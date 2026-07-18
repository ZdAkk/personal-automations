// ============================================================================
// Digest email renderer — turns a run's new apartment matches into ONE HTML
// email (with the main photo, key facts, a link to the listing, and the
// ready-to-send application letter for easy copy). Shared by both the
// Kleinanzeigen and ImmoScout scouts.
//
// Layout: a 2-column grid of compact cards (two ads per row) so more listings
// are visible at a glance and the photos stay small. Kept email-client-safe:
// table-based columns, inline styles only, no external CSS/JS, jpg images
// (hotlinked from the source CDN). A media query stacks to one column on
// narrow screens; clients that ignore it just show two narrower columns.
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

const SANS = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

// Fixed photo height so every card is the same shape no matter the source
// aspect ratio — portrait shots (e.g. wohnungsswap screenshots) would otherwise
// run absurdly tall and blow the card out.
const IMG_H = 170;

// The inner card (goes inside a grid cell). Smaller photo, tight spacing.
function cardInner(it: DigestItem): string {
  // object-fit:cover crops (not squashes) in modern clients; the wrapper's
  // fixed height + overflow:hidden bounds it in clients that ignore object-fit.
  const img = it.imageUrl
    ? `<a href="${escapeHtml(it.url)}" style="text-decoration:none;display:block;">
         <div style="height:${IMG_H}px;overflow:hidden;border-radius:11px 11px 0 0;line-height:0;font-size:0;">
           <img src="${escapeHtml(it.imageUrl)}" alt="" width="320" height="${IMG_H}"
                style="width:100%;height:${IMG_H}px;object-fit:cover;object-position:center;display:block;border:0;" />
         </div>
       </a>`
    : "";

  const badge = it.far
    ? `<span style="display:inline-block;background:#fce8b2;color:#8a6d00;font-size:11px;font-weight:600;padding:2px 7px;border-radius:999px;margin-bottom:7px;">⚠️ weiter entfernt</span><br/>`
    : "";

  const contact = it.contactName
    ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">Kontakt: ${escapeHtml(it.contactName)}</div>`
    : "";

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e6ea;border-radius:12px;background:#ffffff;">
      <tr><td style="padding:0;">${img}</td></tr>
      <tr><td style="padding:13px 15px 15px 15px;font-family:${SANS};">
        ${badge}
        <div style="font-size:15px;font-weight:700;color:#111827;line-height:1.3;">${escapeHtml(it.title)}</div>
        <div style="font-size:13px;color:#374151;margin-top:5px;">${escapeHtml(factLine(it))}</div>
        ${contact}
        <div style="margin:12px 0;">
          <a href="${escapeHtml(it.url)}"
             style="display:inline-block;background:#e4172b;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;padding:8px 14px;border-radius:7px;">
            Auf ${escapeHtml(it.source)} öffnen
          </a>
        </div>
        <div style="font-size:11px;color:#6b7280;margin:12px 0 5px 0;text-transform:uppercase;letter-spacing:.04em;">Nachricht — zum Kopieren</div>
        <div style="white-space:pre-wrap;font-family:${SANS};font-size:13px;line-height:1.5;color:#111827;background:#f6f7f9;border:1px solid #e3e6ea;border-radius:8px;padding:14px;">${escapeHtml(it.letter)}</div>
      </td></tr>
    </table>`;
}

// One grid cell (50% wide). `filled` false renders an empty spacer cell so an
// odd final row keeps its column widths.
function cell(it: DigestItem | null): string {
  const inner = it ? cardInner(it) : "";
  return `<td class="digest-col" width="50%" valign="top" style="width:50%;padding:8px;vertical-align:top;">${inner}</td>`;
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
    <tr><td colspan="2" style="padding:4px 8px 18px 8px;font-family:${SANS};">
      <div style="font-size:20px;font-weight:800;color:#111827;">${n} ${noun}</div>
      <div style="font-size:13px;color:#6b7280;margin-top:3px;">${escapeHtml(source)} · ${escapeHtml(dateLabel)} · Bewerbermappe-PDF beim Senden anhängen</div>
    </td></tr>`;

  // Two cards per row. A lone listing spans the full width instead of sitting
  // in a half-width column next to an empty one (which reads as broken).
  const rows: string[] = [];
  if (items.length === 1) {
    rows.push(
      `<tr><td colspan="2" valign="top" style="padding:8px;vertical-align:top;">${cardInner(items[0])}</td></tr>`
    );
  } else {
    for (let i = 0; i < items.length; i += 2) {
      rows.push(`<tr>${cell(items[i])}${cell(items[i + 1] ?? null)}</tr>`);
    }
  }

  const html = `
  <style>
    @media only screen and (max-width:620px) {
      .digest-col { display:block !important; width:100% !important; }
    }
  </style>
  <div style="background:#eef0f3;padding:22px 10px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;margin:0 auto;">
      ${header}
      ${rows.join("")}
      <tr><td colspan="2" style="padding:10px 8px 4px 8px;font-family:${SANS};font-size:12px;color:#9ca3af;">
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
