import { task, schedules, logger, idempotencyKeys } from "@trigger.dev/sdk";
import {
  searchByUrl,
  buildCategoryUrl,
  listingMatches,
  parsePrice,
  parseDistanceKm,
  fetchDetails,
  featureList,
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
  logger.info("🔍 Stage 1 search", { watch: watch.id, url, maxPages: watch.maxPages });

  const listings = await searchByUrl({ url, max_pages: watch.maxPages });
  const maxKalt = watch.criteria.maxKaltmiete;

  // Radius: Kleinanzeigen pads pages with out-of-radius "(N km)" ads.
  const inRadius = listings.filter((l) => {
    const km = parseDistanceKm(l.location);
    return km === null || km <= watch.radius;
  });
  // Coarse Kaltmiete cap on the search price (keep VB/null for stage 2).
  const underPrice = inRadius.filter((l) => {
    if (maxKalt == null) return true;
    const p = parsePrice(l.price);
    return p === null || p <= maxKalt;
  });
  // Drop only unambiguous junk here (see config.excludeKeywords note).
  const kept = underPrice.filter((l) =>
    listingMatches(l, { excludeAny: watch.criteria.excludeKeywords })
  );

  logger.info(`🧹 Coarse funnel: ${listings.length} raw → ${kept.length} candidates`, {
    watch: watch.id,
    raw: listings.length,
    inRadius: inRadius.length,
    underPrice: underPrice.length,
    kept: kept.length,
  });
  return kept;
}

// ---------------------------------------------------------------------------
// STAGE 2 — per-listing: fetch the detail, apply the real criteria, and on a
// pass draft the message + push ONE ntfy alert (body = the letter to send).
//
// Triggered with idempotencyKey = adid (global), so each ad is detailed and
// decided EXACTLY ONCE (a rejected ad is never re-fetched; a failed run clears
// the key and retries). The `queue` throttles concurrent detail fetches so we
// never hammer the scraper regardless of how many candidates a poll produced.
//
// Each step logs to the run trace so the whole decision is visible in the
// dashboard: what was fetched, why it passed/failed, the draft, and the push.
// ---------------------------------------------------------------------------

export const processListing = task({
  id: "wohnung-process",
  queue: { concurrencyLimit: 4 },
  retry: { maxAttempts: 3 },
  run: async (payload: { candidate: KleinanzeigenListing; context: ProcessContext }) => {
    const { candidate, context } = payload;
    logger.info(`🔎 Processing ${candidate.adid}: ${candidate.title}`, {
      adid: candidate.adid,
      price: candidate.price,
      location: candidate.location,
      url: candidate.url,
    });

    const details = await fetchDetails([candidate.adid], 1);
    const detail = details[0];
    if (!detail || detail.not_found) {
      logger.warn(`⏭️ Skipped ${candidate.adid}: listing gone / no detail`, {
        adid: candidate.adid,
      });
      return { adid: candidate.adid, notified: false, reason: "no detail / gone" };
    }
    logger.info(`📄 Detail fetched: ${detail.title}`, {
      adid: candidate.adid,
      stadtteil: detail.location?.city,
      zip: detail.location?.zip,
      details: detail.details, // Wohnfläche, Zimmer, Nebenkosten, Kaution, …
      features: featureList(detail),
      seller: detail.seller?.name,
    });

    const verdict = applyCriteria(detail, context.criteria);
    if (!verdict.pass) {
      logger.info(`❌ Rejected ${candidate.adid}: ${verdict.reason}`, {
        adid: candidate.adid,
        reason: verdict.reason,
      });
      return { adid: candidate.adid, notified: false, reason: verdict.reason };
    }
    logger.info(`✅ ${candidate.adid} passed the fine filter`, { adid: candidate.adid });

    const topic =
      process.env[context.topicEnv ?? "WOHNUNG_NTFY_TOPIC"] ?? process.env.WOHNUNG_NTFY_TOPIC;
    if (!topic) {
      logger.warn(`⚠️ No ntfy topic configured; not pushing ${candidate.adid}`, {
        adid: candidate.adid,
      });
      return { adid: candidate.adid, notified: false, reason: "no topic" };
    }

    const distanceKm = parseDistanceKm(candidate.location);
    const draft = await draftFromDetail(detail, distanceKm, {
      lmuMaxKm: context.lmuMaxKm,
      warnMaxKm: context.warnMaxKm,
    });
    logger.info(`✍️ Draft ready (${draft.framing} framing)`, {
      adid: candidate.adid,
      stadtteil: draft.stadtteil,
      kaltmiete: draft.kaltmiete,
      warmmiete: draft.warmmiete,
      wohnflaeche: draft.wohnflaeche,
      zimmer: draft.zimmer,
      distanceKm,
      framing: draft.framing,
      hook: draft.body.split("\n\n")[1], // the LLM-generated opening sentence
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
    const pushTitle = `${draft.far ? "⚠️ " : ""}${context.title}: ${bits.join(" · ")}`;

    // Message body is the PURE letter so "copy message" in ntfy yields exactly
    // the text to paste. Listing meta lives in the title (not copied); the ad
    // title/details are one tap away via the click/action link below.
    await ntfy.publish({
      topic,
      title: pushTitle,
      message: draft.body,
      priority: context.priority ?? 4,
      tags: context.emoji ? [context.emoji] : [],
      click: candidate.url,
      actions: [{ action: "view", label: "Anzeige öffnen", url: candidate.url }],
    });
    logger.info(`📲 Pushed to ntfy "${topic}": ${pushTitle}`, { adid: candidate.adid });

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
    logger.info(`🏠 Watch "${watch.id}" starting`, {
      location: watch.location,
      radius: watch.radius,
      maxKaltmiete: watch.criteria.maxKaltmiete,
      wohnflaeche: `${watch.criteria.minWohnflaeche ?? "?"}–${watch.criteria.maxWohnflaeche ?? "?"} m²`,
    });

    const candidates = await runSearch(watch);
    // Dedup by adid within this poll (multiple pages can repeat an ad).
    const unique = [...new Map(candidates.map((c) => [c.adid, c])).values()];
    if (unique.length === 0) {
      logger.info(`🔚 Watch "${watch.id}": no candidates this poll`, { watch: watch.id });
      return { watch: watch.id, candidates: 0 };
    }
    logger.info(`📋 ${unique.length} candidate(s) to detail-check`, {
      watch: watch.id,
      adids: unique.map((c) => c.adid),
    });

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
    logger.info(`🚀 Triggered ${unique.length} listing processor(s) for "${watch.id}"`, {
      watch: watch.id,
    });

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
    logger.info(`⏰ Wohnung poller tick @ ${window}`, { watches: WOHNUNG_WATCHES.length });

    for (const watch of WOHNUNG_WATCHES) {
      const result = await wohnungWatch.triggerAndWait(
        { watch },
        { idempotencyKey: `${watch.id}-${window}` }
      );
      if (!result.ok) {
        logger.error(`❌ Watch "${watch.id}" failed`, { watch: watch.id, error: result.error });
      }
    }

    return { watches: WOHNUNG_WATCHES.length };
  },
});
