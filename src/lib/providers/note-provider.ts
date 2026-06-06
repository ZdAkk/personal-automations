/**
 * NoteProvider — generic abstraction over any note/task app
 *
 * Automations call getNoteProvider("analyst") or getNoteProvider("dreams")
 * and receive a fully configured provider instance. They never touch env vars,
 * provider names, or source IDs — that knowledge lives here.
 *
 * To add a new provider: implement NoteProvider in a new file and add a case
 * in getNoteProvider(). To add a new collection: add an entry to COLLECTIONS.
 *
 * Active provider selected via NOTE_PROVIDER env var (clickup | notion, default: clickup).
 */

// Re-export the base types and abstract class so callers only need one import.
export type { NoteItem, NoteItemCreate } from "./note-provider-base";
export { NoteProvider } from "./note-provider-base";

// ---------------------------------------------------------------------------
// Provider implementations (no circular dependency — they import from base)
// ---------------------------------------------------------------------------

import { ClickUpProvider } from "./clickup-provider";
import { NotionProvider } from "./notion-provider";
import type { NoteProvider as NoteProviderType } from "./note-provider-base";

// ---------------------------------------------------------------------------
// Collection registry
// ---------------------------------------------------------------------------

/** Logical collections known to this application. */
export enum NoteCollection {
  Analyst = "analyst",
  Dreams  = "dreams",
}

/**
 * Maps each logical collection to the env var that holds its source ID
 * for each supported provider.
 */
const COLLECTIONS: Record<NoteCollection, { clickup: string; notion: string }> = {
  analyst: {
    clickup: "CLICKUP_LIST_ID",
    notion: "NOTION_ANALYST_DATABASE_ID",
  },
  dreams: {
    clickup: "CLICKUP_DREAM_LIST_ID",
    notion: "NOTION_DREAM_DATABASE_ID",
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns a fully configured NoteProvider for the given logical collection.
 * All provider selection and source ID resolution is handled internally —
 * callers remain completely agnostic to which provider is active.
 *
 * @example
 *   const provider = getNoteProvider("dreams");
 *   const entries  = await provider.listByStatus("Raw");
 */
export function getNoteProvider(collection: NoteCollection): NoteProviderType {
  const providerName = (process.env.NOTE_PROVIDER ?? "clickup").toLowerCase();
  const map = COLLECTIONS[collection];
  const varName = providerName === "notion" ? map.notion : map.clickup;
  const sourceId = process.env[varName];
  if (!sourceId) throw new Error(`${varName} is not set`);

  switch (providerName) {
    case "clickup": return new ClickUpProvider(sourceId);
    case "notion":  return new NotionProvider(sourceId);
    default: throw new Error(`Unknown NOTE_PROVIDER "${providerName}". Valid values: clickup, notion`);
  }
}
