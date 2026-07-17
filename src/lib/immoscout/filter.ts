// ============================================================================
// Fine filter for a fully-detailed ImmoScout listing. The search API already
// enforced price/size/radius, so this mainly re-checks and adds the rules the
// search can't do (WBS / möbliert / Tausch on the full text, Kaution cap,
// exact rooms). Uses the shared German matchers so logic stays in sync with
// the Kleinanzeigen pipeline.
// ============================================================================

import type { ImmoScoutExpose } from "../adapters/immoscout";
import { needsWbs, isFurnished, isTauschOffer } from "../apartments/text";
import type { ImmoScoutCriteria } from "../../config/immoscout-watches";

export interface FilterResult {
  pass: boolean;
  reason?: string;
}

function haystack(e: ImmoScoutExpose): string {
  return [e.title ?? "", e.description ?? "", ...(e.features ?? [])]
    .join(" ")
    .toLowerCase();
}

export function applyCriteria(e: ImmoScoutExpose, c: ImmoScoutCriteria): FilterResult {
  if (e.notFound) return { pass: false, reason: "listing gone" };

  const hay = haystack(e);
  const furnishedFlag = (e.features ?? []).some((f) => /m[oö]bl/i.test(f));

  if (c.excludeWBS && needsWbs(hay)) return { pass: false, reason: "WBS required" };
  if (c.excludeMoebliert && isFurnished(hay, furnishedFlag)) {
    return { pass: false, reason: "möbliert" };
  }
  if (c.excludeTausch && isTauschOffer(e.title ?? "")) {
    return { pass: false, reason: "Tausch offer" };
  }

  if (c.maxKaltmiete != null && e.kaltmiete != null && e.kaltmiete > c.maxKaltmiete) {
    return { pass: false, reason: `Kaltmiete ${e.kaltmiete} > ${c.maxKaltmiete}` };
  }

  if (c.minWohnflaeche != null) {
    if (e.wohnflaeche == null) return { pass: false, reason: "Wohnfläche unknown" };
    if (e.wohnflaeche < c.minWohnflaeche)
      return { pass: false, reason: `Wohnfläche ${e.wohnflaeche} < ${c.minWohnflaeche}` };
  }
  if (c.maxWohnflaeche != null && e.wohnflaeche != null && e.wohnflaeche > c.maxWohnflaeche) {
    return { pass: false, reason: `Wohnfläche ${e.wohnflaeche} > ${c.maxWohnflaeche}` };
  }

  if (c.minZimmer != null && e.zimmer != null && e.zimmer < c.minZimmer) {
    return { pass: false, reason: `Zimmer ${e.zimmer} < ${c.minZimmer}` };
  }
  if (c.maxZimmer != null && e.zimmer != null && e.zimmer > c.maxZimmer) {
    return { pass: false, reason: `Zimmer ${e.zimmer} > ${c.maxZimmer}` };
  }

  if (c.maxKaution != null && e.kaution != null && e.kaution > c.maxKaution) {
    return { pass: false, reason: `Kaution ${e.kaution} > ${c.maxKaution}` };
  }

  for (const feat of c.requireFeatures ?? []) {
    if (!(e.features ?? []).some((f) => f.toLowerCase().includes(feat.toLowerCase()))) {
      return { pass: false, reason: `missing ${feat}` };
    }
  }

  return { pass: true };
}
