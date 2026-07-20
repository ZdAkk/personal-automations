// ============================================================================
// Applicant profile + letter skeleton for apartment applications (Zaid).
//
// This is the single source of truth for WHO is applying and HOW the letter is
// structured. The search parameters (where/what/price) live in
// src/config/wohnung-watches.ts; the personalised hook sentence is written per
// listing by the LLM in draft.ts. Everything else is assembled deterministically
// from the constants here so the structure never drifts and the "no dashes
// inside sentences" rule can't be violated by the model.
//
// Prose rule (mirrors docs/wohnung/bewerbung-guide.md): never use "–"/"—" inside
// a sentence. The "–" characters below are BULLET markers and a date span only.
// ============================================================================

export const APPLICANT = {
  fullName: "Zaid Alakad",
  age: 25,
  phone: "0179 4895351",
  email: "zaid@alakad.de",
  currentCity: "Hannover",
  tenantSince: 2022,
  moveInDate: "01.10.2026",
  schufaDate: "09.07.2026",
  paymentHistory: "07/2024 bis 07/2026",
  monthlyIncomeEur: 8700,
  reservesEur: 60000,
} as const;

// The relocation reason, swapped by distance. LMU only makes sense when the
// apartment is genuinely commutable to Munich; further out it invites a
// "why so far from campus?" question, so we use a neutral Bavaria relocation.
export const FRAMING_CLAUSE = {
  lmu:
    "beginne zum Wintersemester zusätzlich ein Masterstudium an der LMU München, meine freiberufliche Tätigkeit läuft parallel weiter",
  neutral: "verlege meinen Lebensmittelpunkt nach Bayern",
} as const;

export type Framing = keyof typeof FRAMING_CLAUSE;

// The "who I am" paragraph, parameterised only by the framing clause.
function aboutParagraph(framing: Framing): string {
  return (
    "Kurz zu mir: Ich bin 25 Jahre alt, Nichtraucher, ziehe als Einpersonenhaushalt " +
    "ein und habe keine Haustiere. Beruflich bin ich selbstständiger Softwareentwickler " +
    `mit laufenden Kundenprojekten und ${FRAMING_CLAUSE[framing]}. Seit ${APPLICANT.tenantSince} ` +
    "bin ich Mieter in Hannover und würde mich freuen, in meinem neuen Zuhause länger zu bleiben."
  );
}

// The financial-security block. Bullet "–" markers and the date span are the
// only permitted dashes (never inside a sentence).
const SECURITY_BLOCK = [
  "Als Mieter biete ich Ihnen verlässliche Sicherheit:",
  "– Durchschnittliches Einkommen von ca. 8.700 € monatlich, belegt durch Kontoauszüge",
  "– Rücklagen von über 60.000 €",
  `– SCHUFA-BonitätsCheck vom ${APPLICANT.schufaDate} mit ausschließlich positiven Einträgen (online verifizierbar)`,
  `– Lückenloser Nachweis über zwei Jahre stets pünktlicher Mietzahlung von ${APPLICANT.paymentHistory}`,
].join("\n");

// Kleinanzeigen can't take an attachment on a first message, so there we OFFER
// to send the Mappe. ImmoScout lets us attach the PDF directly, so the offer is
// redundant there and is left out (see assembleLetter's includeMappeLine).
const MAPPE_LINE =
  "Meine vollständige Bewerbermappe (Mieterselbstauskunft, SCHUFA-Check, Einkommensnachweis " +
  "und Zahlungsnachweise) sende ich Ihnen gerne als eine PDF, sodass Sie sich sofort ein " +
  "vollständiges Bild machen können.";

const LOGISTICS_LINE =
  `Einziehen würde ich gerne zum ${APPLICANT.moveInDate}, nach Vereinbarung auch früher. ` +
  "Für eine Besichtigung reise ich kurzfristig aus Hannover an, gerne auch abends. " +
  `Sie erreichen mich jederzeit unter ${APPLICANT.phone}.`;

/**
 * Assemble the full, ready-to-send message from a personalised opening hook +
 * the chosen framing. Everything except `hook` is fixed, so the structure and
 * the no-dash rule are guaranteed regardless of the LLM output.
 *
 * Salutation/closing default to the informal Kleinanzeigen style ("Hallo," /
 * "Viele Grüße"); ImmoScout passes a formal salutation with the agent's name.
 *
 * `includeMappeLine` defaults to true (Kleinanzeigen, where the Mappe can only
 * be offered). ImmoScout passes false because the PDF is attached to the message
 * itself, so offering to send it would read as redundant.
 */
export function assembleLetter(
  hook: string,
  framing: Framing,
  opts: { salutation?: string; closing?: string; includeMappeLine?: boolean } = {}
): string {
  return [
    opts.salutation ?? "Hallo,",
    hook.trim(),
    aboutParagraph(framing),
    SECURITY_BLOCK,
    opts.includeMappeLine === false ? null : MAPPE_LINE,
    LOGISTICS_LINE,
    (opts.closing ?? "Viele Grüße") + "\n" + APPLICANT.fullName,
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}

// Fallback hook when the LLM call fails or returns nothing usable — generic but
// true, so a listing never goes un-drafted just because the model hiccuped.
export function fallbackHook(ort: string | null): string {
  const where = ort ? `Ihre Wohnung in ${ort}` : "Ihre Wohnung";
  return `${where} gefällt mir und passt gut zu dem, was ich suche.`;
}
