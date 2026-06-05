/**
 * ClickUp API client
 *
 * All functions read CLICKUP_API_TOKEN and CLICKUP_LIST_ID from env.
 * Authentication uses a personal API token (passed as the Authorization header value directly).
 * Docs: https://clickup.com/api
 */

const BASE_URL = "https://api.clickup.com/api/v2";

function headers(): Record<string, string> {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) throw new Error("CLICKUP_API_TOKEN is not set");
  return {
    Authorization: token,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClickUpTag {
  name: string;
}

export interface ClickUpStatus {
  status: string;
  color: string;
  type: string;
}

export interface ClickUpCustomField {
  id: string;
  name: string;
  type: string;
  value?: string | null;
}

export interface ClickUpTask {
  id: string;
  name: string;
  description?: string;
  status: ClickUpStatus;
  tags: ClickUpTag[];
  custom_fields?: ClickUpCustomField[];
  date_done?: string | null;
  date_created?: string;
  date_updated?: string;
}

/** Extract a custom field value by name (case-insensitive). Returns null if not found or empty. */
export function getCustomField(task: ClickUpTask, fieldName: string): string | null {
  const field = task.custom_fields?.find(
    (f) => f.name.toLowerCase() === fieldName.toLowerCase()
  );
  return field?.value?.trim() || null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if the task already has the given tag (case-insensitive). */
export function hasTag(task: ClickUpTask, tagName: string): boolean {
  return task.tags.some((t) => t.name.toLowerCase() === tagName.toLowerCase());
}

async function throwIfNotOk(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`ClickUp ${context} failed [${res.status}]: ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/** Fetch all tasks in a list that have the given status name. */
export async function getTasksByStatus(
  listId: string,
  status: string
): Promise<ClickUpTask[]> {
  const url = `${BASE_URL}/list/${listId}/task?statuses[]=${encodeURIComponent(status)}&include_closed=false`;
  const res = await fetch(url, { headers: headers() });
  await throwIfNotOk(res, `getTasksByStatus(${status})`);
  const data = (await res.json()) as { tasks?: ClickUpTask[] };
  return data.tasks ?? [];
}

/** Fetch a single task by ID. */
export async function getTask(taskId: string): Promise<ClickUpTask> {
  const res = await fetch(`${BASE_URL}/task/${taskId}`, { headers: headers() });
  await throwIfNotOk(res, `getTask(${taskId})`);
  return res.json() as Promise<ClickUpTask>;
}

/**
 * Fetch all tasks with status "Done" that were completed after `since`.
 * ClickUp filters by date_done_gt (millisecond timestamp).
 */
export async function getCompletedTasksSince(
  listId: string,
  since: Date
): Promise<ClickUpTask[]> {
  const ts = since.getTime();
  const url =
    `${BASE_URL}/list/${listId}/task` +
    `?statuses[]=Done&date_done_gt=${ts}&include_closed=true`;
  const res = await fetch(url, { headers: headers() });
  await throwIfNotOk(res, "getCompletedTasksSince");
  const data = (await res.json()) as { tasks?: ClickUpTask[] };
  return data.tasks ?? [];
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/** Post a markdown comment to a task. */
export async function addComment(taskId: string, text: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/task/${taskId}/comment`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ comment_text: text }),
  });
  await throwIfNotOk(res, `addComment(${taskId})`);
}

/**
 * Add a tag to a task.
 * Note: the tag must already exist in the ClickUp Space, or ClickUp will
 * create it automatically (behaviour depends on plan).
 */
export async function addTag(taskId: string, tagName: string): Promise<void> {
  const res = await fetch(
    `${BASE_URL}/task/${taskId}/tag/${encodeURIComponent(tagName)}`,
    { method: "POST", headers: headers() }
  );
  await throwIfNotOk(res, `addTag(${taskId}, ${tagName})`);
}

/** Remove a tag from a task. */
export async function removeTag(taskId: string, tagName: string): Promise<void> {
  const res = await fetch(
    `${BASE_URL}/task/${taskId}/tag/${encodeURIComponent(tagName)}`,
    { method: "DELETE", headers: headers() }
  );
  await throwIfNotOk(res, `removeTag(${taskId}, ${tagName})`);
}

/** Update the status of a task. The status string must match a status name in the list. */
export async function updateTaskStatus(
  taskId: string,
  status: string
): Promise<void> {
  const res = await fetch(`${BASE_URL}/task/${taskId}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ status }),
  });
  await throwIfNotOk(res, `updateTaskStatus(${taskId}, ${status})`);
}

/** Create a new task in a list. */
export async function createTask(
  listId: string,
  task: {
    name: string;
    description?: string;
    status?: string;
    tags?: string[];
  }
): Promise<ClickUpTask> {
  const res = await fetch(`${BASE_URL}/list/${listId}/task`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name: task.name,
      description: task.description ?? "",
      status: task.status,
      tags: task.tags?.map((name) => ({ name })),
    }),
  });
  await throwIfNotOk(res, "createTask");
  return res.json() as Promise<ClickUpTask>;
}
