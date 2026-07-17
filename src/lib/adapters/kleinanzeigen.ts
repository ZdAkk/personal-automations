const BASE_URL = process.env.KLEINANZEIGEN_API_URL ?? "http://192.168.178.40:8001";

function headers(): Record<string, string> {
  const token = process.env.KLEINANZEIGEN_API_TOKEN;
  if (!token) throw new Error("KLEINANZEIGEN_API_TOKEN is not set");
  return { "x-token": token };
}

export interface KleinanzeigenListing {
  adid: string;
  url: string;
  title: string;
  price: string | null;
  description: string | null;
  image_url: string | null;
  location: string | null;
  time: string | null;
  published_at: string | null;
}

export interface KleinanzeigenPrice {
  amount: string; // e.g. "535" — for Mietwohnungen this is the Kaltmiete
  currency: string; // "€"
  negotiable: boolean;
}

// Full detail record from POST /inserate/batch. `details` is a free-form dict
// keyed by German labels ("Wohnfläche", "Zimmer", "Nebenkosten",
// "Kaution / Genoss.-Anteile", "Verfügbar ab", "Tauschangebot", ...).
export interface KleinanzeigenDetail {
  id: string | null;
  url_requested: string;
  url_redirected?: string;
  title: string | null;
  status: string; // "active" | "sold" | "reserved" | "deleted"
  not_found?: boolean;
  price: KleinanzeigenPrice | null;
  location: { zip: string; city: string; state: string } | null;
  details: Record<string, string>;
  // The scraper returns an array of feature labels, OR an empty object {} when a
  // listing has no feature box. Normalise with featureList() before use.
  features: string[] | Record<string, string>;
  description: string | null;
  seller: { name: string | null; type?: string } | null;
}

/** Normalise a detail's `features` (array, or {} when absent) to a string[]. */
export function featureList(d: KleinanzeigenDetail): string[] {
  const f = d.features as unknown;
  if (Array.isArray(f)) return f.map(String);
  if (f && typeof f === "object") return Object.values(f).map(String);
  return [];
}

export interface SearchParams {
  query: string;
  page_count?: number;
  location?: string;
  radius?: number;
  min_price?: number;
  max_price?: number;
  min_publish_date?: string;
}

export async function searchListings(params: SearchParams): Promise<KleinanzeigenListing[]> {
  const url = new URL(`${BASE_URL}/inserate`);
  url.searchParams.set("query", params.query);
  if (params.page_count != null) url.searchParams.set("page_count", String(params.page_count));
  if (params.location != null) url.searchParams.set("location", params.location);
  if (params.radius != null) url.searchParams.set("radius", String(params.radius));
  if (params.min_price != null) url.searchParams.set("min_price", String(params.min_price));
  if (params.max_price != null) url.searchParams.set("max_price", String(params.max_price));
  if (params.min_publish_date != null) url.searchParams.set("min_publish_date", params.min_publish_date);

  const response = await fetch(url.toString(), { headers: headers() });
  if (!response.ok) {
    throw new Error(`Kleinanzeigen API error: ${response.status} ${await response.text()}`);
  }

  const data: { success: boolean; results: KleinanzeigenListing[] } = await response.json();
  if (!data.success) throw new Error("Kleinanzeigen API returned success: false");
  return data.results ?? [];
}

export interface SearchByUrlParams {
  url: string;
  max_pages?: number;
  min_publish_date?: string;
}

// Scrape a full Kleinanzeigen search/category URL. Unlike /inserate, this
// preserves everything encoded in the URL — category (c225 = Grafikkarten),
// offers-only (anzeige:angebote), price range (preis:min:max) — because the
// scraper navigates the real URL rather than rebuilding it from query params.
export async function searchByUrl(params: SearchByUrlParams): Promise<KleinanzeigenListing[]> {
  const response = await fetch(`${BASE_URL}/inserate-by-url`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({
      url: params.url,
      max_pages: params.max_pages ?? 1,
      min_publish_date: params.min_publish_date ?? null,
    }),
  });
  if (!response.ok) {
    throw new Error(`Kleinanzeigen API error: ${response.status} ${await response.text()}`);
  }
  const data: { success: boolean; results: KleinanzeigenListing[] } = await response.json();
  if (!data.success) throw new Error("Kleinanzeigen API returned success: false");
  return data.results ?? [];
}

export interface CategoryUrlOptions {
  categorySlug: string; // e.g. "s-grafikkarten"
  categoryId: number; // e.g. 225
  keyword?: string; // e.g. "rtx 3090" — slugified into the URL path
  offersOnly?: boolean; // default true → adds anzeige:angebote (excludes "Gesuche")
  min_price?: number;
  max_price?: number;
  location?: string; // postal code, e.g. "10178"
  radius?: number; // km around the postal code
}

// Build a Kleinanzeigen category search URL, e.g.
//   s-grafikkarten / anzeige:angebote / preis::750 / rtx-3090 / k0c225
// Segment order matters; Kleinanzeigen expects the filter segment (k0cNNN) last.
//
// Location is a query string (?locationStr=ZIP&radius=KM). Two quirks:
//   - the `preis:` PATH segment and the locationStr query are mutually
//     exclusive — when both are present Kleinanzeigen silently ignores the
//     location. So price is only encoded in the URL when there's no location;
//     with a location, the caller enforces price client-side instead.
//   - even with a location active, Kleinanzeigen pads the page with
//     out-of-radius ads tagged "(N km)", so the caller must also enforce the
//     radius via parseDistanceKm().
export function buildCategoryUrl(opts: CategoryUrlOptions): string {
  const segments: string[] = [opts.categorySlug];

  if (opts.offersOnly !== false) segments.push("anzeige:angebote");

  const hasLocation = Boolean(opts.location);
  if (!hasLocation && (opts.min_price != null || opts.max_price != null)) {
    segments.push(`preis:${opts.min_price ?? ""}:${opts.max_price ?? ""}`);
  }

  if (opts.keyword) {
    const slug = opts.keyword
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug) segments.push(slug);
  }

  // Keyword searches use the "k0c<id>" (keyword, page 0) form; a keyword-less
  // category browse must use plain "c<id>" — "anzeige:angebote/k0c<id>" without
  // a keyword returns almost nothing (Kleinanzeigen URL quirk).
  segments.push(opts.keyword ? `k0c${opts.categoryId}` : `c${opts.categoryId}`);
  let url = `https://www.kleinanzeigen.de/${segments.join("/")}`;

  const query = new URLSearchParams();
  if (opts.location) query.set("locationStr", opts.location);
  if (opts.radius != null) query.set("radius", String(opts.radius));
  const qs = query.toString();
  if (qs) url += `?${qs}`;

  return url;
}

// When a location search is active, Kleinanzeigen annotates each listing's
// location with its distance, e.g. "81677 Bogenhausen (4 km)" (German decimals,
// e.g. "12,5 km", are handled). Returns the distance in km, or null if absent.
export function parseDistanceKm(location: string | null): number | null {
  if (!location) return null;
  const m = location.match(/\(([\d.,]+)\s*km\)/);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

export async function getListingDetail(id: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/inserat/${id}`, { headers: headers() });
  if (!response.ok) {
    throw new Error(`Kleinanzeigen API error: ${response.status} ${await response.text()}`);
  }
  const data: { success: boolean; results: Record<string, unknown> } = await response.json();
  return data.results ?? {};
}

// POST /inserate/batch — full details for specific ad ids. Each ad spins up a
// headless browser server-side, so this is ~1-2s/ad (vs. instant search): fetch
// details ONLY for new, coarse-filtered candidates, never the whole superset.
export async function fetchDetails(
  ids: string[],
  maxConcurrent = 3
): Promise<KleinanzeigenDetail[]> {
  if (ids.length === 0) return [];
  const response = await fetch(`${BASE_URL}/inserate/batch`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ ids, max_concurrent: maxConcurrent }),
  });
  if (!response.ok) {
    throw new Error(`Kleinanzeigen batch error: ${response.status} ${await response.text()}`);
  }
  const data: { success: boolean; results: KleinanzeigenDetail[] } = await response.json();
  return data.results ?? [];
}

// German number parsing lives in the shared apartments/text module; re-exported
// here so existing importers keep working unchanged.
export { parseGermanNumber } from "../apartments/text";

// Keyword filter against a listing's title + description. Both the haystack and
// the tokens are reduced to [a-z0-9] only, so:
//   - "24 GB" / "24gb" / "24GB" all match the token "24gb"
//   - "3090 Ti" / "3090Ti" match "3090ti"
//   - umlauts survive the API's broken encoding: "Wasserkühler" arrives as
//     mangled bytes, but stripping non-[a-z0-9] leaves "wasserkhler", which the
//     ASCII-safe token "wasserk" still matches. (Hence tokens must be ASCII.)
const clean = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function listingMatches(
  listing: KleinanzeigenListing,
  opts: { requireAll?: string[]; excludeAny?: string[] }
): boolean {
  const hay = clean(`${listing.title} ${listing.description ?? ""}`);

  if (opts.excludeAny?.some((t) => hay.includes(clean(t)))) return false;
  if (opts.requireAll && !opts.requireAll.every((t) => hay.includes(clean(t)))) return false;
  return true;
}

// Parse a Kleinanzeigen price string like "850 €" or "1.200 €" into a number.
// Returns null for non-numeric entries ("VB", "Zu verschenken", etc).
export function parsePrice(raw: string | null): number | null {
  if (!raw) return null;
  const digits = raw.replace(/\./g, "").replace(",", ".").match(/[\d.]+/);
  if (!digits) return null;
  const value = parseFloat(digits[0]);
  return isNaN(value) ? null : value;
}
