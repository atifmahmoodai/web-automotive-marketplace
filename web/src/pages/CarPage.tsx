import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { staff, useMe, useMeta } from "../api/auth";
import { api, ApiError, errorText } from "../api/client";
import { SaveButton } from "../components/CarCard";
import { Loading, Modal, Status, useTitle } from "../components/ui";
import { carTitle, fmtDate, fmtMiles, fmtPrice, REPORT_REASON_LABEL } from "../lib/format";
import { REPORT_REASONS } from "../../../shared/schemas";
import type { ListingDetail, Photo } from "../../../shared/types";

export function CarPage() {
  const { id = "" } = useParams();
  const me = useMe();
  const site = useMeta().data?.settings.siteName ?? "";
  const car = useQuery({ queryKey: ["car", id], queryFn: () => api<ListingDetail>(`/listings/${encodeURIComponent(id)}`), retry: false });
  const [reporting, setReporting] = useState(false);
  const [removing, setRemoving] = useState(false);
  useTitle(car.data ? `${carTitle(car.data)} for ${fmtPrice(car.data.priceCents)}` : "Car", site);

  if (car.isPending) return <Loading />;
  if (car.isError) {
    return (
      <div className="wrap narrow">
        <div className="card stack">
          <h1>{car.error instanceof ApiError && car.error.status === 404 ? "This car isn't available" : "Something went wrong"}</h1>
          <p className="muted">{errorText(car.error)}</p>
          <Link to="/" className="btn btn-primary">Browse other cars</Link>
        </div>
      </div>
    );
  }
  const c = car.data;
  const specs: [string, string][] = [
    ["Year", String(c.year)],
    ["Mileage", fmtMiles(c.mileage)],
    ["Fuel", c.fuel],
    ["Gearbox", c.transmission],
    ["Body", c.body],
    ["Colour", c.colour || "—"],
    ["Location", c.city],
    ["Reference", c.ref],
  ];

  return (
    <div className="wrap car-page">
      <nav className="small">
        <Link to="/">‹ All cars</Link> · <Link to={`/?make=${encodeURIComponent(c.make)}`}>{c.make}</Link> ·{" "}
        <Link to={`/?make=${encodeURIComponent(c.make)}&model=${encodeURIComponent(c.model)}`}>{c.model}</Link>
      </nav>
      {(c.mine || c.status !== "live") && (
        <div className={`notice ${c.status === "live" ? "notice-good" : ""}`}>
          {c.status === "sold" ? "This car has been sold." : c.mine ? <>This is your listing. <Status value={c.status} /> </> : <>Status: <Status value={c.status} /> </>}
          {c.mine && <Link to={`/sell/${c.id}`}> Edit listing ›</Link>}
        </div>
      )}
      <div className="car-layout">
        <div className="stack">
          <div className="order-gallery">
            <Gallery photos={c.photos} title={carTitle(c)} />
          </div>
          <section className="card stack">
            <h2>Key facts</h2>
            <dl className="facts">
              {specs.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="card stack">
            <h2>Description</h2>
            <p className="pre">{c.description || "The seller hasn't written a description."}</p>
          </section>
        </div>
        <aside className="stack car-side">
          <section className="card stack order-price">
            <div>
              <h1 className="car-title">{carTitle(c)}</h1>
              <div className="muted">{c.variant}</div>
            </div>
            <div className="price price-lg">
              {fmtPrice(c.priceCents)}
              {c.previousPriceCents !== null && c.previousPriceCents > c.priceCents && (
                <span className="was">
                  was {fmtPrice(c.previousPriceCents)} · <b className="good">{fmtPrice(c.previousPriceCents - c.priceCents)} less</b>
                </span>
              )}
            </div>
            <div className="row">
              {c.status === "live" && !c.mine && <SaveButton id={c.id} saved={!!c.saved && !!me.data} large />}
              <ShareButton title={`${carTitle(c)} – ${fmtPrice(c.priceCents)}`} />
            </div>
          </section>
          <SellerCard car={c} />
          {c.status === "live" && !c.mine && <ContactForm car={c} />}
          <section className="card small stack safety">
            <b>Buy safely</b>
            <span>See the car in person before paying anything, and never send a deposit to hold a car you haven't seen. Keep messages on {site}.</span>
            <Link to="/safety">More safety tips</Link>
          </section>
          <div className="row small">
            {c.status === "live" && !c.mine && me.data && (
              <button className="linklike" onClick={() => setReporting(true)}>
                ⚑ Report this listing
              </button>
            )}
            {staff(me.data) && c.status !== "removed" && (
              <button className="btn btn-sm btn-danger" onClick={() => setRemoving(true)}>
                Remove listing
              </button>
            )}
          </div>
        </aside>
      </div>
      {reporting && <ReportForm id={c.id} onClose={() => setReporting(false)} />}
      {removing && <RemoveForm id={c.id} onClose={() => setRemoving(false)} />}
    </div>
  );
}

function Gallery({ photos, title }: { photos: Photo[]; title: string }) {
  const [i, setI] = useState(0);
  if (!photos.length) return <div className="gallery-main no-photo">No photos</div>;
  const n = photos.length;
  const at = Math.min(i, n - 1);
  const go = (d: number) => setI((at + d + n) % n);
  return (
    <div
      className="gallery"
      tabIndex={0}
      aria-roledescription="carousel"
      aria-label={`Photos of the ${title}`}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
    >
      <div className="gallery-main">
        <img src={photos[at].url} alt={`${title}, photo ${at + 1} of ${n}`} />
        {n > 1 && (
          <>
            <button className="gallery-nav prev" onClick={() => go(-1)} aria-label="Previous photo">‹</button>
            <button className="gallery-nav next" onClick={() => go(1)} aria-label="Next photo">›</button>
            <span className="photo-count">{at + 1} / {n}</span>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="gallery-thumbs">
          {photos.map((p, k) => (
            <button key={p.id} className={k === at ? "on" : ""} onClick={() => setI(k)} aria-label={`Photo ${k + 1}`} aria-current={k === at}>
              <img src={p.thumb} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // the person closed the share sheet
    }
  };
  return (
    <button className="btn" onClick={() => void share()}>
      {copied ? "Link copied" : "Share"}
    </button>
  );
}

function SellerCard({ car }: { car: ListingDetail }) {
  const s = car.seller;
  return (
    <section className="card stack seller-card order-seller">
      <div className="muted small">{s.kind === "dealer" ? "Dealer" : "Private seller"}</div>
      <div>
        <b>{s.dealerSlug ? <Link to={`/dealers/${s.dealerSlug}`}>{s.name}</Link> : s.name}</b>
        {s.verified && <span className="badge badge-good" title="Checked by our team"> ✔ Verified dealer</span>}
      </div>
      <div className="small">
        {s.city} · {s.kind === "dealer" ? "Trading" : "Member"} since {fmtDate(s.memberSince)}
      </div>
      {s.phone && (
        <a className="btn" href={`tel:${s.phone.replace(/[^\d+]/g, "")}`}>
          📞 {s.phone}
        </a>
      )}
      {s.dealerSlug && <Link to={`/dealers/${s.dealerSlug}`} className="small">See all cars from this dealer ›</Link>}
    </section>
  );
}

function ContactForm({ car }: { car: ListingDetail }) {
  const me = useMe();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const [body, setBody] = useState("Hi, is this car still available? I'd like to arrange a viewing.");
  const send = useMutation({
    mutationFn: () => api<{ threadId: string }>(`/listings/${car.id}/messages`, { method: "POST", body: { body } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["threads"] });
      nav(`/messages/${r.threadId}`);
    },
  });
  if (!me.data) {
    return (
      <section className="card stack order-contact">
        <h2>Contact the seller</h2>
        <p className="muted small">Sign in or join free to message the seller. Your email stays private.</p>
        <Link className="btn btn-primary" to={`/login?next=${encodeURIComponent(loc.pathname)}`}>Sign in to message</Link>
      </section>
    );
  }
  return (
    <form
      className="card stack order-contact"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <h2>Message the seller</h2>
      <label>
        Your message
        <textarea rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} required />
      </label>
      {send.isError && <div className="field-error">{errorText(send.error)}</div>}
      <button className="btn btn-primary" disabled={send.isPending || !body.trim()}>
        {send.isPending ? "Sending…" : "Send message"}
      </button>
      <span className="muted small">Your email address isn't shared. Replies arrive in Messages.</span>
    </form>
  );
}

function ReportForm({ id, onClose }: { id: string; onClose: () => void }) {
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>("scam");
  const [note, setNote] = useState("");
  const send = useMutation({ mutationFn: () => api(`/listings/${id}/report`, { method: "POST", body: { reason, note } }) });
  return (
    <Modal title="Report this listing" onClose={onClose}>
      {send.isSuccess ? (
        <>
          <div className="notice notice-good">Thanks. A moderator will look at it.</div>
          <div className="btn-row"><button className="btn" onClick={onClose}>Close</button></div>
        </>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <fieldset>
            <legend>What's wrong?</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r} className="check">
                <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} /> {REPORT_REASON_LABEL[r]}
              </label>
            ))}
          </fieldset>
          <label>
            Anything else we should know? (optional)
            <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {send.isError && <div className="field-error">{errorText(send.error)}</div>}
          <div className="btn-row">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={send.isPending}>Send report</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function RemoveForm({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const remove = useMutation({
    mutationFn: () => api(`/mod/listings/${id}/remove`, { method: "POST", body: { reason } }),
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <Modal title="Remove this listing" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          remove.mutate();
        }}
      >
        <p className="muted small">The listing comes off the site for good and the seller sees your reason. Open reports on it are closed.</p>
        <label>
          Reason
          <textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
        {remove.isError && <div className="field-error">{errorText(remove.error)}</div>}
        <div className="btn-row">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-danger-fill" disabled={remove.isPending}>Remove</button>
        </div>
      </form>
    </Modal>
  );
}

