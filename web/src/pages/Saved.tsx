import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useMeta } from "../api/auth";
import { api, errorText } from "../api/client";
import { CarCard } from "../components/CarCard";
import { Empty, Loading, useTitle } from "../components/ui";
import { paramsFor } from "../lib/filters";
import { ago } from "../lib/format";
import type { ListingCard, SavedSearch } from "../../../shared/types";

type SavedCar = ListingCard & { status: string; available: boolean };

export function Saved() {
  const site = useMeta().data?.settings.siteName ?? "";
  useTitle("Saved", site);
  const qc = useQueryClient();
  const nav = useNavigate();
  const cars = useQuery({ queryKey: ["saved"], queryFn: () => api<{ items: SavedCar[] }>("/saved") });
  const searches = useQuery({ queryKey: ["searches"], queryFn: () => api<{ items: SavedSearch[] }>("/searches") });
  const open = useMutation({
    mutationFn: (s: SavedSearch) => api(`/searches/${s.id}/seen`, { method: "POST" }),
    onSettled: (_r, _e, s) => {
      void qc.invalidateQueries({ queryKey: ["searches"] });
      void qc.invalidateQueries({ queryKey: ["unread"] });
      const q = paramsFor(s.filters, "newest");
      nav(q ? `/?${q}` : "/");
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/searches/${id}`, { method: "DELETE" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["searches"] });
      void qc.invalidateQueries({ queryKey: ["unread"] });
    },
  });

  return (
    <div className="wrap">
      <h1>Saved</h1>
      <section className="stack">
        <h2>Searches</h2>
        {searches.isPending && <Loading />}
        {searches.isError && <div className="notice notice-bad">{errorText(searches.error)}</div>}
        {searches.data?.items.length === 0 && (
          <p className="muted">
            Save a search from the <Link to="/">search page</Link> and we'll count new matches for you.
          </p>
        )}
        <ul className="plain saved-searches">
          {searches.data?.items.map((s) => (
            <li key={s.id} className="card row">
              <div className="grow">
                <b>{s.name}</b>
                <div className="muted small clip">{s.summary}</div>
              </div>
              {s.newCount > 0 ? <span className="badge badge-brand">{s.newCount} new</span> : <span className="muted small">Checked {ago(s.lastSeenAt)}</span>}
              <button className="btn btn-sm btn-primary" onClick={() => open.mutate(s)}>
                Show cars
              </button>
              <button className="btn btn-sm" aria-label={`Delete ${s.name}`} onClick={() => remove.mutate(s.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="stack">
        <h2>Cars</h2>
        {cars.isPending && <Loading />}
        {cars.data?.items.length === 0 && (
          <Empty title="No saved cars yet">
            <p className="muted">Tap ♡ on any car to keep it here.</p>
          </Empty>
        )}
        <div className="car-grid">
          {cars.data?.items.map((c) => <CarCard key={c.id} car={c} badge={c.status === "sold" ? <span className="ribbon">Sold</span> : undefined} />)}
        </div>
      </section>
    </div>
  );
}
