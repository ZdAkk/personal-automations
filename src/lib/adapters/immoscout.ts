// ============================================================================
// ImmoScout24 adapter — talks to the app's private mobile JSON API
// (api.mobile.immobilienscout24.de). Plain HTTP, no browser, no captcha, no
// login: it just needs the app's User-Agent header. Two calls:
//   searchList()  → POST /search/list  (server-side filtered, newest-first)
//   fetchExpose() → GET  /expose/{id}  (full detail, normalised)
// ============================================================================

import { parseGermanNumber } from "../apartments/text";

const BASE = process.env.IMMOSCOUT_API_URL ?? "https://api.mobile.immobilienscout24.de";
// Tracks the shipping IS24 app version; occasionally needs bumping (monitor via
// an "empty results" alarm). Overridable without a code change.
const USER_AGENT = process.env.IMMOSCOUT_USER_AGENT ?? "ImmoScout_27.12_26.2_._";

function headers(): Record<string, string> {
  return { "User-Agent": USER_AGENT, Accept: "application/json" };
}

// --- search -----------------------------------------------------------------

export interface ImmoScoutSearchParams {
  lat: number;
  lon: number;
  radiusKm: number;
  maxPrice?: number; // Kaltmiete cap (€)
  minLivingSpace?: number; // m²
  maxLivingSpace?: number;
  minRooms?: number;
  maxRooms?: number;
  pageSize?: number;
  pageNumber?: number;
  sorting?: string; // default "-firstactivation" = newest first
}

export interface ImmoScoutSearchItem {
  id: string;
  title: string;
  addressLine: string;
  lat: number | null;
  lon: number | null;
  price: string | null; // attributes: [price, size, rooms]
  size: string | null;
  rooms: string | null;
  isPrivate: boolean;
  published: string | null;
  url: string;
}

function rangeParam(min: number | undefined, max: number | undefined): string | null {
  if (min == null && max == null) return null;
  return `${(min ?? 0).toFixed(1)}-${(max ?? 99999).toFixed(1)}`;
}

export async function searchList(
  p: ImmoScoutSearchParams
): Promise<{ total: number; items: ImmoScoutSearchItem[] }> {
  const qs = new URLSearchParams();
  qs.set("searchType", "radius");
  qs.set("geocoordinates", `${p.lat};${p.lon};${p.radiusKm}`);
  qs.set("realestatetype", "apartmentrent");
  if (p.maxPrice != null) qs.set("price", `0.0-${p.maxPrice.toFixed(1)}`);
  const ls = rangeParam(p.minLivingSpace, p.maxLivingSpace);
  if (ls) qs.set("livingspace", ls);
  const rooms = rangeParam(p.minRooms, p.maxRooms);
  if (rooms) qs.set("numberofrooms", rooms);
  qs.set("pagesize", String(p.pageSize ?? 20));
  qs.set("pagenumber", String(p.pageNumber ?? 1));
  qs.set("sorting", p.sorting ?? "-firstactivation");

  const res = await fetch(`${BASE}/search/list?${qs.toString()}`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ supportedResultListType: [], userData: {} }),
  });
  if (!res.ok) {
    throw new Error(`ImmoScout search error: ${res.status} ${await res.text()}`);
  }
  const data: any = await res.json();
  const items: ImmoScoutSearchItem[] = (data.resultListItems ?? [])
    .filter((x: any) => x?.type === "EXPOSE_RESULT" && x.item)
    .map((x: any) => {
      const it = x.item;
      const attrs: string[] = (it.attributes ?? []).map((a: any) => a.value);
      return {
        id: String(it.id),
        title: it.title ?? "",
        addressLine: it.address?.line ?? "",
        lat: it.address?.lat ?? null,
        lon: it.address?.lon ?? null,
        price: attrs[0] ?? null,
        size: attrs[1] ?? null,
        rooms: attrs[2] ?? null,
        isPrivate: Boolean(it.isPrivate),
        published: it.published ?? null,
        url: `https://www.immobilienscout24.de/expose/${it.id}`,
      };
    });
  return { total: data.totalResults ?? items.length, items };
}

// --- expose (detail) --------------------------------------------------------

export interface ImmoScoutExpose {
  id: string;
  url: string;
  title: string | null;
  description: string;
  kaltmiete: number | null;
  nebenkosten: number | null;
  warmmiete: number | null;
  kaution: number | null;
  wohnflaeche: number | null;
  zimmer: number | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  stadtteil: string | null;
  availableFrom: string | null;
  features: string[];
  contactName: string | null;
  imageUrl: string | null; // main photo (jpg, ~800x600) for the digest email
  /** Advertised broadband, e.g. "1000 MBit/s" — highly relevant for remote work,
   *  so it's surfaced to the letter's opening sentence. Null if not advertised. */
  internetSpeed: string | null;
  /** Objektzustand, e.g. "Neuwertig" / "Gepflegt" / "Renoviert". */
  condition: string | null;
  isPrivate: boolean;
  notFound?: boolean;
}

const yes = (v: unknown): boolean => v === "y" || v === "true" || v === true;

// adTargetingParameters use ENGLISH/machine decimals ("1.5", "51.5", "800") —
// NOT German display format. parseGermanNumber (dot=thousands) would mangle
// them (1.5→15), so parse these with a plain decimal parser. Section/display
// values ("2.400,00 €") still go through parseGermanNumber.
function parseAtpNum(v: unknown): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

const FLAG_LABELS: Record<string, string> = {
  obj_balcony: "Balkon",
  obj_hasKitchen: "Einbauküche",
  obj_lift: "Aufzug",
  obj_cellar: "Keller",
  obj_garden: "Garten",
  obj_barrierFree: "Barrierefrei",
};

// Main photo from the MEDIA section (sections[0].media[]). The API returns webp
// by default; some email clients (Outlook) don't render webp, so swap the
// format token to jpg — IS24's image CDN honours it. Returns null if imageless.
function mainImageUrl(sections: any[]): string | null {
  const media: any[] = sections.find((s) => s.type === "MEDIA")?.media ?? [];
  const pic = media.find((m) => m?.type === "PICTURE") ?? media[0];
  const raw: string | null = pic?.previewImageUrl ?? pic?.fullImageUrl ?? null;
  if (!raw) return null;
  return raw.replace("/format/webp/", "/format/jpg/");
}

// Pull a labelled value out of an ATTRIBUTE_LIST section (label→text).
function attr(sections: any[], listTitle: string, labelIncludes: string): string | null {
  const list = sections.find((s) => s.type === "ATTRIBUTE_LIST" && s.title === listTitle);
  const a = (list?.attributes ?? []).find((x: any) =>
    (x.label ?? "").toLowerCase().includes(labelIncludes.toLowerCase())
  );
  return a?.text ?? null;
}

export async function fetchExpose(id: string): Promise<ImmoScoutExpose | null> {
  const res = await fetch(`${BASE}/expose/${id}`, { headers: headers() });
  if (res.status === 404 || res.status === 410) return { ...emptyExpose(id), notFound: true };
  if (!res.ok) {
    throw new Error(`ImmoScout expose error: ${res.status} ${await res.text()}`);
  }
  const d: any = await res.json();
  const atp: Record<string, any> = d.adTargetingParameters ?? {};
  const sections: any[] = d.sections ?? [];

  const title =
    sections.find((s) => s.type === "TITLE")?.title ??
    d.header?.title ??
    null;

  const description = sections
    .filter((s) => s.type === "TEXT_AREA")
    .map((s) => s.text ?? "")
    .filter(Boolean)
    .join("\n\n");

  const kaltmiete = parseAtpNum(atp.obj_baseRent);
  const warmmiete = parseAtpNum(atp.obj_totalRent);
  const nebenkosten =
    kaltmiete != null && warmmiete != null && warmmiete > kaltmiete
      ? Math.round(warmmiete - kaltmiete)
      : null;
  const kaution = parseGermanNumber(attr(sections, "Kosten", "Kaution"));

  const street = atp.obj_streetPlain ?? atp.obj_street ?? null;
  const features = Object.entries(FLAG_LABELS)
    .filter(([k]) => yes(atp[k]))
    .map(([, label]) => label);
  if (yes(atp.obj_newlyConst)) features.push("Neubau");

  const contactName =
    sections.find((s) => s.type === "AGENTS_INFO")?.name ??
    sections.find((s) => s.type === "AGENTS_CONTACT")?.name ??
    null;

  return {
    id,
    url: `https://www.immobilienscout24.de/expose/${id}`,
    title,
    description,
    kaltmiete,
    nebenkosten,
    warmmiete,
    kaution,
    wohnflaeche: parseAtpNum(atp.obj_livingSpace),
    zimmer: parseAtpNum(atp.obj_noRooms),
    street: street ?? null,
    zip: atp.obj_zipCode ?? null,
    city: atp.obj_regio2 ?? null,
    stadtteil: atp.obj_regio3 ?? null,
    availableFrom: attr(sections, "Hauptkriterien", "Bezugsfrei"),
    features,
    contactName,
    imageUrl: mainImageUrl(sections),
    // Telekom broadband availability rides along in the ad targeting params.
    internetSpeed: yes(atp.obj_telekomInternetAvailable)
      ? (atp.obj_telekomInternetSpeed ?? null)
      : null,
    condition: attr(sections, "Bausubstanz & Energieausweis", "Objektzustand"),
    isPrivate: yes(atp.obj_privateOffer),
  };
}

function emptyExpose(id: string): ImmoScoutExpose {
  return {
    id,
    url: `https://www.immobilienscout24.de/expose/${id}`,
    title: null,
    description: "",
    kaltmiete: null,
    nebenkosten: null,
    warmmiete: null,
    kaution: null,
    wohnflaeche: null,
    zimmer: null,
    street: null,
    zip: null,
    city: null,
    stadtteil: null,
    availableFrom: null,
    features: [],
    contactName: null,
    imageUrl: null,
    internetSpeed: null,
    condition: null,
    isPrivate: false,
  };
}
