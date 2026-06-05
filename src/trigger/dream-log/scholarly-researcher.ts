/**
 * Scholarly Researcher
 *
 * Runs a live web search via Perplexity Sonar to find current scholarly
 * sources, articles, and academic perspectives on the Jungian themes
 * and symbols identified in the dream.
 *
 * Citations are read from the Perplexity API response annotations field
 * (not from the text body, which never contains raw URLs).
 */

import { task, logger } from "@trigger.dev/sdk";
import { researchWithBrowsingAndSources } from "../../lib/ai";

export const scholarlyResearcher = task({
  id: "scholarly-researcher",
  retry: { maxAttempts: 3 },
  run: async (payload: { key_themes: string[]; symbols: string[] }) => {
    const researchModel = process.env.DREAM_RESEARCHER_MODEL ?? "perplexity/sonar";
    logger.log("Scholarly researcher starting", {
      model: researchModel,
      themes: payload.key_themes,
      symbols: payload.symbols,
    });

    const combined = [...payload.key_themes, ...payload.symbols].join(", ");
    const query = `Jungian psychological analysis of: ${combined} — scholarly sources, archetypes, and depth psychology`;
    const { content, citations } = await researchWithBrowsingAndSources(query);

    logger.log("Scholarly researcher complete", { citationsFound: citations.length });

    return { scholarly_context: content, web_sources: citations };
  },
});
