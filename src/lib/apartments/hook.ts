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
  "- Beziehe dich bevorzugt auf: schnelles Internet (falls angegeben), Zustand/Baujahr,",
  "  Balkon/Terrasse, Einbauküche, Grundriss oder Lage/Stadtteil.",
  "- Ist eine schnelle Internetverbindung angegeben (z. B. 1000 MBit/s), ist das ein",
  "  besonders passendes Merkmal: der Bewerber arbeitet als Softwareentwickler viel im",
  "  Homeoffice. Nenne die Geschwindigkeit dann konkret.",
  "- NIEMALS erwähnen: Barrierefreiheit, stufenloser Zugang, Pflege/Alter, Haustiere,",
  "  Kinderfreundlichkeit oder Familien. Der Bewerber ist 25, gesund und wohnt allein.",
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
  /** Advertised broadband, e.g. "1000 MBit/s" (ImmoScout only). */
  internetSpeed?: string | null;
  /** Objektzustand, e.g. "Neuwertig" / "Gepflegt". */
  condition?: string | null;
}

// Features the letter must never lead with — accessibility/care-related traits
// are irrelevant for a healthy 25-year-old and read as a mis-targeted mass mail.
// Dropped before the model ever sees them (belt and braces with the prompt ban).
const HIDDEN_FEATURES = /barrierefrei|barrierearm|stufenlos|senioren|pflege|rollstuhl/i;

// A hook is rejected if it contains a dash inside the sentence (house style) or
// any of the brochure/AI tells the prompt bans. The prompt asks for this, but
// models still slip one in, so it's enforced here rather than trusted.
const BANNED_HOOK =
  /[–—]|\b(perfekt|ideal|optimal|traumhaft|einzigartig|wunderschön|barrierefrei|stufenlos)\b/i;

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
  const features = (facts.features ?? []).filter((f) => !HIDDEN_FEATURES.test(f));
  const userLines = [
    facts.title ? `Titel: ${facts.title}` : null,
    facts.stadtteil ? `Stadtteil: ${facts.stadtteil}` : null,
    facts.wohnflaeche != null ? `Wohnfläche: ${facts.wohnflaeche} m²` : null,
    facts.zimmer != null ? `Zimmer: ${facts.zimmer}` : null,
    facts.internetSpeed ? `Internet: bis zu ${facts.internetSpeed}` : null,
    facts.condition ? `Objektzustand: ${facts.condition}` : null,
    features.length ? `Ausstattung: ${features.join(", ")}` : null,
    facts.description ? `Beschreibung: ${facts.description.slice(0, 900)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const chosenModel = model ?? process.env.WOHNUNG_LLM_MODEL ?? "anthropic/claude-sonnet-4";
  try {
    // Two shots: a model that slipped in a banned word usually avoids it when
    // told again. Only if both trip the guard do we fall back to the generic
    // (true but bland) opener.
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = await chat(
        [
          { role: "system", content: HOOK_SYSTEM_PROMPT },
          { role: "user", content: userLines },
          ...(attempt === 0
            ? []
            : [
                {
                  role: "user" as const,
                  content:
                    "Dein letzter Satz enthielt ein verbotenes Wort (Superlativ, " +
                    "Gedankenstrich oder Barrierefreiheit). Schreibe ihn neu, " +
                    "streng nach den Regeln.",
                },
              ]),
        ],
        chosenModel
      );
      const line = out.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
      const cleaned = line.replace(/^["'»]|["'«]$/g, "").trim();
      if (cleaned && !BANNED_HOOK.test(cleaned)) return cleaned;
    }
    return fallback;
  } catch {
    return fallback;
  }
}
