// Declarative watch-group model.
//
// A "watch group" is a named batch of searches that share a source, a category,
// notification metadata and a set of common excludes — e.g. all GPU searches.
// Adding a new group (keyboards, bikes, monitors, …) means adding one entry to
// the WATCH_GROUPS registry in src/config/watch-groups.ts; the trigger iterates
// that registry and knows nothing group-specific.
//
// Behaviour that varies by source lives in a Strategy keyed by `searchType`
// (see ./strategies.ts), so the data here stays pure and JSON-serializable
// across the Trigger.dev parent→child task boundary.

export type SearchType = "kleinanzeigen-category";

export interface NotifyMeta {
  /** ntfy tag rendered as an emoji in the push (e.g. "computer" → 💻). */
  emoji?: string;
  /** ntfy priority 1–5 (default 4 = high). */
  priority?: number;
  /** Env var holding this group's ntfy topic. Falls back to KLEINANZEIGEN_NTFY_TOPIC. */
  topicEnv?: string;
}

export interface SearchCategory {
  slug: string; // e.g. "s-grafikkarten"
  id: number; // e.g. 225
}

export interface SearchTarget {
  id: string;
  label: string;
  /** Search term, slugified into the source URL (e.g. "rtx 3090"). */
  keyword: string;
  min_price?: number;
  max_price: number;
  /** Every token must appear in title+description ([a-z0-9] substring). */
  requireAll?: string[];
  /** Target-specific excludes; merged with the group's commonExclude by defineSearchGroup. */
  excludeAny?: string[];
}

export interface SearchGroupSpec {
  /** Stable slug, e.g. "gpu-deals". */
  id: string;
  /** Human title shown in notifications, e.g. "GPU Deals". */
  title: string;
  /** One-line context sent with the batch, e.g. "High-VRAM GPUs under budget". */
  description: string;
  /** Selects the execution Strategy (the "source"). */
  searchType: SearchType;
  /** Source category to search within. */
  category: SearchCategory;
  /** Offers only (excludes "Gesuche"). Default true. */
  offersOnly?: boolean;
  /** Pages to fetch per target. Default 1. */
  maxPages?: number;
  /** Notification metadata applied to every alert from this group. */
  notify?: NotifyMeta;
  /** Excludes shared by all targets in the group. */
  commonExclude?: string[];
  targets: SearchTarget[];
}

/** A listing that passed all of a target's filters, ready to notify. */
export interface MatchedListing {
  targetId: string;
  label: string;
  adid: string;
  title: string;
  price: string | null;
  price_eur: number | null;
  url: string;
  location: string | null;
  published_at: string | null;
}

// Factory — normalise a spec into a ready-to-run group:
//   - apply offersOnly / maxPages defaults
//   - merge commonExclude into each target's excludeAny, so downstream code only
//     ever reads target.excludeAny (no group lookup, no behaviour on the data).
export function defineSearchGroup(spec: SearchGroupSpec): SearchGroupSpec {
  const common = spec.commonExclude ?? [];
  return {
    ...spec,
    offersOnly: spec.offersOnly ?? true,
    maxPages: spec.maxPages ?? 1,
    targets: spec.targets.map((t) => ({
      ...t,
      excludeAny: [...common, ...(t.excludeAny ?? [])],
    })),
  };
}
