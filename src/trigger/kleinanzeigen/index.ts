import { task, schedules, logger } from "@trigger.dev/sdk";
import { searchListings, parsePrice, type KleinanzeigenListing } from "../../lib/kleinanzeigen";
import { GPU_SEARCHES, type SearchTarget } from "../../config/kleinanzeigen-searches";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MatchedListing {
  target: string;
  label: string;
  adid: string;
  title: string;
  price: string | null;
  price_eur: number | null;
  url: string;
  location: string | null;
  published_at: string | null;
}

// ---------------------------------------------------------------------------
// Child task: run one search target
// ---------------------------------------------------------------------------

export const kleinanzeigenSearch = task({
  id: "kleinanzeigen-search",
  retry: { maxAttempts: 3 },
  run: async (payload: { target: SearchTarget; min_publish_date: string }) => {
    const { target, min_publish_date } = payload;

    logger.log("Searching Kleinanzeigen", {
      id: target.id,
      label: target.label,
      max_price: target.max_price,
      min_publish_date,
    });

    const listings = await searchListings({
      query: target.query,
      page_count: target.page_count ?? 1,
      location: target.location,
      radius: target.radius,
      min_price: target.min_price,
      max_price: target.max_price,
      min_publish_date,
    });

    // Client-side price guard: include VB/negotiable (null price) and confirmed-under-ceiling prices.
    const matches: MatchedListing[] = listings
      .map((listing: KleinanzeigenListing) => {
        const price_eur = parsePrice(listing.price);
        return { listing, price_eur };
      })
      .filter(({ price_eur }) => price_eur === null || price_eur <= target.max_price)
      .map(({ listing, price_eur }) => ({
        target: target.id,
        label: target.label,
        adid: listing.adid,
        title: listing.title,
        price: listing.price,
        price_eur,
        url: listing.url,
        location: listing.location,
        published_at: listing.published_at,
      }));

    logger.log("Search complete", {
      id: target.id,
      total: listings.length,
      matches: matches.length,
    });

    return { matches };
  },
});

// ---------------------------------------------------------------------------
// Notification helper — ntfy.sh push
// ---------------------------------------------------------------------------

async function notify(listings: MatchedListing[]): Promise<void> {
  const topic = process.env.KLEINANZEIGEN_NTFY_TOPIC;
  if (!topic) return;

  const ntfyBase = (process.env.KLEINANZEIGEN_NTFY_URL ?? "https://ntfy.sh").replace(/\/$/, "");

  // One notification per listing so each is tappable and goes directly to the ad.
  for (const l of listings) {
    const price = l.price ? `${l.price} €` : "VB";
    const location = l.location ?? "";

    await fetch(`${ntfyBase}/${topic}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // ntfy supports markdown-ish titles and click-through URLs
      },
      body: JSON.stringify({
        topic,
        title: `${l.label} — ${price}`,
        message: [l.title, location].filter(Boolean).join(" · "),
        priority: 4,        // high
        tags: ["computer"], // 💻 emoji in the notification
        click: l.url,       // tap notification → opens the listing
        actions: [
          { action: "view", label: "Anzeige öffnen", url: l.url },
        ],
      }),
    }).then((r) => {
      if (!r.ok) logger.warn("ntfy notification failed", { status: r.status, adid: l.adid });
    });
  }
}

// ---------------------------------------------------------------------------
// Poller: runs every 5 minutes
// ---------------------------------------------------------------------------

export const kleinanzeigenPoller = schedules.task({
  id: "kleinanzeigen-poller",
  cron: "*/5 * * * *",
  run: async () => {
    // Cutoff: 8 minutes ago gives a 3-minute safety overlap without excessive duplicates.
    const cutoff = new Date(Date.now() - 8 * 60 * 1000);
    const min_publish_date = cutoff.toISOString().slice(0, 19).replace("T", "T");

    logger.log("Kleinanzeigen poller starting", {
      targets: GPU_SEARCHES.length,
      min_publish_date,
    });

    const allMatches: MatchedListing[] = [];
    const seenIds = new Set<string>();

    // Sequential: each child task is awaited before the next — required by Trigger.dev.
    for (const target of GPU_SEARCHES) {
      const result = await kleinanzeigenSearch.triggerAndWait(
        { target, min_publish_date },
        { idempotencyKey: `kleinanzeigen-${target.id}-${cutoff.toISOString().slice(0, 16)}` }
      );

      if (!result.ok) {
        logger.warn("Search failed", { target: target.id, error: result.error });
        continue;
      }

      for (const match of result.output.matches) {
        if (!seenIds.has(match.adid)) {
          seenIds.add(match.adid);
          allMatches.push(match);
        }
      }
    }

    logger.log("Poller complete", { total_matches: allMatches.length });

    if (allMatches.length > 0) {
      logger.log(
        "New listings found",
        Object.fromEntries(allMatches.map((m, i) => [`listing_${i}`, `${m.label} — ${m.price ?? "VB"} — ${m.url}`]))
      );
      await notify(allMatches);
    }

    return { matched: allMatches.length, listings: allMatches };
  },
});
