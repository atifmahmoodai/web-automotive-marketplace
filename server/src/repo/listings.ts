import type { Queryable } from "../db";
import { HttpError, notFound } from "../http";
import { median, reviewFlags } from "../../../shared/market";
import type { SessionUser } from "../../../shared/schemas";
import type { Settings } from "../../../shared/types";

export interface ListingRow {
  id: string;
  user_id: string;
  dealer_id: string | null;
  status: string;
  make: string;
  model: string;
  year: number;
  price_cents: number;
  description: string;
  published_at: Date | null;
  expires_at: Date | null;
  version: number;
  dealer_verified: boolean | null;
}

/**
 * A dealer listing belongs to whoever is on the dealer's team now (not to the person who typed it in,
 * who may have left); a private listing belongs to its seller.
 */
export const canManage = (me: SessionUser, l: { user_id: string; dealer_id: string | null }) => (l.dealer_id === null ? l.user_id === me.id : l.dealer_id === me.dealerId);
/** The same rule in SQL, with $1 = user id and $2 = dealer id. */
export const MANAGES_SQL = "((l.dealer_id IS NULL AND l.user_id = $1) OR (l.dealer_id IS NOT NULL AND l.dealer_id = $2))";

/** Loads a listing the signed-in member may manage, locking it when `forUpdate`. */
export async function loadOwn(c: Queryable, me: SessionUser, id: string, forUpdate = false): Promise<ListingRow> {
  const { rows } = await c.query<ListingRow>(
    `SELECT l.id, l.user_id, l.dealer_id, l.status, l.make, l.model, l.year, l.price_cents, l.description, l.published_at, l.expires_at, l.version,
            d.verified AS dealer_verified
       FROM listings l LEFT JOIN dealers d ON d.id = l.dealer_id WHERE l.id = $1 ${forUpdate ? "FOR UPDATE OF l" : ""}`,
    [id],
  );
  const l = rows[0];
  if (!l || !canManage(me, l)) throw notFound("Listing not found");
  return l;
}

/** Median asking price of comparable live cars, or null when there are fewer than five to compare with. */
export async function comparableMedian(c: Queryable, l: { id: string; make: string; model: string; year: number }): Promise<number | null> {
  const { rows } = await c.query<{ price_cents: number }>(
    `SELECT price_cents FROM listings
      WHERE status = 'live' AND id <> $1 AND lower(make) = lower($2) AND lower(model) = lower($3) AND year BETWEEN $4 - 2 AND $4 + 2
      LIMIT 500`,
    [l.id, l.make, l.model, l.year],
  );
  return rows.length >= 5 ? median(rows.map((r) => r.price_cents)) : null;
}

export async function photoCount(c: Queryable, listingId: string): Promise<number> {
  return (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM photos WHERE listing_id = $1", [listingId])).rows[0].n;
}

export async function flagsFor(c: Queryable, l: ListingRow): Promise<string[]> {
  return reviewFlags({ description: l.description, priceCents: l.price_cents, medianCents: await comparableMedian(c, l), photoCount: await photoCount(c, l.id) });
}

/** Unverified sellers wait for a moderator (when the site is set up that way); flagged listings always do. */
export const needsReview = (s: Settings, l: ListingRow, flags: string[]) => flags.length > 0 || (s.reviewUnverified && !l.dealer_verified);

/** Moves a listing onto the site: new listings get a fresh publish date; an expired one gets a new expiry. */
export async function goLive(c: Queryable, id: string, s: Settings) {
  await c.query(
    `UPDATE listings SET status = 'live', flags = '[]', moderation_note = NULL,
            published_at = COALESCE(published_at, now()),
            expires_at = CASE WHEN expires_at IS NULL OR expires_at < now() THEN now() + make_interval(days => $2) ELSE expires_at END,
            version = version + 1, updated_at = now()
      WHERE id = $1`,
    [id, s.listingDays],
  );
}

/** Private sellers may only have a few listings on the site or waiting at once. */
export async function checkPrivateCap(c: Queryable, s: Settings, l: ListingRow) {
  if (l.dealer_id) return;
  // Serialises one seller's submissions so two at once can't both pass the limit.
  await c.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [l.user_id]);
  const { rows } = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM listings
      WHERE user_id = $1 AND dealer_id IS NULL AND id <> $2 AND (status = 'pending' OR (status = 'live' AND expires_at > now()))`,
    [l.user_id, l.id],
  );
  if (rows[0].n >= s.maxListingsPerPrivateSeller) {
    throw new HttpError(409, `Private sellers can have ${s.maxListingsPerPrivateSeller} cars listed at once. Mark one as sold or withdraw it first, or open a dealer account.`, "limit");
  }
}
