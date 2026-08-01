// ============================================================================
// THE ONE FILE TO EDIT.
//
// Everything you'd realistically want to change about the apartment hunt lives
// here: who you are, what the letter says about your situation, where and what
// you're searching for, and how often. Change a value, redeploy, done.
//
// Everything in here is genuinely wired up. If a field exists below, editing it
// changes the output — no decorative settings. (This was not previously true:
// `monthlyIncomeEur` and `reservesEur` used to sit in a config object while the
// letter printed hardcoded strings, so editing them did nothing.)
//
// Prose rule: never use "–"/"—" inside a sentence, use commas. The "–"
// characters in the letter are bullet markers and date spans only.
// ============================================================================

// --- German number formatting so the letter reads naturally ----------------
const de = (n: number): string => n.toLocaleString("de-DE");

// ---------------------------------------------------------------------------
// 1. WHO IS APPLYING
// ---------------------------------------------------------------------------
export const APPLICANT = {
  fullName: "Zaid Alakad",
  age: 25,
  phone: "0179 4895351",
  email: "zaid@alakad.de",
  /** Where you live NOW (used in the letter: "Mieter in X", "wohne derzeit noch in X"). */
  currentCity: "Hannover",
  /** Renting continuously since this year. */
  tenantSince: 2022,
  occupation: "selbstständiger Softwareentwickler",
  /** Shown as "ca. 8.700 € monatlich". */
  monthlyIncomeEur: 8700,
  /** Shown as "über 60.000 €". */
  reservesEur: 60000,
  schufaDate: "09.07.2026",
  paymentHistory: "07/2024 bis 07/2026",
  /** Preferred move-in. The letter always adds "nach Vereinbarung auch früher". */
  moveInDate: "01.10.2026",
  nonSmoker: true,
  hasPets: false,
  singleHousehold: true,
} as const;

// ---------------------------------------------------------------------------
// 2. YOUR SITUATION — the wording that changes as your circumstances change.
//    These are the sentences you have been rewriting most often.
// ---------------------------------------------------------------------------
export const SITUATION = {
  /**
   * Why you're moving. Picked automatically by distance: `lmu` only when the
   * flat is genuinely commutable to the university (see SEARCH.framing),
   * otherwise `neutral`, which is always true and never invites a
   * "why so far from campus?" question.
   */
  framingClause: {
    lmu:
      "beginne zum Wintersemester zusätzlich ein Masterstudium an der LMU München, " +
      "meine freiberufliche Tätigkeit läuft parallel weiter",
    neutral: "verlege meinen Lebensmittelpunkt nach Bayern",
  },

  /** Closing note on wanting to stay. Kept light on purpose. */
  longTermNote: "würde mich freuen, in meinem neuen Zuhause länger zu bleiben",

  /** How viewings work for you right now. */
  viewing: {
    /** You will travel to them. */
    willTravel: true,
    /** How much notice you need, in prose. */
    leadTime: "etwa eine Woche Vorlauf",
    /** Offer a video call as a first step. Set false to drop that sentence. */
    offerVideoCall: true,
  },

  /**
   * The Bewerbermappe offer. Kleinanzeigen can't take an attachment on a first
   * message so we OFFER it there; on ImmoScout the PDF is attached, so the
   * offer is redundant and is dropped (per-channel, see CHANNELS).
   */
  mappeContents: "Mieterselbstauskunft, SCHUFA-Check, Einkommensnachweis und Zahlungsnachweise",
} as const;

// ---------------------------------------------------------------------------
// 3. WHAT YOU'RE LOOKING FOR
// ---------------------------------------------------------------------------
export const SEARCH = {
  /** Search centre. One definition, used by both sources and for distances. */
  city: {
    name: "München",
    lat: 48.1371,
    lon: 11.5754,
    /** Postal code Kleinanzeigen centres on (it has no lat/lon search). */
    zip: "80331",
  },

  /** Default radius. Per-source overrides below if you want them different. */
  radiusKm: 65,

  criteria: {
    /** The real cap: Kaltmiete + Nebenkosten. */
    maxWarmmiete: 1000,
    minWohnflaeche: 35,
    /** null = no upper size limit (the rent cap bounds it anyway). */
    maxWohnflaeche: null as number | null,
    minZimmer: 1.5,
    maxZimmer: null as number | null,
    maxKaution: null as number | null,
    excludeWBS: true,
    excludeTausch: true,
    /** false = furnished flats are fine. */
    excludeMoebliert: false,
  },

  framing: {
    /** Beyond this distance from the centre, drop the LMU angle. */
    lmuMaxKm: 45,
    /** Beyond this, flag the listing "weiter entfernt" in the digest. */
    warnMaxKm: 50,
  },
} as const;

// ---------------------------------------------------------------------------
// 4. PER-SOURCE SETTINGS
//    Overrides are explicit so the two sources can't drift silently.
// ---------------------------------------------------------------------------
export const SOURCES = {
  immoscout: {
    enabled: true,
    /** Overrides SEARCH.radiusKm. Set to null to use the shared value. */
    radiusKm: 55 as number | null,
    /** Result pages per poll (~25 listings each), newest-first. */
    maxPages: 3,
    pageSize: 25,
    /** Coarse title reject before the detail fetch. */
    excludeKeywords: [
      "wohnberechtigungsschein",
      "wbs ",
      "wohngemeinschaft",
      "wg zimmer",
      "wg-zimmer",
      "zwischenmiete",
      "untermiete",
    ],
  },
  kleinanzeigen: {
    enabled: true,
    radiusKm: null as number | null,
    /** Search is date-sorted, so one page per poll covers everything new. */
    maxPages: 1,
    /** Matched against title + description before the detail fetch. Keep these
     *  UNAMBIGUOUS: short tokens like "wbs" would false-reject "kein WBS". */
    excludeKeywords: [
      "wohnberechtigungsschein",
      "zwischenmiete",
      "zwischenmieter",
      "untermiete",
      "wohngemeinschaft",
    ],
  },
} as const;

// ---------------------------------------------------------------------------
// 5. CHANNEL STYLE — how the letter is addressed per platform.
// ---------------------------------------------------------------------------
export const CHANNELS = {
  immoscout: {
    /** Agents are named, so address them directly; formal register. */
    closing: "Mit freundlichen Grüßen",
    /** PDF is attached on IS24, so don't also offer to send it. */
    includeMappeLine: false,
  },
  kleinanzeigen: {
    salutation: "Hallo,",
    closing: "Viele Grüße",
    includeMappeLine: true,
  },
} as const;

// ---------------------------------------------------------------------------
// 6. OPERATIONAL
// ---------------------------------------------------------------------------
export const OPERATIONS = {
  /** How often each scout polls (cron, UTC). */
  cron: {
    immoscout: "*/15 * * * *",
    kleinanzeigen: "*/15 * * * *",
  },
  /** Concurrent per-listing workers. The Kleinanzeigen scraper is the limit. */
  concurrency: 4,
  /** How long a listing stays "already seen". */
  seenTtl: "30d",
  /** Overridden by the WOHNUNG_LLM_MODEL env var if set. */
  llmModel: "anthropic/claude-sonnet-4",
} as const;

// ---------------------------------------------------------------------------
// Derived helpers — used by the letter builder. Not settings.
// ---------------------------------------------------------------------------
export const incomeEur = (): string => de(APPLICANT.monthlyIncomeEur);
export const reservesEurFmt = (): string => de(APPLICANT.reservesEur);

/** Effective radius for a source, honouring its override. */
export function radiusFor(source: keyof typeof SOURCES): number {
  return SOURCES[source].radiusKm ?? SEARCH.radiusKm;
}
