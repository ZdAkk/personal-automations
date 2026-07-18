// ============================================================================
// Draft a ready-to-send ImmoScout application from a detailed listing.
// Reuses the shared letter skeleton (wohnung/applicant) + the shared LLM hook.
// Unlike Kleinanzeigen, IS24 gives us the agent's name and exact coordinates,
// so the salutation is formal-by-name and the framing uses real distance.
// ============================================================================

import { personalizedHook } from "../apartments/hook";
import { haversineKm } from "../apartments/text";
import { assembleLetter, fallbackHook, type Framing } from "../wohnung/applicant";
import type { ImmoScoutExpose } from "../adapters/immoscout";

// München centre — distance reference for framing.
const MUC = { lat: 48.1371, lon: 11.5754 };

export interface FramingRules {
  lmuMaxKm: number;
  warnMaxKm: number;
}

export interface DraftResult {
  body: string;
  framing: Framing;
  far: boolean;
  distanceKm: number | null;
  stadtteil: string | null;
  kaltmiete: number | null;
  warmmiete: number | null;
  wohnflaeche: number | null;
  zimmer: number | null;
  contactName: string | null;
}

function salutation(contactName: string | null): string {
  const formal = "Sehr geehrte Damen und Herren,";
  // Normalise whitespace and strip trailing punctuation ("Frau Langer." ->
  // "Frau Langer", "Herr . ." -> "Herr").
  const name = (contactName ?? "").replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
  if (!name) return formal;
  // Placeholders IS24 puts in the contact field for private / anonymised ads.
  if (/^(privat(angebot)?|provisionsfrei|eigent[üu]mer|anbieter|vermieter)$/i.test(name)) {
    return formal;
  }
  // A bare salutation with no actual name ("Herr", "Frau", "Herrn").
  if (/^(herr|herrn|frau)$/i.test(name)) return formal;
  return `Guten Tag ${name},`;
}

export async function draftFromExpose(
  e: ImmoScoutExpose,
  coords: { lat: number | null; lon: number | null },
  rules: FramingRules,
  model?: string
): Promise<DraftResult> {
  const distanceKm =
    coords.lat != null && coords.lon != null
      ? Math.round(haversineKm(MUC.lat, MUC.lon, coords.lat, coords.lon))
      : null;

  // LMU only when genuinely close: München PLZ (80/81xxx) or a known short distance.
  const inMunich = /^8[01]\d{3}$/.test(e.zip ?? "");
  const framing: Framing =
    inMunich || (distanceKm !== null && distanceKm <= rules.lmuMaxKm) ? "lmu" : "neutral";
  const far = distanceKm !== null && distanceKm > rules.warnMaxKm;

  const stadtteil = e.stadtteil ?? e.city;
  const hook = await personalizedHook(
    {
      title: e.title,
      stadtteil,
      wohnflaeche: e.wohnflaeche,
      zimmer: e.zimmer,
      features: e.features,
      description: e.description,
    },
    fallbackHook(stadtteil),
    model
  );

  const body = assembleLetter(hook, framing, {
    salutation: salutation(e.contactName),
    closing: "Mit freundlichen Grüßen",
  });

  return {
    body,
    framing,
    far,
    distanceKm,
    stadtteil,
    kaltmiete: e.kaltmiete,
    warmmiete: e.warmmiete,
    wohnflaeche: e.wohnflaeche,
    zimmer: e.zimmer,
    contactName: e.contactName,
  };
}
