// ============================================================================
// Email adapter — sends via the Resend HTTP API (https://resend.com).
//
// One HTTPS POST, no SDK. Works from anywhere (incl. the cloud VPS) since it's
// pure outbound HTTPS. Used by the apartment scouts to send one digest email
// per poll instead of per-listing push notifications.
//
// Env:
//   RESEND_API_KEY  Resend API key (re_...) — REQUIRED.
//   EMAIL_FROM      From address on a Resend-VERIFIED domain — REQUIRED.
//   EMAIL_TO        Default recipient — REQUIRED (a call may override via `to`).
// ============================================================================

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendEmailParams {
  subject: string;
  html: string;
  text?: string;
  to?: string; // defaults to EMAIL_TO
  from?: string; // defaults to EMAIL_FROM
  replyTo?: string;
}

/**
 * Send one email through Resend. Retries a couple of times on transient
 * (network / 5xx / 429) failures so a flaky moment doesn't drop a digest;
 * throws after the last attempt so the caller (a Trigger task) can retry too.
 */
export async function sendEmail(p: SendEmailParams): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  const from = p.from ?? process.env.EMAIL_FROM;
  const to = p.to ?? process.env.EMAIL_TO;
  if (!from) throw new Error("EMAIL_FROM is not set");
  if (!to) throw new Error("EMAIL_TO is not set");

  const body = JSON.stringify({
    from,
    to: [to],
    subject: p.subject,
    html: p.html,
    ...(p.text ? { text: p.text } : {}),
    ...(p.replyTo ? { reply_to: p.replyTo } : {}),
  });

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
      });
      if (res.ok) {
        const data: any = await res.json();
        return { id: data?.id ?? "" };
      }
      // 4xx (except 429) are permanent — don't waste retries on them.
      const text = await res.text();
      if (res.status < 500 && res.status !== 429) {
        throw new Error(`Resend error: ${res.status} ${text}`);
      }
      lastErr = new Error(`Resend error: ${res.status} ${text}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
