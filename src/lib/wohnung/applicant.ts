// ============================================================================
// Letter skeleton for apartment applications.
//
// The VALUES live in src/config/profile.ts (who you are, your situation, the
// viewing arrangements). This file only decides how they are assembled into
// prose. Everything except the LLM-written opening hook is deterministic, so
// the structure never drifts and the no-dash rule can't be violated by the
// model.
//
// Prose rule (mirrors docs/wohnungssuche/bewerbung-guide.md): never use "–"/"—"
// inside a sentence. The "–" characters below are BULLET markers and a date
// span only.
// ============================================================================

import {
  APPLICANT,
  SITUATION,
  incomeEur,
  reservesEurFmt,
} from "../../config/profile";

export { APPLICANT };

// Re-exported for the drafters, which pick a variant by distance.
export const FRAMING_CLAUSE = SITUATION.framingClause;
export type Framing = keyof typeof FRAMING_CLAUSE;

// The "who I am" paragraph. Every fact comes from the profile, so editing the
// profile actually changes the letter.
function aboutParagraph(framing: Framing): string {
  const traits = [
    `Ich bin ${APPLICANT.age} Jahre alt`,
    APPLICANT.nonSmoker ? "Nichtraucher" : null,
    APPLICANT.singleHousehold ? "ziehe als Einpersonenhaushalt ein" : null,
    APPLICANT.hasPets ? null : "habe keine Haustiere",
  ].filter((t): t is string => t !== null);

  // German list: "A, B, C und D" — the last item joins with "und", not a comma.
  const traitList =
    traits.length > 1
      ? `${traits.slice(0, -1).join(", ")} und ${traits[traits.length - 1]}`
      : (traits[0] ?? "");

  return (
    `Kurz zu mir: ${traitList}. Beruflich bin ich ${APPLICANT.occupation} ` +
    `mit laufenden Kundenprojekten und ${FRAMING_CLAUSE[framing]}. Seit ${APPLICANT.tenantSince} ` +
    `bin ich Mieter in ${APPLICANT.currentCity} und ${SITUATION.longTermNote}.`
  );
}

// The financial-security block. Bullet "–" markers and the date span are the
// only permitted dashes (never inside a sentence).
function securityBlock(): string {
  return [
    "Als Mieter biete ich Ihnen verlässliche Sicherheit:",
    `– Durchschnittliches Einkommen von ca. ${incomeEur()} € monatlich, belegt durch Kontoauszüge`,
    `– Rücklagen von über ${reservesEurFmt()} €`,
    `– SCHUFA-BonitätsCheck vom ${APPLICANT.schufaDate} mit ausschließlich positiven Einträgen (online verifizierbar)`,
    `– Lückenloser Nachweis über zwei Jahre stets pünktlicher Mietzahlung von ${APPLICANT.paymentHistory}`,
  ].join("\n");
}

// Offered rather than claimed as enclosed: Kleinanzeigen can't take an
// attachment on a first message. ImmoScout attaches the PDF and omits this.
function mappeLine(): string {
  return (
    `Meine vollständige Bewerbermappe (${SITUATION.mappeContents}) sende ich Ihnen gerne ` +
    "als eine PDF, sodass Sie sich sofort ein vollständiges Bild machen können."
  );
}

// Move-in date + how a viewing would actually work, from SITUATION.viewing.
function logisticsLine(): string {
  const { willTravel, leadTime, offerVideoCall } = SITUATION.viewing;
  const parts = [
    `Einziehen würde ich gerne zum ${APPLICANT.moveInDate}, nach Vereinbarung auch früher.`,
  ];
  if (willTravel) {
    parts.push(
      `Ich wohne derzeit noch in ${APPLICANT.currentCity} und komme für eine Besichtigung ` +
        `selbstverständlich zu Ihnen, dafür brauche ich lediglich ${leadTime}.`
    );
  }
  if (offerVideoCall) {
    parts.push(
      "Wenn Sie möchten, können wir die Wohnung vorab auch kurz per Videoanruf anschauen."
    );
  }
  parts.push(`Sie erreichen mich jederzeit unter ${APPLICANT.phone}.`);
  return parts.join(" ");
}

/**
 * Assemble the full, ready-to-send message from a personalised opening hook +
 * the chosen framing. Everything except `hook` is fixed, so the structure and
 * the no-dash rule are guaranteed regardless of the LLM output.
 *
 * Salutation/closing default to the informal Kleinanzeigen style; ImmoScout
 * passes a formal salutation with the agent's name (see config CHANNELS).
 * `includeMappeLine` defaults to true; ImmoScout passes false because the PDF
 * is attached to the message itself.
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
    securityBlock(),
    opts.includeMappeLine === false ? null : mappeLine(),
    logisticsLine(),
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
