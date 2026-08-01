// ============================================================================
// Listing-URL parsing: turn a pasted link into {source, id}.
//
// Both adapters are id-based, so this is the only thing standing between "a
// pile of links in the clipboard" and the existing drafting pipeline.
//
// Security note: callers must use the parsed ID, never the raw URL. Only these
// two hosts are accepted, and each id is validated as digits, so a pasted URL
// can never steer a request at an arbitrary host (the drafting service may run
// on a home LAN alongside unauthenticated services).
// ============================================================================

export type ListingSource = "ImmoScout24" | "Kleinanzeigen";

export interface ParsedListing {
  source: ListingSource;
  id: string;
  /** Canonical URL rebuilt from the id, safe to display and link. */
  url: string;
}

// immobilienscout24.de/expose/169410609[?...][#/...] — also m. and www., plus
// sub-routes like /expose/123/kontakt. \d+ stops at ?, # or /.
const IS24_RE = /(?:^|\.)immobilienscout24\.de\/expose\/(\d{5,12})(?![\d])/i;

// kleinanzeigen.de/s-anzeige/3471724324
// kleinanzeigen.de/s-anzeige/some-slug/3471665429-203-6540
// The trailing "-203-6540" is categoryId + seller flag, not part of the ad id.
const KA_RE =
  /(?:^|\.)(?:ebay-)?kleinanzeigen\.de\/s-anzeige\/(?:[^\/?#]+\/)?(\d{6,})(?:-\d+)*/i;

/**
 * Parse one listing URL. Returns null if it isn't a recognised listing link
 * (a search-results page, another site, or junk).
 */
export function parseListingUrl(raw: string): ParsedListing | null {
  const input = raw.trim();
  if (!input) return null;

  const is24 = input.match(IS24_RE);
  if (is24) {
    const id = is24[1];
    return { source: "ImmoScout24", id, url: `https://www.immobilienscout24.de/expose/${id}` };
  }

  const ka = input.match(KA_RE);
  if (ka) {
    const id = ka[1];
    return { source: "Kleinanzeigen", id, url: `https://www.kleinanzeigen.de/s-anzeige/${id}` };
  }

  return null;
}

export interface ParseListResult {
  listings: ParsedListing[];
  /** Lines that looked like input but weren't recognised, for reporting back. */
  rejected: string[];
}

/**
 * Parse a pasted block of URLs (one per line, blank lines ignored). Deduped by
 * source+id so pasting the same flat twice only drafts it once. Unrecognised
 * lines are collected rather than throwing, so one bad line can't sink a batch.
 */
export function parseListingUrls(block: string): ParseListResult {
  const listings: ParsedListing[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const line of block.split(/[\r\n]+/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parsed = parseListingUrl(trimmed);
    if (!parsed) {
      rejected.push(trimmed);
      continue;
    }
    const key = `${parsed.source}:${parsed.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    listings.push(parsed);
  }

  return { listings, rejected };
}
