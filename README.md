# 🧠 The Analyst

> A Trigger.dev + ClickUp automation project for deep research into depth psychology —
> Freud, Jung, Adler, and beyond.

This project is a learning sandbox for [Trigger.dev v4](https://trigger.dev/docs) built around a
real use-case: using ClickUp as a research queue and automating the research, review, and digest
cycle for psychology topics.

---

## Projects

| # | Name | File | Concepts Taught |
|---|------|------|-----------------|
| 1 | **Deep Dive** | `src/trigger/deep-dive.ts` | Polling · Parent/child tasks · `triggerAndWait` · Result handling |
| 2 | **Weekly Review** | `src/trigger/weekly-review.ts` | Cron scheduling · ClickUp querying · Content generation |
| 3 | **Peer Review** | `src/trigger/peer-review.ts` | `wait.for` · Long-running tasks · Checkpointing · Conditional branching |

---

## Architecture

```
ClickUp List ("Research Queue")
│
├── Status: "Research"
│     └── deepDivePoller (every 2 min)
│           └── deepDive (parent)
│                 ├── webResearcher (child) ──→ live web research
│                 ├── bookContextFinder (child) ──→ Freud/Jung/Adler context
│                 └── synthesizer (child) ──→ structured summary → posted as ClickUp comment
│
├── Status: "Review"
│     └── peerReviewPoller (every 2 min)
│           └── peerReview (long-running)
│                 ├── wait.for({ hours: 48 })  ← checkpointed
│                 ├── check status → accept / re-research / nudge
│                 └── wait.for({ hours: 24 })  ← checkpointed
│                       └── check status → accept / re-research / auto-close
│
└── Status: "Done"
      └── weeklyReview (every Sunday 8 PM UTC)
            └── digest of the week → new "Done" task created in ClickUp
```

**Key design decision — polling vs webhooks:**
Trigger.dev tasks don't expose their own HTTP endpoints. Rather than adding a separate server
just to receive ClickUp webhooks, the pollers use `schedules.task` (cron every 2 minutes) and
tag-based deduplication to avoid re-processing tasks. This keeps the project fully self-contained.

---

## ClickUp Setup

1. Create a **Space** called `The Analyst`
2. Inside it, create a **List** called `Research Queue`
3. Add these **statuses** to the list (Space → `...` → Edit Space → Statuses):

   | Status | Meaning |
   |--------|---------|
   | `Open` | Default / not yet started |
   | `Research` | Move here to trigger a Deep Dive |
   | `Review` | Move here to trigger a Peer Review |
   | `Done` | Completed / accepted |

4. Copy the **List ID** from the URL (`/v/li/{LIST_ID}`) into `CLICKUP_LIST_ID`

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in all values
```

See `.env.example` for detailed instructions on each variable.

### 3. Run locally (dev mode)

```bash
npx trigger.dev@latest dev
```

This starts a local dev worker that connects to the Trigger.dev cloud and executes tasks on your
machine. You'll see a public URL in the console.

### 4. Attach schedules

After the dev server is running, go to the [Trigger.dev dashboard](https://cloud.trigger.dev):

- **Schedules** → Attach `deep-dive-poller` and `peer-review-poller` (both `*/2 * * * *`)
- **Schedules** → Attach `weekly-review` (`0 20 * * 0`)

Or trigger any task manually from the dashboard to test immediately.

### 5. Test the full flow

1. Create a task in ClickUp with a psychology question as the title, e.g.:
   > *What did Jung mean by the Shadow archetype?*
2. Move it to **Research** status
3. Within 2 minutes the `deepDivePoller` picks it up and a Deep Dive starts
4. Watch the run in the Trigger.dev dashboard
5. Check the ClickUp task — a research summary comment will appear
6. Move the task to **Review** to start a Peer Review
7. (Or wait until Sunday for the Weekly Digest)

---

## Deploy to Production

```bash
npx trigger.dev@latest deploy
```

Then add all environment variables in:
**Trigger.dev dashboard → Project → Environment Variables**

---

## Project Structure

```
src/
  trigger/
    deep-dive.ts       # Project 1 — parent/child research workflow
    weekly-review.ts   # Project 2 — Sunday digest
    peer-review.ts     # Project 3 — 48-hour async review
  lib/
    clickup.ts         # ClickUp REST API client
    ai.ts              # Unified LLM client (OpenRouter / OpenAI-compatible)
.env.example           # Environment variable template
AGENTS.md              # Guide for AI agents working in this repo
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@trigger.dev/sdk` | Task runtime, scheduling, waits |
| `openai` | OpenAI-compatible SDK (used against OpenRouter) |
