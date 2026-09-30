import { randomUUID } from "node:crypto";
import type { Queryable } from "../db";
import { DEFAULT_SETTINGS, listingRef } from "../../../shared/market";
import type { ListingCard, Photo, Settings } from "../../../shared/types";

export const newId = (prefix: string) => `${prefix}-${randomUUID()}`;

export async function getSettings(c: Queryable): Promise<Settings> {
  const { rows } = await c.query<{ value: Partial<Settings> }>("SELECT value FROM settings WHERE key = 'app'");
  return { ...DEFAULT_SETTINGS, ...(rows[0]?.value ?? {}) };
}

export async function saveSettings(c: Queryable, s: Settings) {
  await c.query("INSERT INTO settings (key, value) VALUES ('app', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [JSON.stringify(s)]);
}

export async function audit(
  c: Queryable,
  e: { userId: string | null; action: string; entity: string; entityId?: string | null; details?: Record<string, unknown>; ip?: string | null },
) {
  await c.query("INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6)", [
    e.userId,
    e.action,
    e.entity,
    e.entityId ?? null,
    JSON.stringify(e.details ?? {}),
    e.ip ?? null,
  ]);
}

export const photo = (id: string | null, hasThumb = true): Photo | null =>
  id ? { id, url: `/api/photos/${id}`, thumb: hasThumb ? `/api/photos/${id}/thumb` : `/api/photos/${id}` } : null;

/**
 * FROM clause for listings with their seller. `l` is the listing, `u` the user who listed it and `d` the dealer.
 * Suspended private sellers and suspended dealers drop out of everything public.
 */
export const LISTING_FROM = `listings l JOIN users u ON u.id = l.user_id LEFT JOIN dealers d ON d.id = l.dealer_id`;
export const SELLER_ACTIVE = `(CASE WHEN l.dealer_id IS NULL THEN u.active ELSE d.active END)`;
/** What anyone may see in search results. */
export const PUBLIC_LIVE = `l.status = 'live' AND l.expires_at > now() AND ${SELLER_ACTIVE}`;

export const CARD_COLUMNS = `l.id, l.number, l.make, l.model, l.variant, l.year, l.mileage, l.fuel, l.transmission, l.body, l.price_cents,
  l.previous_price_cents, l.city, l.published_at, l.dealer_id,
  COALESCE(d.name, u.name) AS seller_name, COALESCE(d.verified, false) AS verified,
  (SELECT p.id FROM photos p WHERE p.listing_id = l.id ORDER BY p.position LIMIT 1) AS photo_id,
  (SELECT p.thumb IS NOT NULL FROM photos p WHERE p.listing_id = l.id ORDER BY p.position LIMIT 1) AS photo_thumb,
  (SELECT count(*)::int FROM photos p WHERE p.listing_id = l.id) AS photo_count`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toCard(r: any): ListingCard {
  return {
    id: r.id,
    ref: listingRef(r.number),
    make: r.make,
    model: r.model,
    variant: r.variant,
    year: r.year,
    mileage: r.mileage,
    fuel: r.fuel,
    transmission: r.transmission,
    body: r.body,
    priceCents: r.price_cents,
    previousPriceCents: r.previous_price_cents,
    city: r.city,
    photo: photo(r.photo_id, r.photo_thumb),
    photoCount: r.photo_count,
    sellerKind: r.dealer_id ? "dealer" : "private",
    sellerName: r.dealer_id ? r.seller_name : firstName(r.seller_name),
    verified: r.verified,
    publishedAt: r.published_at ? (r.published_at as Date).toISOString() : null,
    ...(r.saved === undefined ? {} : { saved: r.saved }),
  };
}

/** Private sellers are shown by first name only. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Photos of a listing, in display order. */
export async function listPhotos(c: Queryable, listingId: string): Promise<Photo[]> {
  const { rows } = await c.query<{ id: string; has_thumb: boolean }>("SELECT id, thumb IS NOT NULL AS has_thumb FROM photos WHERE listing_id = $1 ORDER BY position", [listingId]);
  return rows.map((r) => photo(r.id, r.has_thumb)!);
}
