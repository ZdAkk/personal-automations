// ============================================================================
// WATCH GROUPS — the registry. THIS is the only file you edit to add a new
// category of listings to watch. The trigger iterates this array; adding a
// group requires no code changes anywhere else.
//
// Each group bundles:
//   - identity / context : id, title, description (sent with every notification)
//   - source             : searchType (the Strategy) + category
//   - notification meta   : emoji, priority, optional per-group ntfy topic
//   - commonExclude       : noise shared by every target in the group
//   - targets             : the individual searches (keyword + price + filters)
//
// Matching note: requireAll/excludeAny run against an [a-z0-9]-reduced haystack,
// so "24 GB"/"24gb" both match "24gb", "3090 Ti"/"3090Ti" match "3090ti", and
// the API's mangled umlaut bytes drop out — use ASCII-prefix tokens like
// "wasserk" for "Wasserkühler".
// ============================================================================

import { defineSearchGroup, type SearchGroupSpec } from "../lib/watch/types";

// ── Kleinanzeigen categories ────────────────────────────────────────────────
const GRAFIKKARTEN = { slug: "s-grafikkarten", id: 225 };

// ── Shared GPU noise: coolers, packaging, cables, trade offers, laptop cards ─
// ASCII-only (the API mangles umlaut bytes); "wasserk" catches "Wasserkühler".
const GPU_COMMON_EXCLUDE = [
  // laptop GPUs (mobile variant carries the same chip name)
  "laptop",
  "notebook",
  "thinkpad",
  "precision",
  "zbook",
  // trade / broken (offers-only already removes "Suche" wanted ads)
  "tausch",
  "defekt",
  // cooling accessories sold on their own
  "waterblock",
  "wasserblock",
  "wasserk",
  "eiswolf",
  "eisblock",
  "alphacool",
  "glacier",
  "backplate",
  // packaging / collectibles / cables — never the card itself
  "leerkarton",
  "sammler",
  "sticker",
  "aufkleber",
  "cablemod",
];

export const WATCH_GROUPS: SearchGroupSpec[] = [
  defineSearchGroup({
    id: "gpu-deals",
    title: "GPU Deal",
    description: "High-VRAM GPU under budget",
    searchType: "kleinanzeigen-category",
    category: GRAFIKKARTEN,
    notify: { emoji: "computer", priority: 4 },
    commonExclude: GPU_COMMON_EXCLUDE,
    targets: [
      {
        id: "rtx-3090",
        label: "RTX 3090 24 GB",
        keyword: "rtx 3090",
        min_price: 200, // below this is accessories (coolers top out ~185)
        max_price: 750,
        requireAll: ["3090"],
        excludeAny: ["3090ti", "3080"],
      },
      {
        id: "rtx-3090-ti",
        label: "RTX 3090 Ti 24 GB",
        keyword: "rtx 3090 ti",
        min_price: 250,
        max_price: 750,
        requireAll: ["3090ti"],
        excludeAny: ["karton"],
      },
      {
        id: "rtx-a5000",
        label: "RTX A5000 24 GB",
        keyword: "rtx a5000",
        min_price: 400,
        max_price: 1300,
        requireAll: ["a5000", "24gb"], // desktop card is 24GB; laptop A5000 is 16GB
      },
      {
        id: "rtx-a5500",
        label: "RTX A5500 24 GB",
        keyword: "rtx a5500",
        min_price: 500,
        max_price: 1800,
        requireAll: ["a5500"],
      },
      {
        id: "rtx-a6000",
        label: "RTX A6000 48 GB",
        keyword: "rtx a6000",
        min_price: 600,
        max_price: 2100,
        requireAll: ["a6000", "48gb"],
        excludeAny: ["ada"],
      },
      {
        id: "nvidia-a40",
        label: "NVIDIA A40 48 GB",
        keyword: "nvidia a40",
        min_price: 500,
        max_price: 1800,
        // "A40" is generic even inside the category — require model + 48gb.
        requireAll: ["a40", "48gb"],
        excludeAny: ["galaxy", "samsung", "celica", "klima"],
      },
    ],
  }),

  // ── Add new categories below — e.g.: ──────────────────────────────────────
  // defineSearchGroup({
  //   id: "mechanical-keyboards",
  //   title: "Keyboard Deal",
  //   description: "Enthusiast mechanical keyboards",
  //   searchType: "kleinanzeigen-category",
  //   category: { slug: "s-pc-zubehoer-software", id: 225 },  // pick the real category
  //   notify: { emoji: "keyboard", priority: 3, topicEnv: "KLEINANZEIGEN_NTFY_TOPIC_KEEBS" },
  //   commonExclude: ["defekt", "tausch"],
  //   targets: [ { id: "tofu65", label: "Tofu65", keyword: "tofu65", max_price: 150 } ],
  // }),
];
