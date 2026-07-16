// ============================================================================
// Stage-2 fine filter: decide whether a fully-detailed listing matches the
// real criteria (rooms, m², rent, deposit, no-Tausch/WBS/möbliert, features).
//
// Reads the free-form `details` dict + `features` + `price` from a
// KleinanzeigenDetail and returns a pass/reject with a human reason (logged).
// ============================================================================

import {
  parseGermanNumber,
  featureList,
  type KleinanzeigenDetail,
} from "../adapters/kleinanzeigen";
import type { WohnungCriteria } from "../../config/wohnung-watches";

export interface FilterResult {
  pass: boolean;
  reason?: string; // why it was rejected (for logs)
}

// --- field extractors -------------------------------------------------------

/** Kaltmiete (€) = the top-level price amount for Mietwohnungen. */
export function kaltmiete(d: KleinanzeigenDetail): number | null {
  return parseGermanNumber(d.price?.amount ?? null);
}

export function nebenkosten(d: KleinanzeigenDetail): number | null {
  return parseGermanNumber(d.details?.["Nebenkosten"]);
}

/** Warmmiete (€) = Kaltmiete + Nebenkosten when both are known. */
export function warmmiete(d: KleinanzeigenDetail): number | null {
  const k = kaltmiete(d);
  const n = nebenkosten(d);
  if (k === null) return null;
  return k + (n ?? 0);
}

export function wohnflaeche(d: KleinanzeigenDetail): number | null {
  return parseGermanNumber(d.details?.["Wohnfläche"]);
}

export function zimmer(d: KleinanzeigenDetail): number | null {
  return parseGermanNumber(d.details?.["Zimmer"]);
}

export function kaution(d: KleinanzeigenDetail): number | null {
  return parseGermanNumber(d.details?.["Kaution / Genoss.-Anteile"]);
}

// Haystack of everything a keyword could hide in: title + description + all
// detail values + features. Lower-cased for case-insensitive matching.
function haystack(d: KleinanzeigenDetail): string {
  return [
    d.title ?? "",
    d.description ?? "",
    ...Object.values(d.details ?? {}),
    ...featureList(d),
  ]
    .join(" ")
    .toLowerCase();
}

const hasFeature = (d: KleinanzeigenDetail, needle: string): boolean =>
  featureList(d).some((f) => f.toLowerCase().includes(needle.toLowerCase()));

// --- the filter -------------------------------------------------------------

export function applyCriteria(
  d: KleinanzeigenDetail,
  c: WohnungCriteria
): FilterResult {
  // Gone / sold / reserved
  if (d.not_found) return { pass: false, reason: "not found / deleted" };
  if (d.status && d.status !== "active") {
    return { pass: false, reason: `status ${d.status}` };
  }

  const hay = haystack(d);

  // WBS required — but NOT when the ad says "kein / ohne WBS".
  if (c.excludeWBS) {
    const needsWbs = /\bwbs\b|wohnberechtigungsschein/.test(hay);
    const noWbs = /(kein|ohne|nicht|no)\s*(wbs|wohnberechtigungsschein)/.test(hay);
    if (needsWbs && !noWbs) return { pass: false, reason: "WBS required" };
  }
  // Furnished — via the structured feature, or text "möbliert"/"teilmöbliert"
  // but NOT "unmöbliert" / "nicht möbliert".
  if (c.excludeMoebliert) {
    const furnished =
      hasFeature(d, "möbliert") ||
      /(?<!un)(?<!nicht )(?:teil|voll)?m[oö]bliert/.test(hay);
    if (furnished) return { pass: false, reason: "möbliert" };
  }
  // Swap offer — the "Tauschangebot" detail field is authoritative ("Kein Tausch"
  // vs a real swap); fall back to guarded text only when the field is absent.
  if (c.excludeTausch) {
    const t = (d.details?.["Tauschangebot"] ?? "").toLowerCase();
    const title = (d.title ?? "").toLowerCase();
    // The "Tauschangebot" field is authoritative ("Kein Tausch" vs a real swap),
    // but posters often only announce the swap in the TITLE ("TAUSCHWOHNUNG",
    // "Tausche 2-Zimmer") without setting the field — so catch both.
    const fieldSwap = t.includes("tausch") && !t.includes("kein tausch");
    const titleSwap = /\btausch/.test(title);
    if (fieldSwap || titleSwap) return { pass: false, reason: "Tausch offer" };
  }

  const kalt = kaltmiete(d);
  if (c.maxKaltmiete != null && kalt != null && kalt > c.maxKaltmiete) {
    return { pass: false, reason: `Kaltmiete ${kalt} > ${c.maxKaltmiete}` };
  }

  const flaeche = wohnflaeche(d);
  if (c.minWohnflaeche != null) {
    if (flaeche == null) return { pass: false, reason: "Wohnfläche unknown" };
    if (flaeche < c.minWohnflaeche)
      return { pass: false, reason: `Wohnfläche ${flaeche} < ${c.minWohnflaeche}` };
  }
  if (c.maxWohnflaeche != null && flaeche != null && flaeche > c.maxWohnflaeche) {
    return { pass: false, reason: `Wohnfläche ${flaeche} > ${c.maxWohnflaeche}` };
  }

  const zi = zimmer(d);
  if (c.minZimmer != null && zi != null && zi < c.minZimmer) {
    return { pass: false, reason: `Zimmer ${zi} < ${c.minZimmer}` };
  }
  if (c.maxZimmer != null && zi != null && zi > c.maxZimmer) {
    return { pass: false, reason: `Zimmer ${zi} > ${c.maxZimmer}` };
  }

  const kaut = kaution(d);
  if (c.maxKaution != null && kaut != null && kaut > c.maxKaution) {
    return { pass: false, reason: `Kaution ${kaut} > ${c.maxKaution}` };
  }

  for (const feat of c.requireFeatures ?? []) {
    if (!hasFeature(d, feat)) return { pass: false, reason: `missing ${feat}` };
  }
  for (const feat of c.excludeFeatures ?? []) {
    if (hasFeature(d, feat)) return { pass: false, reason: `has ${feat}` };
  }

  return { pass: true };
}
