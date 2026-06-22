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

export async function getListingDetail(id: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/inserat/${id}`, { headers: headers() });
  if (!response.ok) {
    throw new Error(`Kleinanzeigen API error: ${response.status} ${await response.text()}`);
  }
  const data: { success: boolean; results: Record<string, unknown> } = await response.json();
  return data.results ?? {};
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
