// ============================================================================
// THE ONE PLACE THE SETTINGS LIVE.
//
// The VALUES are in profile.json next to this file; this module gives them
// types and a small amount of behaviour. Two consumers, two ways in:
//
//   Trigger.dev tasks  — the JSON is imported statically, so the bundler inlines
//                        it into the deployed image. Changing it needs a commit
//                        plus a redeploy, same as any other code change.
//   Dashboard and CLI  — reloadProfile() re-reads the file from disk, so edits
//                        made in the dashboard take effect immediately in the
//                        running process without a restart.
//
// Everything here is genuinely wired up: if a field exists, editing it changes
// the output. The exported objects are mutated in place on reload rather than
// replaced, so consumers that hold a reference (and read properties when they
// build a letter) always see current values.
//
// CAVEAT: the watch configs (immoscout-watches.ts / wohnung-watches.ts) read
// these at module load, so a live reload does NOT retune an already-running
// poll. That is fine: only the dashboard reloads, and it doesn't poll.
//
// Prose rule: never use "–"/"—" inside a sentence, use commas. The "–"
// characters in the letter are bullet markers and date spans only.
// ============================================================================

import { readFileSync, statSync } from "node:fs";

import bundled from "./profile.json" with { type: "json" };

// --- shapes -----------------------------------------------------------------

export interface Applicant {
  fullName: string;
  age: number;
  phone: string;
  email: string;
  /** Where you live NOW ("Mieter in X", "wohne derzeit noch in X"). */
  currentCity: string;
  /** Renting continuously since this year. */
  tenantSince: number;
  occupation: string;
  /** Rendered as "ca. 8.700 € monatlich". */
  monthlyIncomeEur: number;
  /** Rendered as "über 60.000 €". */
  reservesEur: number;
  schufaDate: string;
  paymentHistory: string;
  /** Preferred move-in. The letter always adds "nach Vereinbarung auch früher". */
  moveInDate: string;
  nonSmoker: boolean;
  hasPets: boolean;
  singleHousehold: boolean;
}

/** How keen you are on a specific flat, 1..10. Higher means more willing to
 *  accommodate the landlord, which is what a real applicant does. */
export interface InterestTier {
  /** Lowest score this tier applies to. */
  from: number;
  label: string;
  /** Tone instruction handed to the model writing the opening sentence. */
  tone: string;
  /** Extra concessions added to the letter at this level. */
  sentences: string[];
}

export interface Situation {
  framingClause: { lmu: string; neutral: string };
  longTermNote: string;
  viewing: { willTravel: boolean; leadTime: string; offerVideoCall: boolean };
  mappeContents: string;
  interest: { default: number; tiers: InterestTier[] };
}

export interface Criteria {
  maxWarmmiete: number | null;
  minWohnflaeche: number | null;
  maxWohnflaeche: number | null;
  minZimmer: number | null;
  maxZimmer: number | null;
  maxKaution: number | null;
  excludeWBS: boolean;
  excludeTausch: boolean;
  excludeMoebliert: boolean;
}

export interface Search {
  city: { name: string; lat: number; lon: number; zip: string };
  radiusKm: number;
  criteria: Criteria;
  framing: { lmuMaxKm: number; warnMaxKm: number };
}

export interface SourceConfig {
  enabled: boolean;
  /** Overrides Search.radiusKm. null = use the shared value. */
  radiusKm: number | null;
  maxPages: number;
  pageSize: number;
  excludeKeywords: string[];
}

export interface ChannelStyle {
  /** Empty on ImmoScout: the drafter builds it from the agent's name. */
  salutation: string;
  closing: string;
  includeMappeLine: boolean;
}

export interface Operations {
  cron: { immoscout: string; kleinanzeigen: string };
  concurrency: number;
  seenTtl: string;
  llmModel: string;
}

export interface ProfileValues {
  applicant: Applicant;
  situation: Situation;
  search: Search;
  sources: { immoscout: SourceConfig; kleinanzeigen: SourceConfig };
  channels: { immoscout: ChannelStyle; kleinanzeigen: ChannelStyle };
  operations: Operations;
}

// --- live values ------------------------------------------------------------
// Seeded from the bundled JSON, then optionally refreshed from disk. Exported
// as stable object references that get mutated, never reassigned.

const defaults = bundled as unknown as ProfileValues;

export const APPLICANT: Applicant = structuredClone(defaults.applicant);
export const SITUATION: Situation = structuredClone(defaults.situation);
export const SEARCH: Search = structuredClone(defaults.search);
export const SOURCES = structuredClone(defaults.sources);
export const CHANNELS = structuredClone(defaults.channels);
export const OPERATIONS: Operations = structuredClone(defaults.operations);

/** Snapshot of the current values, e.g. to serve from an API. */
export function profileValues(): ProfileValues {
  return structuredClone({
    applicant: APPLICANT,
    situation: SITUATION,
    search: SEARCH,
    sources: SOURCES,
    channels: CHANNELS,
    operations: OPERATIONS,
  });
}

/** Replace the live values in place. Objects keep their identity so anything
 *  holding a reference sees the update. */
export function applyProfile(next: ProfileValues): void {
  const swap = <T extends object>(target: T, src: T): void => {
    for (const k of Object.keys(target)) delete (target as Record<string, unknown>)[k];
    Object.assign(target, structuredClone(src));
  };
  swap(APPLICANT, next.applicant);
  swap(SITUATION, next.situation);
  swap(SEARCH, next.search);
  swap(SOURCES, next.sources);
  swap(CHANNELS, next.channels);
  swap(OPERATIONS, next.operations);
}

/** Absolute path of profile.json, or null when running from a bundle. */
export function profilePath(): string | null {
  try {
    const url = new URL("./profile.json", import.meta.url);
    return url.protocol === "file:" ? decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1") : null;
  } catch {
    return null;
  }
}

/**
 * Re-read profile.json from disk. Returns true if values were refreshed.
 * A no-op wherever the file isn't on disk (i.e. inside the Trigger bundle),
 * which is why it is safe to call unconditionally.
 */
export async function reloadProfile(): Promise<boolean> {
  const file = profilePath();
  if (!file) return false;
  try {
    const { readFile, stat } = await import("node:fs/promises");
    const raw = await readFile(file, "utf8");
    applyProfile(JSON.parse(raw) as ProfileValues);
    lastMtimeMs = (await stat(file)).mtimeMs;
    return true;
  } catch {
    return false;
  }
}

let lastMtimeMs = -1;

/**
 * Cheap (one stat) check that the in-memory values still match the file, and
 * reload if not. Call it at the top of anything that reads settings.
 *
 * Why this exists rather than trusting a single mutable module: the dashboard
 * workspace is ESM while the repo root is not, so the loader can end up holding
 * TWO instances of this module — the server mutates one and the letter builder
 * reads the other. Treating the file as the source of truth makes every
 * instance converge no matter how many there are, and has the nice side effect
 * that editing profile.json by hand is picked up without a restart.
 *
 * No-op wherever the file isn't on disk (i.e. the Trigger.dev bundle), which
 * keeps the deployed tasks on their bundled values.
 */
export function ensureFreshProfile(): void {
  const file = profilePath();
  if (!file) return;
  try {
    const mtime = statSync(file).mtimeMs;
    if (mtime === lastMtimeMs) return;
    lastMtimeMs = mtime;
    applyProfile(JSON.parse(readFileSync(file, "utf8")) as ProfileValues);
  } catch {
    /* file missing or unreadable (e.g. inside the Trigger bundle): keep values */
  }
}

// --- derived helpers (not settings) -----------------------------------------

const de = (n: number): string => n.toLocaleString("de-DE");

export const incomeEur = (): string => de(APPLICANT.monthlyIncomeEur);
export const reservesEurFmt = (): string => de(APPLICANT.reservesEur);

/** Effective radius for a source, honouring its override. */
export function radiusFor(source: keyof typeof SOURCES): number {
  return SOURCES[source].radiusKm ?? SEARCH.radiusKm;
}

/** The tier that applies to an interest score (1..10). */
export function interestTier(score: number | undefined): InterestTier {
  const s = Math.max(1, Math.min(10, Math.round(score ?? SITUATION.interest.default)));
  const tiers = [...SITUATION.interest.tiers].sort((a, b) => a.from - b.from);
  let match = tiers[0];
  for (const t of tiers) if (s >= t.from) match = t;
  return match;
}
