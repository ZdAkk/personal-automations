// ============================================================================
// Digest email renderer — turns a run's new apartment matches into ONE HTML
// email (with the main photo, key facts, a link to the listing, and the
// ready-to-send application letter for easy copy). Shared by both the
// Kleinanzeigen and ImmoScout scouts.
//
// Kept deliberately email-client-safe: a centred single column, inline styles
// only, no external CSS/JS, jpg images (hotlinked from the source CDN).
// ============================================================================

export interface DigestItem {
  source: "ImmoScout24" | "Kleinanzeigen";
  id: string;
  title: string;
  url: string;
  imageUrl: string | null;
  location: string | null; // Stadtteil / Ort
  kaltmiete: number | null;
  warmmiete: number | null;
  wohnflaeche: number | null;
  zimmer: number | null;
  contactName: string | null;
  far: boolean; // farther than the warn threshold from München
  distanceKm: number | null;
  letter: string; // the full, ready-to-send message
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const eur = (n: number | null): string | null => (n != null ? `${Math.round(n)} €` : null);

function factLine(it: DigestItem): string {
  const bits = [
    it.location,
    eur(it.warmmiete) ? `${eur(it.warmmiete)} warm` : null,
    eur(it.kaltmiete) ? `${eur(it.kaltmiete)} kalt` : null,
    it.wohnflaeche != null ? `${it.wohnflaeche} m²` : null,
    it.zimmer != null ? `${it.zimmer} Zi.` : null,
    it.distanceKm != null ? `${Math.round(it.distanceKm)} km` : null,
  ].filter(Boolean);
  return bits.join("  ·  ");
}

// One listing card.
function card(it: DigestItem): string {
  const img = it.imageUrl
    ? `<a href="${escapeHtml(it.url)}" style="text-decoration:none;">
         <img src="${escapeHtml(it.imageUrl)}" alt="" width="600"
              style="width:100%;max-width:600px;height:auto;display:block;border-radius:10px 10px 0 0;border:0;" />
       </a>`
    : "";

  const badge = it.far
    ? `<span style="display:inline-block;background:#fce8b2;color:#8a6d00;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;margin-bottom:8px;">⚠️ weiter entfernt</span><br/>`
    : "";

  const contact = it.contactName
    ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;">Kontakt: ${escapeHtml(it.contactName)}</div>`
    : "";

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;border:1px solid #e3e6ea;border-radius:12px;background:#ffffff;">
    <tr><td style="padding:0;">${img}</td></tr>
    <tr><td style="padding:18px 20px 20px 20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      ${badge}
      <div style="font-size:17px;font-weight:700;color:#111827;line-height:1.35;">${escapeHtml(it.title)}</div>
      <div style="font-size:14px;color:#374151;margin-top:6px;">${escapeHtml(factLine(it))}</div>
      ${contact}
      <div style="margin:14px 0;">
        <a href="${escapeHtml(it.url)}"
           style="display:inline-block;background:#e4172b;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:9px 16px;border-radius:8px;">
          Auf ${escapeHtml(it.source)} öffnen
        </a>
      </div>
      <div style="font-size:12px;color:#6b7280;margin:14px 0 6px 0;text-transform:uppercase;letter-spacing:.04em;">Nachricht — zum Kopieren</div>
      <div style="white-space:pre-wrap;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827;background:#f6f7f9;border:1px solid #e3e6ea;border-radius:8px;padding:16px;">${escapeHtml(it.letter)}</div>
    </td></tr>
  </table>`;
}

export interface RenderedDigest {
  subject: string;
  html: string;
  text: string;
}

/**
 * Render the digest for one run. `source` names the pipeline; `dateLabel` is a
 * human date (e.g. "18.07.2026") shown in the header/subject.
 */
export function renderDigest(
  source: DigestItem["source"],
  items: DigestItem[],
  dateLabel: string
): RenderedDigest {
  const n = items.length;
  const noun = n === 1 ? "neue Wohnung" : "neue Wohnungen";
  const subject = `🏠 ${n} ${noun} · ${source} · ${dateLabel}`;

  const header = `
    <tr><td style="padding:4px 4px 20px 4px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      <div style="font-size:20px;font-weight:800;color:#111827;">${n} ${noun}</div>
      <div style="font-size:13px;color:#6b7280;margin-top:3px;">${escapeHtml(source)} · ${escapeHtml(dateLabel)} · Bewerbermappe-PDF beim Senden anhängen</div>
    </td></tr>`;

  const html = `
  <div style="background:#eef0f3;padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;">
      ${header}
      <tr><td>${items.map(card).join("")}</td></tr>
      <tr><td style="padding:8px 4px 4px 4px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#9ca3af;">
        Automatischer Wohnungs-Scout · nur zur Information, es wird nichts automatisch gesendet.
      </td></tr>
    </table>
  </div>`;

  const text = [
    `${n} ${noun} — ${source} (${dateLabel})`,
    "",
    ...items.map((it, i) =>
      [
        `${i + 1}. ${it.title}`,
        `   ${factLine(it)}`,
        it.contactName ? `   Kontakt: ${it.contactName}` : null,
        `   ${it.url}`,
        "",
        it.letter,
        "",
        "----------------------------------------",
      ]
        .filter((l) => l != null)
        .join("\n")
    ),
  ].join("\n");

  return { subject, html, text };
}
