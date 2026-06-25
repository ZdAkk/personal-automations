// Kleinanzeigen's search is NOT Google. It matches every word literally with
// AND semantics; quotes, minus, OR and parentheses are treated as literal
// characters and zero out results. So the strategy is:
//   1. `query`      — the broadest reliable term that returns real listings
//   2. `requireAll` — words that MUST appear in title/description (despaced, case-insensitive)
//   3. `excludeAny` — words that disqualify a listing if present
//   4. price bounds — enforced both server-side and client-side
//
// Matching is done by listingMatches() in ../lib/kleinanzeigen.ts against a
// whitespace-stripped, lowercased haystack, so "24 GB", "24gb" and "24GB" all
// match the token "24gb", and "3090 Ti" / "3090Ti" both match "3090ti".

export interface SearchTarget {
  id: string;
  label: string;
  query: string;
  max_price: number;
  min_price?: number;
  page_count?: number;
  location?: string;
  radius?: number;
  /** Every token must appear in title+description (despaced substring). */
  requireAll?: string[];
  /** If any token appears, the listing is dropped (despaced substring). */
  excludeAny?: string[];
}

// Noise common to every GPU search: laptop cards, wanted/trade ads, broken
// units, cooling accessories and empty boxes — never the card itself.
const COMMON_EXCLUDE = [
  // laptop GPUs (the mobile variant carries the same chip name)
  "laptop",
  "notebook",
  "thinkpad",
  "precision",
  "zbook",
  // wanted / trade / broken ads
  "suche",
  "tausch",
  "defekt",
  // cooling accessories sold on their own
  "waterblock",
  "wasserblock",
  "wasserkühlung",
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
    id: "rtx-3090",
    label: "RTX 3090 24 GB",
    query: "RTX 3090",
    max_price: 750,
    page_count: 2,
    // All 3090s are 24GB, so no capacity requirement — just exclude the Ti and noise.
    excludeAny: [...COMMON_EXCLUDE, "3090ti", "3080"],
  },
  {
    id: "rtx-3090-ti",
    label: "RTX 3090 Ti 24 GB",
    query: "RTX 3090",
    max_price: 750,
    page_count: 2,
    requireAll: ["3090ti"],
    excludeAny: [...COMMON_EXCLUDE, "karton"],
  },
  {
    id: "rtx-a5000",
    label: "RTX A5000 24 GB",
    query: "RTX A5000",
    max_price: 1300,
    page_count: 2,
    requireAll: ["24gb"], // desktop card is 24GB; laptop A5000 is 16GB
    excludeAny: COMMON_EXCLUDE,
  },
  {
    id: "rtx-a5500",
    label: "RTX A5500 24 GB",
    query: "RTX A5500",
    max_price: 1800,
    page_count: 2,
    excludeAny: COMMON_EXCLUDE,
  },
  {
    id: "rtx-a6000",
    label: "RTX A6000 48 GB",
    query: "RTX A6000",
    max_price: 2100,
    page_count: 2,
    requireAll: ["48gb"],
    excludeAny: [...COMMON_EXCLUDE, "ada"],
  },
  {
    id: "nvidia-a40",
    label: "NVIDIA A40 48 GB",
    query: "A40",
    max_price: 1800,
    page_count: 2,
    // "A40" is extremely generic (Samsung Galaxy A40, cars, etc.) — requiring
    // 48gb reliably narrows to the actual datacenter GPU.
    requireAll: ["48gb"],
    excludeAny: [...COMMON_EXCLUDE, "galaxy", "samsung", "celica", "klima"],
  },
  {
    // NOTE: There is no 32GB consumer RTX 4080 — the 4080 and 4080 Super are
    // both 16GB. "32gb" here only ever matches system RAM in PC/laptop ads, so
    // this target will mostly false-positive. Kept per request; consider removing.
    id: "rtx-4080-32gb",
    label: "RTX 4080 32 GB AI server",
    query: "RTX 4080",
    max_price: 1300,
    page_count: 2,
    requireAll: ["32gb"],
    excludeAny: [...COMMON_EXCLUDE, "gaming pc", "workstation", "blade"],
  },
];
