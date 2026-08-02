import { useEffect, useMemo, useState } from "react";
import type { DraftResultDto, ProfileDto } from "../../shared/api";
import { fetchProfile, streamDraft } from "./api";
import { ResultCard } from "./components/ResultCard";

interface RunState {
  running: boolean;
  total: number;
  rejected: string[];
  results: DraftResultDto[];
  error: string | null;
}

const EMPTY: RunState = { running: false, total: 0, rejected: [], results: [], error: null };

export default function App() {
  const [urls, setUrls] = useState("");
  const [run, setRun] = useState<RunState>(EMPTY);
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [abortFn, setAbortFn] = useState<(() => void) | null>(null);

  useEffect(() => {
    fetchProfile().then(setProfile).catch(() => setProfile(null));
  }, []);

  // Cheap client-side count so the button can say how many links it sees.
  const pastedCount = useMemo(
    () => urls.split(/[\r\n]+/).filter((l) => /https?:\/\/\S+/.test(l)).length,
    [urls]
  );

  function start(): void {
    if (!urls.trim() || run.running) return;
    setRun({ ...EMPTY, running: true });

    const { done, abort } = streamDraft(urls, (e) => {
      if (e.type === "parsed") {
        setRun((s) => ({ ...s, total: e.total, rejected: e.rejected }));
      } else if (e.type === "item") {
        setRun((s) => ({ ...s, results: [...s.results, e.result] }));
      } else if (e.type === "done") {
        setRun((s) => ({ ...s, running: false }));
      } else if (e.type === "error") {
        setRun((s) => ({ ...s, running: false, error: e.message }));
      }
    });
    setAbortFn(() => abort);
    done
      .catch((err: Error) => {
        if (err.name !== "AbortError") setRun((s) => ({ ...s, error: err.message }));
      })
      .finally(() => setRun((s) => ({ ...s, running: false })));
  }

  function stop(): void {
    abortFn?.();
    setRun((s) => ({ ...s, running: false }));
  }

  const progress = run.total > 0 ? `${run.results.length}/${run.total}` : "";

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Wohnungs&#8203;-Bewerbungen</h1>
          <p className="header__sub">
            Links einfügen, fertige Nachrichten erhalten. ImmoScout24 und Kleinanzeigen gemischt.
          </p>
        </div>
        {profile && (
          <dl className="profile" title="Aus src/config/profile.ts">
            <div>
              <dt>Suche</dt>
              <dd>
                {profile.city.name} +{profile.city.radiusKm} km
                {profile.criteria.maxWarmmiete && ` · ≤ ${profile.criteria.maxWarmmiete} € warm`}
                {profile.criteria.minWohnflaeche && ` · ≥ ${profile.criteria.minWohnflaeche} m²`}
              </dd>
            </div>
            <div>
              <dt>Einzug</dt>
              <dd>{profile.applicant.moveInDate}</dd>
            </div>
            <div>
              <dt>Einkommen</dt>
              <dd>{profile.applicant.monthlyIncomeEur.toLocaleString("de-DE")} €</dd>
            </div>
          </dl>
        )}
      </header>

      <section className="composer">
        <textarea
          className="composer__input"
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={
            "Links hier einfügen, einer pro Zeile:\n\n" +
            "https://www.immobilienscout24.de/expose/169449374\n" +
            "https://www.kleinanzeigen.de/s-anzeige/3474385551"
          }
          spellCheck={false}
          rows={7}
        />
        <div className="composer__actions">
          {run.running ? (
            <button className="btn btn--primary" onClick={stop} type="button">
              Abbrechen {progress && `(${progress})`}
            </button>
          ) : (
            <button
              className="btn btn--primary"
              onClick={start}
              type="button"
              disabled={pastedCount === 0}
            >
              {pastedCount > 0 ? `${pastedCount} Anzeige${pastedCount === 1 ? "" : "n"} entwerfen` : "Entwerfen"}
            </button>
          )}
          {run.results.length > 0 && !run.running && (
            <button className="btn btn--ghost" onClick={() => setRun(EMPTY)} type="button">
              Leeren
            </button>
          )}
          {run.running && <span className="spinner" aria-label="lädt" />}
        </div>
      </section>

      {run.error && <p className="notice notice--error">Fehler: {run.error}</p>}

      {run.rejected.length > 0 && (
        <p className="notice notice--warn">
          {run.rejected.length} Zeile(n) übersprungen (keine Anzeigen-URL, z. B. eine Suchseite):
          <br />
          {run.rejected.map((r) => (
            <code key={r}>{r.length > 90 ? `${r.slice(0, 90)}…` : r}</code>
          ))}
        </p>
      )}

      {run.running && run.total > 0 && (
        <p className="notice">
          {run.results.length} von {run.total} fertig …
        </p>
      )}

      <section className="results">
        {run.results.map((r) => (
          <ResultCard key={`${r.source}:${r.id}`} result={r} />
        ))}
      </section>

      {!run.running && run.results.length === 0 && (
        <p className="empty">Noch nichts entworfen.</p>
      )}
    </div>
  );
}
