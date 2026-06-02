/**
 * Unified AI client via OpenRouter
 *
 * Uses the OpenAI-compatible SDK pointed at OpenRouter's API, so you can swap
 * any model (OpenAI, Anthropic, Mistral, Perplexity, etc.) by just changing
 * the OPENROUTER_DEFAULT_MODEL or OPENROUTER_RESEARCH_MODEL env vars —
 * no code changes required.
 *
 * Default models:
 *   OPENROUTER_DEFAULT_MODEL  → openai/gpt-4o-mini  (fast, cheap, good for synthesis)
 *   OPENROUTER_RESEARCH_MODEL → perplexity/sonar     (has live web browsing built-in)
 *
 * To use your OpenAI key directly (without OpenRouter), set:
 *   OPENROUTER_API_KEY=<your OpenAI key>
 *   OPENROUTER_BASE_URL=https://api.openai.com/v1
 *   OPENROUTER_DEFAULT_MODEL=gpt-4o-mini
 *   OPENROUTER_RESEARCH_MODEL=gpt-4o  (note: no built-in browsing this way)
 */

import OpenAI from "openai";

function getClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    defaultHeaders: {
      // OpenRouter uses these for rate-limit grouping & dashboard attribution
      "HTTP-Referer": "https://github.com/personal-automations",
      "X-Title": "The Analyst",
    },
  });
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * General-purpose chat completion.
 * Pass an optional `model` to override OPENROUTER_DEFAULT_MODEL for this call.
 */
export async function chat(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  model?: string
): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: model ?? process.env.OPENROUTER_DEFAULT_MODEL ?? "openai/gpt-4o-mini",
    messages,
  });
  return response.choices[0]?.message?.content ?? "";
}

/**
 * Research query with live web browsing.
 * Uses OPENROUTER_RESEARCH_MODEL (default: perplexity/sonar) which has
 * built-in internet access — no separate search API key needed.
 */
export async function researchWithBrowsing(query: string): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model:
      process.env.OPENROUTER_RESEARCH_MODEL ?? "perplexity/sonar",
    messages: [
      {
        role: "system",
        content:
          "You are a research assistant specialising in psychology, psychoanalysis, " +
          "and depth psychology. Search the web for current, reliable information and " +
          "provide well-sourced findings. Always cite your sources.",
      },
      {
        role: "user",
        content: `Research the following topic and provide a comprehensive, sourced summary:\n\n"${query}"`,
      },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}
