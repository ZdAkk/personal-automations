import { task, schedules, logger } from "@trigger.dev/sdk";
import {
  searchByUrl,
  buildCategoryUrl,
  listingMatches,
  parsePrice,
  parseDistanceKm,
  type KleinanzeigenListing,
} from "../../lib/kleinanzeigen";
import {
  KLEINANZEIGEN_WATCHES,
  KleinanzeigenWatch,
  type KleinanzeigenTarget,
} from "../../config/kleinanzeigen-watches";

// The child receives a KleinanzeigenWatch instance as plain JSON (methods are
// stripped crossing the task boundary, but the class is pure data — the
// constructor already normalized everything we read — so its type describes the
// payload exactly).
interface MatchedListing {
  label: string;
  adid: string;
  title: string;
  price: string | null;
  url: string;
  location: string | null;
}

// ---------------------------------------------------------------------------
// Run one target: build the category URL, search, filter by keywords + price.
// ---------------------------------------------------------------------------

async function runTarget(
  watch: KleinanzeigenWatch,
  target: KleinanzeigenTarget,
  minPublishDate: string
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

  const listings = await searchByUrl({ url, max_pages: watch.maxPages, min_publish_date: minPublishDate });

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
// Notify — one ntfy push per listing, carrying the watch's context.
// ---------------------------------------------------------------------------

async function notify(watch: KleinanzeigenWatch, listings: MatchedListing[]): Promise<void> {
  const topic =
    process.env[watch.notify.topicEnv ?? "KLEINANZEIGEN_NTFY_TOPIC"] ??
    process.env.KLEINANZEIGEN_NTFY_TOPIC;
  if (!topic) return;

  const ntfyBase = (process.env.KLEINANZEIGEN_NTFY_URL ?? "https://ntfy.sh").replace(/\/$/, "");
  const tags = watch.notify.emoji ? [watch.notify.emoji] : [];
  const priority = watch.notify.priority ?? 4;

  for (const l of listings) {
    const price = l.price ? `${l.price} €` : "VB";
    const message = [l.title, l.location, watch.description].filter(Boolean).join(" · ");

    await fetch(`${ntfyBase}/${topic}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        title: `${watch.title}: ${l.label} — ${price}`,
        message,
        priority,
        tags,
        click: l.url, // tap notification → opens the listing
        actions: [{ action: "view", label: "Anzeige öffnen", url: l.url }],
      }),
    }).then((r) => {
      if (!r.ok) logger.warn("ntfy notification failed", { status: r.status, adid: l.adid });
    });
  }
}

// ---------------------------------------------------------------------------
// Child task: process ONE watch (category) — all its targets, dedupe, notify.
// ---------------------------------------------------------------------------

export const kleinanzeigenWatch = task({
  id: "kleinanzeigen-watch",
  retry: { maxAttempts: 3 },
  run: async (payload: { watch: KleinanzeigenWatch; minPublishDate: string }) => {
    const { watch, minPublishDate } = payload;
    logger.log("Watch starting", { watch: watch.id, targets: watch.targets.length });

    const matches: MatchedListing[] = [];
    const seen = new Set<string>();

    for (const target of watch.targets) {
      const found = await runTarget(watch, target, minPublishDate);
      for (const m of found) {
        if (!seen.has(m.adid)) {
          seen.add(m.adid);
          matches.push(m);
        }
      }
    }

    logger.log("Watch complete", { watch: watch.id, matches: matches.length });

    if (matches.length > 0) {
      logger.log(
        `New listings: ${watch.title}`,
        Object.fromEntries(matches.map((m, i) => [`listing_${i}`, `${m.label} — ${m.price ?? "VB"} — ${m.url}`]))
      );
      await notify(watch, matches);
    }

    return { watch: watch.id, matched: matches.length };
  },
});

// ---------------------------------------------------------------------------
// Poller: every 5 minutes, trigger one child run per watch in the list.
// ---------------------------------------------------------------------------

export const kleinanzeigenPoller = schedules.task({
  id: "kleinanzeigen-poller",
  cron: "*/5 * * * *",
  run: async () => {
    // 8-minute lookback gives a 3-minute overlap over the 5-minute cadence so
    // nothing slips between runs; per-watch dedup avoids double-alerting.
    const cutoff = new Date(Date.now() - 8 * 60 * 1000);
    const minPublishDate = cutoff.toISOString().slice(0, 19);
    const window = cutoff.toISOString().slice(0, 16);

    logger.log("Kleinanzeigen poller starting", { watches: KLEINANZEIGEN_WATCHES.length, minPublishDate });

    for (const watch of KLEINANZEIGEN_WATCHES) {
      const result = await kleinanzeigenWatch.triggerAndWait(
        { watch, minPublishDate },
        { idempotencyKey: `${watch.id}-${window}` }
      );
      if (!result.ok) {
        logger.warn("Watch failed", { watch: watch.id, error: result.error });
      }
    }

    return { watches: KLEINANZEIGEN_WATCHES.length };
  },
});
