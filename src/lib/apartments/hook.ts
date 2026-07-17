// ============================================================================
// Shared LLM "hook" generator — writes the ONE personalised opening sentence
// of the application letter (the only model-written part; everything else in
// the letter is deterministic, see wohnung/applicant.ts). Used by both the
// Kleinanzeigen and ImmoScout drafters.
// ============================================================================

import { chat } from "../adapters/ai";

const HOOK_SYSTEM_PROMPT = [
  "Du hilfst bei Wohnungsbewerbungen.",
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
