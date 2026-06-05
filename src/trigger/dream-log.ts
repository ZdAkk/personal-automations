/**
 * Dream Log Automation — v4
 *
 * Status-based double-processing prevention (no tags).
 * Contextual KB queries for better book relevance.
 * Scholar citations read from Perplexity API response annotations.
 * dreamCleaner extracts day_residue from raw text as part of structured output.
 * dreamSynthesizer uses full Jungian depth psychology system prompt.
 */

import { task, schedules, logger } from "@trigger.dev/sdk";
import {
  getTasksByStatus,
  getCustomField,
  addComment,
  updateTaskStatus,
  type ClickUpTask,
} from "../lib/clickup";
import { chat, researchWithBrowsingAndSources } from "../lib/ai";
import {
  searchBooks,
  ingestDream,
  addInterpretation,
  type DreamSymbol,
  type InterpretationPayload,
} from "../lib/knowledge-base";

// ---------------------------------------------------------------------------
// Child task: dreamCleaner
// ---------------------------------------------------------------------------

export const dreamCleaner = task({
  id: "dream-cleaner",
  retry: { maxAttempts: 3 },
  run: async (payload: {
    taskId: string;
    rawText: string;
    dreamedOn: string;
    dayResidueHint: string | null; // from ClickUp custom field — used as a seed for the AI
  }) => {
    logger.log("Dream cleaner starting", { taskId: payload.taskId });

    const model = process.env.DREAM_CLEANER_MODEL ?? "deepseek/deepseek-r1";

    const dayResidueHintSection = payload.dayResidueHint
      ? `\n\nThe dreamer has provided this day residue hint (use it to guide your extraction of the day_residue field):\n${payload.dayResidueHint}`
      : "";

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
  "day_residue": "what the dreamer experienced, encountered, or was preoccupied with in the day or two before the dream — extracted from the raw text if mentioned, otherwise null",
  "key_themes": ["array of 3-6 thematic strings for Jungian analysis"],
  "symbols": ["array of significant symbols or figures as short strings"]
}

Raw dream text:
${payload.rawText}${dayResidueHintSection}`,
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
      cleaned_text: parsed.cleaned_text,
      day_residue: parsed.day_residue,
    };
  },
});

// ---------------------------------------------------------------------------
// Child task: knowledgeBaseSearcher
// ---------------------------------------------------------------------------

export const knowledgeBaseSearcher = task({
  id: "knowledge-base-searcher",
  retry: { maxAttempts: 3 },
  run: async (payload: {
    dream_id: string;
    key_themes: string[];
    symbols: string[];
    cleaned_text: string;
  }) => {
    logger.log("Knowledge base searcher starting", { dream_id: payload.dream_id });

    // Contextual phrasing embeds richer semantic meaning than bare keywords,
    // naturally surfacing Jungian texts over irrelevant books.
    const themeQueries = payload.key_themes
      .slice(0, 2)
      .map((t) => `What does Jung say about ${t} in dreams?`);
    const symbolQueries = payload.symbols
      .slice(0, 2)
      .map((s) => `Jungian interpretation and archetypal significance of ${s}`);
    const queries = [...themeQueries, ...symbolQueries];

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
    const kb_context =
      allResults.length === 0
        ? "No relevant passages found in the knowledge base."
        : allResults
            .map(
              (r) =>
                `**${r.title ?? r.book_slug}** — ${r.chapter_title ?? "Unknown chapter"}\n${r.text}`
            )
            .join("\n\n---\n\n");

    logger.log("Knowledge base searcher complete", {
      resultsFound: allResults.length,
      books_used,
    });

    return { kb_context, books_used };
  },
});

// ---------------------------------------------------------------------------
// Child task: scholarlyResearcher
// ---------------------------------------------------------------------------

export const scholarlyResearcher = task({
  id: "scholarly-researcher",
  retry: { maxAttempts: 3 },
  run: async (payload: { key_themes: string[]; symbols: string[] }) => {
    logger.log("Scholarly researcher starting", {
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

// ---------------------------------------------------------------------------
// Child task: dreamSynthesizer
// ---------------------------------------------------------------------------

export const dreamSynthesizer = task({
  id: "dream-synthesizer",
  retry: { maxAttempts: 3 },
  run: async (payload: {
    dream_id: string;
    cleaned_text: string;
    day_residue: string | null;
    kb_context: string;
    scholarly_context: string;
    symbols: string[];
    books_used: string[];
    web_sources: string[];
  }) => {
    logger.log("Dream synthesizer starting", { dream_id: payload.dream_id });

    const model = process.env.DREAM_SYNTHESIZER_MODEL ?? "deepseek/deepseek-r1";

    const dayResidueSection = payload.day_residue
      ? `\n---\nDay Residue (what the dreamer experienced in the day or two before this dream):\n${payload.day_residue}`
      : "\n---\nDay Residue: not provided.";

    const raw = await chat(
      [
        {
          role: "system",
          content: `You are a depth psychologist in the tradition of Carl Gustav Jung. You have spent sixty years sitting with patients and their dreams. You do not interpret dreams mechanically or impose meanings from outside — you listen to what the psyche is trying to say, on its own terms, in its own language.

Your interpretive framework rests on several principles that you must never abandon:

1. THE DREAM IS NOT A DISGUISE. Unlike Freud, you do not believe the dream hides its meaning. The dream says exactly what it means — but in the language of images, not of rational thought. Your task is translation, not decryption.

2. PERSONAL ASSOCIATION BEFORE AMPLIFICATION. Before reaching for mythology or collective symbolism, you must always ask: what does this image mean to *this* dreamer? A gun is not universally a symbol of aggression. A professor is not universally a Wise Old Man. You must first exhaust the personal dimension — what the dreamer associates with this figure, this object, this place, especially in the days leading up to the dream. Only when the personal layer is fully explored do you widen outward to archetypal parallels.

3. DAY RESIDUE IS NOT NOISE — IT IS THE DOORWAY. The experiences of the previous day are not accidental material that the unconscious happens to pick up. They are the specific entry points the psyche chose. The unconscious selects from waking experience precisely those images that carry the energetic charge it needs to make its statement. If the dreamer encountered an authority figure the day before and that figure appears in the dream, this is not coincidence — it is the unconscious using a ready-made vessel. Always interpret the day residue as a deliberate choice by the psyche, not as background noise.

4. THE DREAM COMPENSATES. The unconscious does not tell the dreamer what the conscious mind already knows. It compensates — it brings forward what is missing, suppressed, undeveloped, or dangerously one-sided in the dreamer's conscious attitude. Ask yourself: what is the dreamer's conscious position, and how does this dream correct, deepen, or challenge it?

5. SYMBOLS ARE ALIVE, NOT FIXED. A symbol from the collective unconscious — the Shadow, the Anima, the Wise Old Man, the descent — is a living psychic reality, not a label to be applied. When you name an archetype, you must show how it is alive and specific in *this* dream, *this* dreamer's life. The archetypal name is the beginning of the interpretation, not the end.

6. THE SELF SPEAKS IN WHOLE SITUATIONS, NOT SINGLE IMAGES. Read the dream as a drama — with a setting, a development, a climax, a resolution or lack thereof. The narrative structure itself carries meaning. A dream that ends in escape means something different from one that ends in victory, surrender, or ambiguity.

7. DO NOT MORALIZE. You do not tell the dreamer what they should do. You tell them what the unconscious is already doing — what it is working on, what it is trying to integrate. The psyche knows its direction. Your job is to make it visible.

Return only valid JSON. No markdown. No preamble. No explanation outside the JSON.`,
        },
        {
          role: "user",
          content: `Analyse this dream and return a single JSON object with exactly these fields:
{
  "central_theme": "one sentence naming the core psychological drama of this dream",
  "jungian_analysis": "your full interpretation — structured as a drama (setting → development → climax → resolution), addressing each major symbol in order of appearance, grounding each first in the day residue and personal context before widening to archetypal meaning, referencing the library passages where relevant",
  "waking_life": "how this dream speaks to the dreamer's current life situation — what the unconscious is compensating for, what it is trying to bring forward",
  "message": "the psyche's core statement in 2-3 sentences — not advice, but what the unconscious is doing",
  "symbols": [
    {
      "name": "symbol or figure name",
      "archetype": "Jungian archetype",
      "description": "what it was in the dream",
      "significance": "what it means psychologically, grounded first in day residue then archetype",
      "jungian_concept": "specific Jungian concept"
    }
  ]
}

Dream text:
${payload.cleaned_text}
${dayResidueSection}

---
Knowledge Base Passages (from ingested Jungian texts — use for amplification after personal context):
${payload.kb_context}

---
Scholarly Research:
${payload.scholarly_context}

Symbols to address: ${payload.symbols.join(", ")}`,
        },
      ],
      model
    );

    let parsed: {
      central_theme: string;
      jungian_analysis: string;
      waking_life: string;
      message: string;
      symbols: DreamSymbol[];
    };

    try {
      const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(stripped);
    } catch (e) {
      throw new Error(
        `dreamSynthesizer: failed to parse AI response as JSON. Raw output: ${raw.slice(0, 500)}`
      );
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

// ---------------------------------------------------------------------------
// Parent task: dreamLog
// ---------------------------------------------------------------------------

export const dreamLog = task({
  id: "dream-log",
  retry: { maxAttempts: 1 },
  run: async (payload: {
    taskId: string;
    rawText: string;
    dreamedOn: string;
    dayResidueHint: string | null;
  }) => {
    logger.log("Dream log starting", {
      taskId: payload.taskId,
      dreamedOn: payload.dreamedOn,
      hasDayResidueHint: !!payload.dayResidueHint,
    });

    try {
      // Step 1 — Clean the dream, extract day_residue, ingest into KB
      const cleanerResult = await dreamCleaner.triggerAndWait({
        taskId: payload.taskId,
        rawText: payload.rawText,
        dreamedOn: payload.dreamedOn,
        dayResidueHint: payload.dayResidueHint,
      });
      if (!cleanerResult.ok) throw new Error(`dreamCleaner failed: ${cleanerResult.error}`);
      const { dream_id, key_themes, symbols, cleaned_text, day_residue } = cleanerResult.output;

      // Step 2 — Search knowledge base for relevant Jungian passages
      const kbResult = await knowledgeBaseSearcher.triggerAndWait({
        dream_id,
        key_themes,
        symbols,
        cleaned_text,
      });
      if (!kbResult.ok) throw new Error(`knowledgeBaseSearcher failed: ${kbResult.error}`);
      const { kb_context, books_used } = kbResult.output;

      // Step 3 — Scholarly web research
      const scholarResult = await scholarlyResearcher.triggerAndWait({ key_themes, symbols });
      if (!scholarResult.ok) throw new Error(`scholarlyResearcher failed: ${scholarResult.error}`);
      const { scholarly_context, web_sources } = scholarResult.output;

      // Step 4 — Synthesize and store interpretation
      const synthResult = await dreamSynthesizer.triggerAndWait({
        dream_id,
        cleaned_text,
        day_residue,
        kb_context,
        scholarly_context,
        symbols,
        books_used,
        web_sources,
      });
      if (!synthResult.ok) throw new Error(`dreamSynthesizer failed: ${synthResult.error}`);
      const { interpretation } = synthResult.output;

      // Step 5 — Post summary to ClickUp
      const model = process.env.DREAM_SYNTHESIZER_MODEL ?? "deepseek/deepseek-r1";
      const comment =
        `## 🌙 Dream Interpretation Complete\n\n` +
        `**Theme:** ${interpretation.central_theme}\n\n` +
        `**Message:** ${interpretation.message}\n\n` +
        `---\n*Full analysis stored in knowledge base — dream_id: ${dream_id}*\n` +
        `*Interpreted using Jungian analytical psychology · ${model}*`;

      await addComment(payload.taskId, comment);
      await updateTaskStatus(payload.taskId, "Done");

      logger.log("Dream log complete", { taskId: payload.taskId, dream_id });
      return { taskId: payload.taskId, dream_id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.log("Dream log failed", { taskId: payload.taskId, error: message });
      await updateTaskStatus(payload.taskId, "Error").catch(() => {});
      await addComment(
        payload.taskId,
        `## ❌ Dream Log Failed\n\n**Error:**\n\`\`\`\n${message}\n\`\`\`\n\n*Check the Trigger.dev dashboard for the full run trace.*`
      ).catch(() => {});
      throw err;
    }
  },
});

// ---------------------------------------------------------------------------
// Poller — watches ClickUp every 2 minutes for new "Raw" dream tasks
// ---------------------------------------------------------------------------

export const dreamLogPoller = schedules.task({
  id: "dream-log-poller",
  cron: "*/2 * * * *",
  run: async () => {
    const listId = process.env.CLICKUP_DREAM_LIST_ID;
    if (!listId) throw new Error("CLICKUP_DREAM_LIST_ID is not set");

    logger.log("Polling ClickUp Dream Log for Raw tasks…");
    const tasks: ClickUpTask[] = await getTasksByStatus(listId, "Raw");

    logger.log(`Found ${tasks.length} Raw dream(s)`);

    for (const t of tasks) {
      const rawText = t.description?.trim() ?? "";
      if (!rawText) {
        logger.log("Skipping task with empty description", { id: t.id });
        continue;
      }

      // Move to Processing before triggering — next poll won't see it as Raw
      await updateTaskStatus(t.id, "Processing");

      const dreamedOn = new Date(parseInt(t.date_created ?? "0"))
        .toISOString()
        .split("T")[0];

      // Read optional day residue hint from ClickUp custom field
      const dayResidueHint = getCustomField(t, "dayResidue");
      if (dayResidueHint) {
        logger.log("Day residue hint found", { id: t.id });
      }

      await dreamLog.trigger(
        { taskId: t.id, rawText, dreamedOn, dayResidueHint },
        { idempotencyKey: `dream-log-${t.id}` }
      );

      logger.log("Triggered dream log", { id: t.id, dreamedOn });
    }
  },
});
