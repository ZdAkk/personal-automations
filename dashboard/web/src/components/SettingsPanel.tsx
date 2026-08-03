import { useState } from "react";
import type { ProfileMeta, ProfileValues } from "../../../shared/api";
import { saveProfile } from "../api";

// Small typed field helpers. Everything writes into a draft copy; nothing is
// persisted until "Speichern", so a half-typed number can't break a draft run.

function Text({
  label,
  value,
  onChange,
  hint,
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <label className={`field${wide ? " field--wide" : ""}`}>
      <span className="field__label">{label}</span>
      <input className="field__input" value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

function Num({
  label,
  value,
  onChange,
  hint,
  step,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  hint?: string;
  step?: string;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="field__input"
        type="number"
        step={step ?? "1"}
        value={value ?? ""}
        placeholder="kein Limit"
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
  hint,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  rows?: number;
}) {
  return (
    <label className="field field--wide">
      <span className="field__label">{label}</span>
      <textarea
        className="field__input field__input--area"
        rows={rows ?? 3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function SettingsPanel({
  profile,
  meta,
  onSaved,
}: {
  profile: ProfileValues;
  meta: ProfileMeta | null;
  onSaved: (v: ProfileValues) => void;
}) {
  const [draft, setDraft] = useState<ProfileValues>(() => structuredClone(profile));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Mutate a nested slice without hand-writing spread chains everywhere.
  function edit(fn: (d: ProfileValues) => void): void {
    setDraft((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setStatus(null);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setStatus(null);
    try {
      await saveProfile(draft);
      onSaved(structuredClone(draft));
      setStatus("Gespeichert. Wirkt sofort hier; die Trigger.dev-Scouts brauchen einen Redeploy.");
    } catch (e) {
      setStatus(`Fehler: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const a = draft.applicant;
  const si = draft.situation;
  const se = draft.search;

  return (
    <div className="settings">
      <div className="settings__bar">
        <button className="btn btn--primary" onClick={save} disabled={saving} type="button">
          {saving ? "Speichert …" : "Speichern"}
        </button>
        <button
          className="btn btn--ghost"
          type="button"
          onClick={() => {
            setDraft(structuredClone(profile));
            setStatus(null);
          }}
        >
          Zurücksetzen
        </button>
        {status && <span className="settings__status">{status}</span>}
        {meta?.path && (
          <span className="settings__path" title={meta.path}>
            {meta.writable ? "" : "⚠ schreibgeschützt · "}
            {meta.path.replace(/^.*[\\/](src[\\/].*)$/, "$1")}
          </span>
        )}
      </div>

      {/* ---------------- Bewerber ---------------- */}
      <section className="settings__section">
        <h3>Bewerber</h3>
        <div className="grid">
          <Text label="Name" value={a.fullName} onChange={(v) => edit((d) => void (d.applicant.fullName = v))} />
          <Num label="Alter" value={a.age} onChange={(v) => edit((d) => void (d.applicant.age = v ?? 0))} />
          <Text label="Telefon" value={a.phone} onChange={(v) => edit((d) => void (d.applicant.phone = v))} />
          <Text label="E-Mail" value={a.email} onChange={(v) => edit((d) => void (d.applicant.email = v))} />
          <Text
            label="Aktueller Wohnort"
            value={a.currentCity}
            onChange={(v) => edit((d) => void (d.applicant.currentCity = v))}
            hint="Erscheint als „Mieter in X“ und „wohne derzeit noch in X“"
          />
          <Num
            label="Mieter seit (Jahr)"
            value={a.tenantSince}
            onChange={(v) => edit((d) => void (d.applicant.tenantSince = v ?? 0))}
          />
          <Text
            label="Beruf"
            value={a.occupation}
            onChange={(v) => edit((d) => void (d.applicant.occupation = v))}
            wide
          />
          <Num
            label="Einkommen / Monat (€)"
            value={a.monthlyIncomeEur}
            onChange={(v) => edit((d) => void (d.applicant.monthlyIncomeEur = v ?? 0))}
          />
          <Num
            label="Rücklagen (€)"
            value={a.reservesEur}
            onChange={(v) => edit((d) => void (d.applicant.reservesEur = v ?? 0))}
          />
          <Text
            label="SCHUFA-Datum"
            value={a.schufaDate}
            onChange={(v) => edit((d) => void (d.applicant.schufaDate = v))}
          />
          <Text
            label="Mietzahlungs-Nachweis"
            value={a.paymentHistory}
            onChange={(v) => edit((d) => void (d.applicant.paymentHistory = v))}
            hint="z. B. 07/2024 bis 07/2026"
          />
          <Text
            label="Wunsch-Einzugsdatum"
            value={a.moveInDate}
            onChange={(v) => edit((d) => void (d.applicant.moveInDate = v))}
          />
        </div>
        <div className="checks">
          <Check
            label="Nichtraucher"
            value={a.nonSmoker}
            onChange={(v) => edit((d) => void (d.applicant.nonSmoker = v))}
          />
          <Check
            label="Haustiere"
            value={a.hasPets}
            onChange={(v) => edit((d) => void (d.applicant.hasPets = v))}
          />
          <Check
            label="Einpersonenhaushalt"
            value={a.singleHousehold}
            onChange={(v) => edit((d) => void (d.applicant.singleHousehold = v))}
          />
        </div>
      </section>

      {/* ---------------- Situation / Wording ---------------- */}
      <section className="settings__section">
        <h3>Situation &amp; Formulierungen</h3>
        <div className="grid">
          <Area
            label="Umzugsgrund — nah (LMU)"
            value={si.framingClause.lmu}
            onChange={(v) => edit((d) => void (d.situation.framingClause.lmu = v))}
            hint="Wird nur genutzt, wenn die Wohnung innerhalb der LMU-Distanz liegt"
          />
          <Area
            label="Umzugsgrund — allgemein"
            value={si.framingClause.neutral}
            onChange={(v) => edit((d) => void (d.situation.framingClause.neutral = v))}
            rows={2}
          />
          <Area
            label="Langfristigkeits-Satz"
            value={si.longTermNote}
            onChange={(v) => edit((d) => void (d.situation.longTermNote = v))}
            rows={2}
          />
          <Area
            label="Inhalt der Bewerbermappe"
            value={si.mappeContents}
            onChange={(v) => edit((d) => void (d.situation.mappeContents = v))}
            rows={2}
          />
          <Text
            label="Vorlauf für Besichtigung"
            value={si.viewing.leadTime}
            onChange={(v) => edit((d) => void (d.situation.viewing.leadTime = v))}
            hint="Formuliert, z. B. „etwa eine Woche Vorlauf“"
            wide
          />
        </div>
        <div className="checks">
          <Check
            label="Ich reise für eine Besichtigung an"
            value={si.viewing.willTravel}
            onChange={(v) => edit((d) => void (d.situation.viewing.willTravel = v))}
          />
          <Check
            label="Videoanruf vorab anbieten"
            value={si.viewing.offerVideoCall}
            onChange={(v) => edit((d) => void (d.situation.viewing.offerVideoCall = v))}
          />
        </div>
      </section>

      {/* ---------------- Interest tiers ---------------- */}
      <section className="settings__section">
        <h3>Interesse-Stufen</h3>
        <p className="settings__note">
          Je höher das Interesse an einer Wohnung, desto entgegenkommender die Nachricht. Der
          Tonfall steuert den ersten Satz, die Sätze werden zusätzlich eingefügt.
        </p>
        <div className="grid">
          <Num
            label="Standard-Interesse (1–10)"
            value={si.interest.default}
            onChange={(v) => edit((d) => void (d.situation.interest.default = Math.max(1, Math.min(10, v ?? 5))))}
          />
        </div>
        {si.interest.tiers.map((t, idx) => (
          <div className="tier" key={idx}>
            <div className="grid">
              <Num
                label="ab Stufe"
                value={t.from}
                onChange={(v) => edit((d) => void (d.situation.interest.tiers[idx].from = v ?? 1))}
              />
              <Text
                label="Bezeichnung"
                value={t.label}
                onChange={(v) => edit((d) => void (d.situation.interest.tiers[idx].label = v))}
              />
              <Text
                label="Tonfall"
                value={t.tone}
                onChange={(v) => edit((d) => void (d.situation.interest.tiers[idx].tone = v))}
                wide
              />
            </div>
            <Area
              label="Zusätzliche Sätze (einer pro Zeile)"
              value={t.sentences.join("\n")}
              onChange={(v) =>
                edit(
                  (d) =>
                    void (d.situation.interest.tiers[idx].sentences = v
                      .split("\n")
                      .map((x) => x.trim())
                      .filter(Boolean))
                )
              }
              rows={3}
            />
          </div>
        ))}
      </section>

      {/* ---------------- Search ---------------- */}
      <section className="settings__section">
        <h3>Suche</h3>
        <div className="grid">
          <Text label="Stadt" value={se.city.name} onChange={(v) => edit((d) => void (d.search.city.name = v))} />
          <Text label="PLZ (Kleinanzeigen)" value={se.city.zip} onChange={(v) => edit((d) => void (d.search.city.zip = v))} />
          <Num label="Breitengrad" step="0.0001" value={se.city.lat} onChange={(v) => edit((d) => void (d.search.city.lat = v ?? 0))} />
          <Num label="Längengrad" step="0.0001" value={se.city.lon} onChange={(v) => edit((d) => void (d.search.city.lon = v ?? 0))} />
          <Num label="Radius (km)" value={se.radiusKm} onChange={(v) => edit((d) => void (d.search.radiusKm = v ?? 0))} />
          <Num
            label="Max. Warmmiete (€)"
            value={se.criteria.maxWarmmiete}
            onChange={(v) => edit((d) => void (d.search.criteria.maxWarmmiete = v))}
          />
          <Num
            label="Min. Wohnfläche (m²)"
            value={se.criteria.minWohnflaeche}
            onChange={(v) => edit((d) => void (d.search.criteria.minWohnflaeche = v))}
          />
          <Num
            label="Max. Wohnfläche (m²)"
            value={se.criteria.maxWohnflaeche}
            onChange={(v) => edit((d) => void (d.search.criteria.maxWohnflaeche = v))}
          />
          <Num
            label="Min. Zimmer"
            step="0.5"
            value={se.criteria.minZimmer}
            onChange={(v) => edit((d) => void (d.search.criteria.minZimmer = v))}
          />
          <Num
            label="Max. Zimmer"
            step="0.5"
            value={se.criteria.maxZimmer}
            onChange={(v) => edit((d) => void (d.search.criteria.maxZimmer = v))}
          />
          <Num
            label="Max. Kaution (€)"
            value={se.criteria.maxKaution}
            onChange={(v) => edit((d) => void (d.search.criteria.maxKaution = v))}
          />
          <Num
            label="LMU-Bezug bis (km)"
            value={se.framing.lmuMaxKm}
            onChange={(v) => edit((d) => void (d.search.framing.lmuMaxKm = v ?? 0))}
            hint="Weiter weg wird der neutrale Umzugsgrund genutzt"
          />
          <Num
            label="„weiter entfernt“ ab (km)"
            value={se.framing.warnMaxKm}
            onChange={(v) => edit((d) => void (d.search.framing.warnMaxKm = v ?? 0))}
          />
        </div>
        <div className="checks">
          <Check
            label="WBS-Wohnungen ausschließen"
            value={se.criteria.excludeWBS}
            onChange={(v) => edit((d) => void (d.search.criteria.excludeWBS = v))}
          />
          <Check
            label="Tauschwohnungen ausschließen"
            value={se.criteria.excludeTausch}
            onChange={(v) => edit((d) => void (d.search.criteria.excludeTausch = v))}
          />
          <Check
            label="Möbliert ausschließen"
            value={se.criteria.excludeMoebliert}
            onChange={(v) => edit((d) => void (d.search.criteria.excludeMoebliert = v))}
          />
        </div>
      </section>

      {/* ---------------- Sources + ops ---------------- */}
      <section className="settings__section">
        <h3>Quellen &amp; Betrieb</h3>
        <p className="settings__note">
          Diese Werte betreffen vor allem die automatischen Scouts. Änderungen wirken dort erst
          nach einem Trigger.dev-Redeploy.
        </p>
        {(["immoscout", "kleinanzeigen"] as const).map((key) => (
          <div className="tier" key={key}>
            <div className="grid">
              <Text label="Quelle" value={key} onChange={() => {}} />
              <Num
                label="Radius-Override (km)"
                value={draft.sources[key].radiusKm}
                onChange={(v) => edit((d) => void (d.sources[key].radiusKm = v))}
                hint="leer = gemeinsamer Radius"
              />
              <Num
                label="Seiten pro Lauf"
                value={draft.sources[key].maxPages}
                onChange={(v) => edit((d) => void (d.sources[key].maxPages = v ?? 1))}
              />
              <Text
                label="Cron"
                value={draft.operations.cron[key]}
                onChange={(v) => edit((d) => void (d.operations.cron[key] = v))}
              />
            </div>
            <Area
              label="Ausschluss-Stichwörter (einer pro Zeile)"
              value={draft.sources[key].excludeKeywords.join("\n")}
              onChange={(v) =>
                edit(
                  (d) =>
                    void (d.sources[key].excludeKeywords = v
                      .split("\n")
                      .map((x) => x.trim())
                      .filter(Boolean))
                )
              }
              rows={3}
            />
          </div>
        ))}
        <div className="grid">
          <Text
            label="LLM-Modell"
            value={draft.operations.llmModel}
            onChange={(v) => edit((d) => void (d.operations.llmModel = v))}
            hint="Wird von der Umgebungsvariable WOHNUNG_LLM_MODEL überschrieben"
            wide
          />
          <Num
            label="Parallele Abrufe"
            value={draft.operations.concurrency}
            onChange={(v) => edit((d) => void (d.operations.concurrency = v ?? 1))}
          />
          <Text
            label="Bereits-gesehen-Dauer"
            value={draft.operations.seenTtl}
            onChange={(v) => edit((d) => void (d.operations.seenTtl = v))}
          />
        </div>
      </section>
    </div>
  );
}
