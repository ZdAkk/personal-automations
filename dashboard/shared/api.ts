// ============================================================================
// The wire contract between the Fastify server and the React app.
// Imported by both, so a change to a field name breaks the build rather than
// silently producing an undefined at runtime.
// ============================================================================

export type ListingSource = "ImmoScout24" | "Kleinanzeigen";

/** One drafted listing, as streamed to the browser. */
export interface DraftResultDto {
  source: ListingSource;
  id: string;
  url: string;
  ok: boolean;
  error?: string;
  /** Criteria the listing misses. Informational: it is still drafted, because
   *  pasting a URL is the decision. */
  outsideCriteria?: string[];
  listing?: {
    title: string;
    imageUrl: string | null;
    location: string | null;
    kaltmiete: number | null;
    warmmiete: number | null;
    wohnflaeche: number | null;
    zimmer: number | null;
    contactName: string | null;
    distanceKm: number | null;
    far: boolean;
    letter: string;
  };
}

/** SSE events emitted by POST /api/draft, in order. */
export type DraftEvent =
  | { type: "parsed"; total: number; rejected: string[]; bySource: Record<string, number> }
  | { type: "item"; index: number; result: DraftResultDto }
  | { type: "done"; total: number; ok: number }
  | { type: "error"; message: string };

/** GET /api/profile — what the UI shows so you can sanity-check the letter. */
export interface ProfileDto {
  applicant: {
    fullName: string;
    moveInDate: string;
    monthlyIncomeEur: number;
    reservesEur: number;
    schufaDate: string;
    currentCity: string;
  };
  criteria: {
    maxWarmmiete: number | null;
    minWohnflaeche: number | null;
    maxWohnflaeche: number | null;
    minZimmer: number | null;
  };
  city: { name: string; radiusKm: number };
  llmModel: string;
}
