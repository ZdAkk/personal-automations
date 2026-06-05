/**
 * Knowledge Base Searcher
 *
 * Uses HyDE (Hypothetical Document Embeddings) to retrieve relevant
 * passages from the Jungian book library.
 *
 * HyDE approach: instead of embedding short question-style queries
 * (which sit in a different vector space than full book passages),
 * we ask the model to write a short hypothetical passage in the style
 * of a depth psychology textbook for each theme/symbol. These passages
 * embed much closer to the actual book chunks, dramatically improving
 * retrieval recall.
 *
 * One structured AI call generates all passages at once as a JSON map,
 * then each passage is used as a separate search query.
 */

import { task, logger } from "@trigger.dev/sdk";
import { chat } from "../../lib/ai";
import { searchBooks } from "../../lib/knowledge-base";

export const knowledgeBaseSearcher = task({
  id: "knowledge-base-searcher",
  retry: { maxAttempts: 3 },
  run: async (payload: {
    dream_id: string;
    key_themes: string[];
    symbols: string[];
    cleaned_text: string;
  }) => {
    const hydeModel = process.env.DREAM_HYDE_MODEL ?? "deepseek/deepseek-v4-flash";
    logger.log("Knowledge base searcher starting", {
      dream_id: payload.dream_id,
      hyde_model: hydeModel,
      themes: payload.key_themes,
      symbols: payload.symbols,
    });

    const allTerms = [
      ...payload.key_themes,          // all themes
      ...payload.symbols.slice(0, 4), // up to 4 symbols
    ];

    const hydeRaw = await chat(
      [
        {
          role: "system",
          content:
            "You are a depth psychology scholar. For each term provided, write a 2-3 sentence " +
            "passage in the style of a Jungian psychology textbook (think Jung, von Franz, Hillman) " +
            "that a relevant chapter might contain. Write as if it is an excerpt from an actual book. " +
            "Return ONLY a valid JSON object where each key is the exact term and the value is the passage. " +
            "No markdown, no explanation.",
        },
        {
          role: "user",
          content: `Write hypothetical textbook passages for these Jungian concepts:\n${JSON.stringify(allTerms)}`,
        },
      ],
      hydeModel
    );

    let hydeMap: Record<string, string> = {};
    try {
      const stripped = hydeRaw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      hydeMap = JSON.parse(stripped);
    } catch (e) {
      // Graceful fallback to question-style queries if HyDE parsing fails
      logger.log("HyDE parsing failed — falling back to question-style queries");
      for (const theme of payload.key_themes) {
        hydeMap[theme] = `What does Jung say about ${theme} in dreams?`;
      }
      for (const symbol of payload.symbols.slice(0, 4)) {
        hydeMap[symbol] = `Jungian interpretation and archetypal significance of ${symbol}`;
      }
    }

    logger.log("HyDE passages generated", { termCount: Object.keys(hydeMap).length });

    // ── Step 2: Search KB with each hypothetical passage
    const allResults: Awaited<ReturnType<typeof searchBooks>> = [];
    const seenIds = new Set<string>();

    for (const [term, passage] of Object.entries(hydeMap)) {
      const results = await searchBooks(passage, 5, 0.30);
      logger.log(`KB search for "${term}"`, { hits: results.length });
      for (const r of results) {
        if (!seenIds.has(r.chunk_id)) {
          seenIds.add(r.chunk_id);
          allResults.push(r);
        }
      }
    }

    // Sort by similarity descending so synthesizer sees best passages first
    allResults.sort((a, b) => b.similarity - a.similarity);

    const books_used = [...new Set(allResults.map((r) => r.book_slug))];

    const kb_context =
      allResults.length === 0
        ? "No relevant passages found in the knowledge base."
        : allResults
            .map(
              (r) =>
                `**${r.title ?? r.book_slug}** — ${r.chapter_title ?? "Unknown chapter"} ` +
                `(similarity: ${r.similarity.toFixed(3)})\n${r.text}`
            )
            .join("\n\n---\n\n");

    logger.log("Knowledge base searcher complete", {
      queriesSent: Object.keys(hydeMap).length,
      resultsFound: allResults.length,
      books_used,
    });

    return { kb_context, books_used };
  },
});
