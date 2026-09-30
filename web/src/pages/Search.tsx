import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMe, useMeta } from "../api/auth";
import { api, errorText } from "../api/client";
import { CarCard } from "../components/CarCard";
import { Empty, Modal, Pager, useTitle } from "../components/ui";
import { filtersFromParams, MILEAGE_STEPS, paramsFor, PRICE_STEPS, yearSteps } from "../lib/filters";
import { fmtNum, fmtPrice } from "../lib/format";
import { describeFilters } from "../../../shared/market";
import { BODIES, FUELS, SORTS, TRANSMISSIONS, type SearchFilters, type Sort } from "../../../shared/schemas";
import type { SearchResult } from "../../../shared/types";

const SORT_LABEL: Record<Sort, string> = { newest: "Newest first", price_asc: "Price: low to high", price_desc: "Price: high to low", mileage: "Lowest mileage", year_desc: "Newest cars" };

export function Search() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const me = useMe();
  const site = useMeta().data?.settings.siteName ?? "";
  const filters = filtersFromParams(params);
  const sort = (SORTS as readonly string[]).includes(params.get("sort") ?? "") ? (params.get("sort") as Sort) : "newest";
  const page = Math.min(100, Math.max(1, Number(params.get("page")) || 1));
  const qs = paramsFor(filters, sort, page);
  const results = useQuery({
    queryKey: ["search", qs],
    queryFn: ({ signal }) => api<SearchResult>(`/listings${qs ? `?${qs}` : ""}`, { signal }),
    placeholderData: keepPreviousData,
  });
  const [showFilters, setShowFilters] = useState(false);
  const [saving, setSaving] = useState(false);
  const summary = describeFilters(filters, fmtPrice);
  useTitle(summary === "All cars" ? "Used cars for sale" : summary, site);

  const go = (f: SearchFilters, s: Sort = sort) => {
    const q = paramsFor(f, s, 1);
    nav(q ? `/?${q}` : "/");
  };
  const r = results.data;

  return (
    <div className="wrap search-page">
      <div className="search-head">
        <div>
          <h1>{summary === "All cars" ? "Used cars for sale" : summary}</h1>
          <p className="muted" aria-live="polite">
            {r ? `${fmtNum(r.total)} ${r.total === 1 ? "car" : "cars"}` : "Searching…"}
          </p>
        </div>
        <span className="spacer" />
        <button className="btn show-narrow" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} aria-controls="filters">
          Filters{Object.keys(filters).length ? ` (${Object.keys(filters).length})` : ""}
        </button>
        <label className="sort">
          <span className="hide-narrow">Sort</span>
          <select aria-label="Sort" value={sort} onChange={(e) => go(filters, e.target.value as Sort)}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={() => (me.data ? setSaving(true) : nav(`/login?next=${encodeURIComponent(`/?${qs}`)}`))}>
          ♡ <span className="hide-narrow">Save search</span>
          <span className="show-narrow-inline">Save</span>
        </button>
      </div>
      <div className="search-layout">
        <Filters key={qs} filters={filters} makes={r?.makes ?? []} onApply={go} open={showFilters} />
        <section aria-label="Results" className="stack">
          {results.isError && <div className="notice notice-bad">{errorText(results.error)}</div>}
          {r && r.items.length === 0 && (
            <Empty title="No cars match">
              <p className="muted">Try widening the price range or removing a filter.</p>
              <Link to="/" className="btn">Clear all filters</Link>
            </Empty>
          )}
          <div className={`car-grid ${results.isPlaceholderData ? "stale" : ""}`}>
            {r?.items.map((c) => <CarCard key={c.id} car={c} />)}
          </div>
          {r && <Pager page={r.page} pages={r.pages} href={(p) => `/?${paramsFor(filters, sort, p)}`} />}
        </section>
      </div>
      {saving && <SaveSearch filters={filters} suggested={summary} onClose={() => setSaving(false)} />}
    </div>
  );
}

function Filters({ filters, makes, onApply, open }: { filters: SearchFilters; makes: { make: string; n: number }[]; onApply: (f: SearchFilters) => void; open: boolean }) {
  const [f, setF] = useState<SearchFilters>(filters);
  const models = useQuery({
    queryKey: ["models", f.make ?? ""],
    queryFn: () => api<{ items: { model: string; n: number }[] }>(`/listings/models?make=${encodeURIComponent(f.make ?? "")}`),
    enabled: !!f.make,
    staleTime: 60_000,
  });
  const set = <K extends keyof SearchFilters>(k: K, v: SearchFilters[K] | "") => setF((cur) => ({ ...cur, [k]: v === "" ? undefined : v }));
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onApply(f);
  };
  // The make list comes from live cars; keep the chosen one even if it has none right now.
  const makeOptions = f.make && !makes.some((m) => m.make.toLowerCase() === f.make!.toLowerCase()) ? [{ make: f.make, n: 0 }, ...makes] : makes;
  return (
    <form id="filters" className={`card filters-panel stack ${open ? "open" : ""}`} onSubmit={submit} aria-label="Filters">
      <label>
        Keywords
        <input type="search" value={f.q ?? ""} placeholder="e.g. GTI, estate, red" maxLength={100} onChange={(e) => set("q", e.target.value)} />
      </label>
      <label>
        Make
        <select value={f.make ?? ""} onChange={(e) => setF({ ...f, make: e.target.value || undefined, model: undefined })}>
          <option value="">Any make</option>
          {makeOptions.map((m) => (
            <option key={m.make} value={m.make}>
              {m.make} ({m.n})
            </option>
          ))}
        </select>
      </label>
      <label>
        Model
        <select value={f.model ?? ""} disabled={!f.make} onChange={(e) => set("model", e.target.value)}>
          <option value="">Any model</option>
          {f.model && !models.data?.items.some((m) => m.model.toLowerCase() === f.model!.toLowerCase()) && <option value={f.model}>{f.model}</option>}
          {models.data?.items.map((m) => (
            <option key={m.model} value={m.model}>
              {m.model} ({m.n})
            </option>
          ))}
        </select>
      </label>
      <div className="pair">
        <label>
          Min price
          <select value={f.minPrice ?? ""} onChange={(e) => set("minPrice", num(e.target.value))}>
            <option value="">No min</option>
            {PRICE_STEPS.map((p) => <option key={p} value={p}>{fmtPrice(p)}</option>)}
          </select>
        </label>
        <label>
          Max price
          <select value={f.maxPrice ?? ""} onChange={(e) => set("maxPrice", num(e.target.value))}>
            <option value="">No max</option>
            {PRICE_STEPS.map((p) => <option key={p} value={p}>{fmtPrice(p)}</option>)}
          </select>
        </label>
      </div>
      <div className="pair">
        <label>
          Year from
          <select value={f.minYear ?? ""} onChange={(e) => set("minYear", num(e.target.value))}>
            <option value="">Any</option>
            {yearSteps().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>
          Year to
          <select value={f.maxYear ?? ""} onChange={(e) => set("maxYear", num(e.target.value))}>
            <option value="">Any</option>
            {yearSteps().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <label>
        Max mileage
        <select value={f.maxMileage ?? ""} onChange={(e) => set("maxMileage", num(e.target.value))}>
          <option value="">Any</option>
          {MILEAGE_STEPS.map((m) => <option key={m} value={m}>Up to {fmtNum(m)}</option>)}
        </select>
      </label>
      <label>
        Fuel
        <select value={f.fuel ?? ""} onChange={(e) => set("fuel", e.target.value as SearchFilters["fuel"])}>
          <option value="">Any</option>
          {FUELS.map((x) => <option key={x}>{x}</option>)}
        </select>
      </label>
      <label>
        Gearbox
        <select value={f.transmission ?? ""} onChange={(e) => set("transmission", e.target.value as SearchFilters["transmission"])}>
          <option value="">Any</option>
          {TRANSMISSIONS.map((x) => <option key={x}>{x}</option>)}
        </select>
      </label>
      <label>
        Body
        <select value={f.body ?? ""} onChange={(e) => set("body", e.target.value as SearchFilters["body"])}>
          <option value="">Any</option>
          {BODIES.map((x) => <option key={x}>{x}</option>)}
        </select>
      </label>
      <label>
        Town or city
        <input value={f.city ?? ""} maxLength={60} onChange={(e) => set("city", e.target.value)} />
      </label>
      <label>
        Seller
        <select value={f.seller ?? ""} onChange={(e) => set("seller", e.target.value as SearchFilters["seller"])}>
          <option value="">Dealers and private</option>
          <option value="dealer">Dealers only</option>
          <option value="private">Private sellers only</option>
        </select>
      </label>
      <div className="btn-row">
        <Link to="/" className="btn">Clear</Link>
        <button className="btn btn-primary">Show cars</button>
      </div>
    </form>
  );
}

function SaveSearch({ filters, suggested, onClose }: { filters: SearchFilters; suggested: string; onClose: () => void }) {
  const [name, setName] = useState(suggested.slice(0, 80));
  const save = useMutation({ mutationFn: () => api("/searches", { method: "POST", body: { name, filters } }) });
  useEffect(() => {
    if (save.isSuccess) {
      const t = setTimeout(onClose, 1200);
      return () => clearTimeout(t);
    }
  }, [save.isSuccess, onClose]);
  return (
    <Modal title="Save this search" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="muted">We'll show you how many new cars match whenever you open the app.</p>
        <label>
          Name
          <input value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
        </label>
        {save.isError && <div className="field-error">{errorText(save.error)}</div>}
        {save.isSuccess && <div className="notice notice-good">Saved. Find it under Saved.</div>}
        <div className="btn-row">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={save.isPending || save.isSuccess}>Save search</button>
        </div>
      </form>
    </Modal>
  );
}
