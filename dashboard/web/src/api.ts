import type {
  DraftEvent,
  DraftResultDto,
  ProfileMeta,
  ProfileValues,
} from "../../shared/api";

export async function fetchProfile(): Promise<ProfileValues> {
  const res = await fetch("/api/profile");
  if (!res.ok) throw new Error(`profile: ${res.status}`);
  return res.json();
}

export async function fetchProfileMeta(): Promise<ProfileMeta> {
  const res = await fetch("/api/profile/meta");
  if (!res.ok) throw new Error(`profile meta: ${res.status}`);
  return res.json();
}

export async function saveProfile(values: ProfileValues): Promise<void> {
  const res = await fetch("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `save failed: ${res.status}`);
  }
}

/** Re-draft one listing at a different interest score. */
export async function draftOne(url: string, interest: number): Promise<DraftResultDto> {
  const res = await fetch("/api/draft-one", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, interest }),
  });
  if (!res.ok) throw new Error(`draft-one: ${res.status}`);
  return res.json();
}

/**
 * POST the pasted block and consume the SSE stream, invoking `onEvent` per
 * event as it arrives. Uses fetch + a ReadableStream rather than EventSource,
 * because EventSource can only issue GETs and the paste can be long.
 *
 * Returns an abort function so the UI can cancel a run.
 */
export function streamDraft(
  urls: string,
  interest: number,
  onEvent: (e: DraftEvent) => void
): { done: Promise<void>; abort: () => void } {
  const controller = new AbortController();

  const done = (async () => {
    const res = await fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, interest }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`draft: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue; // skips ": ping" heartbeats
          try {
            onEvent(JSON.parse(line.slice(6)) as DraftEvent);
          } catch {
            /* ignore a malformed frame rather than killing the stream */
          }
        }
      }
    }
  })();

  return { done, abort: () => controller.abort() };
}

/**
 * Copy text to the clipboard.
 *
 * navigator.clipboard is unavailable on plain http:// origins (non-secure
 * context), which is exactly how this runs on the LAN — so fall back to the
 * old execCommand path rather than silently doing nothing.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
