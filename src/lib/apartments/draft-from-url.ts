// ============================================================================
// Draft a ready-to-send letter for a listing the user picked by hand.
//
// This is the "I already decided I want this one" path: it deliberately does
// NOT run applyCriteria. Pasting a link IS the decision, so a flat that is 40 €
// over the rent cap should still produce a letter (with the numbers shown so
// the caller can judge), not be silently dropped.
//
// Source-dispatching lives here rather than in the CLI so the dashboard can
// reuse it unchanged.
// ============================================================================

import { fetchExpose } from "../adapters/immoscout";
import { fetchDetails } from "../adapters/kleinanzeigen";
import { draftFromExpose } from "../immoscout/draft";
import { draftFromDetail } from "../wohnung/draft";
import { kaltmiete, warmmiete, wohnflaeche, zimmer } from "../wohnung/filter";
import { SEARCH, CHANNELS } from "../../config/profile";
import type { DigestItem } from "./digest";
import type { ParsedListing } from "./url";

export interface DraftedListing {
  source: ParsedListing["source"];
  id: string;
  url: string;
  ok: boolean;
  /** Present when ok. */
  item?: DigestItem;
  /** Present when !ok — "listing gone", a scraper timeout, etc. */
  error?: string;
  /** True when the flat is outside the configured criteria (informational only,
   *  never a reason to skip: the user asked for this listing by name). */
  outsideCriteria?: string[];
}

/** Cheap, non-blocking sanity notes so the caller can flag a listing. */
function criteriaNotes(item: DigestItem): string[] {
  const c = SEARCH.criteria;
  const notes: string[] = [];
  const rent = item.warmmiete ?? item.kaltmiete;
  if (c.maxWarmmiete != null && rent != null && rent > c.maxWarmmiete) {
    notes.push(`${Math.round(rent)} € > ${c.maxWarmmiete} € Warmmiete`);
  }
  if (c.minWohnflaeche != null && item.wohnflaeche != null && item.wohnflaeche < c.minWohnflaeche) {
    notes.push(`${item.wohnflaeche} m² < ${c.minWohnflaeche} m²`);
  }
  if (c.minZimmer != null && item.zimmer != null && item.zimmer < c.minZimmer) {
    notes.push(`${item.zimmer} Zi < ${c.minZimmer} Zi`);
  }
  return notes;
}

export async function draftListing(listing: ParsedListing): Promise<DraftedListing> {
  const base = { source: listing.source, id: listing.id, url: listing.url };
  try {
    if (listing.source === "ImmoScout24") {
      const e = await fetchExpose(listing.id);
      if (!e || e.notFound) return { ...base, ok: false, error: "listing gone or not found" };

      // Coordinates are approximate (postcode centroid) — see the adapter — but
      // good enough for the distance badge and the framing decision.
      const draft = await draftFromExpose(e, { lat: e.lat, lon: e.lon }, SEARCH.framing);
      const item: DigestItem = {
        source: "ImmoScout24",
        id: listing.id,
        title: e.title ?? "",
        url: listing.url,
        imageUrl: e.imageUrl,
        location: (e.stadtteil ?? e.city ?? "").replace(/_/g, " ") || null,
        kaltmiete: draft.kaltmiete,
        warmmiete: draft.warmmiete,
        wohnflaeche: draft.wohnflaeche,
        zimmer: draft.zimmer,
        contactName: draft.contactName,
        far: draft.far,
        distanceKm: draft.distanceKm,
        letter: draft.body,
      };
      return { ...base, ok: true, item, outsideCriteria: criteriaNotes(item) };
    }

    // --- Kleinanzeigen ---
    const details = await fetchDetails([listing.id], 1);
    const d = details[0];
    if (!d || d.not_found) return { ...base, ok: false, error: "listing gone or not found" };

    // KleinanzeigenDetail carries no coordinates and the "(N km)" annotation only
    // exists on search results, so distance is unavailable here; framing falls
    // back to the postcode test, which is correct for the München case.
    const draft = await draftFromDetail(d, null, SEARCH.framing);
    const item: DigestItem = {
      source: "Kleinanzeigen",
      id: listing.id,
      title: d.title ?? "",
      url: listing.url,
      imageUrl: null,
      location: d.location?.city ?? null,
      kaltmiete: kaltmiete(d),
      warmmiete: warmmiete(d),
      wohnflaeche: wohnflaeche(d),
      zimmer: zimmer(d),
      contactName: d.seller?.name ?? null,
      far: false,
      distanceKm: null,
      letter: draft.body,
    };
    return { ...base, ok: true, item, outsideCriteria: criteriaNotes(item) };
  } catch (err) {
    return { ...base, ok: false, error: (err as Error).message };
  }
}

/**
 * Draft many listings with bounded concurrency. Kleinanzeigen spins up a
 * headless browser per ad, so this must not fan out wide.
 */
export async function draftListings(
  listings: ParsedListing[],
  opts: { concurrency?: number; onDone?: (r: DraftedListing) => void } = {}
): Promise<DraftedListing[]> {
  const limit = opts.concurrency ?? 3;
  const results: DraftedListing[] = new Array(listings.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= listings.length) return;
      const r = await draftListing(listings[i]);
      results[i] = r;
      opts.onDone?.(r);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, listings.length) }, worker));
  return results;
}

export { CHANNELS };
