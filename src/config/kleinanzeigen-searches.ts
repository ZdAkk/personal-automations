// Search strategy — three complementary layers, best to worst signal:
//
//   1. CATEGORY URL (structural)   — searches inside the Kleinanzeigen
//      Grafikkarten category (c225) with offers-only (anzeige:angebote) and a
//      price ceiling baked into the URL. This alone removes whole-PC listings
//      (they live in the PC category) and all "Gesuche" (wanted) ads.
//   2. requireAll / excludeAny (keyword) — cleans up what survives inside the
//      category: cooling accessories, waterblocks, empty boxes, trade ("Tausch")
//      offers and laptop cards, none of which the category filter removes.
//   3. price guard (client-side)   — final check on the parsed price.
//
// Keyword matching (layer 2) runs in listingMatches() against a haystack
// reduced to [a-z0-9] only, so "24 GB"/"24gb"/"24GB" all match "24gb",
// "3090 Ti"/"3090Ti" match "3090ti", and the API's mangled umlaut bytes drop
// out (use ASCII-prefix tokens like "wasserk" for "Wasserkühler").

export interface SearchTarget {
  id: string;
  label: string;
  /** Search term, slugified into the category URL path (e.g. "rtx 3090"). */
  keyword: string;
  max_price: number;
  min_price?: number;
  /** Pages to fetch from the category listing (default 1). */
  max_pages?: number;
  /** Kleinanzeigen category slug + id. Defaults to the Grafikkarten category. */
  categorySlug?: string;
  categoryId?: number;
  /** Offers only (excludes "Gesuche"). Default true. */
  offersOnly?: boolean;
  /** Every token must appear in title+description (despaced substring). */
  requireAll?: string[];
  /** If any token appears, the listing is dropped (despaced substring). */
  excludeAny?: string[];
}

// Kleinanzeigen "Grafikkarten" (graphics cards) category.
export const GPU_CATEGORY = {
  categorySlug: "s-grafikkarten",
  categoryId: 225,
} as const;

// Noise that survives the category filter: cooling accessories, packaging,
// cables, trade offers and laptop cards — never the card we want.
// NOTE: tokens must be ASCII-only (no umlauts) — the API mangles umlaut bytes,
// so use an ASCII prefix like "wasserk" to catch "Wasserkühler"/"Wasserkühlung".
const COMMON_EXCLUDE = [
  // laptop GPUs (mobile variant carries the same chip name)
  "laptop",
  "notebook",
  "thinkpad",
  "precision",
  "zbook",
  // trade / broken (offers-only already removes "Suche" wanted ads)
  "tausch",
  "defekt",
  // cooling accessories sold on their own
  "waterblock",
  "wasserblock",
  "wasserk", // Wasserkühler / Wasserkühlung (ASCII prefix; umlaut-proof)
  "eiswolf",
  "eisblock",
  "alphacool",
  "glacier",
  "backplate",
  // packaging / collectibles / cables — never the card itself
  "leerkarton",
  "sammler",
  "sticker",
  "aufkleber",
  "cablemod",
];

export const GPU_SEARCHES: SearchTarget[] = [
  {
    ...GPU_CATEGORY,
    id: "rtx-3090",
    label: "RTX 3090 24 GB",
    keyword: "rtx 3090",
    min_price: 200, // below this is accessories (coolers/waterblocks top out ~185)
    max_price: 750,
    max_pages: 1,
    // All 3090s are 24GB — require the model, exclude the Ti and accessory noise.
    requireAll: ["3090"],
    excludeAny: [...COMMON_EXCLUDE, "3090ti", "3080"],
  },
  {
    ...GPU_CATEGORY,
    id: "rtx-3090-ti",
    label: "RTX 3090 Ti 24 GB",
    keyword: "rtx 3090 ti",
    min_price: 250,
    max_price: 750,
    max_pages: 1,
    requireAll: ["3090ti"],
    excludeAny: [...COMMON_EXCLUDE, "karton"],
  },
  {
    ...GPU_CATEGORY,
    id: "rtx-a5000",
    label: "RTX A5000 24 GB",
    keyword: "rtx a5000",
    min_price: 400,
    max_price: 1300,
    max_pages: 1,
    requireAll: ["a5000", "24gb"], // desktop card is 24GB; laptop A5000 is 16GB
    excludeAny: COMMON_EXCLUDE,
  },
  {
    ...GPU_CATEGORY,
    id: "rtx-a5500",
    label: "RTX A5500 24 GB",
    keyword: "rtx a5500",
    min_price: 500,
    max_price: 1800,
    max_pages: 1,
    requireAll: ["a5500"],
    excludeAny: COMMON_EXCLUDE,
  },
  {
    ...GPU_CATEGORY,
    id: "rtx-a6000",
    label: "RTX A6000 48 GB",
    keyword: "rtx a6000",
    min_price: 600,
    max_price: 2100,
    max_pages: 1,
    requireAll: ["a6000", "48gb"],
    excludeAny: [...COMMON_EXCLUDE, "ada"],
  },
  {
    ...GPU_CATEGORY,
    id: "nvidia-a40",
    label: "NVIDIA A40 48 GB",
    keyword: "nvidia a40",
    min_price: 500,
    max_price: 1800,
    max_pages: 1,
    // "A40" is generic even inside the category — requiring both the model and
    // 48gb pins it to the actual datacenter GPU.
    requireAll: ["a40", "48gb"],
    excludeAny: [...COMMON_EXCLUDE, "galaxy", "samsung", "celica", "klima"],
  },
];
