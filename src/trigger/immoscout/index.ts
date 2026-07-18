import { task, schedules, logger, idempotencyKeys } from "@trigger.dev/sdk";
import {
  searchList,
  fetchExpose,
  type ImmoScoutSearchItem,
} from "../../lib/adapters/immoscout";
import { sendEmail } from "../../lib/adapters/email";
import { renderDigest, type DigestItem } from "../../lib/apartments/digest";
import { applyCriteria } from "../../lib/immoscout/filter";
import { draftFromExpose } from "../../lib/immoscout/draft";
import {
  IMMOSCOUT_WATCHES,
  ImmoScoutWatch,
  type ImmoScoutCriteria,
} from "../../config/immoscout-watches";

interface ProcessContext {
  title: string;
  criteria: ImmoScoutCriteria;
  lmuMaxKm: number;
  warnMaxKm: number;
  window: string; // the poll window this listing was (first) processed in
}

interface ProcessResult {
  id: string;
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
// STAGE 1 — the mobile search API filters price/size/rooms/radius server-side,
// so this just pages through newest-first results and coarse-drops junk titles.
// ---------------------------------------------------------------------------

async function runSearch(watch: ImmoScoutWatch): Promise<ImmoScoutSearchItem[]> {
  const excludes = watch.criteria.excludeKeywords ?? [];
  const all: ImmoScoutSearchItem[] = [];
  let total = 0;
  for (let page = 1; page <= watch.maxPages; page++) {
    const { total: t, items } = await searchList({
      lat: watch.lat,
      lon: watch.lon,
      radiusKm: watch.radiusKm,
      // Search price param is the base rent; warm >= kalt, so a Kaltmiete cap at
      // the Warmmiete limit is a safe superset (fine filter enforces warm).
      maxPrice: watch.criteria.maxWarmmiete ?? watch.criteria.maxKaltmiete,
      minLivingSpace: watch.criteria.minWohnflaeche,
      maxLivingSpace: watch.criteria.maxWohnflaeche,
      minRooms: watch.criteria.minZimmer,
      maxRooms: watch.criteria.maxZimmer,
      pageSize: watch.pageSize,
      pageNumber: page,
      sorting: "-firstactivation",
    });
    total = t;
    all.push(...items);
    if (items.length < watch.pageSize) break; // last page
  }

  const kept = all.filter((it) => {
    const title = (it.title ?? "").toLowerCase();
    return !excludes.some((k) => title.includes(k.toLowerCase()));
  });
  const unique = [...new Map(kept.map((it) => [it.id, it])).values()];

  logger.info(`🔍 Search: ${total} total in criteria → ${unique.length} candidates`, {
    watch: watch.id,
    fetched: all.length,
    afterTitleFilter: kept.length,
    unique: unique.length,
  });
  return unique;
}

// ---------------------------------------------------------------------------
// STAGE 2 — per-listing: fetch expose, fine-filter, and on a pass draft the
// letter + build the digest item. It notifies NOTHING itself; the watch collects
// the new matches into one email.
//
// Triggered with idempotencyKey = expose id (global, 30d): each listing is
// decided exactly once. Because the output is cached, a listing seen in a later
// poll returns its ORIGINAL `window`; the watch uses window === currentWindow to
// tell "new this poll" from "already handled" — no external dedup store needed.
// ---------------------------------------------------------------------------

export const processListing = task({
  id: "immoscout-process",
  queue: { concurrencyLimit: 4 },
  retry: { maxAttempts: 3 },
  run: async (payload: { candidate: ImmoScoutSearchItem; context: ProcessContext }): Promise<ProcessResult> => {
    const { candidate, context } = payload;
    const window = context.window;
    logger.info(`🔎 Processing ${candidate.id}: ${candidate.title}`, {
      id: candidate.id,
      address: candidate.addressLine,
      teaser: `${candidate.price ?? "?"} · ${candidate.size ?? "?"} · ${candidate.rooms ?? "?"}`,
      isPrivate: candidate.isPrivate,
      url: candidate.url,
    });

    const detail = await fetchExpose(candidate.id);
    if (!detail || detail.notFound) {
      logger.warn(`⏭️ Skipped ${candidate.id}: listing gone`, { id: candidate.id });
      return { id: candidate.id, matched: false, window, reason: "gone" };
    }
    logger.info(`📄 Detail: ${detail.title}`, {
      id: candidate.id,
      stadtteil: detail.stadtteil,
      zip: detail.zip,
      kaltmiete: detail.kaltmiete,
      warmmiete: detail.warmmiete,
      kaution: detail.kaution,
      wohnflaeche: detail.wohnflaeche,
      zimmer: detail.zimmer,
      features: detail.features,
      contact: detail.contactName,
    });

    const verdict = applyCriteria(detail, context.criteria);
    if (!verdict.pass) {
      logger.info(`❌ Rejected ${candidate.id}: ${verdict.reason}`, {
        id: candidate.id,
        reason: verdict.reason,
      });
      return { id: candidate.id, matched: false, window, reason: verdict.reason };
    }
    logger.info(`✅ ${candidate.id} passed the fine filter`, { id: candidate.id });

    const draft = await draftFromExpose(
      detail,
      { lat: candidate.lat, lon: candidate.lon },
      { lmuMaxKm: context.lmuMaxKm, warnMaxKm: context.warnMaxKm }
    );
    logger.info(`✍️ Draft ready (${draft.framing} framing)`, {
      id: candidate.id,
      distanceKm: draft.distanceKm,
      contact: draft.contactName,
      hook: draft.body.split("\n\n")[1],
    });

    const item: DigestItem = {
      source: "ImmoScout24",
      id: candidate.id,
      title: detail.title ?? candidate.title ?? "",
      url: candidate.url,
      imageUrl: detail.imageUrl,
      location: draft.stadtteil,
      kaltmiete: draft.kaltmiete,
      warmmiete: draft.warmmiete,
      wohnflaeche: draft.wohnflaeche,
      zimmer: draft.zimmer,
      contactName: draft.contactName,
      far: draft.far,
      distanceKm: draft.distanceKm,
      letter: draft.body,
    };
    return { id: candidate.id, matched: true, window, item };
  },
});

// ---------------------------------------------------------------------------
// Child task: process ONE watch — search, fan out per listing, email new hits.
// ---------------------------------------------------------------------------

export const immoscoutWatch = task({
  id: "immoscout-watch",
  retry: { maxAttempts: 3 },
  run: async (payload: { watch: ImmoScoutWatch; window: string }) => {
    const { watch, window } = payload;
    logger.info(`🏠 IS24 watch "${watch.id}" starting`, {
      radiusKm: watch.radiusKm,
      maxWarmmiete: watch.criteria.maxWarmmiete,
      minWohnflaeche: watch.criteria.minWohnflaeche,
      minZimmer: watch.criteria.minZimmer,
    });

    const candidates = await runSearch(watch);
    if (candidates.length === 0) {
      logger.info(`🔚 IS24 watch "${watch.id}": no candidates this poll`, { watch: watch.id });
      return { watch: watch.id, candidates: 0, matched: 0, emailed: 0 };
    }

    const context: ProcessContext = {
      title: watch.title,
      criteria: watch.criteria,
      lmuMaxKm: watch.framing.lmuMaxKm,
      warnMaxKm: watch.framing.warnMaxKm,
      window,
    };

    // idempotencyKey = expose id, GLOBAL scope + 30d TTL: each listing is decided
    // exactly once ACROSS polls, so its cached output keeps its ORIGINAL window
    // and the watch only emails it the poll it first appeared. The key MUST be
    // global: a raw string defaults to `run` scope (SDK v4.3.1+), which re-scopes
    // it per poll and re-emails every match every 15 min.
    const items = await Promise.all(
      candidates.map(async (candidate) => ({
        payload: { candidate, context },
        options: {
          idempotencyKey: await idempotencyKeys.create(candidate.id, { scope: "global" }),
          idempotencyKeyTTL: "30d",
        },
      }))
    );
    const result = await processListing.batchTriggerAndWait(items);

    // A run is NEW this poll iff it echoes the current window (a cached, already-
    // seen listing returns the window it was first processed in).
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

    logger.info(`📊 IS24 watch "${watch.id}": ${candidates.length} candidates, ${matchedTotal} match(es), ${newItems.length} new this poll`, {
      watch: watch.id,
      candidates: candidates.length,
      matchedTotal,
      newThisPoll: newItems.length,
    });

    if (newItems.length > 0) {
      const digest = renderDigest("ImmoScout24", newItems, dateLabel(window));
      await sendEmail({ subject: digest.subject, html: digest.html, text: digest.text });
      logger.info(`📧 Emailed ${newItems.length} new listing(s): ${digest.subject}`, {
        watch: watch.id,
        ids: newItems.map((i) => i.id),
      });
    }

    return {
      watch: watch.id,
      candidates: candidates.length,
      matched: matchedTotal,
      emailed: newItems.length,
    };
  },
});

// ---------------------------------------------------------------------------
// Poller: run one child per watch. The minute-precision window flows down so
// per-listing runs can stamp "which poll first saw me".
// ---------------------------------------------------------------------------

export const immoscoutPoller = schedules.task({
  id: "immoscout-poller",
  cron: "*/15 * * * *",
  run: async (payload) => {
    const window = payload.timestamp.toISOString().slice(0, 16);
    logger.info(`⏰ ImmoScout poller tick @ ${window}`, { watches: IMMOSCOUT_WATCHES.length });

    for (const watch of IMMOSCOUT_WATCHES) {
      const result = await immoscoutWatch.triggerAndWait(
        { watch, window },
        { idempotencyKey: `is24-${watch.id}-${window}` }
      );
      if (!result.ok) {
        logger.error(`❌ IS24 watch "${watch.id}" failed`, { watch: watch.id, error: result.error });
      }
    }

    return { watches: IMMOSCOUT_WATCHES.length };
  },
});
