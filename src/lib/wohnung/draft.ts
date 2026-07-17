// ============================================================================
// Draft a ready-to-send apartment inquiry from a fully-detailed Kleinanzeigen
// listing. The LLM writes ONLY the one-sentence hook (shared apartments/hook);
// the rest of the letter and the LMU-vs-neutral framing are deterministic
// (applicant.ts), so the model can't break the structure or drop the Mappe.
// ============================================================================

import { featureList, type KleinanzeigenDetail } from "../adapters/kleinanzeigen";
import { kaltmiete, warmmiete, wohnflaeche, zimmer } from "./filter";
import { assembleLetter, fallbackHook, type Framing } from "./applicant";
import { personalizedHook } from "../apartments/hook";

export interface FramingRules {
  lmuMaxKm: number; // beyond this, drop the LMU angle
  warnMaxKm: number; // beyond this, flag "far" in the push
}

export interface DraftResult {
  body: string; // the full, ready-to-copy-paste message
  framing: Framing;
  far: boolean;
  // for the ntfy title
  stadtteil: string | null;
  kaltmiete: number | null;
  warmmiete: number | null;
  wohnflaeche: number | null;
  zimmer: number | null;
}

export async function draftFromDetail(
  d: KleinanzeigenDetail,
  distanceKm: number | null,
  rules: FramingRules,
  model?: string
): Promise<DraftResult> {
  const stadtteil = d.location?.city?.trim() || null;

  // Framing: LMU only when we can confirm the place is genuinely close — the
  // detail PLZ is in München (80000–81999), or the search reported a distance
  // within lmuMaxKm. Otherwise (far, or unknown distance) use the neutral
  // Bavaria-relocation reason, which is always true and safe.
  const zip = d.location?.zip ?? "";
  const inMunich = /^8[01]\d{3}$/.test(zip);
  const framing: Framing =
    inMunich || (distanceKm !== null && distanceKm <= rules.lmuMaxKm) ? "lmu" : "neutral";
  const far = distanceKm !== null && distanceKm > rules.warnMaxKm;

  const hook = await personalizedHook(
    {
      title: d.title,
      stadtteil,
      wohnflaeche: wohnflaeche(d),
      zimmer: zimmer(d),
      features: featureList(d),
      description: d.description,
    },
    fallbackHook(stadtteil),
    model
  );
  const body = assembleLetter(hook, framing);

  return {
    body,
    framing,
    far,
    stadtteil,
    kaltmiete: kaltmiete(d),
    warmmiete: warmmiete(d),
    wohnflaeche: wohnflaeche(d),
    zimmer: zimmer(d),
  };
}
