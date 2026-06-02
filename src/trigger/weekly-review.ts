/**
 * PROJECT 2 — Weekly Review Digest
 *
 * Teaches: cron scheduling · ClickUp querying · content generation · task creation
 *
 * Flow:
 *   weeklyReview (runs every Sunday at 8 PM UTC)
 *     → queries ClickUp for tasks completed in the last 7 days
 *     → queries tasks still in "Research" and "Review"
 *     → generates a reflective digest via the AI client
 *     → creates a new "Done" task in ClickUp containing the full digest
 *
 * Setup:
 *   After deploying, attach the schedule in the Trigger.dev dashboard
 *   (Trigger.dev → Schedules → Attach to "weekly-review").
 *   You can also trigger it manually from the dashboard at any time to test.
 */

import { schedules, logger } from "@trigger.dev/sdk";
import {
  getCompletedTasksSince,
  getTasksByStatus,
  createTask,
} from "../lib/clickup";
import { chat } from "../lib/ai";

export const weeklyReview = schedules.task({
  id: "weekly-review",
  cron: {
    // Every Sunday at 20:00 UTC
    pattern: "0 20 * * 0",
    timezone: "UTC",
  },
  run: async (payload) => {
    const listId = process.env.CLICKUP_LIST_ID;
    if (!listId) throw new Error("CLICKUP_LIST_ID is not set");

    logger.log("Weekly review starting", {
      scheduledAt: payload.timestamp.toISOString(),
    });

    // Derive the start of the review window (7 days ago)
    const weekStart = new Date(payload.timestamp);
    weekStart.setDate(weekStart.getDate() - 7);

    // --- Fetch data from ClickUp ---
    const [completedTasks, researchTasks, reviewTasks] = await Promise.all([
      getCompletedTasksSince(listId, weekStart),
      getTasksByStatus(listId, "Research"),
      getTasksByStatus(listId, "Review"),
    ]);

    logger.log("ClickUp data fetched", {
      completed: completedTasks.length,
      research: researchTasks.length,
      review: reviewTasks.length,
    });

    // Skip the digest if there was no activity at all
    if (
      completedTasks.length === 0 &&
      researchTasks.length === 0 &&
      reviewTasks.length === 0
    ) {
      logger.log("No activity this week — skipping digest");
      return { skipped: true, reason: "no activity" };
    }

    // --- Format task lists for the prompt ---
    const formatList = (names: string[]): string =>
      names.length > 0 ? names.map((n) => `- ${n}`).join("\n") : "_Nothing_";

    const weekLabel = weekStart.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    // --- Generate the digest ---
    const digest = await chat([
      {
        role: "system",
        content:
          "You are a personal research journal curator for 'The Analyst' — a project " +
          "dedicated to exploring depth psychology through the lenses of Freud, Jung, and Adler. " +
          "Write warm, intellectually stimulating weekly digests that celebrate curiosity, " +
          "notice emerging themes, and encourage continued exploration. Use markdown.",
      },
      {
        role: "user",
        content: `Create the weekly digest for the week starting ${weekLabel}.

**Completed this week (${completedTasks.length})**
${formatList(completedTasks.map((t) => t.name))}

**Still being researched (${researchTasks.length})**
${formatList(researchTasks.map((t) => t.name))}

**Awaiting review (${reviewTasks.length})**
${formatList(reviewTasks.map((t) => t.name))}

---
Format your response as:

# 📖 Weekly Digest — Week of ${weekLabel}

## This Week's Explorations
(Reflect on the completed topics. What themes emerged? Any surprising connections between Freud, Jung, or Adler's ideas?)

## Still Brewing
(Comment on the in-progress and under-review topics — why might these be more complex or nuanced?)

## A Thought to Carry Forward
(A single compelling quote or idea from the depth psychology canon that relates to this week's themes)

## Looking Ahead
(2–3 suggested questions or topics worth adding to the Research Queue next week)`,
      },
    ]);

    // --- Create digest task in ClickUp ---
    const taskName = `📖 Weekly Digest — Week of ${weekLabel}`;
    const created = await createTask(listId, {
      name: taskName,
      description: digest,
      status: "Done",
      tags: ["weekly-digest"],
    });

    logger.log("Weekly digest created in ClickUp", {
      taskId: created.id,
      name: taskName,
      completedCount: completedTasks.length,
    });

    return {
      skipped: false,
      taskId: created.id,
      completedCount: completedTasks.length,
      digest,
    };
  },
});
