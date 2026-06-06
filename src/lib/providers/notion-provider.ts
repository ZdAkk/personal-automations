/**
 * Notion implementation of NoteProvider.
 *
 * Required env vars:
 *   NOTION_API_TOKEN  — integration secret (starts with "secret_")
 *
 * The sourceId passed to the constructor is the Notion database ID.
 *
 * Expected database schema:
 *   Name          — title property
 *   Status        — status property  (Raw | Processing | Done | Error | Research | Review | ...)
 *   Tags          — multi_select property  (maps to NoteItem.tags)
 *   Created time  — created_time auto-property
 *   (any other text/select properties are surfaced in NoteItem.fields)
 *
 * Item content lives in the page body (paragraph blocks), not a property —
 * giving a proper writing surface in Notion.
 *
 * Comments / interpretations are appended as blocks (divider + heading_2 +
 * paragraphs) rather than using the Comments API, which requires an extra
 * capability flag on the integration.
 *
 * listCompletedSince filters by last_edited_time (Notion has no "date_done"
 * concept natively). Add a "Completed At" date property and adjust the filter
 * if you need exact completion timestamps.
 */

import { NoteProvider, NoteItem, NoteItemCreate } from "./note-provider-base";

const BASE_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function headers(): Record<string, string> {
  const token = process.env.NOTION_API_TOKEN;
  if (!token) throw new Error("NOTION_API_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
  };
}

async function throwIfNotOk(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`Notion ${context} failed [${res.status}]: ${body}`);
  }
}

function plainText(richText: { plain_text: string }[]): string {
  return richText.map((t) => t.plain_text).join("");
}

// Minimal Notion types
interface NotionPage {
  id: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, NotionProp>;
}

type NotionTitleProp        = { type: "title"; title: { plain_text: string }[] };
type NotionStatusProp       = { type: "status"; status: { name: string } | null };
type NotionSelectProp       = { type: "select"; select: { name: string } | null };
type NotionMultiSelectProp  = { type: "multi_select"; multi_select: { name: string }[] };
type NotionRichTextProp     = { type: "rich_text"; rich_text: { plain_text: string }[] };
type NotionCreatedTimeProp  = { type: "created_time"; created_time: string };
type NotionProp =
  | NotionTitleProp
  | NotionStatusProp
  | NotionSelectProp
  | NotionMultiSelectProp
  | NotionRichTextProp
  | NotionCreatedTimeProp
  | { type: string };

interface NotionBlock {
  type: string;
  [key: string]: unknown;
}

// Convert a Notion page (without body — caller fetches body separately)
function toNoteItem(page: NotionPage, content: string): NoteItem {
  let title = "";
  let status = "";
  const tags: string[] = [];
  const fields: Record<string, string | null> = {};

  for (const [key, prop] of Object.entries(page.properties)) {
    const lk = key.toLowerCase();
    if (prop.type === "title") {
      title = plainText((prop as NotionTitleProp).title);
    } else if (prop.type === "status" && lk === "status") {
      status = ((prop as NotionStatusProp).status?.name ?? "").toLowerCase();
    } else if (prop.type === "multi_select" && lk === "tags") {
      tags.push(...(prop as NotionMultiSelectProp).multi_select.map((t) => t.name));
    } else if (prop.type === "rich_text") {
      const val = plainText((prop as NotionRichTextProp).rich_text).trim();
      fields[lk] = val || null;
    } else if (prop.type === "select" && lk !== "status") {
      const val = (prop as NotionSelectProp).select?.name?.trim() ?? null;
      fields[lk] = val || null;
    }
  }

  return {
    id: page.id,
    title,
    content,
    createdAt: page.created_time.split("T")[0],
    status,
    tags,
    fields,
  };
}

const TEXT_BLOCK_TYPES = [
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
];

export class NotionProvider extends NoteProvider {
  get displayName() { return "Notion"; }

  // ── Collection reads ─────────────────────────────────────────────────────

  async listByStatus(status: string): Promise<NoteItem[]> {
    return this._queryPages({
      filter: { property: "Status", status: { equals: status } },
    });
  }

  async listCompletedSince(since: Date): Promise<NoteItem[]> {
    return this._queryPages({
      filter: {
        and: [
          { property: "Status", status: { equals: "Done" } },
          {
            timestamp: "last_edited_time",
            last_edited_time: { on_or_after: since.toISOString() },
          },
        ],
      },
    });
  }

  private async _queryPages(body: object): Promise<NoteItem[]> {
    const res = await fetch(`${BASE_URL}/databases/${this.sourceId}/query`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    await throwIfNotOk(res, "_queryPages");

    const data = (await res.json()) as { results: NotionPage[] };
    const items: NoteItem[] = [];
    for (const page of data.results) {
      const content = await this._getBodyText(page.id);
      if (!content.trim()) continue;
      items.push(toNoteItem(page, content.trim()));
    }
    return items;
  }

  // ── Item reads ───────────────────────────────────────────────────────────

  async getItem(id: string): Promise<NoteItem> {
    const res = await fetch(`${BASE_URL}/pages/${id}`, { headers: headers() });
    await throwIfNotOk(res, `getItem(${id})`);
    const page = (await res.json()) as NotionPage;
    const content = await this._getBodyText(id);
    return toNoteItem(page, content.trim());
  }

  async getCustomField(id: string, fieldName: string): Promise<string | null> {
    const item = await this.getItem(id);
    return item.fields[fieldName.toLowerCase()] ?? null;
  }

  // ── Item writes ──────────────────────────────────────────────────────────

  async updateStatus(id: string, status: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/pages/${id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({
        properties: { Status: { status: { name: status } } },
      }),
    });
    await throwIfNotOk(res, `updateStatus(${id}, ${status})`);
  }

  async addComment(id: string, text: string): Promise<void> {
    // Strip markdown syntax so the plain-text comment is readable
    const plain = text
      .replace(/^#{1,6}\s+/gm, "")       // remove heading markers
      .replace(/\*\*(.*?)\*\*/g, "$1")    // remove bold
      .replace(/\*(.*?)\*/g, "$1")        // remove italic
      .replace(/`{1,3}(.*?)`{1,3}/gs, "$1") // remove code spans/blocks
      .trim();

    const res = await fetch(`${BASE_URL}/comments`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        parent: { type: "page_id", page_id: id },
        rich_text: [{ type: "text", text: { content: plain } }],
      }),
    });
    await throwIfNotOk(res, `addComment(${id})`);
  }

  async addTag(id: string, tag: string): Promise<void> {
    const item = await this.getItem(id);
    const current = item.tags.map((t) => ({ name: t }));
    if (item.tags.includes(tag)) return; // already present

    const res = await fetch(`${BASE_URL}/pages/${id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({
        properties: {
          Tags: { multi_select: [...current, { name: tag }] },
        },
      }),
    });
    await throwIfNotOk(res, `addTag(${id}, ${tag})`);
  }

  async removeTag(id: string, tag: string): Promise<void> {
    const item = await this.getItem(id);
    const updated = item.tags.filter((t) => t !== tag).map((t) => ({ name: t }));

    const res = await fetch(`${BASE_URL}/pages/${id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({
        properties: { Tags: { multi_select: updated } },
      }),
    });
    await throwIfNotOk(res, `removeTag(${id}, ${tag})`);
  }

  // ── Collection writes ─────────────────────────────────────────────────────

  async createItem(item: NoteItemCreate): Promise<NoteItem> {
    const properties: Record<string, unknown> = {
      Name: { title: [{ type: "text", text: { content: item.title } }] },
    };
    if (item.status) {
      properties["Status"] = { status: { name: item.status } };
    }
    if (item.tags?.length) {
      properties["Tags"] = { multi_select: item.tags.map((t) => ({ name: t })) };
    }

    // Create the page
    const res = await fetch(`${BASE_URL}/pages`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        parent: { database_id: this.sourceId },
        properties,
      }),
    });
    await throwIfNotOk(res, "createItem (page)");
    const page = (await res.json()) as NotionPage;

    // Append content as paragraph blocks if provided
    if (item.content?.trim()) {
      const paragraphs = item.content.split(/\n\n+/).filter(Boolean);
      const blockRes = await fetch(`${BASE_URL}/blocks/${page.id}/children`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          children: paragraphs.map((p) => ({
            object: "block",
            type: "paragraph",
            paragraph: { rich_text: [{ type: "text", text: { content: p } }] },
          })),
        }),
      });
      await throwIfNotOk(blockRes, "createItem (content blocks)");
    }

    return toNoteItem(page, item.content ?? "");
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async _getBodyText(pageId: string): Promise<string> {
    const res = await fetch(`${BASE_URL}/blocks/${pageId}/children`, {
      headers: headers(),
    });
    await throwIfNotOk(res, `_getBodyText(${pageId})`);
    const data = (await res.json()) as { results: NotionBlock[] };

    return data.results
      .filter((b) => TEXT_BLOCK_TYPES.includes(b.type))
      .map((b) => {
        const inner = (b[b.type] as { rich_text?: { plain_text: string }[] } | undefined);
        return inner?.rich_text ? plainText(inner.rich_text) : "";
      })
      .join("\n");
  }
}
