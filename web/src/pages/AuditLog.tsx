import { useInfiniteQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { isAdmin, useMe } from "../api/auth";
import { api, errorText } from "../api/client";
import { fmtDateTime } from "../lib/format";

interface AuditEntry {
  id: number;
  at: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  userName: string | null;
}

const LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.register": "Joined",
  "auth.password_changed": "Changed password",
  "listing.create": "Started a listing",
  "listing.update": "Edited a listing",
  "listing.update_held": "Edited a listing (held for review)",
  "listing.submit": "Submitted a listing",
  "listing.sold": "Marked a car sold",
  "listing.withdraw": "Withdrew a listing",
  "listing.renew": "Renewed a listing",
  "listing.delete": "Deleted a draft",
  "listing.approve": "Approved a listing",
  "listing.reject": "Sent a listing back",
  "listing.remove": "Removed a listing",
  "listing.report": "Reported a listing",
  "listing.auto_hold": "Listing held after reports",
  "photo.add": "Added a photo",
  "photo.delete": "Deleted a photo",
  "report.dismiss": "Dismissed a report",
  "report.remove_listing": "Acted on a report",
  "dealer.create": "Opened a dealer account",
  "dealer.update": "Edited dealer details",
  "dealer.staff_add": "Added dealer staff",
  "dealer.staff_remove": "Removed dealer staff",
  "dealer.leave": "Left a dealer team",
  "dealer.moderate": "Changed a dealer's status",
  "settings.update": "Changed settings",
  "user.update": "Changed a member's role",
  "user.suspend": "Suspended a member",
  "user.restore": "Restored a member",
};

function summary(e: AuditEntry): string {
  const d = e.details as Record<string, unknown>;
  if (typeof d.reason === "string") return d.reason;
  if (e.action === "listing.submit") return d.result === "live" ? "went live" : "waiting for review";
  if (e.action === "listing.auto_hold") return `${d.reports} reports`;
  if (e.action === "dealer.moderate") return [d.verified ? "verified" : "not verified", d.active ? "active" : "suspended"].join(", ");
  if (e.action === "user.update") return String(d.role ?? "");
  if (e.action === "dealer.create") return String(d.name ?? "");
  return "";
}

/** Who did what, and when. */
export function AuditLog() {
  const me = useMe();
  const q = useInfiniteQuery({
    queryKey: ["audit"],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => api<{ items: AuditEntry[]; nextBefore: number | null }>(`/audit${pageParam ? `?before=${pageParam}` : ""}`),
    getNextPageParam: (last) => last.nextBefore,
    enabled: isAdmin(me.data),
  });
  if (!isAdmin(me.data)) return <Navigate to="/" replace />;
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Activity</h1>
      </div>
      {q.isError && <div className="notice">{errorText(q.error)}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Details</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>{fmtDateTime(e.at)}</td>
                <td>{e.userName ?? <span className="muted">System</span>}</td>
                <td>{LABELS[e.action] ?? e.action}</td>
                <td className="muted">{summary(e)}</td>
                <td className="muted small">{e.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.hasNextPage && (
        <div>
          <button className="btn" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {q.isFetchingNextPage ? "Loading…" : "Show older"}
          </button>
        </div>
      )}
    </div>
  );
}
