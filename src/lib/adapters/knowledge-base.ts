/**
 * Knowledge Base API client
 *
 * Thin wrapper around the self-hosted knowledge base API.
 * All requests use Bearer token auth from KNOWLEDGE_BASE_API_KEY.
 * Base URL from KNOWLEDGE_BASE_BASE_URL env var.
 *
 * Mirrors the structure and style of src/lib/clickup.ts.
 */

const BASE_URL = (): string => {
  const url = process.env.KNOWLEDGE_BASE_BASE_URL;
  if (!url) throw new Error("KNOWLEDGE_BASE_BASE_URL is not set");
  return url.replace(/\/$/, "");
};

function headers(): Record<string, string> {
  const key = process.env.KNOWLEDGE_BASE_API_KEY;
  if (!key) throw new Error("KNOWLEDGE_BASE_API_KEY is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BookSearchResult {
  chunk_id: string;
  book_slug: string;
  title: string | null;
  chapter_title: string | null;
  text: string;
  similarity: number;
}

export interface DreamIngestPayload {
  dreamed_on: string;         // YYYY-MM-DD
  raw_text: string;
  cleaned_text: string;
  title: string;
  emotional_tone: string[];
  lucid: boolean;
  recurring: boolean;
  notes?: string | null;
  day_residue?: string | null; // optional waking-life context from the previous day
}

export interface DreamSymbol {
  name: string;
  archetype: string;
  description: string;
  significance: string;
  jungian_concept: string;
}

export interface InterpretationPayload {
  central_theme: string;
  jungian_analysis: string;
  waking_life: string;
  message: string;
  symbols: DreamSymbol[];
  books_used: string[];
  web_sources: string[];
  scholar_sources: string[] | null;
  model_used: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function throwIfNotOk(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`KnowledgeBase ${context} failed [${res.status}]: ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

/** Semantic search across all ingested books. */
export async function searchBooks(
  query: string,
  limit = 5,
  threshold = 0.3
): Promise<BookSearchResult[]> {
  const url =
    `${BASE_URL()}/books/search` +
    `?q=${encodeURIComponent(query)}&limit=${limit}&threshold=${threshold}`;
  const res = await fetch(url, { headers: headers() });
  await throwIfNotOk(res, `searchBooks("${query}")`);
  const data = (await res.json()) as { results?: BookSearchResult[] };
  return data.results ?? [];
}

// ---------------------------------------------------------------------------
// Dreams
// ---------------------------------------------------------------------------

/** Ingest a new dream entry. Returns the generated dream_id. */
export async function ingestDream(
  payload: DreamIngestPayload
): Promise<{ dream_id: string }> {
  const res = await fetch(`${BASE_URL()}/dreams/ingest`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
  await throwIfNotOk(res, "ingestDream");
  return res.json() as Promise<{ dream_id: string }>;
}

/** Add a Jungian interpretation to an existing dream. */
export async function addInterpretation(
  dreamId: string,
  payload: InterpretationPayload
): Promise<void> {
  const res = await fetch(`${BASE_URL()}/dreams/${dreamId}/interpretation`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
  await throwIfNotOk(res, `addInterpretation(${dreamId})`);
}
