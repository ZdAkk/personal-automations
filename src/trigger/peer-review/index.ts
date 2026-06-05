/**
 * PROJECT 3 — Peer Review (Async Review Workflow)
 *
 * Teaches: wait.for · long-running tasks · checkpointing · conditional branching
 *
 * Flow:
 *   peerReviewPoller (runs every 2 minutes)
 *     → finds ClickUp tasks in "Review" status without "peer-review-started" tag
 *     → tags them immediately (prevents double-processing)
 *     → fires peerReview task per unprocessed task
 *
 *   peerReview (long-running task)
 *     → posts an opening comment explaining the review window
 *     → WAITS 48 hours  ← Trigger.dev checkpoints here; zero compute consumed
 *     → re-fetches the task status from ClickUp
 *       · "done"     → accepts and celebrates ✅
 *       · "research" → sends back for a new deep dive (removes deep-dive-started tag) 🔄
 *       · still "review" → posts a nudge comment, waits another 24 hours
 *           · "done"     → accepts ✅
 *           · "research" → sends back 🔄
 *           · anything else → auto-closes after 72 hours total 🏁
 *
 * KEY CONCEPT — wait.for():
 *   When a task hits wait.for(), Trigger.dev serialises its state to durable
 *   storage and suspends execution. The worker is freed immediately. After the
 *   delay, Trigger.dev resumes from exactly the same point. Waits longer than
 *   5 seconds do not count toward compute billing.
 */

import { task, schedules, wait, logger } from "@trigger.dev/sdk";
import {
  getTasksByStatus,
  getTask,
  addComment,
  addTag,
  removeTag,
  updateTaskStatus,
  hasTag,
  type ClickUpTask,
} from "../../lib/clickup";

const INITIAL_WAIT_HOURS = 48;
const NUDGE_WAIT_HOURS = 24;

// ---------------------------------------------------------------------------
// Main review task
// ---------------------------------------------------------------------------

export const peerReview = task({
  id: "peer-review",
  // No retry — each run is a deliberate long-running workflow.
  // A failure mid-wait will surface in the Trigger.dev dashboard.
  retry: { maxAttempts: 1 },
  run: async (payload: { taskId: string; title: string }) => {
    logger.log("Peer review started", {
      taskId: payload.taskId,
      title: payload.title,
    });

    // --- Opening comment ---
    await addComment(
      payload.taskId,
      `## 👁️ Peer Review Period Started

Your deep dive on **"${payload.title}"** is ready for review.

You have **${INITIAL_WAIT_HOURS} hours** to read through the research and make a decision:

| Action | How |
|--------|-----|
| ✅ Accept the research | Move to **Done** |
| 🔄 Request deeper research | Move back to **Research** |
| ⏳ Need more time | Leave in **Review** (you'll get a nudge) |

*Review clock started: ${new Date().toUTCString()}*`,
    );

    // -----------------------------------------------------------------------
    // FIRST WAIT — 48 hours
    // Trigger.dev checkpoints here. Zero compute consumed during the wait.
    // -----------------------------------------------------------------------
    logger.log(`Waiting ${INITIAL_WAIT_HOURS} hours for review decision…`);
    await wait.for({ hours: INITIAL_WAIT_HOURS });

    // --- Check status after first wait ---
    const outcome = await handleReviewOutcome(
      payload.taskId,
      payload.title,
      "first",
    );
    if (outcome !== "still-reviewing") {
      return { taskId: payload.taskId, outcome };
    }

    // --- Still in Review: post nudge and wait again ---
    await addComment(
      payload.taskId,
      `## ⏰ Review Reminder

The research on **"${payload.title}"** has been awaiting your review for ${INITIAL_WAIT_HOURS} hours.

Waiting another **${NUDGE_WAIT_HOURS} hours** before auto-closing.

Move to **Done** to accept, or **Research** to request a new deep dive.`,
    );

    // -----------------------------------------------------------------------
    // SECOND WAIT — 24 hours
    // -----------------------------------------------------------------------
    logger.log(`Waiting ${NUDGE_WAIT_HOURS} more hours…`);
    await wait.for({ hours: NUDGE_WAIT_HOURS });

    // --- Final check ---
    const finalOutcome = await handleReviewOutcome(
      payload.taskId,
      payload.title,
      "final",
    );

    if (finalOutcome === "still-reviewing") {
      // Auto-close after 72 hours total with no action
      await updateTaskStatus(payload.taskId, "Done");
      await addComment(
        payload.taskId,
        `## 🏁 Auto-Closed

No action taken after ${INITIAL_WAIT_HOURS + NUDGE_WAIT_HOURS} hours. Task automatically marked **Done**.

*You can re-open and move to Research at any time to trigger a fresh deep dive.*`,
      );
      await removeTag(payload.taskId, "peer-review-started").catch(() => {});
      logger.log("Task auto-closed after 72 hours — tag removed", {
        taskId: payload.taskId,
      });
      return { taskId: payload.taskId, outcome: "auto-closed" };
    }

    return { taskId: payload.taskId, outcome: finalOutcome };
  },
});

// ---------------------------------------------------------------------------
// Helper — inspect the current ClickUp status and act accordingly
// ---------------------------------------------------------------------------

async function handleReviewOutcome(
  taskId: string,
  title: string,
  stage: "first" | "final",
): Promise<"accepted" | "re-researched" | "still-reviewing"> {
  const currentTask = await getTask(taskId);
  const status = currentTask.status.status.toLowerCase();

  logger.log(`Review ${stage} check`, { taskId, status });

  if (status === "done") {
    await addComment(
      taskId,
      `## ✅ Research Accepted

Great — **"${title}"** is marked complete. The deep dive has been signed off!

*Check the weekly digest on Sunday for a reflection on this topic.*`,
    );
    await removeTag(taskId, "peer-review-started").catch(() => {});
    return "accepted";
  }

  if (status === "research") {
    // Remove both tags: peer-review-started (review is over) and
    // deep-dive-started (so the poller will pick it up for a new deep dive)
    await removeTag(taskId, "peer-review-started").catch(() => {});
    await removeTag(taskId, "deep-dive-started").catch(() => {});
    await addComment(
      taskId,
      `## 🔄 Sent Back for Research

**"${title}"** has been returned to the Research queue. A new deep dive will begin automatically within 2 minutes.

Feel free to add notes in the task description to guide the next research run.`,
    );
    logger.log("Task returned to Research — both tags removed", { taskId });
    return "re-researched";
  }

  // Status is still "review" (or something unexpected)
  return "still-reviewing";
}

// ---------------------------------------------------------------------------
// Poller — watches ClickUp every 2 minutes for new "Review" tasks
// ---------------------------------------------------------------------------

export const peerReviewPoller = schedules.task({
  id: "peer-review-poller",
  // Every 2 minutes. Attach this schedule in the Trigger.dev dashboard.
  cron: "*/2 * * * *",
  run: async () => {
    const listId = process.env.CLICKUP_LIST_ID;
    if (!listId) throw new Error("CLICKUP_LIST_ID is not set");

    logger.log("Polling ClickUp for Review tasks…");

    const tasks: ClickUpTask[] = await getTasksByStatus(listId, "Review");

    // Skip tasks already being tracked
    const unprocessed = tasks.filter((t) => !hasTag(t, "peer-review-started"));

    logger.log(`Found ${unprocessed.length} unprocessed Review task(s)`);

    for (const t of unprocessed) {
      // Tag immediately to prevent duplicate runs
      await addTag(t.id, "peer-review-started");

      await peerReview.trigger(
        { taskId: t.id, title: t.name },
        {
          // Idempotency key: even if the poller fires twice in rapid succession,
          // only one peerReview run will be created
          idempotencyKey: `peer-review-${t.id}`,
        },
      );

      logger.log("Triggered peer review", { id: t.id, name: t.name });
    }
  },
});
