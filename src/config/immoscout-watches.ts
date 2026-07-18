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
  warnMaxKm: number; // beyond this, flag "weiter entfernt" on the digest card
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
  }
}

// ---------------------------------------------------------------------------
// Zaid's live search — same criteria as the Kleinanzeigen wohnung watch:
//   München (48.1371, 11.5754) + 65 km · Warmmiete <= 1000 € · >= 35 m²
//   >= 1.5 Zimmer · no WBS · no Tausch · furnished OK
//
// 65 km (not 50) because the affordable stock sits outside the city: at 50 km
// the search matched 844 listings, at 65 km it matches 1266. Anything past
// framing.warnMaxKm still arrives flagged "weiter entfernt".
// ---------------------------------------------------------------------------
export const IMMOSCOUT_WATCHES: ImmoScoutWatch[] = [
  new ImmoScoutWatch({
    id: "muenchen",
    title: "IS24 München",
    description: "ImmoScout24 Mietwohnung, München + 65 km",
    lat: 48.1371,
    lon: 11.5754,
    radiusKm: 65,
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
      // Coarse title reject. Mirrors the Kleinanzeigen watch: a shared room or a
      // sublet isn't what's wanted, and IS24 does list WG rooms as apartments.
      excludeKeywords: [
        "wohnberechtigungsschein",
        "wbs ",
        "wohngemeinschaft",
        "wg zimmer",
        "wg-zimmer",
        "zwischenmiete",
        "untermiete",
      ],
    },
    framing: { lmuMaxKm: 45, warnMaxKm: 50 },
  }),
];
