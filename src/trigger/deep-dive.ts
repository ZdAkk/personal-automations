/**
 * PROJECT 1 — Deep Dive
 *
 * Teaches: scheduled polling · parent/child tasks · triggerAndWait · result handling
 *
 * Flow:
 *   deepDivePoller (runs every 2 min)
 *     → finds ClickUp tasks in "Research" status without the "deep-dive-started" tag
 *     → tags them immediately (prevents double-processing)
 *     → fires deepDive parent task per unprocessed task
 *
 *   deepDive (parent)
 *     → triggers webResearcher child  → waits for result
 *     → triggers bookContextFinder child → waits for result
 *     → triggers synthesizer child (receives both results) → waits for result
 *     → posts the final summary as a comment back on the ClickUp task
 *
 * NOTE: triggerAndWait calls are intentionally sequential (not Promise.all).
 *       Trigger.dev does not support wrapping triggerAndWait in Promise.all.
 *       Use batchTriggerAndWait only when running multiple instances of the
 *       SAME task in parallel.
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
import { researchWithBrowsing, chat } from "../lib/ai";

// ---------------------------------------------------------------------------
// Child tasks
// ---------------------------------------------------------------------------

/** Searches the live web for information on the query using a browsing-capable model. */
export const webResearcher = task({
  id: "web-researcher",
  retry: { maxAttempts: 3 },
  run: async (payload: { query: string }) => {
    logger.log("Web researcher starting", { query: payload.query });
    const findings = await researchWithBrowsing(payload.query);
    logger.log("Web researcher complete");
    return { findings };
  },
});

/**
 * Provides scholarly context from the works of Freud, Jung, and Adler.
 * The system prompt embeds deep domain knowledge so any model works well here.
 */
export const bookContextFinder = task({
  id: "book-context-finder",
  retry: { maxAttempts: 3 },
  run: async (payload: { query: string }) => {
    logger.log("Book context finder starting", { query: payload.query });

    const context = await chat([
      {
        role: "system",
        content: `You are a scholar of depth psychology and psychoanalysis with encyclopaedic knowledge of:

**Sigmund Freud** — dream analysis, the unconscious, id/ego/superego, Oedipus complex, libido theory, defence mechanisms.
Key works: "The Interpretation of Dreams" (1900), "The Psychopathology of Everyday Life" (1901), "Civilization and Its Discontents" (1930), "Three Essays on the Theory of Sexuality" (1905).

**Carl Gustav Jung** — archetypes, collective unconscious, individuation, shadow, anima/animus, persona, synchronicity, the Self, psychological types.
Key works: "Man and His Symbols" (1964), "Memories, Dreams, Reflections" (1962), "The Archetypes and the Collective Unconscious" (1959), "Psychological Types" (1921), "The Red Book" (2009).

**Alfred Adler** — individual psychology, inferiority complex, striving for superiority/significance, social interest (Gemeinschaftsgefühl), lifestyle, birth order, fictional final goals.
Key works: "Understanding Human Nature" (1927), "The Practice and Theory of Individual Psychology" (1925), "What Life Could Mean to You" (1931).

Always cite specific books and chapters. Highlight where these thinkers agree, disagree, or complement one another.`,
      },
      {
        role: "user",
        content: `Provide rich scholarly context from the works of Freud, Jung, and Adler regarding:\n\n"${payload.query}"\n\nInclude:\n- Each thinker's specific perspective\n- Relevant book/chapter citations\n- Points of contrast between the three`,
      },
    ]);

    logger.log("Book context finder complete");
    return { context };
  },
});

/**
 * Receives raw web findings + scholarly context and produces a structured
 * research summary that is posted back to the ClickUp task.
 */
export const synthesizer = task({
  id: "synthesizer",
  retry: { maxAttempts: 3 },
  run: async (payload: {
    query: string;
    webFindings: string;
    bookContext: string;
  }) => {
    logger.log("Synthesizer starting", { query: payload.query });

    const summary = await chat([
      {
        role: "system",
        content:
          "You are an expert research synthesiser. Combine web research with scholarly " +
          "book context into a clear, structured report. Use markdown formatting.",
      },
      {
        role: "user",
        content: `Synthesise the following research about "${payload.query}" into a structured report.

---
## Web Research Findings
${payload.webFindings}

---
## Scholarly Book Context (Freud · Jung · Adler)
${payload.bookContext}

---
Format your response exactly as:

## 🧠 Core Answer
(2–3 sentences giving the direct answer)

## 💡 Key Insights
(bullet points — the most important takeaways)

## 🔬 Scholarly Perspectives
### Freud
### Jung
### Adler

## 📚 Recommended Reading
(specific books and chapters most relevant to this question)

## ❓ Further Questions
(3 follow-up questions worth exploring next)`,
      },
    ]);

    logger.log("Synthesizer complete");
    return { summary };
  },
});

// ---------------------------------------------------------------------------
// Parent task
// ---------------------------------------------------------------------------

export const deepDive = task({
  id: "deep-dive",
  retry: { maxAttempts: 2 },
  run: async (payload: {
    taskId: string;
    title: string;
    description: string;
  }) => {
    const query = [payload.title, payload.description]
      .filter(Boolean)
      .join(": ");

    logger.log("Deep dive starting", { taskId: payload.taskId, query });

    // Step 1 — Web research
    const webResult = await webResearcher.triggerAndWait({ query });
    if (!webResult.ok) {
      throw new Error(`webResearcher failed: ${webResult.error}`);
    }

    // Step 2 — Book context (sequential: triggerAndWait cannot be in Promise.all)
    const bookResult = await bookContextFinder.triggerAndWait({ query });
    if (!bookResult.ok) {
      throw new Error(`bookContextFinder failed: ${bookResult.error}`);
    }

    // Step 3 — Synthesise
    const synthesisResult = await synthesizer.triggerAndWait({
      query,
      webFindings: webResult.output.findings,
      bookContext: bookResult.output.context,
    });
    if (!synthesisResult.ok) {
      throw new Error(`synthesizer failed: ${synthesisResult.error}`);
    }

    // Step 4 — Post back to ClickUp and move to Review
    const comment =
      `## 🧠 Deep Dive Research Complete\n\n` +
      synthesisResult.output.summary +
      `\n\n---\n*Generated by The Analyst · Task moved to **Review** — accept or send back for more research*`;

    await addComment(payload.taskId, comment);
    await updateTaskStatus(payload.taskId, "Review");
    await removeTag(payload.taskId, "deep-dive-started");

    logger.log("Deep dive complete — comment posted, status set to Review, tag removed", {
      taskId: payload.taskId,
    });

    return {
      taskId: payload.taskId,
      query,
      summary: synthesisResult.output.summary,
    };
  },
});

// ---------------------------------------------------------------------------
// Poller — watches ClickUp every 2 minutes for new "Research" tasks
// ---------------------------------------------------------------------------

export const deepDivePoller = schedules.task({
  id: "deep-dive-poller",
  // Every 2 minutes. Attach this schedule in the Trigger.dev dashboard.
  cron: "*/2 * * * *",
  run: async () => {
    const listId = process.env.CLICKUP_LIST_ID;
    if (!listId) throw new Error("CLICKUP_LIST_ID is not set");

    logger.log("Polling ClickUp for Research tasks…");

    const tasks: ClickUpTask[] = await getTasksByStatus(listId, "Research");

    // Filter out tasks already being processed (tagged "deep-dive-started")
    const unprocessed = tasks.filter((t) => !hasTag(t, "deep-dive-started"));

    logger.log(`Found ${unprocessed.length} unprocessed Research task(s)`);

    for (const t of unprocessed) {
      // Tag first — if the trigger below fails the tag prevents an infinite retry loop
      await addTag(t.id, "deep-dive-started");

      await deepDive.trigger(
        {
          taskId: t.id,
          title: t.name,
          description: t.description ?? "",
        },
        {
          // Idempotency key ensures at-most-once execution even if the
          // poller fires twice in rapid succession
          idempotencyKey: `deep-dive-${t.id}`,
        }
      );

      logger.log("Triggered deep dive", { id: t.id, name: t.name });
    }
  },
});
