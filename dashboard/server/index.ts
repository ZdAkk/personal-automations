// ============================================================================
// Wohnung dashboard — LAN-only Fastify server.
//
// Paste apartment listing URLs, get ready-to-send German application letters.
// The drafting itself is NOT reimplemented here: it imports the same
// draftListings() the CLI and the Trigger.dev scouts build on, so the letter
// has exactly one definition in this repo.
//
// Results stream back per listing (SSE) rather than in one blocking response:
// a Kleinanzeigen detail costs a headless-browser fetch plus an LLM call, so a
// batch of ten would otherwise be a minute of blank screen.
//
// No auth, by design: this binds to the LAN and is never exposed publicly,
// which is what keeps the letters (income, phone, SCHUFA date) off the internet.
// ============================================================================

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { parseListingUrls } from "../../src/lib/apartments/url.js";
import { draftListings, type DraftedListing } from "../../src/lib/apartments/draft-from-url.js";
import { APPLICANT, SEARCH, OPERATIONS, radiusFor } from "../../src/config/profile.js";
import type { DraftEvent, DraftResultDto, ProfileDto } from "../shared/api.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const WEB_DIST = path.resolve(HERE, "../web/dist");

// Load the repo-root .env (same file the CLI and Trigger dev use). No dotenv
// dependency: the format we need is one KEY=value per line.
function loadEnv(): void {
  const file = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const PORT = Number(process.env.DASHBOARD_PORT ?? 8088);
const HOST = process.env.DASHBOARD_HOST ?? "0.0.0.0";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  // Generous: a batch of listings legitimately takes minutes, and the SSE
  // response must not be cut off underneath it.
  requestTimeout: 0,
  connectionTimeout: 0,
});

// --- API --------------------------------------------------------------------

app.get("/health", async () => ({ ok: true, uptime: process.uptime() }));

app.get("/api/profile", async (): Promise<ProfileDto> => {
  const c = SEARCH.criteria;
  return {
    applicant: {
      fullName: APPLICANT.fullName,
      moveInDate: APPLICANT.moveInDate,
      monthlyIncomeEur: APPLICANT.monthlyIncomeEur,
      reservesEur: APPLICANT.reservesEur,
      schufaDate: APPLICANT.schufaDate,
      currentCity: APPLICANT.currentCity,
    },
    criteria: {
      maxWarmmiete: c.maxWarmmiete ?? null,
      minWohnflaeche: c.minWohnflaeche ?? null,
      maxWohnflaeche: c.maxWohnflaeche ?? null,
      minZimmer: c.minZimmer ?? null,
    },
    city: { name: SEARCH.city.name, radiusKm: radiusFor("immoscout") },
    llmModel: process.env.WOHNUNG_LLM_MODEL ?? OPERATIONS.llmModel,
  };
});

function toDto(r: DraftedListing): DraftResultDto {
  const i = r.item;
  return {
    source: r.source,
    id: r.id,
    url: r.url,
    ok: r.ok,
    error: r.error,
    outsideCriteria: r.outsideCriteria,
    listing: i
      ? {
          title: i.title,
          imageUrl: i.imageUrl,
          location: i.location,
          kaltmiete: i.kaltmiete,
          warmmiete: i.warmmiete,
          wohnflaeche: i.wohnflaeche,
          zimmer: i.zimmer,
          contactName: i.contactName,
          distanceKm: i.distanceKm,
          far: i.far,
          letter: i.letter,
        }
      : undefined,
  };
}

app.post<{ Body: { urls?: string } }>("/api/draft", async (req, reply) => {
  const { listings, rejected } = parseListingUrls(req.body?.urls ?? "");

  // We drive the socket ourselves from here on; stop Fastify from also trying
  // to send a reply when this handler resolves.
  reply.hijack();

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Defeats nginx/proxy response buffering, which would otherwise collapse
    // the stream back into one blocking response.
    "X-Accel-Buffering": "no",
  });

  // Watch the RESPONSE stream, not the request: on a POST the request stream
  // emits "close" as soon as the body has been read, which would mark the
  // client as gone before any work had even started.
  let closed = false;
  reply.raw.on("close", () => {
    closed = true;
  });

  const send = (e: DraftEvent): void => {
    if (closed) return;
    reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  // Keepalive: a long-stalled listing must not look like a dead connection.
  const heartbeat = setInterval(() => {
    if (!closed) reply.raw.write(": ping\n\n");
  }, 15_000);

  const bySource = listings.reduce<Record<string, number>>((acc, l) => {
    acc[l.source] = (acc[l.source] ?? 0) + 1;
    return acc;
  }, {});
  send({ type: "parsed", total: listings.length, rejected, bySource });

  let index = 0;
  let ok = 0;
  try {
    if (listings.length > 0) {
      await draftListings(listings, {
        concurrency: 3,
        onDone: (r) => {
          if (r.ok) ok++;
          send({ type: "item", index: index++, result: toDto(r) });
        },
      });
    }
    send({ type: "done", total: listings.length, ok });
  } catch (err) {
    req.log.error({ err }, "draft failed");
    send({ type: "error", message: (err as Error).message });
  } finally {
    clearInterval(heartbeat);
    if (!closed) reply.raw.end();
  }
});

// --- static UI --------------------------------------------------------------

if (fs.existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST });
  // SPA fallback so a refresh on any path still serves the app.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || req.url === "/health") {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html");
  });
} else {
  app.log.warn(`No built UI at ${WEB_DIST} — run "npm run build" in dashboard/. API still available.`);
}

await app.listen({ port: PORT, host: HOST });
app.log.info(`Wohnung dashboard on http://${HOST}:${PORT}`);
