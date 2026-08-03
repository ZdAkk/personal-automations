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

import { parseListingUrls, parseListingUrl } from "../../src/lib/apartments/url";
import {
  draftListing,
  draftListings,
  type DraftedListing,
} from "../../src/lib/apartments/draft-from-url";
import {
  SITUATION,
  applyProfile,
  profilePath,
  profileValues,
  reloadProfile,
  type ProfileValues,
} from "../../src/config/profile";
import type { DraftEvent, DraftResultDto, ProfileMeta } from "../shared/api.js";

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

app.get("/api/profile", async () => {
  // Re-read from disk so an edit made outside the UI is picked up too.
  await reloadProfile();
  return profileValues();
});

app.get("/api/profile/meta", async (): Promise<ProfileMeta> => {
  const p = profilePath();
  if (!p) return { path: null, writable: false };
  try {
    await fs.promises.access(p, fs.constants.W_OK);
    return { path: p, writable: true };
  } catch {
    return { path: p, writable: false };
  }
});

app.put<{ Body: ProfileValues }>("/api/profile", async (req, reply) => {
  const next = req.body;
  if (!next?.applicant || !next?.situation || !next?.search) {
    return reply.code(400).send({ error: "incomplete profile payload" });
  }
  const file = profilePath();
  if (!file) return reply.code(500).send({ error: "profile.json path unavailable" });

  // Write the same file the Trigger.dev pipelines read at build time, so the
  // dashboard and the scouts cannot drift. Formatted for a readable git diff.
  await fs.promises.writeFile(file, `${JSON.stringify(next, null, 2)}
`, "utf8");
  applyProfile(next);
  req.log.info("profile saved");
  return { ok: true, path: file };
});

function toDto(r: DraftedListing, interest: number): DraftResultDto {
  const i = r.item;
  return {
    source: r.source,
    id: r.id,
    url: r.url,
    ok: r.ok,
    error: r.error,
    outsideCriteria: r.outsideCriteria,
    interest,
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

app.post<{ Body: { urls?: string; interest?: number } }>("/api/draft", async (req, reply) => {
  const { listings, rejected } = parseListingUrls(req.body?.urls ?? "");
  const interest = clampInterest(req.body?.interest);

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
        interest,
        onDone: (r) => {
          if (r.ok) ok++;
          send({ type: "item", index: index++, result: toDto(r, interest) });
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

function clampInterest(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return SITUATION.interest.default;
  return Math.max(1, Math.min(10, Math.round(n)));
}

// Re-draft ONE listing, used when a card's interest slider moves. Cheap enough
// to be synchronous: a single fetch plus one short LLM call.
app.post<{ Body: { url?: string; interest?: number } }>("/api/draft-one", async (req, reply) => {
  const parsed = parseListingUrl(req.body?.url ?? "");
  if (!parsed) return reply.code(400).send({ error: "not a recognised listing URL" });
  const interest = clampInterest(req.body?.interest);
  const result = await draftListing(parsed, interest);
  return toDto(result, interest);
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
