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
}

// Build a Kleinanzeigen category search URL, e.g.
//   s-grafikkarten / anzeige:angebote / preis::750 / rtx-3090 / k0c225
// Segment order matters; Kleinanzeigen expects the filter segment (k0cNNN) last.
export function buildCategoryUrl(opts: CategoryUrlOptions): string {
  const segments: string[] = [opts.categorySlug];

  if (opts.offersOnly !== false) segments.push("anzeige:angebote");

  if (opts.min_price != null || opts.max_price != null) {
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

  segments.push(`k0c${opts.categoryId}`);
  return `https://www.kleinanzeigen.de/${segments.join("/")}`;
}

export async function getListingDetail(id: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/inserat/${id}`, { headers: headers() });
  if (!response.ok) {
    throw new Error(`Kleinanzeigen API error: ${response.status} ${await response.text()}`);
  }
  const data: { success: boolean; results: Record<string, unknown> } = await response.json();
  return data.results ?? {};
}

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
