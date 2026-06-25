import { task, schedules, logger } from "@trigger.dev/sdk";
import {
  searchByUrl,
  buildCategoryUrl,
  listingMatches,
  parsePrice,
  parseDistanceKm,
  type KleinanzeigenListing,
} from "../../lib/adapters/kleinanzeigen";
import * as ntfy from "../../lib/adapters/ntfy";
import {
  KLEINANZEIGEN_WATCHES,
  KleinanzeigenWatch,
  type KleinanzeigenTarget,
} from "../../config/kleinanzeigen-watches";

interface MatchedListing {
  label: string;
  adid: string;
  title: string;
  price: string | null;
  url: string;
  location: string | null;
}

// The notification context a listing needs, lifted off its watch so we don't
// ship the whole watch (with all targets) on every notify trigger.
interface NotifyContext {
  title: string; // watch.title
  description: string; // watch.description
  emoji?: string;
  priority?: number;
  topicEnv?: string;
}

// ---------------------------------------------------------------------------
// Run one target: build the category URL, search, filter by keywords + price.
// ---------------------------------------------------------------------------

async function runTarget(
  watch: KleinanzeigenWatch,
  target: KleinanzeigenTarget
): Promise<MatchedListing[]> {
  const url = buildCategoryUrl({
    categorySlug: watch.category.slug,
    categoryId: watch.category.id,
    keyword: target.keyword,
    offersOnly: watch.offersOnly,
    min_price: target.min_price,
    max_price: target.max_price,
    location: watch.location,
    radius: watch.radius,
  });

  // No publish-date window: every poll fetches all current matches. Re-alerting
  // is prevented by notifyListing's adid idempotency, not by a freshness filter.
  const listings = await searchByUrl({ url, max_pages: watch.maxPages });

  return listings
    // Enforce the radius: with a location active, Kleinanzeigen pads the page
    // with out-of-radius ads tagged "(N km)". Keep only those within radius
    // (untagged listings are kept — they only appear when no location is set).
    .filter((l: KleinanzeigenListing) => {
      if (watch.radius == null) return true;
      const km = parseDistanceKm(l.location);
      return km === null || km <= watch.radius;
    })
    .filter((l: KleinanzeigenListing) =>
      listingMatches(l, { requireAll: target.requireAll, excludeAny: target.excludeAny })
    )
    .map((l) => ({ l, price_eur: parsePrice(l.price) }))
    // keep VB/negotiable (null price); otherwise enforce the [min, max] window
    .filter(({ price_eur }) =>
      price_eur === null || (price_eur <= target.max_price && price_eur >= (target.min_price ?? 0))
    )
    .map(({ l }) => ({
      label: target.label,
      adid: l.adid,
      title: l.title,
      price: l.price,
      url: l.url,
      location: l.location,
    }));
}

// ---------------------------------------------------------------------------
// Notify task: send ONE ntfy push for ONE listing (via the ntfy adapter).
//
// Triggered with idempotencyKey = adid, so a given ad notifies exactly once.
// This is the *only* thing preventing re-alerts: every poll fetches all current
// matches, and the 30-day TTL means an ad already seen won't ping again until
// long after it's gone (a relisted ad gets a new adid, so it would alert anew).
// ---------------------------------------------------------------------------

export const notifyListing = task({
  id: "kleinanzeigen-notify",
  retry: { maxAttempts: 3 },
  run: async (payload: { listing: MatchedListing; context: NotifyContext }) => {
    const { listing, context } = payload;

    const topic =
      process.env[context.topicEnv ?? "KLEINANZEIGEN_NTFY_TOPIC"] ?? process.env.KLEINANZEIGEN_NTFY_TOPIC;
    if (!topic) {
      logger.warn("No ntfy topic configured; skipping notification", { adid: listing.adid });
      return { sent: false };
    }

    const price = listing.price ? `${listing.price} €` : "VB";

    await ntfy.publish({
      topic,
      title: `${context.title}: ${listing.label} — ${price}`,
      message: [listing.title, listing.location, context.description].filter(Boolean).join(" · "),
      priority: context.priority ?? 4,
      tags: context.emoji ? [context.emoji] : [],
      click: listing.url, // tap notification → opens the listing
      actions: [{ action: "view", label: "Anzeige öffnen", url: listing.url }],
    });

    return { sent: true, adid: listing.adid };
  },
});

// ---------------------------------------------------------------------------
// Child task: process ONE watch (category) — run its targets, fan out notifies.
// ---------------------------------------------------------------------------

export const kleinanzeigenWatch = task({
  id: "kleinanzeigen-watch",
  retry: { maxAttempts: 3 },
  run: async (payload: { watch: KleinanzeigenWatch }) => {
    const { watch } = payload;
    logger.log("Watch starting", { watch: watch.id, targets: watch.targets.length });

    const found: MatchedListing[] = [];
    for (const target of watch.targets) {
      found.push(...(await runTarget(watch, target)));
    }

    // Collapse the same ad matched by multiple targets so we issue one notify
    // trigger per ad (the idempotency key would dedupe anyway — this just avoids
    // redundant triggers).
    const matches = [...new Map(found.map((m) => [m.adid, m])).values()];

    logger.log("Watch complete", { watch: watch.id, matches: matches.length });
    if (matches.length === 0) return { watch: watch.id, matched: 0 };

    logger.log(
      `Matches: ${watch.title}`,
      Object.fromEntries(matches.map((m, i) => [`listing_${i}`, `${m.label} — ${m.price ?? "VB"} — ${m.url}`]))
    );

    const context: NotifyContext = {
      title: watch.title,
      description: watch.description,
      emoji: watch.notify.emoji,
      priority: watch.notify.priority,
      topicEnv: watch.notify.topicEnv,
    };

    // Fire-and-forget; idempotencyKey = adid guarantees once-per-ad. The 30-day
    // TTL means a still-listed ad never re-pings; a relisted ad (new adid) does.
    await notifyListing.batchTrigger(
      matches.map((listing) => ({
        payload: { listing, context },
        options: { idempotencyKey: listing.adid, idempotencyKeyTTL: "30d" },
      }))
    );

    return { watch: watch.id, matched: matches.length };
  },
});

// ---------------------------------------------------------------------------
// Poller: every 5 minutes, trigger one child run per watch in the list.
// ---------------------------------------------------------------------------

export const kleinanzeigenPoller = schedules.task({
  id: "kleinanzeigen-poller",
  cron: "*/5 * * * *",
  run: async (payload) => {
    // Each poll fetches all current matches; re-alerting is handled downstream by
    // notifyListing's adid idempotency, so there's no freshness window here.
    // Key the per-watch run on the scheduled timestamp so a poller retry reuses
    // the same run instead of re-scraping.
    const window = payload.timestamp.toISOString().slice(0, 16);

    logger.log("Kleinanzeigen poller starting", { watches: KLEINANZEIGEN_WATCHES.length });

    for (const watch of KLEINANZEIGEN_WATCHES) {
      const result = await kleinanzeigenWatch.triggerAndWait(
        { watch },
        { idempotencyKey: `${watch.id}-${window}` }
      );
      if (!result.ok) {
        logger.warn("Watch failed", { watch: watch.id, error: result.error });
      }
    }

    return { watches: KLEINANZEIGEN_WATCHES.length };
  },
});
