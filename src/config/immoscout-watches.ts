// ============================================================================
// ImmoScout watches — apartment searches the IS24 poller loops over.
//
// The mobile search API filters price / living-space / radius SERVER-SIDE, so
// the coarse stage is essentially free; the `criteria` below are re-checked on
// the detail (and add WBS/möbliert/Tausch/keyword rules the search can't do).
// Everything apartment-related lives here and is editable without touching the
// trigger.
// ============================================================================

export interface ImmoScoutCriteria {
  maxWarmmiete?: number; // €, the primary rent cap; also used as the search price cap
  maxKaltmiete?: number; // €, optional extra cap on base rent
  minWohnflaeche?: number; // m², also passed to the search API
  maxWohnflaeche?: number;
  minZimmer?: number; // also passed to the search API
  maxZimmer?: number;
  maxKaution?: number;
  excludeWBS?: boolean;
  excludeMoebliert?: boolean;
  excludeTausch?: boolean;
  requireFeatures?: string[];
  /** Coarse reject on the search-result title (before fetching the detail). */
  excludeKeywords?: string[];
}

export interface ImmoScoutFraming {
  lmuMaxKm: number; // beyond this distance from the centre, drop the LMU angle
  warnMaxKm: number; // beyond this, flag "far" in the push
}

export interface ImmoScoutNotifyMeta {
  emoji?: string;
  priority?: number;
  topicEnv?: string; // env var holding the topic; falls back to IMMOSCOUT_NTFY_TOPIC
}

export interface ImmoScoutWatchConfig {
  id: string;
  title: string;
  description: string;
  /** Search centre + radius (radius search). */
  lat: number;
  lon: number;
  radiusKm: number;
  /** Search pages to fetch per poll (newest-first, ~25/page). Default 1. */
  maxPages?: number;
  pageSize?: number;
  criteria: ImmoScoutCriteria;
  framing: ImmoScoutFraming;
  notify?: ImmoScoutNotifyMeta;
}

/** Plain-data config (survives the Trigger parent→child JSON boundary). */
export class ImmoScoutWatch {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly lat: number;
  readonly lon: number;
  readonly radiusKm: number;
  readonly maxPages: number;
  readonly pageSize: number;
  readonly criteria: ImmoScoutCriteria;
  readonly framing: ImmoScoutFraming;
  readonly notify: ImmoScoutNotifyMeta;

  constructor(cfg: ImmoScoutWatchConfig) {
    this.id = cfg.id;
    this.title = cfg.title;
    this.description = cfg.description;
    this.lat = cfg.lat;
    this.lon = cfg.lon;
    this.radiusKm = cfg.radiusKm;
    this.maxPages = cfg.maxPages ?? 1;
    this.pageSize = cfg.pageSize ?? 25;
    this.criteria = cfg.criteria;
    this.framing = cfg.framing;
    this.notify = cfg.notify ?? {};
  }
}

// ---------------------------------------------------------------------------
// Zaid's live search — same criteria as the Kleinanzeigen wohnung watch:
//   München (48.1371, 11.5754) + 50 km · Warmmiete <= 1000 € · >= 35 m²
//   >= 1.5 Zimmer · no WBS · no Tausch · furnished OK
// ---------------------------------------------------------------------------
export const IMMOSCOUT_WATCHES: ImmoScoutWatch[] = [
  new ImmoScoutWatch({
    id: "muenchen",
    title: "IS24 München",
    description: "ImmoScout24 Mietwohnung, München + 50 km",
    lat: 48.1371,
    lon: 11.5754,
    radiusKm: 50,
    // Newest-first search, so page 1 (~25) covers new listings between polls.
    maxPages: 2,
    pageSize: 25,
    criteria: {
      maxWarmmiete: 1000, // real cap; also the search price cap (kalt <= warm)
      minWohnflaeche: 35, // no upper size cap (per Zaid)
      minZimmer: 1.5,
      excludeWBS: true,
      excludeMoebliert: false, // furnished OK (per Zaid)
      excludeTausch: true,
      excludeKeywords: ["wohnberechtigungsschein", "wbs "],
    },
    framing: { lmuMaxKm: 45, warnMaxKm: 50 },
    notify: { emoji: "house", priority: 4 },
  }),
];
