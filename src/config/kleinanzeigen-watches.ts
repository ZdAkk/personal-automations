// ============================================================================
// Kleinanzeigen watches — the list the trigger loops over.
//
// One KleinanzeigenWatch instance = one category of things to watch (e.g. GPUs).
// It bundles the Kleinanzeigen category, notification context, the excludes
// common to the whole group, and the individual searches (targets).
//
// To watch something new, add another `new KleinanzeigenWatch({...})` to
// KLEINANZEIGEN_WATCHES below. Nothing in the trigger needs to change.
//
// Matching note: requireAll/excludeAny run against an [a-z0-9]-reduced haystack,
// so "24 GB"/"24gb" both match "24gb", "3090 Ti"/"3090Ti" match "3090ti", and
// the API's mangled umlaut bytes drop out — use ASCII-prefix tokens like
// "wasserk" for "Wasserkühler".
// ============================================================================

export interface KleinanzeigenTarget {
  id: string;
  label: string;
  /** Search term, slugified into the category URL (e.g. "rtx 3090"). */
  keyword: string;
  min_price?: number;
  max_price: number;
  /** Every token must appear in title+description. */
  requireAll?: string[];
  /** Target-specific excludes; the watch's commonExclude is merged in by the constructor. */
  excludeAny?: string[];
}

export interface NotifyMeta {
  /** ntfy tag rendered as an emoji in the push (e.g. "computer" → 💻). */
  emoji?: string;
  /** ntfy priority 1–5 (default 4 = high). */
  priority?: number;
  /** Env var holding this watch's ntfy topic. Falls back to KLEINANZEIGEN_NTFY_TOPIC. */
  topicEnv?: string;
}

export interface KleinanzeigenWatchConfig {
  /** Stable slug, e.g. "gpu-deals". */
  id: string;
  /** Human title shown in notifications, e.g. "GPU Deal". */
  title: string;
  /** One-line context sent with every alert, e.g. "High-VRAM GPU under budget". */
  description: string;
  /** Kleinanzeigen category to search within. */
  category: { slug: string; id: number };
  /** Offers only (excludes "Gesuche"). Default true. */
  offersOnly?: boolean;
  /** Pages to fetch per target. Default 1. */
  maxPages?: number;
  notify?: NotifyMeta;
  /** Excludes shared by every target in this watch. */
  commonExclude?: string[];
  targets: KleinanzeigenTarget[];
}

/**
 * One category of Kleinanzeigen listings to watch. The constructor applies
 * defaults and folds `commonExclude` into each target's `excludeAny`, so by the
 * time the trigger reads a target it only needs to look at `target.excludeAny`.
 *
 * Plain-data only (no methods used after construction) so an instance survives
 * the Trigger.dev parent→child task boundary as JSON.
 */
export class KleinanzeigenWatch {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: { slug: string; id: number };
  readonly offersOnly: boolean;
  readonly maxPages: number;
  readonly notify: NotifyMeta;
  readonly targets: KleinanzeigenTarget[];

  constructor(cfg: KleinanzeigenWatchConfig) {
    this.id = cfg.id;
    this.title = cfg.title;
    this.description = cfg.description;
    this.category = cfg.category;
    this.offersOnly = cfg.offersOnly ?? true;
    this.maxPages = cfg.maxPages ?? 1;
    this.notify = cfg.notify ?? {};

    const common = cfg.commonExclude ?? [];
    this.targets = cfg.targets.map((t) => ({
      ...t,
      excludeAny: [...common, ...(t.excludeAny ?? [])],
    }));
  }
}

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

export const KLEINANZEIGEN_WATCHES: KleinanzeigenWatch[] = [
  new KleinanzeigenWatch({
    id: "gpu-deals",
    title: "GPU Deal",
    description: "High-VRAM GPU under budget",
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

  // ── Add another category below, e.g.: ─────────────────────────────────────
  // new KleinanzeigenWatch({
  //   id: "mechanical-keyboards",
  //   title: "Keyboard Deal",
  //   description: "Enthusiast mechanical keyboards",
  //   category: { slug: "s-pc-zubehoer-software", id: 161 },
  //   notify: { emoji: "keyboard", priority: 3, topicEnv: "KLEINANZEIGEN_NTFY_TOPIC_KEEBS" },
  //   commonExclude: ["defekt", "tausch"],
  //   targets: [{ id: "tofu65", label: "Tofu65", keyword: "tofu65", max_price: 150 }],
  // }),
];
