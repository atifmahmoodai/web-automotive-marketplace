import type { FastifyInstance, FastifyRequest } from "fastify";
import { tx, type Queryable } from "../db";
import { badRequest, conflict, HttpError, notFound, parse, requireUser } from "../http";
import { audit, CARD_COLUMNS, getSettings, iso, LISTING_FROM, listPhotos, newId, PUBLIC_LIVE, SELLER_ACTIVE, toCard } from "../repo/data";
import { canManage, checkPrivateCap, MANAGES_SQL, flagsFor, goLive, loadOwn, needsReview, photoCount } from "../repo/listings";
import { ORDER_BY, PAGE_SIZE, searchWhere } from "../repo/search";
import { toCsv } from "../../../shared/csv";
import { listingRef, submitProblems } from "../../../shared/market";
import { isStaff, listingSchema, listingUpdateSchema, searchQuerySchema, type SessionUser } from "../../../shared/schemas";
import type { ListingDetail, OwnListing, SearchResult } from "../../../shared/types";

export async function listingRoutes(app: FastifyInstance) {
  const member = requireUser();
  const me = (req: FastifyRequest): SessionUser => req.session!.user;

  // ---------- public ----------

  app.get("/listings", async (req): Promise<SearchResult> => {
    const f = parse(searchQuerySchema, req.query);
    const params: unknown[] = [];
    const where = searchWhere(f, params);
    const viewer = req.session?.user.id ?? null;
    params.push(viewer);
    const viewerParam = `$${params.length}`;
    const [items, total, makes] = await Promise.all([
      app.db.query(
        `SELECT ${CARD_COLUMNS}, EXISTS (SELECT 1 FROM favourites fv WHERE fv.listing_id = l.id AND fv.user_id = ${viewerParam}) AS saved
           FROM ${LISTING_FROM} WHERE ${where}
          ORDER BY ${ORDER_BY[f.sort]} LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`,
        params,
      ),
      app.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${LISTING_FROM} WHERE ${where}`, params.slice(0, -1)),
      (() => {
        // Make counts ignore the make/model filter so the list still offers the other makes.
        const p2: unknown[] = [];
        const w2 = searchWhere(f, p2, { skipMake: true });
        return app.db.query<{ make: string; n: number }>(
          `SELECT min(l.make) AS make, count(*)::int AS n FROM ${LISTING_FROM} WHERE ${w2} GROUP BY lower(l.make) ORDER BY 1`,
          p2,
        );
      })(),
    ]);
    const n = total.rows[0].n;
    return { items: items.rows.map(toCard), total: n, page: f.page, pages: Math.max(1, Math.ceil(n / PAGE_SIZE)), makes: makes.rows };
  });

  /** Models of a make that are on the site now (for the search form). */
  app.get<{ Querystring: { make?: string } }>("/listings/models", async (req) => {
    const make = String(req.query.make ?? "").slice(0, 40);
    if (!make) return { items: [] };
    const { rows } = await app.db.query<{ model: string; n: number }>(
      `SELECT min(l.model) AS model, count(*)::int AS n FROM ${LISTING_FROM} WHERE ${PUBLIC_LIVE} AND lower(l.make) = lower($1) GROUP BY lower(l.model) ORDER BY 1`,
      [make],
    );
    return { items: rows };
  });

  app.get<{ Params: { id: string } }>("/listings/:id", async (req): Promise<ListingDetail> => {
    const viewer = req.session?.user ?? null;
    const { rows } = await app.db.query(
      `SELECT ${CARD_COLUMNS}, l.user_id, l.status, l.colour, l.description, l.expires_at, l.sold_at,
              (${PUBLIC_LIVE}) AS public_live, ${SELLER_ACTIVE} AS seller_active,
              d.slug AS dealer_slug, d.phone AS dealer_phone, d.city AS dealer_city, COALESCE(d.created_at, u.created_at) AS member_since,
              EXISTS (SELECT 1 FROM favourites fv WHERE fv.listing_id = l.id AND fv.user_id = $2) AS saved
         FROM ${LISTING_FROM} WHERE l.id = $1`,
      [req.params.id, viewer?.id ?? null],
    );
    const r = rows[0];
    if (!r) throw notFound("This listing doesn't exist.");
    const mine = !!viewer && canManage(viewer, r);
    // Sold cars stay visible for a while so people who saved them see what happened.
    const soldRecently = r.status === "sold" && r.seller_active && r.sold_at && Date.now() - (r.sold_at as Date).getTime() < 30 * 86400_000;
    if (!r.public_live && !soldRecently && !mine && !isStaff(viewer?.role)) throw notFound("This listing isn't available any more.");
    if (r.public_live && !mine) await app.db.query("UPDATE listings SET views = views + 1 WHERE id = $1", [r.id]);
    const card = toCard(r);
    return {
      ...card,
      colour: r.colour,
      description: r.description,
      photos: await listPhotos(app.db, r.id),
      status: r.status,
      mine,
      expiresAt: iso(r.expires_at),
      seller: {
        kind: card.sellerKind,
        name: card.sellerName,
        dealerSlug: r.dealer_slug,
        verified: r.verified,
        city: r.dealer_city ?? r.city,
        phone: r.dealer_phone || null,
        memberSince: iso(r.member_since)!,
      },
    };
  });

  // ---------- the seller's own listings ----------

  const ownQuery = (where: string) =>
    `SELECT ${CARD_COLUMNS}, l.user_id, l.status, l.colour, l.description, l.version, l.flags, l.moderation_note, l.expires_at, l.views, l.updated_at,
            (l.status = 'live' AND l.expires_at <= now()) AS expired, u.name AS created_by,
            (SELECT count(*)::int FROM favourites fv WHERE fv.listing_id = l.id) AS saves,
            (SELECT count(*)::int FROM threads t WHERE t.listing_id = l.id) AS enquiries
       FROM ${LISTING_FROM} WHERE ${where}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toOwn = async (c: Queryable, r: any): Promise<OwnListing> => ({
    ...toCard(r),
    colour: r.colour,
    description: r.description,
    photos: await listPhotos(c, r.id),
    status: r.status,
    version: r.version,
    rejectReason: r.moderation_note,
    flags: r.flags,
    expiresAt: iso(r.expires_at),
    expired: r.expired,
    views: r.views,
    saves: r.saves,
    enquiries: r.enquiries,
    createdByName: r.created_by,
    updatedAt: iso(r.updated_at)!,
  });

  const getOwn = async (c: Queryable, id: string) => {
    const { rows } = await c.query(ownQuery("l.id = $1"), [id]);
    return toOwn(c, rows[0]);
  };

  app.get("/my/listings", { preHandler: member }, async (req) => {
    const u = me(req);
    const { rows } = await app.db.query(
      `${ownQuery(MANAGES_SQL)}
       ORDER BY CASE l.status WHEN 'rejected' THEN 0 WHEN 'draft' THEN 1 WHEN 'pending' THEN 2 WHEN 'live' THEN 3 ELSE 4 END, l.updated_at DESC
       LIMIT 500`,
      [u.id, u.dealerId],
    );
    // One photo lookup per row is fine for a seller's own list; the card already has the first photo.
    return { items: rows.map((r) => ({ ...toCard(r), status: r.status, expired: r.expired, views: r.views, saves: r.saves, enquiries: r.enquiries, rejectReason: r.moderation_note, createdByName: r.created_by })) };
  });

  /** The seller's listings as a spreadsheet (views, saves and enquiries included). */
  app.get("/my/listings.csv", { preHandler: member }, async (req, reply) => {
    const u = me(req);
    const { rows } = await app.db.query(`${ownQuery(MANAGES_SQL)} ORDER BY l.number`, [u.id, u.dealerId]);
    const csv = toCsv(
      ["ref", "status", "make", "model", "variant", "year", "mileage", "fuel", "transmission", "body", "colour", "price", "city", "published", "expires", "views", "saves", "enquiries", "listed_by"],
      rows.map((r) => [
        listingRef(r.number),
        r.expired ? "expired" : r.status,
        r.make,
        r.model,
        r.variant,
        r.year,
        r.mileage,
        r.fuel,
        r.transmission,
        r.body,
        r.colour,
        (r.price_cents / 100).toFixed(2),
        r.city,
        iso(r.published_at)?.slice(0, 10) ?? "",
        iso(r.expires_at)?.slice(0, 10) ?? "",
        r.views,
        r.saves,
        r.enquiries,
        r.created_by,
      ]),
    );
    return reply.type("text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="my-listings.csv"').send(csv);
  });

  app.get<{ Params: { id: string } }>("/my/listings/:id", { preHandler: member }, async (req) => {
    await loadOwn(app.db, me(req), req.params.id);
    return getOwn(app.db, req.params.id);
  });

  app.post("/my/listings", { preHandler: member }, async (req, reply) => {
    const l = parse(listingSchema, req.body);
    const u = me(req);
    const id = newId("l");
    await app.db.query(
      `INSERT INTO listings (id, user_id, dealer_id, make, model, variant, year, mileage, fuel, transmission, body, colour, price_cents, city, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [id, u.id, u.dealerId, l.make, l.model, l.variant, l.year, l.mileage, l.fuel, l.transmission, l.body, l.colour, l.priceCents, l.city, l.description],
    );
    await audit(app.db, { userId: u.id, action: "listing.create", entity: "listing", entityId: id, ip: req.ip });
    return reply.status(201).send(await getOwn(app.db, id));
  });

  app.put<{ Params: { id: string } }>("/my/listings/:id", { preHandler: member }, async (req) => {
    const l = parse(listingUpdateSchema, req.body);
    const u = me(req);
    const result = await tx(app.db, async (c) => {
      const cur = await loadOwn(c, u, req.params.id, true);
      if (["sold", "removed"].includes(cur.status)) throw conflict(cur.status === "sold" ? "This car is marked as sold and can't be changed." : "A moderator removed this listing; it can't be changed.");
      if (cur.version !== l.version) throw conflict("Someone else changed this listing. Reload to see their changes.");
      // Show a price cut to buyers ("was £X"); a rise clears it.
      const onSite = cur.published_at !== null && ["live", "pending"].includes(cur.status);
      const prev = onSite && l.priceCents < cur.price_cents ? cur.price_cents : onSite && l.priceCents > cur.price_cents ? null : undefined;
      await c.query(
        `UPDATE listings SET make = $2, model = $3, variant = $4, year = $5, mileage = $6, fuel = $7, transmission = $8, body = $9, colour = $10,
                price_cents = $11, city = $12, description = $13,
                previous_price_cents = CASE WHEN $14::boolean THEN $15::integer ELSE previous_price_cents END,
                version = version + 1, updated_at = now()
          WHERE id = $1`,
        [cur.id, l.make, l.model, l.variant, l.year, l.mileage, l.fuel, l.transmission, l.body, l.colour, l.priceCents, l.city, l.description, prev !== undefined, prev ?? null],
      );
      // An approved listing edited into something suspicious goes back to the moderators.
      let heldBack = false;
      if (cur.status === "live") {
        const flags = await flagsFor(c, { ...cur, make: l.make, model: l.model, year: l.year, price_cents: l.priceCents, description: l.description });
        if (flags.length) {
          await c.query("UPDATE listings SET status = 'pending', flags = $2 WHERE id = $1", [cur.id, JSON.stringify(flags)]);
          heldBack = true;
        }
      }
      await audit(c, { userId: u.id, action: heldBack ? "listing.update_held" : "listing.update", entity: "listing", entityId: cur.id, details: { priceCents: l.priceCents }, ip: req.ip });
      return heldBack;
    });
    return { ...(await getOwn(app.db, req.params.id)), heldForReview: result };
  });

  /** Sends a draft (or a fixed rejected / withdrawn listing) to the site, via the review queue when needed. */
  app.post<{ Params: { id: string } }>("/my/listings/:id/submit", { preHandler: member }, async (req) => {
    const u = me(req);
    const settings = await getSettings(app.db);
    const status = await tx(app.db, async (c) => {
      const cur = await loadOwn(c, u, req.params.id, true);
      if (!["draft", "rejected", "withdrawn"].includes(cur.status)) throw conflict("This listing has already been submitted.");
      const problems = submitProblems({ photoCount: await photoCount(c, cur.id), description: cur.description });
      if (problems.length) throw new HttpError(400, problems.join(" "), "incomplete");
      await checkPrivateCap(c, settings, cur);
      const flags = await flagsFor(c, cur);
      // A withdrawn car that comes back counts as newly listed.
      if (cur.status === "withdrawn") await c.query("UPDATE listings SET published_at = NULL, expires_at = NULL, previous_price_cents = NULL WHERE id = $1", [cur.id]);
      const next = needsReview(settings, cur, flags) ? "pending" : "live";
      if (next === "pending") {
        await c.query("UPDATE listings SET status = 'pending', flags = $2, moderation_note = NULL, version = version + 1, updated_at = now() WHERE id = $1", [
          cur.id,
          JSON.stringify(flags),
        ]);
      } else {
        await goLive(c, cur.id, settings);
      }
      await audit(c, { userId: u.id, action: "listing.submit", entity: "listing", entityId: cur.id, details: { result: next, flags }, ip: req.ip });
      return next;
    });
    return { status, listing: await getOwn(app.db, req.params.id) };
  });

  const transition = (path: string, from: string[], to: "sold" | "withdrawn", action: string) =>
    app.post<{ Params: { id: string } }>(`/my/listings/:id/${path}`, { preHandler: member }, async (req) => {
      const u = me(req);
      await tx(app.db, async (c) => {
        const cur = await loadOwn(c, u, req.params.id, true);
        if (!from.includes(cur.status)) throw conflict(`A ${cur.status} listing can't be changed like that.`);
        await c.query(`UPDATE listings SET status = $2, sold_at = CASE WHEN $2 = 'sold' THEN now() END, version = version + 1, updated_at = now() WHERE id = $1`, [cur.id, to]);
        await audit(c, { userId: u.id, action, entity: "listing", entityId: cur.id, ip: req.ip });
      });
      return getOwn(app.db, req.params.id);
    });
  transition("sold", ["live", "pending", "withdrawn"], "sold", "listing.sold");
  transition("withdraw", ["live", "pending", "rejected"], "withdrawn", "listing.withdraw");

  /** Keeps a live listing up for another full period. */
  app.post<{ Params: { id: string } }>("/my/listings/:id/renew", { preHandler: member }, async (req) => {
    const u = me(req);
    const settings = await getSettings(app.db);
    await tx(app.db, async (c) => {
      const cur = await loadOwn(c, u, req.params.id, true);
      if (cur.status !== "live") throw conflict("Only listings on the site can be renewed.");
      if (cur.expires_at && cur.expires_at.getTime() - Date.now() > (settings.listingDays - 7) * 86400_000) throw badRequest("This listing was renewed recently.");
      await c.query("UPDATE listings SET expires_at = now() + make_interval(days => $2), version = version + 1, updated_at = now() WHERE id = $1", [cur.id, settings.listingDays]);
      await audit(c, { userId: u.id, action: "listing.renew", entity: "listing", entityId: cur.id, ip: req.ip });
    });
    return getOwn(app.db, req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/my/listings/:id", { preHandler: member }, async (req) => {
    const u = me(req);
    await tx(app.db, async (c) => {
      const cur = await loadOwn(c, u, req.params.id, true);
      if (cur.status !== "draft") throw conflict("Only drafts can be deleted. Withdraw the listing instead.");
      await c.query("DELETE FROM listings WHERE id = $1", [cur.id]);
      await audit(c, { userId: u.id, action: "listing.delete", entity: "listing", entityId: cur.id, ip: req.ip });
    });
    return { ok: true };
  });
}
