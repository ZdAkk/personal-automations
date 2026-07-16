import { task, schedules, logger, idempotencyKeys } from "@trigger.dev/sdk";
import {
  searchByUrl,
  buildCategoryUrl,
  listingMatches,
  parsePrice,
  parseDistanceKm,
  fetchDetails,
  type KleinanzeigenListing,
} from "../../lib/adapters/kleinanzeigen";
import * as ntfy from "../../lib/adapters/ntfy";
import { draftFromDetail } from "../../lib/wohnung/draft";
import { applyCriteria } from "../../lib/wohnung/filter";
import { WOHNUNG_WATCHES, WohnungWatch, type WohnungCriteria } from "../../config/wohnung-watches";

// Context lifted off the watch so we don't ship the whole watch on every
// per-listing trigger.
interface ProcessContext {
  title: string;
  description: string;
  criteria: WohnungCriteria;
  lmuMaxKm: number;
  warnMaxKm: number;
  emoji?: string;
  priority?: number;
  topicEnv?: string;
}

// ---------------------------------------------------------------------------
// STAGE 1 — Obermenge: broad category search + coarse filters (radius, price
// cap, unambiguous junk keywords). The search endpoint only exposes
// title/price/location/description, so this deliberately still contains junk;
// the real filtering happens in stage 2 on the detail.
// ---------------------------------------------------------------------------

async function runSearch(watch: WohnungWatch): Promise<KleinanzeigenListing[]> {
  const url = buildCategoryUrl({
    categorySlug: watch.category.slug,
    categoryId: watch.category.id,
    keyword: watch.keyword,
    offersOnly: watch.offersOnly,
    location: watch.location,
    radius: watch.radius,
  });

  const listings = await searchByUrl({ url, max_pages: watch.maxPages });
  const maxKalt = watch.criteria.maxKaltmiete;

  return listings
    // Enforce the radius (Kleinanzeigen pads pages with out-of-radius "(N km)" ads).
    .filter((l) => {
      const km = parseDistanceKm(l.location);
      return km === null || km <= watch.radius;
    })
    // Coarse Kaltmiete cap on the search price (keep VB/null for stage 2).
    .filter((l) => {
      if (maxKalt == null) return true;
      const p = parsePrice(l.price);
      return p === null || p <= maxKalt;
    })
    // Drop only unambiguous junk here (see config.excludeKeywords note).
    .filter((l) => listingMatches(l, { excludeAny: watch.criteria.excludeKeywords }));
}

// ---------------------------------------------------------------------------
// STAGE 2 — per-listing: fetch the detail, apply the real criteria, and on a
// pass draft the message + push ONE ntfy alert (body = the letter to send).
//
// Triggered with idempotencyKey = adid (global), so each ad is detailed and
// decided EXACTLY ONCE (a rejected ad is never re-fetched; a failed run clears
// the key and retries). The `queue` throttles concurrent detail fetches so we
// never hammer the scraper regardless of how many candidates a poll produced.
// ---------------------------------------------------------------------------

export const processListing = task({
  id: "wohnung-process",
  queue: { concurrencyLimit: 4 },
  retry: { maxAttempts: 3 },
  run: async (payload: { candidate: KleinanzeigenListing; context: ProcessContext }) => {
    const { candidate, context } = payload;

    const details = await fetchDetails([candidate.adid], 1);
    const detail = details[0];
    if (!detail || detail.not_found) {
      return { adid: candidate.adid, notified: false, reason: "no detail / gone" };
    }

    const verdict = applyCriteria(detail, context.criteria);
    if (!verdict.pass) {
      logger.log("Rejected", { adid: candidate.adid, reason: verdict.reason });
      return { adid: candidate.adid, notified: false, reason: verdict.reason };
    }

    const topic =
      process.env[context.topicEnv ?? "WOHNUNG_NTFY_TOPIC"] ?? process.env.WOHNUNG_NTFY_TOPIC;
    if (!topic) {
      logger.warn("No ntfy topic configured; skipping push", { adid: candidate.adid });
      return { adid: candidate.adid, notified: false, reason: "no topic" };
    }

    const distanceKm = parseDistanceKm(candidate.location);
    const draft = await draftFromDetail(detail, distanceKm, {
      lmuMaxKm: context.lmuMaxKm,
      warnMaxKm: context.warnMaxKm,
    });

    // Title = at-a-glance facts; body = the pure letter (long-press to copy).
    const bits = [
      draft.stadtteil,
      draft.kaltmiete != null ? `${draft.kaltmiete}€ kalt` : null,
      draft.warmmiete != null ? `${draft.warmmiete}€ warm` : null,
      draft.wohnflaeche != null ? `${draft.wohnflaeche}m²` : null,
      draft.zimmer != null ? `${draft.zimmer}Zi` : null,
      distanceKm != null ? `${Math.round(distanceKm)}km` : null,
    ].filter(Boolean);

    await ntfy.publish({
      topic,
      title: `${draft.far ? "⚠️ " : ""}${context.title}: ${bits.join(" · ")}`,
      message: `${detail.title ?? ""}\n\n${draft.body}`,
      priority: context.priority ?? 4,
      tags: context.emoji ? [context.emoji] : [],
      click: candidate.url,
      actions: [{ action: "view", label: "Anzeige öffnen", url: candidate.url }],
    });

    return { adid: candidate.adid, notified: true, framing: draft.framing };
  },
});

// ---------------------------------------------------------------------------
// Child task: process ONE watch — search, coarse-filter, fan out per listing.
// ---------------------------------------------------------------------------

export const wohnungWatch = task({
  id: "wohnung-watch",
  retry: { maxAttempts: 3 },
  run: async (payload: { watch: WohnungWatch }) => {
    const { watch } = payload;
    logger.log("Watch starting", { watch: watch.id });

    const candidates = await runSearch(watch);
    // Dedup by adid within this poll (multiple pages can repeat an ad).
    const unique = [...new Map(candidates.map((c) => [c.adid, c])).values()];
    logger.log("Coarse candidates", { watch: watch.id, count: unique.length });
    if (unique.length === 0) return { watch: watch.id, candidates: 0 };

    const context: ProcessContext = {
      title: watch.title,
      description: watch.description,
      criteria: watch.criteria,
      lmuMaxKm: watch.framing.lmuMaxKm,
      warnMaxKm: watch.framing.warnMaxKm,
      emoji: watch.notify.emoji,
      priority: watch.notify.priority,
      topicEnv: watch.notify.topicEnv,
    };

    // idempotencyKey = adid (GLOBAL, TTL): each ad is detailed+decided once.
    const items = await Promise.all(
      unique.map(async (candidate) => ({
        payload: { candidate, context },
        options: {
          idempotencyKey: await idempotencyKeys.create(candidate.adid, { scope: "global" }),
          idempotencyKeyTTL: "30d",
        },
      }))
    );
    await processListing.batchTrigger(items);

    return { watch: watch.id, candidates: unique.length };
  },
});

// ---------------------------------------------------------------------------
// Poller: every 15 minutes, run one child per watch.
// ---------------------------------------------------------------------------

export const wohnungPoller = schedules.task({
  id: "wohnung-poller",
  cron: "*/15 * * * *",
  run: async (payload) => {
    const window = payload.timestamp.toISOString().slice(0, 16);
    logger.log("Wohnung poller starting", { watches: WOHNUNG_WATCHES.length });

    for (const watch of WOHNUNG_WATCHES) {
      const result = await wohnungWatch.triggerAndWait(
        { watch },
        { idempotencyKey: `${watch.id}-${window}` }
      );
      if (!result.ok) {
        logger.warn("Watch failed", { watch: watch.id, error: result.error });
      }
    }

    return { watches: WOHNUNG_WATCHES.length };
  },
});
