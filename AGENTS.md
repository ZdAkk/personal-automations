# AGENTS.md — Guide for AI Agents

This document describes how AI agents (Claude, Copilot, Cursor, etc.) should reason about,
navigate, and modify this repository.

---

## What This Repo Does

**The Analyst** is a [Trigger.dev v4](https://trigger.dev/docs) project that automates psychology
research using ClickUp as a task queue and OpenRouter as a unified LLM gateway.

Three autonomous workflows run entirely within Trigger.dev — no separate HTTP server, no
framework, no database. All state lives in ClickUp task tags and statuses.

---

## Repository Map

```
src/trigger/          The three Trigger.dev task files — entry points for all automation
src/lib/clickup.ts    ClickUp REST API client — all ClickUp I/O goes through here
src/lib/ai.ts         Unified LLM client — all AI calls go through here
.env.example          Canonical list of required environment variables
trigger.config.ts     Trigger.dev project config (project ID, runtime, dirs)
```

---

## SDK Rules (CRITICAL — read before writing any task code)

This project uses **Trigger.dev SDK v4**. The following rules are non-negotiable.

### ✅ Always use
```ts
import { task, schedules, wait, logger } from "@trigger.dev/sdk";
```

### ❌ Never use
```ts
// v2 API — breaks the application
client.defineJob({ id: "...", run: async (payload, io) => {} });
```

### triggerAndWait — never in Promise.all
```ts
// ❌ WRONG — not supported
const [a, b] = await Promise.all([
  childA.triggerAndWait(payload),
  childB.triggerAndWait(payload),
]);

// ✅ CORRECT — sequential
const aResult = await childA.triggerAndWait(payload);
const bResult = await childB.triggerAndWait(payload);
```

To run the **same task** in parallel, use `batchTriggerAndWait`:
```ts
const results = await myTask.batchTriggerAndWait([
  { payload: { id: "a" } },
  { payload: { id: "b" } },
]);
```

### Result objects
`triggerAndWait` returns a `Result`, not the task's return value directly:
```ts
const result = await child.triggerAndWait(payload);
if (result.ok) {
  console.log(result.output); // ← actual return value here
} else {
  throw new Error(result.error);
}
```

### wait.for — never in Promise.all
```ts
// ❌ WRONG
await Promise.all([wait.for({ hours: 1 }), doSomething()]);

// ✅ CORRECT — sequential only
await wait.for({ hours: 1 });
await doSomething();
```

### Scheduled tasks
```ts
import { schedules } from "@trigger.dev/sdk";

export const myPoller = schedules.task({
  id: "my-poller",
  cron: "*/2 * * * *",
  run: async (payload) => { /* payload.timestamp is a Date */ },
});
```

---

## Deduplication Pattern

All three pollers use **tag-based deduplication** to prevent re-processing:

1. Poller fetches tasks with a given status
2. Filters out tasks that already have the processing tag (`deep-dive-started`, `peer-review-started`)
3. Tags the task **before** triggering the downstream task
4. Passes an `idempotencyKey` to `trigger()` as a second safety net

When modifying poller logic, always preserve this order (tag first, trigger second).

---

## Adding a New Task

1. Create `src/trigger/my-task.ts`
2. Export your task(s) — Trigger.dev auto-discovers all exports in `src/trigger/`
3. If it needs ClickUp access, add a helper to `src/lib/clickup.ts`
4. If it needs LLM access, use `chat()` or `researchWithBrowsing()` from `src/lib/ai.ts`
5. If it needs a new env var, add it to `.env.example` with a comment
6. Document it in `README.md` (Projects table + Architecture diagram)

---

## Environment Variables

All required variables are documented in `.env.example`. Never hardcode secrets.
In production, set variables in the Trigger.dev dashboard (Project → Environment Variables).

Key variables agents should be aware of:

| Variable | Used In | Notes |
|----------|---------|-------|
| `CLICKUP_API_TOKEN` | `src/lib/clickup.ts` | Personal API token |
| `CLICKUP_LIST_ID` | All trigger files | Numeric list ID from ClickUp URL |
| `OPENROUTER_API_KEY` | `src/lib/ai.ts` | Works with OpenRouter or direct OpenAI |
| `OPENROUTER_DEFAULT_MODEL` | `src/lib/ai.ts` | Swap model without code changes |
| `OPENROUTER_RESEARCH_MODEL` | `src/lib/ai.ts` | Should support live web browsing |

---

## AI Client — Swapping Models

`src/lib/ai.ts` wraps the OpenAI SDK pointed at OpenRouter. To change the model for any call:

```ts
// Use the default model (OPENROUTER_DEFAULT_MODEL env var)
await chat(messages);

// Override for a single call
await chat(messages, "anthropic/claude-3.5-sonnet");

// Use the research/browsing model (OPENROUTER_RESEARCH_MODEL env var)
await researchWithBrowsing(query);
```

No code changes are needed to swap providers — only env var changes.

---

## ClickUp Client

`src/lib/clickup.ts` exports typed helpers for all ClickUp operations used in this project:

| Function | Description |
|----------|-------------|
| `getTasksByStatus(listId, status)` | Fetch tasks with a given status |
| `getTask(taskId)` | Fetch a single task by ID |
| `getCompletedTasksSince(listId, since)` | Fetch Done tasks after a date |
| `addComment(taskId, text)` | Post a markdown comment |
| `addTag(taskId, tagName)` | Add a tag to a task |
| `removeTag(taskId, tagName)` | Remove a tag |
| `updateTaskStatus(taskId, status)` | Change task status |
| `createTask(listId, task)` | Create a new task |
| `hasTag(task, tagName)` | Utility — check if a task has a tag |

When adding new ClickUp operations, add them here rather than inline in task files.

---

## Testing

There is no automated test suite yet. To test manually:

1. Run `npx trigger.dev@latest dev` to start a local worker
2. Use the Trigger.dev dashboard to trigger any task manually with a test payload
3. Inspect run logs in the dashboard — all steps log with `logger.log()`
4. Check ClickUp for side effects (comments, tags, status changes)

When writing new tasks, structure the `run` function so each logical step is preceded by a
`logger.log()` call — this makes dashboard debugging much easier.
