import { task, schedules, logger, idempotencyKeys } from "@trigger.dev/sdk";
import {
  searchList,
  fetchExpose,
  type ImmoScoutSearchItem,
} from "../../lib/adapters/immoscout";
import * as ntfy from "../../lib/adapters/ntfy";
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
  emoji?: string;
  priority?: number;
  topicEnv?: string;
}

// ---------------------------------------------------------------------------
// STAGE 1 — the mobile search API filters price/size/radius server-side, so
// this just pages through newest-first results and coarse-drops junk titles.
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
      maxPrice: watch.criteria.maxKaltmiete,
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
// STAGE 2 — per-listing: fetch expose, fine-filter, draft, push ONE ntfy alert.
// idempotencyKey = expose id (global): each listing is decided exactly once.
// ---------------------------------------------------------------------------

export const processListing = task({
  id: "immoscout-process",
  queue: { concurrencyLimit: 4 },
  retry: { maxAttempts: 3 },
  run: async (payload: { candidate: ImmoScoutSearchItem; context: ProcessContext }) => {
    const { candidate, context } = payload;
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
      return { id: candidate.id, notified: false, reason: "gone" };
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
      return { id: candidate.id, notified: false, reason: verdict.reason };
    }
    logger.info(`✅ ${candidate.id} passed the fine filter`, { id: candidate.id });

    const topic =
      process.env[context.topicEnv ?? "IMMOSCOUT_NTFY_TOPIC"] ?? process.env.IMMOSCOUT_NTFY_TOPIC;
    if (!topic) {
      logger.warn(`⚠️ No ntfy topic configured; not pushing ${candidate.id}`, {
        id: candidate.id,
      });
      return { id: candidate.id, notified: false, reason: "no topic" };
    }

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

    const bits = [
      draft.stadtteil,
      draft.kaltmiete != null ? `${draft.kaltmiete}€ kalt` : null,
      draft.warmmiete != null ? `${draft.warmmiete}€ warm` : null,
      draft.wohnflaeche != null ? `${draft.wohnflaeche}m²` : null,
      draft.zimmer != null ? `${draft.zimmer}Zi` : null,
      draft.distanceKm != null ? `${draft.distanceKm}km` : null,
    ].filter(Boolean);
    const pushTitle = `${draft.far ? "⚠️ " : ""}${context.title}: ${bits.join(" · ")}`;

    await ntfy.publish({
      topic,
      title: pushTitle,
      message: draft.body, // pure letter — long-press to copy
      priority: context.priority ?? 4,
      tags: context.emoji ? [context.emoji] : [],
      click: candidate.url,
      actions: [{ action: "view", label: "Auf ImmoScout öffnen", url: candidate.url }],
    });
    logger.info(`📲 Pushed to ntfy "${topic}": ${pushTitle}`, { id: candidate.id });

    return { id: candidate.id, notified: true, framing: draft.framing };
  },
});

// ---------------------------------------------------------------------------
// Child task: process ONE watch — search, fan out per listing.
// ---------------------------------------------------------------------------

export const immoscoutWatch = task({
  id: "immoscout-watch",
  retry: { maxAttempts: 3 },
  run: async (payload: { watch: ImmoScoutWatch }) => {
    const { watch } = payload;
    logger.info(`🏠 IS24 watch "${watch.id}" starting`, {
      radiusKm: watch.radiusKm,
      maxKaltmiete: watch.criteria.maxKaltmiete,
      wohnflaeche: `${watch.criteria.minWohnflaeche ?? "?"}–${watch.criteria.maxWohnflaeche ?? "?"} m²`,
    });

    const candidates = await runSearch(watch);
    if (candidates.length === 0) {
      logger.info(`🔚 IS24 watch "${watch.id}": no candidates this poll`, { watch: watch.id });
      return { watch: watch.id, candidates: 0 };
    }

    const context: ProcessContext = {
      title: watch.title,
      criteria: watch.criteria,
      lmuMaxKm: watch.framing.lmuMaxKm,
      warnMaxKm: watch.framing.warnMaxKm,
      emoji: watch.notify.emoji,
      priority: watch.notify.priority,
      topicEnv: watch.notify.topicEnv,
    };

    const items = await Promise.all(
      candidates.map(async (candidate) => ({
        payload: { candidate, context },
        options: {
          idempotencyKey: await idempotencyKeys.create(candidate.id, { scope: "global" }),
          idempotencyKeyTTL: "30d",
        },
      }))
    );
    await processListing.batchTrigger(items);
    logger.info(`🚀 Triggered ${candidates.length} listing processor(s) for "${watch.id}"`, {
      watch: watch.id,
    });

    return { watch: watch.id, candidates: candidates.length };
  },
});

// ---------------------------------------------------------------------------
// Poller: every 15 minutes, run one child per watch.
// ---------------------------------------------------------------------------

export const immoscoutPoller = schedules.task({
  id: "immoscout-poller",
  cron: "*/15 * * * *",
  run: async (payload) => {
    const window = payload.timestamp.toISOString().slice(0, 16);
    logger.info(`⏰ ImmoScout poller tick @ ${window}`, { watches: IMMOSCOUT_WATCHES.length });

    for (const watch of IMMOSCOUT_WATCHES) {
      const result = await immoscoutWatch.triggerAndWait(
        { watch },
        { idempotencyKey: `is24-${watch.id}-${window}` }
      );
      if (!result.ok) {
        logger.error(`❌ IS24 watch "${watch.id}" failed`, { watch: watch.id, error: result.error });
      }
    }

    return { watches: IMMOSCOUT_WATCHES.length };
  },
});
