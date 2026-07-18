// ============================================================================
// Shared LLM "hook" generator — writes the ONE personalised opening sentence
// of the application letter (the only model-written part; everything else in
// the letter is deterministic, see wohnung/applicant.ts). Used by both the
// Kleinanzeigen and ImmoScout drafters.
// ============================================================================

import { chat } from "../adapters/ai";

const HOOK_SYSTEM_PROMPT = [
  "Du formulierst den ersten Satz einer echten Wohnungsbewerbung.",
  "Schreibe GENAU EINEN kurzen, sachlichen deutschen Satz (höchstens 18 Wörter), der",
  "1 bis 2 KONKRETE Merkmale der Anzeige nennt und in ruhigem, ehrlichem Ton echtes",
  "Interesse zeigt. Es soll klingen wie von einem echten Bewerber, nicht wie Werbung.",
  "",
  "VERBOTEN (klingt nach Makler oder KI):",
  "- Superlative/Floskeln: ideal, perfekt, optimal, traumhaft, einzigartig, wunderschön.",
  "- leere Wohlfühl-Phrasen: 'viel Tageslicht', 'Entspannung im Freien', 'zum Wohlfühlen',",
  "  'ein echtes Zuhause', 'langfristiger Wohnsitz'.",
  "- Ausrufezeichen, Übertreibung.",
  "",
  "RICHTIG:",
  "- nüchtern, konkret, erste Person. Nenne einfach, was an der Wohnung gut passt.",
  "- Beziehe dich bevorzugt auf Lage/Stadtteil, Balkon/Terrasse, Einbauküche, Grundriss",
  "  oder Zustand. Nur Merkmale, die für einen berufstätigen Einpersonenhaushalt relevant",
  "  sind (KEINE Haustiererlaubnis, Barrierefreiheit o. Ä., außer sie sind zentral).",
  "- Variiere die Formulierung, wiederhole nicht immer dieselbe Wendung.",
  "- Beispiele: 'Besonders der Balkon und die ruhige Lage in Neuried sprechen mich an.'",
  "  / 'Die kompakte Aufteilung mit Einbauküche passt gut für mich als Einzelperson.'",
  "",
  "Regeln: keine Gedankenstriche (– oder —), nutze Kommas; erfinde keine Merkmale; gib",
  "NUR den einen Satz zurück, ohne Begrüßung oder Unterschrift.",
].join("\n");

export interface HookFacts {
  title?: string | null;
  stadtteil?: string | null;
  wohnflaeche?: number | null;
  zimmer?: number | null;
  features?: string[];
  description?: string | null;
}

/**
 * Ask the LLM for the one-sentence hook. Returns `fallback` on any failure or
 * if the model returns nothing usable / a sentence with a dash — so a listing
 * is never left un-drafted and the no-dash rule always holds.
 */
export async function personalizedHook(
  facts: HookFacts,
  fallback: string,
  model?: string
): Promise<string> {
  const userLines = [
    facts.title ? `Titel: ${facts.title}` : null,
    facts.stadtteil ? `Stadtteil: ${facts.stadtteil}` : null,
    facts.wohnflaeche != null ? `Wohnfläche: ${facts.wohnflaeche} m²` : null,
    facts.zimmer != null ? `Zimmer: ${facts.zimmer}` : null,
    facts.features?.length ? `Ausstattung: ${facts.features.join(", ")}` : null,
    facts.description ? `Beschreibung: ${facts.description.slice(0, 600)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const out = await chat(
      [
        { role: "system", content: HOOK_SYSTEM_PROMPT },
        { role: "user", content: userLines },
      ],
      model ?? process.env.WOHNUNG_LLM_MODEL ?? "deepseek/deepseek-chat"
    );
    const line = out.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    const cleaned = line.replace(/^["'»]|["'«]$/g, "").trim();
    if (!cleaned || /[–—]/.test(cleaned)) return fallback;
    return cleaned;
  } catch {
    return fallback;
  }
}
