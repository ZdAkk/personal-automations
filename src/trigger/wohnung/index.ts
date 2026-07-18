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
import { sendEmail } from "../../lib/adapters/email";
import { renderDigest, type DigestItem } from "../../lib/apartments/digest";
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
  window: string; // the poll window this listing was (first) processed in
}

interface ProcessResult {
  adid: string;
  matched: boolean;
  window: string; // echoed back — equals the current window ONLY when freshly run
  item?: DigestItem;
  reason?: string;
}

// "2026-07-18T14:30" -> "18.07.2026"
function dateLabel(window: string): string {
  const [y, m, d] = window.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
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
    sortByDate: true, // newest-first so 1 page/poll catches all new ads (not the closest)
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
// pass draft the message + build the digest item. Notifies NOTHING itself; the
// watch collects the run's new matches into a single email.
//
// Triggered with idempotencyKey = adid (global, 30d): each ad is detailed and
// decided EXACTLY ONCE. The cached output preserves the ORIGINAL poll `window`,
// so the watch tells "new this poll" (window === current) from "already handled"
// without any external dedup store. The `queue` throttles concurrent detail
// fetches so we never hammer the scraper.
// ---------------------------------------------------------------------------

export const processListing = task({
  id: "wohnung-process",
  queue: { concurrencyLimit: 4 },
  retry: { maxAttempts: 2 }, // scraper is fragile; one retry, not three
  run: async (payload: { candidate: KleinanzeigenListing; context: ProcessContext }): Promise<ProcessResult> => {
    const { candidate, context } = payload;
    const window = context.window;
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
      return { adid: candidate.adid, matched: false, window, reason: "no detail / gone" };
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
      return { adid: candidate.adid, matched: false, window, reason: verdict.reason };
    }
    logger.info(`✅ ${candidate.adid} passed the fine filter`, { adid: candidate.adid });

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

    const item: DigestItem = {
      source: "Kleinanzeigen",
      id: candidate.adid,
      title: detail.title ?? candidate.title ?? "",
      url: candidate.url,
      imageUrl: candidate.image_url,
      location: draft.stadtteil,
      kaltmiete: draft.kaltmiete,
      warmmiete: draft.warmmiete,
      wohnflaeche: draft.wohnflaeche,
      zimmer: draft.zimmer,
      contactName: detail.seller?.name ?? null,
      far: draft.far,
      distanceKm: distanceKm != null ? Math.round(distanceKm) : null,
      letter: draft.body,
    };
    return { adid: candidate.adid, matched: true, window, item };
  },
});

// ---------------------------------------------------------------------------
// Child task: process ONE watch — search, coarse-filter, fan out, email new hits.
// ---------------------------------------------------------------------------

export const wohnungWatch = task({
  id: "wohnung-watch",
  // No retry: a failed search (usually the scraper being slow/wedged) shouldn't
  // hammer it 3x — the next 15-min poll is the retry.
  retry: { maxAttempts: 1 },
  run: async (payload: { watch: WohnungWatch; window: string }) => {
    const { watch, window } = payload;
    logger.info(`🏠 Watch "${watch.id}" starting`, {
      location: watch.location,
      radius: watch.radius,
      maxWarmmiete: watch.criteria.maxWarmmiete,
      minWohnflaeche: watch.criteria.minWohnflaeche,
      minZimmer: watch.criteria.minZimmer,
    });

    const candidates = await runSearch(watch);
    // Dedup by adid within this poll (multiple pages can repeat an ad).
    const unique = [...new Map(candidates.map((c) => [c.adid, c])).values()];
    if (unique.length === 0) {
      logger.info(`🔚 Watch "${watch.id}": no candidates this poll`, { watch: watch.id });
      return { watch: watch.id, candidates: 0, matched: 0, emailed: 0 };
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
      window,
    };

    // idempotencyKey = adid, GLOBAL scope + 30d TTL: each ad is decided exactly
    // once ACROSS polls, so its cached output keeps its ORIGINAL window and the
    // watch only emails it the poll it first appeared. The key MUST be global: a
    // raw string defaults to `run` scope (SDK v4.3.1+), which re-scopes it per
    // poll and re-emails every match every poll.
    const items = await Promise.all(
      unique.map(async (candidate) => ({
        payload: { candidate, context },
        options: {
          idempotencyKey: await idempotencyKeys.create(candidate.adid, { scope: "global" }),
          idempotencyKeyTTL: "30d",
        },
      }))
    );
    const result = await processListing.batchTriggerAndWait(items);

    // NEW this poll iff the run echoes the current window (cached, already-seen
    // ads return the window they were first processed in).
    const newItems: DigestItem[] = [];
    let matchedTotal = 0;
    for (const run of result.runs) {
      if (!run.ok) {
        logger.error(`⚠️ processListing failed`, { error: run.error });
        continue;
      }
      if (run.output.matched) matchedTotal++;
      if (run.output.matched && run.output.window === window && run.output.item) {
        newItems.push(run.output.item);
      }
    }

    logger.info(`📊 Watch "${watch.id}": ${unique.length} candidates, ${matchedTotal} match(es), ${newItems.length} new this poll`, {
      watch: watch.id,
      candidates: unique.length,
      matchedTotal,
      newThisPoll: newItems.length,
    });

    if (newItems.length > 0) {
      const digest = renderDigest("Kleinanzeigen", newItems, dateLabel(window));
      await sendEmail({ subject: digest.subject, html: digest.html, text: digest.text });
      logger.info(`📧 Emailed ${newItems.length} new listing(s): ${digest.subject}`, {
        watch: watch.id,
        ids: newItems.map((i) => i.id),
      });
    }

    return {
      watch: watch.id,
      candidates: unique.length,
      matched: matchedTotal,
      emailed: newItems.length,
    };
  },
});

// ---------------------------------------------------------------------------
// Poller: run one child per watch. The minute-precision window flows down so
// per-listing runs can stamp "which poll first saw me".
// ---------------------------------------------------------------------------

export const wohnungPoller = schedules.task({
  id: "wohnung-poller",
  cron: "*/15 * * * *",
  run: async (payload) => {
    const window = payload.timestamp.toISOString().slice(0, 16);
    logger.info(`⏰ Wohnung poller tick @ ${window}`, { watches: WOHNUNG_WATCHES.length });

    for (const watch of WOHNUNG_WATCHES) {
      const result = await wohnungWatch.triggerAndWait(
        { watch, window },
        { idempotencyKey: `${watch.id}-${window}` }
      );
      if (!result.ok) {
        logger.error(`❌ Watch "${watch.id}" failed`, { watch: watch.id, error: result.error });
      }
    }

    return { watches: WOHNUNG_WATCHES.length };
  },
});
