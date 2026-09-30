import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useMeta } from "../api/auth";
import { api, errorText } from "../api/client";
import { CarCard } from "../components/CarCard";
import { Empty, Loading, useTitle } from "../components/ui";
import { fmtDate } from "../lib/format";
import type { Dealer, ListingCard } from "../../../shared/types";

export function DealerPage() {
  const { slug = "" } = useParams();
  const site = useMeta().data?.settings.siteName ?? "";
  const q = useQuery({ queryKey: ["dealer-page", slug], queryFn: () => api<{ dealer: Dealer; items: ListingCard[] }>(`/dealers/${encodeURIComponent(slug)}`), retry: false });
  useTitle(q.data?.dealer.name ?? "Dealer", site);
  if (q.isPending) return <Loading />;
  if (q.isError) {
    return (
      <div className="wrap narrow">
        <div className="card stack">
          <h1>Dealer not found</h1>
          <p className="muted">{errorText(q.error)}</p>
          <Link to="/" className="btn">Browse cars</Link>
        </div>
      </div>
    );
  }
  const { dealer: d, items } = q.data;
  return (
    <div className="wrap">
      <section className="card stack dealer-head">
        <div className="row">
          <h1>{d.name}</h1>
          {d.verified && <span className="badge badge-good">✔ Verified dealer</span>}
        </div>
        <div className="muted">
          {d.city} · On the site since {fmtDate(d.createdAt)} · {items.length} {items.length === 1 ? "car" : "cars"} for sale
        </div>
        {d.about && <p className="pre">{d.about}</p>}
        <div className="row">
          {d.phone && <a className="btn" href={`tel:${d.phone.replace(/[^\d+]/g, "")}`}>📞 {d.phone}</a>}
          {d.website && (
            <a className="btn" href={d.website} target="_blank" rel="noopener noreferrer nofollow ugc">
              Website ↗
            </a>
          )}
        </div>
      </section>
      {items.length === 0 ? <Empty title="No cars for sale right now" /> : <div className="car-grid">{items.map((c) => <CarCard key={c.id} car={c} />)}</div>}
    </div>
  );
}
