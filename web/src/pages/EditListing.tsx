import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMeta } from "../api/auth";
import { api, ApiError, errorText } from "../api/client";
import { Loading, Modal, Status, useTitle } from "../components/ui";
import { preparePhoto } from "../lib/images";
import { carTitle, centsToInput, daysLeft, fmtDate, parseMoney } from "../lib/format";
import { submitProblems } from "../../../shared/market";
import { BODIES, FUELS, MAX_PHOTOS, TRANSMISSIONS, listingSchema } from "../../../shared/schemas";
import type { OwnListing, Photo } from "../../../shared/types";

type Form = {
  make: string;
  model: string;
  variant: string;
  year: string;
  mileage: string;
  fuel: string;
  transmission: string;
  body: string;
  colour: string;
  price: string;
  city: string;
  description: string;
};

const blank: Form = { make: "", model: "", variant: "", year: "", mileage: "", fuel: "Petrol", transmission: "Manual", body: "Hatchback", colour: "", price: "", city: "", description: "" };
const fromListing = (l: OwnListing): Form => ({
  make: l.make,
  model: l.model,
  variant: l.variant,
  year: String(l.year),
  mileage: String(l.mileage),
  fuel: l.fuel,
  transmission: l.transmission,
  body: l.body,
  colour: l.colour,
  price: centsToInput(l.priceCents),
  city: l.city,
  description: l.description,
});
const toBody = (f: Form) => ({
  make: f.make,
  model: f.model,
  variant: f.variant,
  year: Number(f.year),
  mileage: Number(f.mileage.replace(/[,\s]/g, "")),
  fuel: f.fuel,
  transmission: f.transmission,
  body: f.body,
  colour: f.colour,
  priceCents: parseMoney(f.price),
  city: f.city,
  description: f.description,
});

export function EditListing() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const q = useQuery({ queryKey: ["own", id], queryFn: () => api<OwnListing>(`/my/listings/${encodeURIComponent(id!)}`), enabled: !isNew, retry: false });
  if (isNew) return <ListingEditor key="new" listing={null} />;
  if (q.isPending) return <Loading />;
  if (q.isError) return <div className="wrap narrow"><div className="notice notice-bad">{errorText(q.error)}</div></div>;
  return <ListingEditor key={q.data.id} listing={q.data} />;
}

function ListingEditor({ listing }: { listing: OwnListing | null }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const meta = useMeta().data;
  const [form, setForm] = useState<Form>(listing ? fromListing(listing) : blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useTitle(listing ? `Edit ${carTitle(listing)}` : "List a car", meta?.settings.siteName ?? "");
  const locked = listing !== null && ["sold", "removed"].includes(listing.status);

  const refresh = (l: OwnListing) => {
    qc.setQueryData(["own", l.id], l);
    void qc.invalidateQueries({ queryKey: ["my-listings"] });
    void qc.invalidateQueries({ queryKey: ["search"] });
    void qc.invalidateQueries({ queryKey: ["car", l.id] });
  };

  const save = useMutation({
    mutationFn: (body: ReturnType<typeof toBody>) =>
      listing ? api<OwnListing & { heldForReview: boolean }>(`/my/listings/${listing.id}`, { method: "PUT", body: { ...body, version: listing.version } }) : api<OwnListing>("/my/listings", { method: "POST", body }),
    onSuccess: (l) => {
      refresh(l);
      if (!listing) nav(`/sell/${l.id}`, { replace: true });
      else setMsg({ ok: true, text: "heldForReview" in l && l.heldForReview ? "Saved. Because of what changed, a moderator will check the listing before it's shown again." : "Saved." });
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.details);
      setMsg({ ok: false, text: errorText(e) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const body = toBody(form);
    const check = listingSchema.safeParse(body);
    if (!check.success) {
      const errs: Record<string, string> = {};
      for (const i of check.error.issues) errs[String(i.path[0])] ??= i.message;
      if (Number.isNaN(body.priceCents)) errs.priceCents = "Enter a price like 8995";
      setErrors(errs);
      setMsg({ ok: false, text: "Please check the highlighted fields." });
      return;
    }
    setErrors({});
    save.mutate(body);
  };

  const field = (k: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, errKey: string = k) => (
    <label>
      {label}
      <input value={form[k]} disabled={locked} aria-invalid={!!errors[errKey]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...props} />
      {errors[errKey] && <span className="field-error">{errors[errKey]}</span>}
    </label>
  );
  const select = (k: keyof Form, label: string, options: readonly string[]) => (
    <label>
      {label}
      <select value={form[k]} disabled={locked} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </label>
  );

  return (
    <div className="wrap narrow">
      <nav className="small"><Link to="/sell">‹ Your listings</Link></nav>
      <div className="page-head">
        <h1 className="grow">{listing ? carTitle(listing) : "List a car"}</h1>
        {listing && <Status value={listing.expired ? "expired" : listing.status} />}
      </div>
      {listing && <StatusPanel listing={listing} onChange={refresh} />}
      <form className="card stack" onSubmit={submit} noValidate>
        <h2>The car</h2>
        <div className="form-grid">
          {field("make", "Make", { placeholder: "e.g. Ford", maxLength: 40, autoComplete: "off" })}
          {field("model", "Model", { placeholder: "e.g. Focus", maxLength: 60, autoComplete: "off" })}
          {field("variant", "Version (optional)", { placeholder: "e.g. 1.0 EcoBoost Titanium", maxLength: 80 })}
          {field("year", "Year", { inputMode: "numeric", maxLength: 4 })}
          {field("mileage", "Mileage", { inputMode: "numeric", maxLength: 9 })}
          {field("colour", "Colour", { maxLength: 40 })}
          {select("fuel", "Fuel", FUELS)}
          {select("transmission", "Gearbox", TRANSMISSIONS)}
          {select("body", "Body", BODIES)}
          {field("city", "Where is the car? (town or city)", { maxLength: 60 })}
          {field("price", `Asking price (${meta?.settings.currency ?? ""})`, { inputMode: "decimal", maxLength: 12 }, "priceCents")}
        </div>
        <label>
          Description
          <textarea rows={7} maxLength={5000} disabled={locked} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <span className="muted small">
            History, condition, extras, anything a buyer should know. Don't include phone numbers, emails or links: buyers message you here, which keeps you safe from scammers. ({form.description.length}/5000)
          </span>
          {errors.description && <span className="field-error">{errors.description}</span>}
        </label>
        {msg && <div className={`notice ${msg.ok ? "notice-good" : "notice-bad"}`} role="status">{msg.text}</div>}
        {!locked && (
          <div className="btn-row">
            <button className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? "Saving…" : listing ? "Save changes" : "Save and add photos"}
            </button>
          </div>
        )}
      </form>
      {listing && <Photos listing={listing} locked={locked} onChange={() => void qc.invalidateQueries({ queryKey: ["own", listing.id] })} />}
    </div>
  );
}

/** What happens next with the listing, and the buttons to move it along. */
function StatusPanel({ listing: l, onChange }: { listing: OwnListing; onChange: (l: OwnListing) => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const days = useMeta().data?.settings.listingDays ?? 60;
  const [confirm, setConfirm] = useState<null | "sold" | "withdraw" | "delete">(null);
  const act = useMutation({
    mutationFn: async (what: "submit" | "sold" | "withdraw" | "renew" | "delete") => {
      if (what === "delete") return api(`/my/listings/${l.id}`, { method: "DELETE" });
      const r = await api<OwnListing | { status: string; listing: OwnListing }>(`/my/listings/${l.id}/${what}`, { method: "POST" });
      return "listing" in r ? r.listing : r;
    },
    onSuccess: (r, what) => {
      setConfirm(null);
      if (what === "delete") {
        void qc.invalidateQueries({ queryKey: ["my-listings"] });
        nav("/sell");
      } else onChange(r as OwnListing);
    },
  });
  const problems = submitProblems({ photoCount: l.photos.length, description: l.description });
  const canSubmit = ["draft", "rejected", "withdrawn"].includes(l.status);
  return (
    <section className="card stack status-panel">
      {l.status === "draft" && <p>This is a draft: only you can see it. When the details and photos are ready, send it to the site.</p>}
      {l.status === "pending" && (
        <p>
          A moderator is checking this listing. It usually takes less than a day.
          {l.flags.length > 0 && <span className="muted small"> (Checking: {l.flags.join("; ")}.)</span>}
        </p>
      )}
      {l.status === "rejected" && (
        <div className="notice">
          <b>A moderator asked for changes:</b> {l.rejectReason}
          <div className="small">Fix the listing below, then send it again.</div>
        </div>
      )}
      {l.status === "live" && !l.expired && (
        <p>
          On the site until {fmtDate(l.expiresAt)} ({daysLeft(l.expiresAt)} days). <Link to={`/cars/${l.id}`}>View listing ›</Link>
        </p>
      )}
      {l.expired && <div className="notice">This listing has expired and doesn't show in search. Renew it to put it back.</div>}
      {l.status === "sold" && <p>Sold. The listing stays visible for 30 days so people who saved it know.</p>}
      {l.status === "removed" && <div className="notice notice-bad"><b>Removed by moderators:</b> {l.rejectReason}</div>}
      {l.status === "withdrawn" && <p>Withdrawn: not on the site. You can put it back at any time.</p>}
      {canSubmit && problems.length > 0 && (
        <ul className="small warn">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      {act.isError && <div className="notice notice-bad">{errorText(act.error)}</div>}
      <div className="btn-row">
        {l.status === "draft" && <button className="btn btn-danger" onClick={() => setConfirm("delete")}>Delete draft</button>}
        {["live", "pending", "rejected"].includes(l.status) && <button className="btn" onClick={() => setConfirm("withdraw")}>Withdraw</button>}
        {["live", "pending", "withdrawn"].includes(l.status) && <button className="btn" onClick={() => setConfirm("sold")}>Mark as sold</button>}
        {l.status === "live" && daysLeft(l.expiresAt) <= 7 && <button className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate("renew")}>Renew for another {days} days</button>}
        {canSubmit && (
          <button className="btn btn-primary" disabled={act.isPending || problems.length > 0} onClick={() => act.mutate("submit")}>
            {l.status === "withdrawn" ? "Put back on the site" : l.status === "rejected" ? "Send again" : "Send to the site"}
          </button>
        )}
      </div>
      {l.status === "live" && (
        <p className="muted small">
          {l.views} views · {l.saves} saves · {l.enquiries} {l.enquiries === 1 ? "conversation" : "conversations"}
        </p>
      )}
      {confirm && (
        <Modal title={confirm === "sold" ? "Mark as sold?" : confirm === "withdraw" ? "Withdraw this listing?" : "Delete this draft?"} onClose={() => setConfirm(null)}>
          <p>
            {confirm === "sold"
              ? "The car comes out of search and buyers who saved it see it's sold. This can't be undone."
              : confirm === "withdraw"
                ? "The car comes off the site. You can put it back later."
                : "The draft and its photos are deleted."}
          </p>
          <div className="btn-row">
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate(confirm)}>
              {confirm === "sold" ? "Mark as sold" : confirm === "withdraw" ? "Withdraw" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function Photos({ listing, locked, onChange }: { listing: OwnListing; locked: boolean; onChange: () => void }) {
  const [photos, setPhotos] = useState<Photo[]>(listing.photos);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const room = MAX_PHOTOS - photos.length;

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, room);
    const errs: string[] = files.length > room ? [`Only ${room} more photo${room === 1 ? "" : "s"} fit, so the rest were skipped.`] : [];
    for (const [i, f] of list.entries()) {
      setBusy(`Uploading ${i + 1} of ${list.length}…`);
      try {
        const { full, thumb } = await preparePhoto(f);
        const p = await api<Photo>(`/my/listings/${listing.id}/photos`, { method: "POST", blob: full });
        await api(`/my/listings/${listing.id}/photos/${p.id}/thumb`, { method: "PUT", blob: thumb }).catch(() => {
          // the full-size photo is used in lists when the small one is missing
        });
        setPhotos((cur) => [...cur, { ...p, thumb: `/api/photos/${p.id}/thumb` }]);
      } catch (e) {
        errs.push(errorText(e));
      }
    }
    setBusy(null);
    setProblems(errs);
    if (input.current) input.current.value = "";
    onChange();
  };

  const move = async (idx: number, d: number) => {
    const next = [...photos];
    [next[idx], next[idx + d]] = [next[idx + d], next[idx]];
    setPhotos(next);
    try {
      const r = await api<{ items: Photo[] }>(`/my/listings/${listing.id}/photos/order`, { method: "PUT", body: { order: next.map((p) => p.id) } });
      setPhotos(r.items);
      onChange();
    } catch (e) {
      setProblems([errorText(e)]);
      setPhotos(photos);
    }
  };

  const remove = async (p: Photo) => {
    try {
      const r = await api<{ items: Photo[] }>(`/my/listings/${listing.id}/photos/${p.id}`, { method: "DELETE" });
      setPhotos(r.items);
      onChange();
    } catch (e) {
      setProblems([errorText(e)]);
    }
  };

  return (
    <section className="card stack">
      <div className="row">
        <h2 className="grow">Photos</h2>
        <span className="muted small">
          {photos.length} of {MAX_PHOTOS}
        </span>
      </div>
      <p className="muted small">The first photo is the one buyers see in search. Outside, in daylight, from the front corner works best.</p>
      <ol className="photo-grid plain">
        {photos.map((p, i) => (
          <li key={p.id}>
            <img src={p.thumb} alt={`Photo ${i + 1}`} />
            {i === 0 && <span className="ribbon">Main</span>}
            {!locked && (
              <div className="photo-tools">
                <button className="btn btn-xs" disabled={i === 0} onClick={() => void move(i, -1)} aria-label={`Move photo ${i + 1} earlier`}>←</button>
                <button className="btn btn-xs" disabled={i === photos.length - 1} onClick={() => void move(i, 1)} aria-label={`Move photo ${i + 1} later`}>→</button>
                <button className="btn btn-xs btn-danger" onClick={() => void remove(p)} aria-label={`Delete photo ${i + 1}`}>✕</button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {problems.length > 0 && (
        <div className="notice notice-bad" role="alert">
          {problems.map((p) => <div key={p}>{p}</div>)}
        </div>
      )}
      {!locked && room > 0 && (
        <label className="upload">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={!!busy} onChange={(e) => void add(e.target.files)} />
          <span className="btn">{busy ?? "＋ Add photos"}</span>
        </label>
      )}
    </section>
  );
}
