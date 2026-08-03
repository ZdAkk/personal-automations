import { useRef, useState } from "react";
import type { DraftResultDto, ProfileValues } from "../../../shared/api";
import { copyText, draftOne } from "../api";

type Tier = ProfileValues["situation"]["interest"]["tiers"][number];

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

export function ResultCard({
  result,
  tiers,
  onRedraft,
}: {
  result: DraftResultDto;
  tiers: Tier[];
  onRedraft: (r: DraftResultDto) => void;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [interest, setInterest] = useState(result.interest);
  const [redrafting, setRedrafting] = useState(false);
  const letterRef = useRef<HTMLPreElement>(null);

  const tierLabel = (score: number): string => {
    let label = "";
    for (const t of [...tiers].sort((a, b) => a.from - b.from)) if (score >= t.from) label = t.label;
    return label;
  };

  // Re-write this one letter at a new interest level. Only fires on release,
  // not while dragging, so a slider sweep doesn't queue ten LLM calls.
  async function commitInterest(next: number): Promise<void> {
    if (next === result.interest || redrafting) return;
    setRedrafting(true);
    try {
      onRedraft(await draftOne(result.url, next));
    } catch {
      setInterest(result.interest);
    } finally {
      setRedrafting(false);
    }
  }

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

        <div className="card__interest">
          <label className="card__interestLabel">
            Interesse <strong>{interest}</strong>
            {tierLabel(interest) && <em> · {tierLabel(interest)}</em>}
          </label>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={interest}
            disabled={redrafting}
            onChange={(e) => setInterest(Number(e.target.value))}
            onMouseUp={(e) => void commitInterest(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => void commitInterest(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => void commitInterest(Number((e.target as HTMLInputElement).value))}
          />
          {redrafting && <span className="spinner spinner--sm" aria-label="wird neu geschrieben" />}
        </div>

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
