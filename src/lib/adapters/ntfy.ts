/**
 * ntfy push-notification adapter.
 *
 * One shared account publishes to any topic on the configured server. Auth and
 * the JSON wire format live here; callers just hand over a NtfyMessage.
 *
 * Env:
 *   NTFY_URL       server base (default https://ntfy.sh)
 *   NTFY_USER      account username  ┐ Basic auth for a protected (deny-all)
 *   NTFY_PASSWORD  account password  ┘ server; omit both for a public server.
 */

const BASE_URL = (process.env.NTFY_URL ?? "https://ntfy.sh").replace(/\/$/, "");

export interface NtfyAction {
  action: "view";
  label: string;
  url: string;
}

export interface NtfyMessage {
  topic: string;
  message: string;
  title?: string;
  priority?: number; // 1–5 (5 = max)
  tags?: string[]; // emoji short-codes (e.g. "computer") or labels
  click?: string; // URL opened when the notification is tapped
  actions?: NtfyAction[];
}

// Basic auth for the single shared account over HTTPS; {} when no creds are set.
function authHeader(): Record<string, string> {
  const user = process.env.NTFY_USER;
  const pass = process.env.NTFY_PASSWORD;
  if (user && pass) {
    return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
  }
  return {};
}

// Publish one message. JSON publishing posts to the ROOT url with the topic in
// the body (per ntfy's API) — NOT to /<topic>, which would treat the JSON as
// the literal message text.
export async function publish(msg: NtfyMessage): Promise<void> {
  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(msg),
  });

  if (!response.ok) {
    throw new Error(`ntfy publish failed: ${response.status} ${await response.text()}`);
  }
}
