import type { SearchFilters, Sort } from "../../../shared/schemas";
import { PUBLIC_LIVE } from "./data";

/** Escapes LIKE wildcards so user text matches literally. */
export const likeEscape = (s: string) => s.replace(/[%_\\]/g, "\\$&");

/**
 * WHERE clause (for `LISTING_FROM`) matching the filters. Values are bound parameters appended to
 * `params`; nothing from the filters is ever spliced into the SQL text.
 */
export function searchWhere(f: SearchFilters, params: unknown[], opts: { skipMake?: boolean } = {}): string {
  const where = [PUBLIC_LIVE];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.q) where.push(`l.search @@ websearch_to_tsquery('simple', ${p(f.q)})`);
  if (f.make && !opts.skipMake) where.push(`lower(l.make) = lower(${p(f.make)})`);
  if (f.model && !opts.skipMake) where.push(`lower(l.model) = lower(${p(f.model)})`);
  if (f.minPrice !== undefined) where.push(`l.price_cents >= ${p(f.minPrice)}`);
  if (f.maxPrice !== undefined) where.push(`l.price_cents <= ${p(f.maxPrice)}`);
  if (f.minYear !== undefined) where.push(`l.year >= ${p(f.minYear)}`);
  if (f.maxYear !== undefined) where.push(`l.year <= ${p(f.maxYear)}`);
  if (f.maxMileage !== undefined) where.push(`l.mileage <= ${p(f.maxMileage)}`);
  if (f.fuel) where.push(`l.fuel = ${p(f.fuel)}`);
  if (f.transmission) where.push(`l.transmission = ${p(f.transmission)}`);
  if (f.body) where.push(`l.body = ${p(f.body)}`);
  if (f.city) where.push(`l.city ILIKE ${p(likeEscape(f.city) + "%")}`);
  if (f.seller === "dealer") where.push("l.dealer_id IS NOT NULL");
  if (f.seller === "private") where.push("l.dealer_id IS NULL");
  return where.join(" AND ");
}

/** Every order ends on the listing id so pages never overlap or skip when prices tie. */
export const ORDER_BY: Record<Sort, string> = {
  newest: "l.published_at DESC, l.id",
  price_asc: "l.price_cents ASC, l.id",
  price_desc: "l.price_cents DESC, l.id",
  mileage: "l.mileage ASC, l.id",
  year_desc: "l.year DESC, l.published_at DESC, l.id",
};

export const PAGE_SIZE = 24;
