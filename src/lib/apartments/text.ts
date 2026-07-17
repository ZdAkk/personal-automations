// ============================================================================
// Shared German-text helpers for apartment listings — used by BOTH the
// Kleinanzeigen and ImmoScout pipelines so the intent-matchers stay in one place.
// ============================================================================

/** Parse a German-formatted number: "54,5 m²"→54.5, "1.590 €"→1590, "2,5"→2.5. */
export function parseGermanNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/\./g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return isNaN(v) ? null : v;
}

/** WBS (Wohnberechtigungsschein) required — but NOT when the ad says "kein/ohne WBS". */
export function needsWbs(hay: string): boolean {
  const has = /\bwbs\b|wohnberechtigungsschein/.test(hay);
  const negated = /(kein|ohne|nicht|no)\s*(wbs|wohnberechtigungsschein)/.test(hay);
  return has && !negated;
}

/** Furnished — via a structured flag, or text "möbliert"/"teilmöbliert" but NOT
 *  "unmöbliert" / "nicht möbliert". */
export function isFurnished(hay: string, hasFurnishedFlag = false): boolean {
  if (hasFurnishedFlag) return true;
  return /(?<!un)(?<!nicht )(?:teil|voll)?m[oö]bliert/.test(hay);
}

/** Swap offer — a "Tauschangebot" field says a real swap, or the title announces
 *  one ("TAUSCHWOHNUNG", "Tausche 2-Zimmer"). */
export function isTauschOffer(title: string, tauschField = ""): boolean {
  const t = tauschField.toLowerCase();
  const fieldSwap = t.includes("tausch") && !t.includes("kein tausch");
  const titleSwap = /\btausch/.test(title.toLowerCase());
  return fieldSwap || titleSwap;
}

/** Haversine distance in km between two lat/lon points. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
