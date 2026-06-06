/**
 * Dream Cleaner
 *
 * Receives raw dream text and uses an AI model to:
 *  - Write a polished cleaned narrative
 *  - Extract structured metadata (title, emotional tone, lucid flag)
 *  - Extract day_residue directly from the raw text — no hint required.
 *    The dreamer writes everything in one message; the model identifies
 *    any waking-life context (events, worries, encounters, media) embedded
 *    in the narrative and lifts it out as day_residue.
 *  - Identify key Jungian themes and symbols for downstream tasks
 *
 * Then ingests the dream record into the knowledge base API.
 * Returns everything the parent needs to pass to subsequent tasks.
 */

import { task, logger } from "@trigger.dev/sdk";
import { chat } from "../../lib/ai";
import { ingestDream } from "../../lib/knowledge-base";

export const dreamCleaner = task({
  id: "dream-cleaner",
  retry: { maxAttempts: 3 },
  run: async (payload: {
    taskId: string;
    rawText: string;
    dreamedOn: string;
  }) => {
    const model = process.env.DREAM_CLEANER_MODEL ?? "deepseek/deepseek-v3.2";
    logger.log("Dream cleaner starting", { taskId: payload.taskId, model });

    const raw = await chat(
      [
        {
          role: "system",
          content:
            "You are a Jungian-aware analyst who helps people process their dreams. " +
            "Your task is to clean and structure a raw dream report. " +
            "You MUST return ONLY a valid JSON object — no markdown, no explanation, no preamble. " +
            "The JSON must conform exactly to the schema described by the user.",
        },
        {
          role: "user",
          content: `Process this dream and return a single JSON object with exactly these fields:
{
  "title": "short evocative title for the dream (5-8 words)",
  "cleaned_text": "polished, fluent narrative of the dream preserving all details",
  "emotional_tone": ["array", "of", "emotion", "strings"],
  "lucid": false,
  "day_residue": "carefully read the raw text for any waking-life material the dreamer mentions — events, conversations, worries, people encountered, media consumed, or anything experienced in the day or two before the dream, even if woven into the narrative rather than stated explicitly. Extract this as a concise summary string. Do NOT label or annotate it — write it as plain observed fact. If no waking-life context can be identified at all, use null.",
  "key_themes": ["array of 3-6 thematic strings for Jungian analysis"],
  "symbols": ["array of significant symbols or figures as short strings"]
}

Raw dream text:
${payload.rawText}`,
        },
      ],
      model
    );

    let parsed: {
      title: string;
      cleaned_text: string;
      emotional_tone: string[];
      lucid: boolean;
      day_residue: string | null;
      key_themes: string[];
      symbols: string[];
    };

    try {
      const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(stripped);
    } catch (e) {
      throw new Error(
        `dreamCleaner: failed to parse AI response as JSON. Raw output: ${raw.slice(0, 500)}`
      );
    }

    const { dream_id } = await ingestDream({
      dreamed_on: payload.dreamedOn,
      raw_text: payload.rawText,
      cleaned_text: parsed.cleaned_text,
      title: parsed.title,
      emotional_tone: parsed.emotional_tone,
      lucid: parsed.lucid,
      recurring: false,
      notes: null,
      day_residue: parsed.day_residue,
    });

    logger.log("Dream cleaner complete", { dream_id, day_residue: parsed.day_residue });

    return {
      dream_id,
      key_themes: parsed.key_themes,
      symbols: parsed.symbols,
      cleaned_text: parsed.clea