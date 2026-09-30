import { FILTER_KEYS } from "../../../shared/market";
import type { SearchFilters, Sort } from "../../../shared/schemas";

const NUMERIC = new Set(["minPrice", "maxPrice", "minYear", "maxYear", "maxMileage"]);

/** Filters from a page URL (unknown or malformed values are ignored rather than breaking the page). */
export function filtersFromParams(p: URLSearchParams): SearchFilters {
  const f: Record<string, string | number> = {};
  for (const k of FILTER_KEYS) {
    const v = p.get(k)?.trim();
    if (!v) continue;
    if (NUMERIC.has(k)) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0) f[k] = n;
    } else f[k] = v.slice(0, 100);
  }
  return f as SearchFilters;
}

/** URL query for filters plus sort and page (defaults left out so links stay short). */
export function paramsFor(f: SearchFilters, sort: Sort = "newest", page = 1): string {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = f[k];
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  if (sort !== "newest") p.set("sort", sort);
  if (page > 1) p.set("page", String(page));
  return p.toString();
}

export const PRICE_STEPS = [1000, 2000, 3000, 4000, 5000, 7500, 10000, 12500, 15000, 20000, 25000, 30000, 40000, 50000, 75000].map((n) => n * 100);
export const MILEAGE_STEPS = [10000, 20000, 30000, 40000, 60000, 80000, 100000, 150000];
export const yearSteps = (now = new Date().getFullYear()) => Array.from({ length: 26 }, (_, i) => now - i);
