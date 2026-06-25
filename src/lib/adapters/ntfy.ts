/**
 * ntfy push-notification adapter.
 *
 * One shared account publishes to any topic on the configured server. Auth and
 * the JSON wire format live here; callers just hand over a NtfyMessage.
 *
 * Env:
 *   NTFY_URL       server base — REQUIRED, no default (set to https://ntfy.sh
 *                  explicitly to use the public server; see baseUrl()).
 *   NTFY_USER      account username  ┐ Basic auth for a protected (deny-all)
 *   NTFY_PASSWORD  account password  ┘ server; omit both for a public server.
 */

// Resolve the server at call time and refuse to guess. Defaulting to the public
// ntfy.sh silently would publish private alerts to a public server if NTFY_URL
// were ever unset (e.g. missing in a deployed env) — so fail loudly instead.
function baseUrl(): string {
  const url = process.env.NTFY_URL;
  if (!url) {
    throw new Error(
      "NTFY_URL is not set. Set it explicitly (e.g. https://ntfy.alakad.de, or " +
        "https://ntfy.sh for the public server) — refusing to default to a public server."
    );
  }
  return url.replace(/\/$/, "");
}

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
  const response = await fetch(baseUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(msg),
  });

  if (!response.ok) {
    throw new Error(`ntfy publish failed: ${response.status} ${await response.text()}`);
  }
}
