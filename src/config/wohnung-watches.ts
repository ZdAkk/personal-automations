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
  /** Beyond this distance (km), mark the listing "far" (⚠️ in the push title). */
  warnMaxKm: number;
}

export interface WohnungNotifyMeta {
  emoji?: string; // ntfy tag -> emoji (e.g. "house" -> 🏠)
  priority?: number; // 1–5 (default 4)
  topicEnv?: string; // env var holding the topic; falls back to WOHNUNG_NTFY_TOPIC
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
  notify?: WohnungNotifyMeta;
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
  readonly notify: WohnungNotifyMeta;

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
    this.notify = cfg.notify ?? {};
  }
}

// ---------------------------------------------------------------------------
// Zaid's live search (from his Kleinanzeigen filter panel):
//   Mietwohnungen · Angebote · München + 50 km · Warmmiete <= 1000 €
//   Wohnfläche >= 35 m² · >= 1.5 Zimmer (lenient when unknown) · no Tausch ·
//   no WBS · furnished OK
// ---------------------------------------------------------------------------
export const WOHNUNG_WATCHES: WohnungWatch[] = [
  new WohnungWatch({
    id: "muenchen",
    title: "Wohnung München",
    description: "Mietwohnung, München + 50 km",
    location: "80331", // München Altstadt — distance reference point
    radius: 50,
    // One page (~25 newest ads) per poll. The search is date-sorted (sortByDate
    // in the trigger), so page 1 is the newest across the whole radius, not the
    // closest; with the 15-min cadence one page catches everything new and stays
    // well under Cloudflare's ~100s proxy cap on the scraper.
    maxPages: 1,
    criteria: {
      maxWarmmiete: 1000, // primary cap (kalt + Nebenkosten)
      maxKaltmiete: 1000, // coarse cap on the search price (kalt <= warm)
      minWohnflaeche: 35, // no upper size cap (per Zaid)
      minZimmer: 1.5, // only rejects when the ad states rooms (KA data is patchy)
      excludeTausch: true,
      excludeWBS: true,
      excludeMoebliert: false, // furnished is OK (per Zaid)
      // Coarse pre-filter on the search title+description (reduces detail
      // fetches). Kept to UNAMBIGUOUS tokens only: the search matcher strips
      // spaces/umlauts and does substring matching, so short/negatable tokens
      // (wbs, möbliert, tausch, befristet) would false-reject "kein WBS" /
      // "unmöbliert" / "unbefristet". Those are handled precisely in the
      // stage-2 fine filter instead.
      excludeKeywords: [
        "wohnberechtigungsschein",
        "zwischenmiete",
        "zwischenmieter",
        "untermiete",
        "wohngemeinschaft",
      ],
    },
    framing: { lmuMaxKm: 45, warnMaxKm: 50 },
    notify: { emoji: "house", priority: 4 },
  }),
];
