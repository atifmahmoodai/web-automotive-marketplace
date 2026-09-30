import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useMe, useMeta } from "../api/auth";
import { api, errorText } from "../api/client";
import { Empty, Loading, Status, useTitle } from "../components/ui";
import { carTitle, fmtNum, fmtPrice } from "../lib/format";
import type { ListingCard } from "../../../shared/types";

type Row = ListingCard & { status: string; expired: boolean; views: number; saves: number; enquiries: number; rejectReason: string | null; createdByName: string };

export function MyListings() {
  const me = useMe().data!;
  const meta = useMeta().data;
  useTitle("Sell", meta?.settings.siteName ?? "");
  const q = useQuery({ queryKey: ["my-listings"], queryFn: () => api<{ items: Row[] }>("/my/listings") });
  const items = q.data?.items ?? [];
  const active = items.filter((i) => ["live", "pending"].includes(i.status) && !i.expired).length;

  return (
    <div className="wrap">
      <div className="page-head">
        <div className="grow">
          <h1>{me.dealerId ? "Dealer stock" : "Your cars for sale"}</h1>
          <p className="muted small">
            {me.dealerId
              ? "Everyone on your dealer team can see and manage these listings."
              : `Private sellers can have ${meta?.settings.maxListingsPerPrivateSeller ?? 3} cars listed at once (${active} now). Selling more? `}
            {!me.dealerId && <Link to="/dealer">Open a dealer account</Link>}
          </p>
        </div>
        {items.length > 0 && (
          <a className="btn" href="/api/my/listings.csv" download>
            Export CSV
          </a>
        )}
        <Link to="/sell/new" className="btn btn-primary">
          ＋ List a car
        </Link>
      </div>
      {q.isPending && <Loading />}
      {q.isError && <div className="notice notice-bad">{errorText(q.error)}</div>}
      {q.data && items.length === 0 && (
        <Empty title="Sell your car">
          <p className="muted">It takes about five minutes: the details, a few photos and a price. Listing is free.</p>
          <Link to="/sell/new" className="btn btn-primary">List a car</Link>
        </Empty>
      )}
      <ul className="plain my-list">
        {items.map((c) => (
          <li key={c.id} className="card my-row">
            <Link to={`/sell/${c.id}`} className="my-photo">
              {c.photo ? <img src={c.photo.thumb} alt="" loading="lazy" /> : <span className="no-photo small">Add photos</span>}
            </Link>
            <div className="stack-sm grow">
              <div className="row-tight">
                <Link to={`/sell/${c.id}`}>
                  <b>{carTitle(c)}</b>
                </Link>
                <Status value={c.expired ? "expired" : c.status} />
              </div>
              <div className="small muted">
                {c.ref} · {fmtPrice(c.priceCents)} · {c.city}
                {me.dealerId && ` · added by ${c.createdByName}`}
              </div>
              {c.status === "rejected" && c.rejectReason && <div className="small warn">Moderator: {c.rejectReason}</div>}
              {c.expired && <div className="small warn">Expired: renew it to show it in search again.</div>}
            </div>
            <dl className="mini-stats">
              <div>
                <dt>Views</dt>
                <dd>{fmtNum(c.views)}</dd>
              </div>
              <div>
                <dt>Saves</dt>
                <dd>{fmtNum(c.saves)}</dd>
              </div>
              <div>
                <dt>Messages</dt>
                <dd>{fmtNum(c.enquiries)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
