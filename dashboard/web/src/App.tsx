import { useEffect, useMemo, useState } from "react";
import type { DraftResultDto, ProfileMeta, ProfileValues } from "../../shared/api";
import { fetchProfile, fetchProfileMeta, streamDraft } from "./api";
import { ResultCard } from "./components/ResultCard";
import { SettingsPanel } from "./components/SettingsPanel";

interface RunState {
  running: boolean;
  total: number;
  rejected: string[];
  results: DraftResultDto[];
  error: string | null;
}

const EMPTY: RunState = { running: false, total: 0, rejected: [], results: [], error: null };

type Tab = "draft" | "settings";

export default function App() {
  const [tab, setTab] = useState<Tab>("draft");
  const [urls, setUrls] = useState("");
  const [run, setRun] = useState<RunState>(EMPTY);
  const [profile, setProfile] = useState<ProfileValues | null>(null);
  const [meta, setMeta] = useState<ProfileMeta | null>(null);
  const [interest, setInterest] = useState(5);
  const [abortFn, setAbortFn] = useState<(() => void) | null>(null);

  useEffect(() => {
    fetchProfile()
      .then((p) => {
        setProfile(p);
        setInterest(p.situation.interest.default);
      })
      .catch(() => setProfile(null));
    fetchProfileMeta().then(setMeta).catch(() => setMeta(null));
  }, []);

  const pastedCount = useMemo(
    () => urls.split(/[\r\n]+/).filter((l) => /https?:\/\/\S+/.test(l)).length,
    [urls]
  );

  const tierLabel = useMemo(() => {
    const tiers = profile?.situation.interest.tiers ?? [];
    let label = "";
    for (const t of [...tiers].sort((a, b) => a.from - b.from)) {
      if (interest >= t.from) label = t.label;
    }
    return label;
  }, [profile, interest]);

  function start(): void {
    if (!urls.trim() || run.running) return;
    setRun({ ...EMPTY, running: true });

    const { done, abort } = streamDraft(urls, interest, (e) => {
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

  /** A card re-drafted itself at a new interest score; swap it in place. */
  function replaceResult(next: DraftResultDto): void {
    setRun((s) => ({
      ...s,
      results: s.results.map((r) => (r.source === next.source && r.id === next.id ? next : r)),
    }));
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
        <nav className="tabs">
          <button
            className={`tab${tab === "draft" ? " tab--active" : ""}`}
            onClick={() => setTab("draft")}
            type="button"
          >
            Entwerfen
          </button>
          <button
            className={`tab${tab === "settings" ? " tab--active" : ""}`}
            onClick={() => setTab("settings")}
            type="button"
          >
            Einstellungen
          </button>
        </nav>
      </header>

      {tab === "settings" ? (
        profile ? (
          <SettingsPanel
            profile={profile}
            meta={meta}
            onSaved={(v) => {
              setProfile(v);
              setInterest(v.situation.interest.default);
            }}
          />
        ) : (
          <p className="empty">Einstellungen werden geladen …</p>
        )
      ) : (
        <>
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

            <div className="interest">
              <label className="interest__label" htmlFor="interest">
                Interesse <strong>{interest}</strong>
                {tierLabel && <em> · {tierLabel}</em>}
              </label>
              <input
                id="interest"
                className="interest__range"
                type="range"
                min={1}
                max={10}
                step={1}
                value={interest}
                onChange={(e) => setInterest(Number(e.target.value))}
              />
              <span className="interest__hint">
                Höher = entgegenkommender formuliert. Pro Wohnung nachträglich anpassbar.
              </span>
            </div>

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
                  {pastedCount > 0
                    ? `${pastedCount} Anzeige${pastedCount === 1 ? "" : "n"} entwerfen`
                    : "Entwerfen"}
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
              {run.rejected.length} Zeile(n) übersprungen (keine Anzeigen-URL, z. B. eine
              Suchseite):
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
              <ResultCard
                key={`${r.source}:${r.id}`}
                result={r}
                tiers={profile?.situation.interest.tiers ?? []}
                onRedraft={replaceResult}
              />
            ))}
          </section>

          {!run.running && run.results.length === 0 && (
            <p className="empty">Noch nichts entworfen.</p>
          )}
        </>
      )}
    </div>
  );
}
