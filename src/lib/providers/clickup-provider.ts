/**
 * ClickUp implementation of NoteProvider.
 *
 * Required env vars:
 *   CLICKUP_API_TOKEN  — personal API token
 *
 * The sourceId passed to the constructor is the ClickUp list ID.
 *
 * Custom fields are pre-populated in NoteItem.fields when listing items.
 * Field names are stored lowercase-normalised.
 *
 * Tags map directly to ClickUp task tags.
 * Status names are passed through as-is (ClickUp is case-sensitive in some
 * places; normalise to lowercase in NoteItem.status for consumer convenience).
 */

import { NoteProvider, NoteItem, NoteItemCreate } from "./note-provider-base";

const BASE_URL = "https://api.clickup.com/api/v2";

function headers(): Record<string, string> {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) throw new Error("CLICKUP_API_TOKEN is not set");
  return {
    Authorization: token,
    "Content-Type": "application/json",
  };
}

async function throwIfNotOk(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`ClickUp ${context} failed [${res.status}]: ${body}`);
  }
}

// ClickUp-specific raw types
interface RawTag { name: string }
interface RawStatus { status: string }
interface RawCustomField { id: string; name: string; type: string; value?: string | null }
interface RawTask {
  id: string;
  name: string;
  description?: string;
  status: RawStatus;
  tags: RawTag[];
  custom_fields?: RawCustomField[];
  date_created?: string;
  date_done?: string | null;
}

function toNoteItem(t: RawTask): NoteItem {
  const fields: Record<string, string | null> = {};
  for (const cf of t.custom_fields ?? []) {
    fields[cf.name.toLowerCase()] = cf.value?.trim() || null;
  }
  return {
    id: t.id,
    title: t.name,
    content: t.description?.trim() ?? "",
    createdAt: new Date(parseInt(t.date_created ?? "0")).toISOString().split("T")[0],
    status: t.status.status.toLowerCase(),
    tags: t.tags.map((tag) => tag.name),
    fields,
  };
}

export class ClickUpProvider extends NoteProvider {
  get displayName() { return "ClickUp"; }

  // ── Collection reads ─────────────────────────────────────────────────────

  async listByStatus(status: string): Promise<NoteItem[]> {
    const url = `${BASE_URL}/list/${this.sourceId}/task?statuses[]=${encodeURIComponent(status)}&include_closed=false`;
    const res = await fetch(url, { headers: headers() });
    await throwIfNotOk(res, `listByStatus(${status})`);
    const data = (await res.json()) as { tasks?: RawTask[] };
    return (data.tasks ?? []).map(toNoteItem);
  }

  async listCompletedSince(since: Date): Promise<NoteItem[]> {
    const ts = since.getTime();
    const url =
      `${BASE_URL}/list/${this.sourceId}/task` +
      `?statuses[]=Done&date_done_gt=${ts}&include_closed=true`;
    const res = await fetch(url, { headers: headers() });
    await throwIfNotOk(res, "listCompletedSince");
    const data = (await res.json()) as { tasks?: RawTask[] };
    return (data.tasks ?? []).map(toNoteItem);
  }

  // ── Item reads ───────────────────────────────────────────────────────────

  async getItem(id: string): Promise<NoteItem> {
    const res = await fetch(`${BASE_URL}/task/${id}`, { headers: headers() });
    await throwIfNotOk(res, `getItem(${id})`);
    const t = (await res.json()) as RawTask;
    return toNoteItem(t);
  }

  async getCustomField(id: string, fieldName: string): Promise<string | null> {
    const item = await this.getItem(id);
    return item.fields[fieldName.toLowerCase()] ?? null;
  }

  // ── Item writes ──────────────────────────────────────────────────────────

  async updateStatus(id: string, status: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/task/${id}`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ status }),
    });
    await throwIfNotOk(res, `updateStatus(${id}, ${status})`);
  }

  async addComment(id: string, text: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/task/${id}/comment`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ comment_text: text }),
    });
    await throwIfNotOk(res, `addComment(${id})`);
  }

  async addTag(id: string, tag: string): Promise<void> {
    const res = await fetch(
      `${BASE_URL}/task/${id}/tag/${encodeURIComponent(tag)}`,
      { method: "POST", headers: headers() }
    );
    await throwIfNotOk(res, `addTag(${id}, ${tag})`);
  }

  async removeTag(id: string, tag: string): Promise<void> {
    const res = await fetch(
      `${BASE_URL}/task/${id}/tag/${encodeURIComponent(tag)}`,
      { method: "DELETE", headers: headers() }
    );
    await throwIfNotOk(res, `removeTag(${id}, ${tag})`);
  }

  // ── Collection writes ─────────────────────────────────────────────────────

  async createItem(item: NoteItemCreate): Promise<NoteItem> {
    const res = await fetch(`${BASE_URL}/list/${this.sourceId}/task`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        name: item.title,
        description: item.content ?? "",
        status: item.status,
        tags: item.tags?.map((name) => ({ name })),
      }),
    });
    await throwIfNotOk(res, "createItem");
    const t = (await res.json()) as RawTask;
    return toNoteItem(t);
  }
}
