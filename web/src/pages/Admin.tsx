import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMeta } from "../api/auth";
import { api, ApiError, errorText } from "../api/client";
import { Loading, useTitle } from "../components/ui";
import type { Settings } from "../../../shared/types";

export function Admin() {
  const meta = useMeta();
  useTitle("Admin", meta.data?.settings.siteName ?? "");
  if (!meta.data) return <Loading />;
  return (
    <div className="wrap narrow">
      <div className="page-head">
        <h1 className="grow">Admin</h1>
        <Link to="/admin/activity" className="btn">Activity log</Link>
        <Link to="/moderation/members" className="btn">Members and roles</Link>
      </div>
      <SettingsForm initial={meta.data.settings} />
    </div>
  );
}

function SettingsForm({ initial }: { initial: Settings }) {
  const qc = useQueryClient();
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/settings", { method: "PUT", body: s });
      await qc.invalidateQueries({ queryKey: ["meta"] });
      setErrs({});
      setMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setErrs(err instanceof ApiError ? err.details : {});
      setMsg({ ok: false, text: errorText(err) });
    }
  };
  const text = (k: "siteName" | "currency" | "locale", label: string) => (
    <label>
      {label}
      <input value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
      {errs[k] && <span className="field-error">{errs[k]}</span>}
    </label>
  );
  const num = (k: "listingDays" | "maxNewEnquiriesPerDay" | "maxListingsPerPrivateSeller", label: string) => (
    <label>
      {label}
      <input type="number" min={1} value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />
      {errs[k] && <span className="field-error">{errs[k]}</span>}
    </label>
  );
  return (
    <form className="card stack" onSubmit={save}>
      <h2>Site settings</h2>
      <div className="form-grid">
        {text("siteName", "Site name")}
        {text("currency", "Currency (e.g. GBP, EUR, USD)")}
        {text("locale", "Locale (e.g. en-GB)")}
        {num("listingDays", "Days a listing stays up")}
        {num("maxListingsPerPrivateSeller", "Cars a private seller may list at once")}
        {num("maxNewEnquiriesPerDay", "New conversations a member may start per day")}
      </div>
      <label className="check">
        <input type="checkbox" checked={s.reviewUnverified} onChange={(e) => setS({ ...s, reviewUnverified: e.target.checked })} /> Moderators check listings from private sellers and unverified dealers before they go live
      </label>
      <p className="muted small">Listings with warning signs (contact details, payment wording, very low prices) are always checked.</p>
      {msg && <div className={`notice ${msg.ok ? "notice-good" : "notice-bad"}`}>{msg.text}</div>}
      <div className="btn-row">
        <button className="btn btn-primary">Save settings</button>
      </div>
    </form>
  );
}
