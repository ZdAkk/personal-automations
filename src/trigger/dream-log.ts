/**
 * Dream Log Automation — v1
 *
 * Uses tag-based double-processing prevention.
 * KB queries use bare keywords (naive approach).
 * Scholar web_sources extracted via regex from text body (broken — always empty).
 */

import { task, schedules, logger } from "@trigger.dev/sdk";
import {
  getTasksByStatus,
  addTag,
  removeTag,
  addComment,
  updateTaskStatus,
  hasTag,
  type ClickUpTask,
} from "../lib/clickup";
import { chat, researchWithBrowsing } from "../lib/ai";
import {
  searchBooks,
  ingestDream,
  addInterpretation,
  type DreamSymbol,
  type InterpretationPayload,
} from "../lib/knowledge-base";

export const dreamCleaner = task({
  id: "dream-cleaner",
  retry: { maxAttempts: 3 },
  run: async (payload: { taskId: string; rawText: string; dreamedOn: string }) => {
    logger.log("Dream cleaner starting", { taskId: payload.taskId });

    const model = process.env.DREAM_CLEANER_MODEL ?? "deepseek/deepseek-r1";

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
      key_themes: string[];
      symbols: string[];
    };

    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new Error(`dreamCleaner: failed to parse AI response as JSON. Raw output: ${raw.slice(0, 500)}`);
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
    });

    logger.log("Dream cleaner complete", { dream_id });
    return { dream_id, key_themes: parsed.key_themes, symbols: parsed.symbols, cleaned_text: parsed.cleaned_text };
  },
});

export const knowledgeBaseSearcher = task({
  id: "knowledge-base-searcher",
  retry: { maxAttempts: 3 },
  run: async (payload: { dream_id: string; key_themes: string[]; symbols: string[]; cleaned_text: string }) => {
    logger.log("Knowledge base searcher starting", { dream_id: payload.dream_id });

    // Naive: bare keyword queries — pulls irrelevant books into results
    const queries = [...payload.key_themes.slice(0, 2), ...payload.symbols.slice(0, 2)];

    const allResults: Awaited<ReturnType<typeof searchBooks>> = [];
    const seenIds = new Set<string>();

    for (const query of queries) {
      const results = await searchBooks(query, 3, 0.3);
      for (const r of results) {
        if (!seenIds.has(r.chunk_id)) {
          seenIds.add(r.chunk_id);
          allResults.push(r);
        }
      }
    }

    const books_used = [...new Set(allResults.map((r) => r.book_slug))];
    const kb_context = allResults.length === 0
      ? "No relevant passages found in the knowledge base."
      : allResults.map((r) => `**${r.title ?? r.book_slug}** — ${r.chapter_title ?? "Unknown chapter"}\n${r.text}`).join("\n\n---\n\n");

    logger.log("Knowledge base searcher complete", { resultsFound: allResults.length, books_used });
    return { kb_context, books_used };
  },
});

export const scholarlyResearcher = task({
  id: "scholarly-researcher",
  retry: { maxAttempts: 3 },
  run: async (payload: { key_themes: string[]; symbols: string[] }) => {
    logger.log("Scholarly researcher starting", { themes: payload.key_themes, symbols: payload.symbols });

    const combined = [...payload.key_themes, ...payload.symbols].join(", ");
    const query = `Jungian psychological analysis of: ${combined} — scholarly sources, archetypes, and depth psychology`;
    const raw = await researchWithBrowsing(query);

    // BUG: Perplexity returns citations in a separate API field, not in the text body.
    // This regex always returns empty — web_sources will always be [].
    const urlPattern = /https?:\/\/[^\s)>"\]]+/g;
    const web_sources = [...new Set(raw.match(urlPattern) ?? [])].slice(0, 10);

    logger.log("Scholarly researcher complete");
    return { scholarly_context: raw, web_sources };
  },
});

export const dreamSynthesizer = task({
  id: "dream-synthesizer",
  retry: { maxAttempts: 3 },
  run: async (payload: {
    dream_id: string;
    cleaned_text: string;
    kb_context: string;
    scholarly_context: string;
    symbols: string[];
    books_used: string[];
    web_sources: string[];
  }) => {
    logger.log("Dream synthesizer starting", { dream_id: payload.dream_id });

    const model = process.env.DREAM_SYNTHESIZER_MODEL ?? "deepseek/deepseek-r1";

    const raw = await chat(
      [
        {
          role: "system",
          content:
            "You are an experienced Jungian analyst with deep knowledge of analytical psychology. " +
            "You have access to both classical Jungian texts and current scholarship. " +
            "You MUST return ONLY a valid JSON object — no markdown, no explanation, no preamble. " +
            "The JSON must conform exactly to the schema described by the user.",
        },
        {
          role: "user",
          content: `Analyse this dream using Jungian analytical psychology and return a single JSON object with exactly these fields:
{
  "central_theme": "one sentence capturing the core psychological theme",
  "jungian_analysis": "full multi-paragraph analysis referencing the KB passages and scholarly sources",
  "waking_life": "connection to current life circumstances inferred from dream content",
  "message": "the psyche's core message in 2-3 sentences",
  "symbols": [
    {
      "name": "symbol or figure name",
      "archetype": "Jungian archetype (e.g. The Shadow, The Anima, The Self)",
      "description": "what it was in the dream",
      "significance": "what it means psychologically",
      "jungian_concept": "specific Jungian concept (e.g. Shadow, Individuation)"
    }
  ]
}

Dream text:
${payload.cleaned_text}

---
Knowledge Base Passages (from ingested Jungian texts):
${payload.kb_context}

---
Scholarly Research:
${payload.scholarly_context}

Symbols to analyse: ${payload.symbols.join(", ")}`,
        },
      ],
      model
    );

    let parsed: { central_theme: string; jungian_analysis: string; waking_life: string; message: string; symbols: DreamSymbol[] };

    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new Error(`dreamSynthesizer: failed to parse AI response as JSON. Raw output: ${raw.slice(0, 500)}`);
    }

    const interpretationPayload: InterpretationPayload = {
      central_theme: parsed.central_theme,
      jungian_analysis: parsed.jungian_analysis,
      waking_life: parsed.waking_life,
      message: parsed.message,
      symbols: parsed.symbols,
      books_used: payload.books_used,
      web_sources: payload.web_sources,
      scholar_sources: null,
      model_used: model,
    };

    await addInterpretation(payload.dream_id, interpretationPayload);
    logger.log("Dream synthesizer complete", { dream_id: payload.dream_id });
    return { interpretation: interpretationPayload };
  },
});

export const dreamLog = task({
  id: "dream-log",
  retry: { maxAttempts: 1 },
  run: async (payload: { taskId: string; rawText: string; dreamedOn: string }) => {
    logger.log("Dream log starting", { taskId: payload.taskId, dreamedOn: payload.dreamedOn });

    try {
      const cleanerResult = await dreamCleaner.triggerAndWait({ taskId: payload.taskId, rawText: payload.rawText, dreamedOn: payload.dreamedOn });
      if (!cleanerResult.ok) throw new Error(`dreamCleaner failed: ${cleanerResult.error}`);
      const { dream_id, key_themes, symbols, cleaned_text } = cleanerResult.output;

      const kbResult = await knowledgeBaseSearcher.triggerAndWait({ dream_id, key_themes, symbols, cleaned_text });
      if (!kbResult.ok) throw new Error(`knowledgeBaseSearcher failed: ${kbResult.error}`);
      const { kb_context, books_used } = kbResult.output;

      const scholarResult = await scholarlyResearcher.triggerAndWait({ key_themes, symbols });
      if (!scholarResult.ok) throw new Error(`scholarlyResearcher failed: ${scholarResult.error}`);
      const { scholarly_context, web_sources } = scholarResult.output;

      const synthResult = await dreamSynthesizer.triggerAndWait({ dream_id, cleaned_text, kb_context, scholarly_context, symbols, books_used, web_sources });
      if (!synthResult.ok) throw new Error(`dreamSynthesizer failed: ${synthResult.error}`);
      const { interpretation } = synthResult.output;

      const model = process.env.DREAM_SYNTHESIZER_MODEL ?? "deepseek/deepseek-r1";
      const comment =
        `## 🌙 Dream Interpretation Complete\n\n` +
        `**Theme:** ${interpretation.central_theme}\n\n` +
        `**Message:** ${interpretation.message}\n\n` +
        `---\n*Full analysis stored in knowledge base — dream_id: ${dream_id}*\n` +
        `*Interpreted using Jungian analytical psychology · ${model}*`;

      await addComment(payload.taskId, comment);
      await updateTaskStatus(payload.taskId, "Done");
      await removeTag(payload.taskId, "dream-processing-started");

      logger.log("Dream log complete", { taskId: payload.taskId, dream_id });
      return { taskId: payload.taskId, dream_id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.log("Dream log failed", { taskId: payload.taskId, error: message });
      await updateTaskStatus(payload.taskId, "Error").catch(() => {});
      await removeTag(payload.taskId, "dream-processing-started").catch(() => {});
      await addComment(payload.taskId, `## ❌ Dream Log Error\n\n\`\`\`\n${message}\n\`\`\``).catch(() => {});
      throw err;
    }
  },
});

export const dreamLogPoller = schedules.task({
  id: "dream-log-poller",
  cron: "*/2 * * * *",
  run: async () => {
    const listId = process.env.CLICKUP_DREAM_LIST_ID;
    if (!listId) throw new Error("CLICKUP_DREAM_LIST_ID is not set");

    logger.log("Polling ClickUp Dream Log for Raw tasks…");
    const tasks: ClickUpTask[] = await getTasksByStatus(listId, "Raw");
    const unprocessed = tasks.filter((t) => !hasTag(t, "dream-processing-started"));

    logger.log(`Found ${unprocessed.length} unprocessed Raw dream(s)`);

    for (const t of unprocessed) {
      const rawText = t.description?.trim() ?? "";
      if (!rawText) { logger.log("Skipping task with empty description", { id: t.id }); continue; }

      const dreamedOn = new Date(parseInt(t.date_created ?? "0")).toISOString().split("T")[0];

      await addTag(t.id, "dream-processing-started");
      await updateTaskStatus(t.id, "Processing");
      await dreamLog.trigger({ taskId: t.id, rawText, dreamedOn }, { idempotencyKey: `dream-log-${t.id}` });
      logger.log("Triggered dream log", { id: t.id, dreamedOn });
    }
  },
});
