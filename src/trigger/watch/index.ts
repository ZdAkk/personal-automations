import { task, schedules, logger } from "@trigger.dev/sdk";
import { WATCH_GROUPS } from "../../config/watch-groups";
import { getStrategy } from "../../lib/watch/strategies";
import type { SearchGroupSpec, SearchTarget, MatchedListing } from "../../lib/watch/types";

// ---------------------------------------------------------------------------
// Child task: run one target of one group via its Strategy.
// Source-agnostic — it dispatches on group.searchType and never names a source.
// ---------------------------------------------------------------------------

export const watchSearch = task({
  id: "watch-search",
  retry: { maxAttempts: 3 },
  run: async (payload: {
    group: SearchGroupSpec;
    target: SearchTarget;
    minPublishDate: string;
  }) => {
    const { group, target, minPublishDate } = payload;

    logger.log("Running search", {
      group: group.id,
      target: target.id,
      label: target.label,
      searchType: group.searchType,
    });

    const matches = await getStrategy(group.searchType).run(group, target, minPublishDate);

    logger.log("Search complete", {
      group: group.id,
      target: target.id,
      matches: matches.length,
    });

    return { matches };
  },
});

// ---------------------------------------------------------------------------
// Notification — ntfy.sh push, one per listing, carrying the group's context.
// ---------------------------------------------------------------------------

async function notify(group: SearchGroupSpec, listings: MatchedListing[]): Promise<void> {
  const topicEnv = group.notify?.topicEnv ?? "KLEINANZEIGEN_NTFY_TOPIC";
  const topic = process.env[topicEnv] ?? process.env.KLEINANZEIGEN_NTFY_TOPIC;
  if (!topic) return;

  const ntfyBase = (process.env.KLEINANZEIGEN_NTFY_URL ?? "https://ntfy.sh").replace(/\/$/, "");
  const tags = group.notify?.emoji ? [group.notify.emoji] : [];
  const priority = group.notify?.priority ?? 4;

  for (const l of listings) {
    const price = l.price ? `${l.price} €` : "VB";
    // Title carries WHAT this is (group + target); body carries the listing +
    // group context so a glance tells you why you're being pinged.
    const message = [l.title, l.location, group.description].filter(Boolean).join(" · ");

    await fetch(`${ntfyBase}/${topic}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        title: `${group.title}: ${l.label} — ${price}`,
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
// Poller: every 5 minutes, run every group in the registry.
// Knows nothing group- or source-specific — just iterates WATCH_GROUPS.
// ---------------------------------------------------------------------------

export const watchPoller = schedules.task({
  id: "watch-poller",
  cron: "*/5 * * * *",
  run: async () => {
    // 8-minute lookback gives a 3-minute overlap over the 5-minute cadence so
    // nothing slips between runs; per-run dedup keeps it from double-alerting.
    const cutoff = new Date(Date.now() - 8 * 60 * 1000);
    const minPublishDate = cutoff.toISOString().slice(0, 19);
    const window = cutoff.toISOString().slice(0, 16);

    logger.log("Watch poller starting", {
      groups: WATCH_GROUPS.length,
      minPublishDate,
    });

    let totalMatched = 0;

    for (const group of WATCH_GROUPS) {
      const groupMatches: MatchedListing[] = [];
      const seen = new Set<string>();

      // Sequential triggerAndWait — required by Trigger.dev (no Promise.all).
      for (const target of group.targets) {
        const result = await watchSearch.triggerAndWait(
          { group, target, minPublishDate },
          { idempotencyKey: `${group.id}-${target.id}-${window}` }
        );

        if (!result.ok) {
          logger.warn("Search failed", {
            group: group.id,
            target: target.id,
            error: result.error,
          });
          continue;
        }

        for (const m of result.output.matches) {
          if (!seen.has(m.adid)) {
            seen.add(m.adid);
            groupMatches.push(m);
          }
        }
      }

      logger.log("Group complete", { group: group.id, matches: groupMatches.length });

      if (groupMatches.length > 0) {
        logger.log(
          `New listings: ${group.title}`,
          Object.fromEntries(
            groupMatches.map((m, i) => [`listing_${i}`, `${m.label} — ${m.price ?? "VB"} — ${m.url}`])
          )
        );
        await notify(group, groupMatches);
      }

      totalMatched += groupMatches.length;
    }

    logger.log("Poller complete", { total_matches: totalMatched });
    return { matched: totalMatched };
  },
});
