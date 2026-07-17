import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  // Deploy-target project ref. Set TRIGGER_PROJECT_REF in .env so you never pass
  // --project-ref on the CLI; falls back to the original ref if unset.
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_ujxgovkfqaotkvsftrvs",
  runtime: "node",
  logLevel: "log",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  // You can override this on an individual task.
  // See https://trigger.dev/docs/runs/max-duration
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./src/trigger"],
});
