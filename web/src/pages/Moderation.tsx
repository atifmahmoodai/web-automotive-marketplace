import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { isAdmin, useMe, useMeta } from "../api/auth";
import { api, errorText } from "../api/client";
import { Empty, Loading, Modal, Status, useTitle } from "../components/ui";
import { useDebounced } from "../lib/useDebounced";
import { ago, carTitle, fmtDate, fmtMiles, fmtPrice, REPORT_REASON_LABEL } from "../lib/format";
import { ROLES, type Role } from "../../../shared/schemas";
import type { AdminUser, Dealer, ListingCard, Photo, Report } from "../../../shared/types";

interface QueueItem extends ListingCard {
  colour: string;
  description: string;
  flags: string[];
  photos: Photo[];
  waitingSince: string;
  seller: { name: string; email: string; since: string; dealerName: string | null; live: number; rejected: number };
  openReports: number;
}

export function Moderation() {
  const { tab = "queue" } = useParams();
  useTitle("Moderation", useMeta().data?.settings.siteName ?? "");
  return (
    <div className="wrap">
      <h1>Moderation</h1>
      <nav className="tabs" aria-label="Moderation">
        <NavLink to="/moderation" end>Review queue</NavLink>
        <NavLink to="/moderation/reports">Reports</NavLink>
        <NavLink to="/moderation/dealers">Dealers</NavLink>
        <NavLink to="/moderation/members">Members</NavLink>
      </nav>
      {tab === "queue" && <Queue />}
      {tab === "reports" && <Reports />}
      {tab === "dealers" && <Dealers />}
      {tab === "members" && <Members />}
    </div>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["mod"] });
    void qc.invalidateQueries({ queryKey: ["unread"] });
    void qc.invalidateQueries({ queryKey: ["search"] });
  };
}

function Queue() {
  const q = useQuery({ queryKey: ["mod", "queue"], queryFn: () => api<{ items: QueueItem[] }>("/mod/queue") });
  if (q.isPending) return <Loading />;
  if (q.isError) return <div className="notice notice-bad">{errorText(q.error)}</div>;
  if (!q.data.items.length) return <Empty title="Nothing waiting">New listings that need a check appear here.</Empty>;
  return (
    <div className="stack">
      {q.data.items.map((l) => (
        <ReviewCard key={l.id} l={l} />
      ))}
    </div>
  );
}

function ReviewCard({ l }: { l: QueueItem }) {
  const refresh = useRefresh();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const review = useMutation({
    mutationFn: (body: { decision: "approve" } | { decision: "reject"; reason: string }) => api(`/mod/listings/${l.id}/review`, { method: "POST", body }),
    onSuccess: () => {
      setRejecting(false);
      refresh();
    },
  });
  return (
    <article className="card review">
      <div className="review-photos">
        {l.photos.slice(0, 6).map((p) => (
          <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
            <img src={p.thumb} alt="" loading="lazy" />
          </a>
        ))}
        {!l.photos.length && <div className="no-photo">No photos</div>}
      </div>
      <div className="stack-sm">
        <div className="row-tight">
          <h2>
            <Link to={`/cars/${l.id}`}>{carTitle(l)}</Link>
          </h2>
          <span className="muted small">{l.ref} · waiting {ago(l.waitingSince).replace(" ago", "")}</span>
        </div>
        <div>
          <b>{fmtPrice(l.priceCents)}</b> · {fmtMiles(l.mileage)} · {l.fuel} · {l.transmission} · {l.city}
        </div>
        {l.flags.length > 0 && (
          <ul className="flags">
            {l.flags.map((f) => <li key={f}>⚠ {f}</li>)}
          </ul>
        )}
        {l.openReports > 0 && <div className="warn small">{l.openReports} open report(s) — see Reports.</div>}
        <p className="pre small review-text">{l.description || <span className="muted">No description.</span>}</p>
        <div className="small muted">
          Seller: <b>{l.seller.dealerName ?? l.seller.name}</b> {l.seller.dealerName && `(${l.seller.name})`} · {l.seller.email} · joined {fmtDate(l.seller.since)} · {l.seller.live} listed before
          {l.seller.rejected > 0 && <span className="warn"> · {l.seller.rejected} rejected/removed</span>}
        </div>
        {review.isError && <div className="field-error">{errorText(review.error)}</div>}
        <div className="btn-row">
          <button className="btn" onClick={() => setRejecting(true)}>Send back…</button>
          <button className="btn btn-primary" disabled={review.isPending} onClick={() => review.mutate({ decision: "approve" })}>
            Approve
          </button>
        </div>
      </div>
      {rejecting && (
        <Modal title="Send back to the seller" onClose={() => setRejecting(false)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              review.mutate({ decision: "reject", reason });
            }}
          >
            <label>
              What should the seller change?
              <textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} required />
            </label>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => setRejecting(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={review.isPending}>Send back</button>
            </div>
          </form>
        </Modal>
      )}
    </article>
  );
}

function Reports() {
  const [closed, setClosed] = useState(false);
  const refresh = useRefresh();
  const q = useQuery({ queryKey: ["mod", "reports", closed], queryFn: () => api<{ items: Report[] }>(`/mod/reports${closed ? "?status=closed" : ""}`) });
  const resolve = useMutation({
    mutationFn: (v: { id: string; action: "dismiss" | "remove_listing"; note: string }) => api(`/mod/reports/${v.id}/resolve`, { method: "POST", body: { action: v.action, note: v.note } }),
    onSuccess: refresh,
  });
  return (
    <div className="stack">
      <label className="check">
        <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Show dealt-with reports
      </label>
      {q.isPending && <Loading />}
      {q.data?.items.length === 0 && <Empty title={closed ? "No closed reports" : "No open reports"} />}
      {resolve.isError && <div className="notice notice-bad">{errorText(resolve.error)}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Listing</th>
              <th>Reason</th>
              <th>From</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((r) => (
              <tr key={r.id}>
                <td>{ago(r.createdAt)}</td>
                <td>
                  <Link to={`/cars/${r.listingId}`}>{r.listingTitle}</Link> <Status value={r.listingStatus} />
                  {r.openOnListing > 1 && <span className="badge badge-warn">{r.openOnListing} reports</span>}
                </td>
                <td className="wrap-cell">
                  <b>{REPORT_REASON_LABEL[r.reason] ?? r.reason}</b>
                  {r.note && <div className="small muted">{r.note}</div>}
                </td>
                <td>{r.reporterName}</td>
                <td className="r">
                  {r.status === "open" ? (
                    <span className="btn-row">
                      <button className="btn btn-sm" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, action: "dismiss", note: "No problem found" })}>
                        Dismiss
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={resolve.isPending}
                        onClick={() => {
                          const note = window.prompt("Reason shown to the seller", REPORT_REASON_LABEL[r.reason] ?? "");
                          if (note !== null) resolve.mutate({ id: r.id, action: "remove_listing", note });
                        }}
                      >
                        Remove listing
                      </button>
                    </span>
                  ) : (
                    <Status value={r.status === "actioned" ? "removed" : "withdrawn"} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Dealers() {
  const refresh = useRefresh();
  const q = useQuery({ queryKey: ["mod", "dealers"], queryFn: () => api<{ items: (Dealer & { active: boolean; live: number; ownerEmail: string | null })[] }>("/mod/dealers") });
  const set = useMutation({
    mutationFn: (v: { id: string; verified: boolean; active: boolean }) => api(`/mod/dealers/${v.id}`, { method: "PUT", body: { verified: v.verified, active: v.active } }),
    onSuccess: refresh,
  });
  if (q.isPending) return <Loading />;
  return (
    <div className="stack">
      <p className="muted small">Verified dealers' listings skip the review queue (flagged listings are still checked). Suspending a dealer hides all of their cars.</p>
      {set.isError && <div className="notice notice-bad">{errorText(set.error)}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Dealer</th>
              <th>Owner</th>
              <th>Since</th>
              <th className="r">Live cars</th>
              <th>Verified</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link to={`/dealers/${d.slug}`}>{d.name}</Link> <span className="muted small">{d.city}</span>
                </td>
                <td className="small">{d.ownerEmail}</td>
                <td>{fmtDate(d.createdAt)}</td>
                <td className="r">{d.live}</td>
                <td>
                  <label className="switch" aria-label={`${d.name} verified`}>
                    <input type="checkbox" checked={d.verified} onChange={(e) => set.mutate({ id: d.id, verified: e.target.checked, active: d.active })} />
                    <span />
                  </label>
                </td>
                <td>
                  <label className="switch" aria-label={`${d.name} active`}>
                    <input
                      type="checkbox"
                      checked={d.active}
                      onChange={(e) => (e.target.checked || window.confirm(`Suspend ${d.name}? All their cars disappear from the site.`)) && set.mutate({ id: d.id, verified: d.verified, active: e.target.checked })}
                    />
                    <span />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Members() {
  const me = useMe().data;
  const refresh = useRefresh();
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim(), 300);
  const q = useQuery({ queryKey: ["mod", "users", term], queryFn: () => api<{ items: AdminUser[] }>(`/users?q=${encodeURIComponent(term)}`) });
  const set = useMutation({
    mutationFn: (v: { id: string; role: Role; active: boolean }) => api(`/users/${v.id}`, { method: "PUT", body: { role: v.role, active: v.active } }),
    onSuccess: refresh,
  });
  const admin = isAdmin(me);
  return (
    <div className="stack">
      <label>
        Find a member
        <input type="search" value={search} placeholder="Name or email" onChange={(e) => setSearch(e.target.value)} />
      </label>
      <p className="muted small">Suspending a member signs them out and hides their private listings. {admin ? "" : "Only admins can change roles."}</p>
      {set.isError && <div className="notice notice-bad">{errorText(set.error)}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Dealer</th>
              <th className="r">Listings</th>
              <th>Joined</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((u) => {
              const self = u.id === me?.id;
              const canEdit = !self && (admin || u.role === "member");
              return (
                <tr key={u.id} className={u.active ? "" : "muted"}>
                  <td>
                    {u.name} {u.locked && <span className="badge badge-warn">Locked</span>}
                  </td>
                  <td>{u.email}</td>
                  <td>{u.dealerName ?? "—"}</td>
                  <td className="r">{u.listings}</td>
                  <td>{fmtDate(u.createdAt)}</td>
                  <td>
                    {admin && !self ? (
                      <select aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => set.mutate({ id: u.id, role: e.target.value as Role, active: u.active })}>
                        {ROLES.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    ) : (
                      u.role
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <button
                        className={`btn btn-sm ${u.active ? "btn-danger" : ""}`}
                        disabled={set.isPending}
                        onClick={() => (!u.active || window.confirm(`Suspend ${u.name}?`)) && set.mutate({ id: u.id, role: u.role, active: !u.active })}
                      >
                        {u.active ? "Suspend" : "Restore"}
                      </button>
                    ) : u.active ? (
                      "Active"
                    ) : (
                      "Suspended"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
