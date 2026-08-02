import { useRef, useState } from "react";
import type { DraftResultDto } from "../../../shared/api";
import { copyText } from "../api";

const eur = (n: number | null | undefined): string | null =>
  n == null ? null : `${Math.round(n)} €`;

function facts(l: NonNullable<DraftResultDto["listing"]>): string {
  return [
    l.location,
    eur(l.warmmiete) && `${eur(l.warmmiete)} warm`,
    eur(l.kaltmiete) && `${eur(l.kaltmiete)} kalt`,
    l.wohnflaeche != null && `${l.wohnflaeche} m²`,
    l.zimmer != null && `${l.zimmer} Zi.`,
    l.distanceKm != null && `${l.distanceKm} km`,
  ]
    .filter(Boolean)
    .join("  ·  ");
}

type CopyState = "idle" | "copied" | "selected";

export function ResultCard({ result }: { result: DraftResultDto }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const letterRef = useRef<HTMLPreElement>(null);

  async function onCopy(): Promise<void> {
    if (!result.listing) return;
    const ok = await copyText(result.listing.letter);
    if (ok) {
      setCopyState("copied");
    } else {
      // Clipboard access can be refused outright (plain-http origin plus a
      // browser that also blocks execCommand). Rather than fail silently,
      // select the letter so Ctrl+C works, and say so on the button.
      const pre = letterRef.current;
      if (pre) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setCopyState("selected");
    }
    window.setTimeout(() => setCopyState("idle"), 2600);
  }

  const copyLabel =
    copyState === "copied"
      ? "✓ Kopiert"
      : copyState === "selected"
        ? "Markiert — Strg+C"
        : "Nachricht kopieren";

  if (!result.ok || !result.listing) {
    return (
      <article className="card card--error">
        <div className="card__body">
          <span className="badge badge--error">{result.source}</span>
          <h3 className="card__title">Konnte nicht geladen werden</h3>
          <p className="card__facts">{result.error ?? "Unbekannter Fehler"}</p>
          <a className="card__link" href={result.url} target="_blank" rel="noreferrer">
            Anzeige öffnen ↗
          </a>
        </div>
      </article>
    );
  }

  const l = result.listing;
  const warnings = result.outsideCriteria ?? [];

  return (
    <article className="card">
      {l.imageUrl && (
        <a href={result.url} target="_blank" rel="noreferrer" className="card__imageLink">
          <img className="card__image" src={l.imageUrl} alt="" loading="lazy" />
        </a>
      )}
      <div className="card__body">
        <div className="card__badges">
          <span className={`badge badge--${result.source === "ImmoScout24" ? "is24" : "ka"}`}>
            {result.source}
          </span>
          {l.far && <span className="badge badge--warn">weiter entfernt</span>}
          {warnings.map((w) => (
            <span key={w} className="badge badge--warn">
              {w}
            </span>
          ))}
        </div>

        <h3 className="card__title">{l.title}</h3>
        <p className="card__facts">{facts(l)}</p>
        {l.contactName && <p className="card__contact">Kontakt: {l.contactName}</p>}

        <div className="card__actions">
          <button className="btn btn--primary" onClick={onCopy} type="button">
            {copyLabel}
          </button>
          <a className="btn btn--ghost" href={result.url} target="_blank" rel="noreferrer">
            Anzeige öffnen ↗
          </a>
        </div>

        <details className="card__letter" open>
          <summary>Nachricht</summary>
          <pre className="letter" ref={letterRef}>{l.letter}</pre>
        </details>
      </div>
    </article>
  );
}
