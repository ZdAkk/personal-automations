// ============================================================================
// Draft a ready-to-send apartment inquiry from a fully-detailed listing.
//
// Hybrid: the LLM writes ONLY the one-sentence personalised hook (the listing-
// specific, error-prone part). The rest of the letter and the LMU-vs-neutral
// framing are deterministic (applicant.ts), so the model can't break the
// structure, drop the Bewerbermappe, or slip a dash into a sentence.
// ============================================================================

import { chat } from "../adapters/ai";
import { featureList, type KleinanzeigenDetail } from "../adapters/kleinanzeigen";
import { kaltmiete, warmmiete, wohnflaeche, zimmer } from "./filter";
import { assembleLetter, fallbackHook, type Framing } from "./applicant";

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

const HOOK_SYSTEM_PROMPT = [
  "Du hilfst bei Wohnungsbewerbungen auf Kleinanzeigen.",
  "Schreibe GENAU EINEN kurzen deutschen Satz (höchstens 25 Wörter), der sich auf ein",
  "konkretes, echtes Merkmal der Anzeige bezieht (z. B. Balkon, Einbauküche, Altbau,",
  "ruhige Lage, Stadtteil, Wohnfläche) und ausdrückt, dass die Wohnung zu einem",
  "langfristigen Wohnsitz passt.",
  "",
  "Strenge Regeln:",
  "- Verwende NIEMALS Gedankenstriche (– oder —) innerhalb eines Satzes. Nutze Kommas.",
  "- Erfinde keine Merkmale, die nicht in den Angaben stehen.",
  "- Keine Begrüßung, keine Unterschrift, kein Zusatztext. Gib NUR den einen Satz zurück.",
].join("\n");

async function personalizedHook(
  d: KleinanzeigenDetail,
  stadtteil: string | null,
  model?: string
): Promise<string> {
  const facts = [
    `Titel: ${d.title ?? ""}`,
    stadtteil ? `Stadtteil: ${stadtteil}` : null,
    d.details?.["Wohnfläche"] ? `Wohnfläche: ${d.details["Wohnfläche"]}` : null,
    d.details?.["Zimmer"] ? `Zimmer: ${d.details["Zimmer"]}` : null,
    featureList(d).length ? `Ausstattung: ${featureList(d).join(", ")}` : null,
    d.description ? `Beschreibung: ${d.description.slice(0, 600)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const out = await chat(
      [
        { role: "system", content: HOOK_SYSTEM_PROMPT },
        { role: "user", content: facts },
      ],
      model ?? process.env.WOHNUNG_LLM_MODEL ?? "deepseek/deepseek-chat"
    );
    const line = out.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    const cleaned = line.replace(/^["'»]|["'«]$/g, "").trim();
    if (!cleaned || /[–—]/.test(cleaned)) return fallbackHook(stadtteil);
    return cleaned;
  } catch {
    return fallbackHook(stadtteil);
  }
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

  const hook = await personalizedHook(d, stadtteil, model);
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
