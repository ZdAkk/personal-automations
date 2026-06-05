/**
 * Dream Log — Parent Task & Poller
 *
 * Orchestrates the full dream interpretation pipeline:
 *
 *   dreamLogPoller (every 2 min)
 *     → picks up "Raw" tasks from ClickUp Dream Log list
 *     → moves to "Processing", triggers dreamLog parent
 *
 *   dreamLog (parent)
 *     → dreamCleaner       — structure raw text, extract day_residue, ingest to KB
 *     → knowledgeBaseSearcher — HyDE retrieval of relevant Jungian passages
 *     → scholarlyResearcher   — live web research via Perplexity
 *     → dreamSynthesizer      — full Jungian interpretation, store in KB
 *     → posts summary comment to ClickUp, moves task to "Done"
 *     → on error: moves to "Error", posts error comment
 *
 * All child tasks are defined in sibling files and imported here.
 * triggerAndWait calls are always sequential — never wrapped in Promise.all.
 */

import { task, schedules, logger } from "@trigger.dev/sdk";
import {
  getTasksByStatus,
  getCustomField,
  addComment,
  updateTaskStatus,
  type ClickUpTask,
} from "../../lib/clickup";

import { dreamCleaner } from "./cleaner";
import { knowledgeBaseSearcher } from "./kb-searcher";
import { scholarlyResearcher } from "./scholarly-researcher";
import { dreamSynthesizer } from "./synthesizer";

// Re-export child tasks so Trigger.dev picks them up from this index
export { dreamCleaner, knowledgeBaseSearcher, scholarlyResearcher, dreamSynthesizer };

// ---------------------------------------------------------------------------
// Parent task
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

      // Step 2 — HyDE retrieval of relevant Jungian passages
      const kbResult = await knowledgeBaseSearcher.triggerAndWait({
        dream_id,
        key_themes,
        symbols,
        cleaned_text,
      });
      if (!kbResult.ok) throw new Error(`knowledgeBaseSearcher failed: ${kbResult.error}`);
      const { kb_context, books_used } = kbResult.output;

      // Step 3 — Live scholarly web research
      const scholarResult = await scholarlyResearcher.triggerAndWait({ key_themes, symbols });
      if (!scholarResult.ok) throw new Error(`scholarlyResearcher failed: ${scholarResult.error}`);
      const { scholarly_context, web_sources } = scholarResult.output;

      // Step 4 — Synthesize and store full interpretation
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

      // Step 5 — Post summary comment to ClickUp and mark done
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
