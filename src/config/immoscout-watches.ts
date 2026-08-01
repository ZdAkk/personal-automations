// ============================================================================
// ImmoScout watches — apartment searches the IS24 poller loops over.
//
// The mobile search API filters price / living-space / radius SERVER-SIDE, so
// the coarse stage is essentially free; the `criteria` below are re-checked on
// the detail (and add WBS/möbliert/Tausch/keyword rules the search can't do).
// Everything apartment-related lives here and is editable without touching the
// trigger.
// ============================================================================

import { SEARCH, SOURCES, radiusFor } from "./profile";

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
// Derived from src/config/profile.ts — EDIT THAT FILE, not this one.
// The search centre, radius, price cap and filters all come from the shared
// profile so this watch can't silently drift from the Kleinanzeigen one.
// ---------------------------------------------------------------------------
const c = SEARCH.criteria;

export const IMMOSCOUT_WATCHES: ImmoScoutWatch[] = [
  new ImmoScoutWatch({
    id: "muenchen",
    title: `IS24 ${SEARCH.city.name}`,
    description: `ImmoScout24 Mietwohnung, ${SEARCH.city.name} + ${radiusFor("immoscout")} km`,
    lat: SEARCH.city.lat,
    lon: SEARCH.city.lon,
    radiusKm: radiusFor("immoscout"),
    maxPages: SOURCES.immoscout.maxPages,
    pageSize: SOURCES.immoscout.pageSize,
    criteria: {
      maxWarmmiete: c.maxWarmmiete, // real cap; also the search price cap (kalt <= warm)
      minWohnflaeche: c.minWohnflaeche,
      maxWohnflaeche: c.maxWohnflaeche ?? undefined,
      minZimmer: c.minZimmer,
      maxZimmer: c.maxZimmer ?? undefined,
      maxKaution: c.maxKaution ?? undefined,
      excludeWBS: c.excludeWBS,
      excludeMoebliert: c.excludeMoebliert,
      excludeTausch: c.excludeTausch,
      excludeKeywords: [...SOURCES.immoscout.excludeKeywords],
    },
    framing: { ...SEARCH.framing },
  }),
];
