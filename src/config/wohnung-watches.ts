// ============================================================================
// Wohnung watches — apartment searches the trigger loops over.
//
// TWO-STAGE design (see src/trigger/wohnung/index.ts):
//   Stage 1 "Obermenge": a broad category search (location + radius + coarse
//            Kaltmiete cap) — the search endpoint only exposes title/price/
//            location/description, so it can only filter coarsely and WILL
//            contain junk.
//   Stage 2 "fine":       fetch each NEW candidate's full detail (rooms, m²,
//            Nebenkosten, Kaution, Tausch, features, ...) and apply the real
//            `criteria` below. Only survivors get drafted + pushed.
//
// EVERYTHING apartment-related lives here and is editable without touching the
// trigger: location, radius, price cap, the fine-filter criteria, framing
// thresholds, notification topic.
// ============================================================================

import { SEARCH, SOURCES, radiusFor } from "./profile";

export interface WohnungCriteria {
  /** Max Warmmiete (€) = Kaltmiete + Nebenkosten. The primary rent cap, checked
   *  on the detail. When Nebenkosten are unknown it's treated leniently (the
   *  listing passes and you review it), since nothing is sent automatically. */
  maxWarmmiete?: number;
  /** Max Kaltmiete (€). Coarse-applied on the search price AND re-checked on detail. */
  maxKaltmiete?: number;
  /** Min / max living area (m²), from detail "Wohnfläche". */
  minWohnflaeche?: number;
  maxWohnflaeche?: number;
  /** Optional room bounds, from detail "Zimmer" (German "2,5" is handled). */
  minZimmer?: number;
  maxZimmer?: number;
  /** Optional max deposit (€), from detail "Kaution / Genoss.-Anteile". */
  maxKaution?: number;
  /** Drop swap offers (detail "Tauschangebot" != "Kein Tausch", or /tausch/ in text). */
  excludeTausch?: boolean;
  /** Drop social housing that needs a Wohnberechtigungsschein (/wbs|wohnberechtigungsschein/). */
  excludeWBS?: boolean;
  /** Drop furnished/part-furnished listings. */
  excludeMoebliert?: boolean;
  /** Every listed feature must be present (matched case-insensitively, substring). */
  requireFeatures?: string[];
  /** Any of these features present -> drop. */
  excludeFeatures?: string[];
  /** Coarse reject: any token in title+description drops the ad BEFORE the detail
   *  fetch (saves work). The fine detail filters are still the authority. */
  excludeKeywords?: string[];
}

export interface WohnungFraming {
  /** Beyond this distance (km) from `location`, drop the LMU angle (use neutral). */
  lmuMaxKm: number;
  /** Beyond this distance (km), flag "weiter entfernt" on the digest card. */
  warnMaxKm: number;
}

export interface WohnungWatchConfig {
  id: string;
  title: string;
  description: string;
  /** Kleinanzeigen category. Default = Mietwohnungen (s-wohnung-mieten / 203). */
  category?: { slug: string; id: number };
  offersOnly?: boolean; // exclude "Gesuche". Default true.
  location: string; // postal code to centre on (also the distance reference)
  radius: number; // km around `location`
  keyword?: string; // optional search term; omit to browse the whole category
  maxPages?: number; // search pages per poll (Default 1). Search sorts by distance.
  criteria: WohnungCriteria;
  framing: WohnungFraming;
}

/** Plain-data config (survives the Trigger parent->child JSON boundary). */
export class WohnungWatch {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: { slug: string; id: number };
  readonly offersOnly: boolean;
  readonly location: string;
  readonly radius: number;
  readonly keyword?: string;
  readonly maxPages: number;
  readonly criteria: WohnungCriteria;
  readonly framing: WohnungFraming;

  constructor(cfg: WohnungWatchConfig) {
    this.id = cfg.id;
    this.title = cfg.title;
    this.description = cfg.description;
    this.category = cfg.category ?? { slug: "s-wohnung-mieten", id: 203 };
    this.offersOnly = cfg.offersOnly ?? true;
    this.location = cfg.location;
    this.radius = cfg.radius;
    this.keyword = cfg.keyword;
    this.maxPages = cfg.maxPages ?? 1;
    this.criteria = cfg.criteria;
    this.framing = cfg.framing;
  }
}

// ---------------------------------------------------------------------------
// Derived from src/config/profile.ts — EDIT THAT FILE, not this one.
// Kleinanzeigen centres on a postal code rather than lat/lon, and the search is
// date-sorted (sortByDate in the trigger), so one page per poll is the newest
// ads across the whole radius and stays well under Cloudflare's ~100s cap.
// ---------------------------------------------------------------------------
const c = SEARCH.criteria;

export const WOHNUNG_WATCHES: WohnungWatch[] = [
  new WohnungWatch({
    id: "muenchen",
    title: `Wohnung ${SEARCH.city.name}`,
    description: `Mietwohnung, ${SEARCH.city.name} + ${radiusFor("kleinanzeigen")} km`,
    location: SEARCH.city.zip, // distance reference point
    radius: radiusFor("kleinanzeigen"),
    maxPages: SOURCES.kleinanzeigen.maxPages,
    criteria: {
      maxWarmmiete: c.maxWarmmiete, // primary cap (kalt + Nebenkosten)
      maxKaltmiete: c.maxWarmmiete, // coarse cap on the search price (kalt <= warm)
      minWohnflaeche: c.minWohnflaeche,
      maxWohnflaeche: c.maxWohnflaeche ?? undefined,
      minZimmer: c.minZimmer, // only rejects when the ad states rooms (KA data is patchy)
      maxZimmer: c.maxZimmer ?? undefined,
      maxKaution: c.maxKaution ?? undefined,
      excludeTausch: c.excludeTausch,
      excludeWBS: c.excludeWBS,
      excludeMoebliert: c.excludeMoebliert,
      excludeKeywords: [...SOURCES.kleinanzeigen.excludeKeywords],
    },
    framing: { ...SEARCH.framing },
  }),
];
