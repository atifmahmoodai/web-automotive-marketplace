import type { FastifyInstance, FastifyRequest } from "fastify";
import { tx, type Queryable } from "../db";
import { conflict, HttpError, notFound, parse, requireUser } from "../http";
import { audit, CARD_COLUMNS, firstName, getSettings, iso, LISTING_FROM, newId, photo, PUBLIC_LIVE, SELLER_ACTIVE, toCard } from "../repo/data";
import { canManage, MANAGES_SQL } from "../repo/listings";
import { searchWhere } from "../repo/search";
import { cleanFilters, describeFilters } from "../../../shared/market";
import { isStaff, messageSchema, reportSchema, savedSearchSchema, type SearchFilters, type SessionUser } from "../../../shared/schemas";
import type { Message, SavedSearch, ThreadSummary, Unread } from "../../../shared/types";

const MAX_SAVED_SEARCHES = 20;
/** Open reports from this many different members take a listing off the site until a moderator looks. */
export const AUTO_HOLD_REPORTS = 3;

export async function memberRoutes(app: FastifyInstance) {
  const member = requireUser();
  const me = (req: FastifyRequest): SessionUser => req.session!.user;

  // ---------- favourites ----------

  app.get("/saved", { preHandler: member }, async (req) => {
    const { rows } = await app.db.query(
      `SELECT ${CARD_COLUMNS}, true AS saved, l.status, (${PUBLIC_LIVE}) AS available
         FROM favourites fv JOIN ${LISTING_FROM} ON l.id = fv.listing_id
        WHERE fv.user_id = $1 AND (${PUBLIC_LIVE} OR (l.status = 'sold' AND ${SELLER_ACTIVE}))
        ORDER BY fv.created_at DESC LIMIT 200`,
      [me(req).id],
    );
    return { items: rows.map((r) => ({ ...toCard(r), status: r.status, available: r.available })) };
  });

  app.put<{ Params: { listingId: string } }>("/saved/:listingId", { preHandler: member }, async (req) => {
    const ok = await app.db.query(`SELECT 1 FROM ${LISTING_FROM} WHERE l.id = $1 AND ${PUBLIC_LIVE}`, [req.params.listingId]);
    if (!ok.rowCount) throw notFound("This listing isn't available.");
    await app.db.query("INSERT INTO favourites (user_id, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [me(req).id, req.params.listingId]);
    return { saved: true };
  });

  app.delete<{ Params: { listingId: string } }>("/saved/:listingId", { preHandler: member }, async (req) => {
    await app.db.query("DELETE FROM favourites WHERE user_id = $1 AND listing_id = $2", [me(req).id, req.params.listingId]);
    return { saved: false };
  });

  // ---------- saved searches ----------

  const newMatches = async (c: Queryable, filters: SearchFilters, since: Date) => {
    const params: unknown[] = [];
    const where = searchWhere(filters, params);
    params.push(since);
    return (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${LISTING_FROM} WHERE ${where} AND l.published_at > $${params.length}`, params)).rows[0].n;
  };

  const loadSearches = async (userId: string): Promise<SavedSearch[]> => {
    const settings = await getSettings(app.db);
    const money = new Intl.NumberFormat(settings.locale, { style: "currency", currency: settings.currency, maximumFractionDigits: 0 });
    const { rows } = await app.db.query<{ id: string; name: string; filters: SearchFilters; last_seen_at: Date; created_at: Date }>(
      "SELECT id, name, filters, last_seen_at, created_at FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        filters: r.filters,
        summary: describeFilters(r.filters, (c) => money.format(c / 100)),
        newCount: await newMatches(app.db, r.filters, r.last_seen_at),
        lastSeenAt: iso(r.last_seen_at)!,
        createdAt: iso(r.created_at)!,
      })),
    );
  };

  app.get("/searches", { preHandler: member }, async (req) => ({ items: await loadSearches(me(req).id) }));

  app.post("/searches", { preHandler: member }, async (req, reply) => {
    const s = parse(savedSearchSchema, req.body);
    const u = me(req);
    const id = newId("ss");
    await tx(app.db, async (c) => {
      // Serialises one member's saves so two quick clicks can't pass the limit together.
      await c.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [u.id]);
      const n = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM saved_searches WHERE user_id = $1", [u.id])).rows[0].n;
      if (n >= MAX_SAVED_SEARCHES) throw conflict(`You can keep up to ${MAX_SAVED_SEARCHES} saved searches. Delete one first.`);
      await c.query("INSERT INTO saved_searches (id, user_id, name, filters) VALUES ($1, $2, $3, $4)", [id, u.id, s.name, JSON.stringify(cleanFilters(s.filters))]);
    });
    return reply.status(201).send({ id });
  });

  /** "I've looked at the new matches": they stop counting as new. */
  app.post<{ Params: { id: string } }>("/searches/:id/seen", { preHandler: member }, async (req) => {
    const r = await app.db.query("UPDATE saved_searches SET last_seen_at = now() WHERE id = $1 AND user_id = $2", [req.params.id, me(req).id]);
    if (!r.rowCount) throw notFound("Saved search not found");
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/searches/:id", { preHandler: member }, async (req) => {
    const r = await app.db.query("DELETE FROM saved_searches WHERE id = $1 AND user_id = $2", [req.params.id, me(req).id]);
    if (!r.rowCount) throw notFound("Saved search not found");
    return { ok: true };
  });

  // ---------- messages ----------

  const threadsQuery = (extra = "") => `
    SELECT ${extra} t.id, t.listing_id, t.buyer_id, t.last_message_at, t.buyer_read_at, t.seller_read_at,
           l.make, l.model, l.year, l.status, l.price_cents, l.user_id, l.dealer_id,
           COALESCE(d.name, u.name) AS seller_name, b.name AS buyer_name,
           (SELECT p.id FROM photos p WHERE p.listing_id = l.id ORDER BY p.position LIMIT 1) AS photo_id,
           (SELECT m.body FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body
      FROM threads t JOIN ${LISTING_FROM} ON l.id = t.listing_id JOIN users b ON b.id = t.buyer_id`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toThread = (r: any, u: SessionUser, unread: number): ThreadSummary => {
    const role = r.buyer_id === u.id ? "buyer" : "seller";
    return {
      id: r.id,
      listingId: r.listing_id,
      listingTitle: `${r.year} ${r.make} ${r.model}`,
      listingStatus: r.status,
      photo: photo(r.photo_id),
      priceCents: r.price_cents,
      otherName: role === "buyer" ? (r.dealer_id ? r.seller_name : firstName(r.seller_name)) : r.buyer_name,
      role,
      lastBody: (r.last_body ?? "").slice(0, 140),
      lastAt: iso(r.last_message_at)!,
      unread,
    };
  };

  const THREADS = threadsQuery();
  const UNREAD = `(SELECT count(*)::int FROM messages m WHERE m.thread_id = t.id AND
      CASE WHEN t.buyer_id = $1 THEN m.sender_id <> t.buyer_id AND m.created_at > t.buyer_read_at
           ELSE m.sender_id = t.buyer_id AND m.created_at > t.seller_read_at END)`;
  const MINE = `(t.buyer_id = $1 OR ${MANAGES_SQL})`;

  app.get("/threads", { preHandler: member }, async (req) => {
    const u = me(req);
    const { rows } = await app.db.query(`${threadsQuery(`${UNREAD} AS unread,`)} WHERE ${MINE} ORDER BY t.last_message_at DESC LIMIT 200`, [u.id, u.dealerId]);
    return { items: rows.map((r) => toThread(r, u, r.unread)) };
  });

  const loadThread = async (c: Queryable, u: SessionUser, id: string) => {
    const { rows } = await c.query(`${THREADS} WHERE t.id = $3 AND ${MINE}`, [u.id, u.dealerId, id]);
    if (!rows[0]) throw notFound("Conversation not found");
    return rows[0];
  };

  const messagesOf = async (c: Queryable, u: SessionUser, threadId: string): Promise<Message[]> => {
    const { rows } = await c.query<{ id: string; body: string; sender_id: string; sender_name: string; created_at: Date }>(
      `SELECT m.id, m.body, m.sender_id, s.name AS sender_name, m.created_at FROM messages m JOIN users s ON s.id = m.sender_id
        WHERE m.thread_id = $1 ORDER BY m.created_at, m.id LIMIT 1000`,
      [threadId],
    );
    return rows.map((r) => ({ id: r.id, body: r.body, mine: r.sender_id === u.id, senderName: r.sender_name, createdAt: iso(r.created_at)! }));
  };

  const markRead = (c: Queryable, t: { id: string; buyer_id: string }, u: SessionUser) =>
    c.query(`UPDATE threads SET ${t.buyer_id === u.id ? "buyer_read_at" : "seller_read_at"} = now() WHERE id = $1`, [t.id]);

  app.get<{ Params: { id: string } }>("/threads/:id", { preHandler: member }, async (req) => {
    const u = me(req);
    const t = await loadThread(app.db, u, req.params.id);
    await markRead(app.db, t, u);
    return { thread: toThread(t, u, 0), messages: await messagesOf(app.db, u, t.id) };
  });

  const addMessage = async (c: Queryable, threadId: string, senderId: string, body: string) => {
    await c.query("INSERT INTO messages (id, thread_id, sender_id, body) VALUES ($1, $2, $3, $4)", [newId("m"), threadId, senderId, body]);
    await c.query("UPDATE threads SET last_message_at = now() WHERE id = $1", [threadId]);
  };

  /** A buyer's message about a listing: starts the conversation, or adds to the one they already have. */
  app.post<{ Params: { id: string } }>("/listings/:id/messages", { preHandler: member, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { body } = parse(messageSchema, req.body);
    const u = me(req);
    const settings = await getSettings(app.db);
    const threadId = await tx(app.db, async (c) => {
      const { rows } = await c.query(`SELECT l.id, l.user_id, l.dealer_id FROM ${LISTING_FROM} WHERE l.id = $1 AND ${PUBLIC_LIVE}`, [req.params.id]);
      const l = rows[0];
      if (!l) throw notFound("This listing isn't available any more.");
      if (canManage(u, l)) throw conflict("This is your own listing.");
      const existing = await c.query<{ id: string }>("SELECT id FROM threads WHERE listing_id = $1 AND buyer_id = $2", [l.id, u.id]);
      let id = existing.rows[0]?.id;
      if (!id) {
        await c.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [u.id]);
        const today = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM threads WHERE buyer_id = $1 AND created_at > now() - interval '24 hours'", [u.id])).rows[0].n;
        if (today >= settings.maxNewEnquiriesPerDay) throw new HttpError(429, "You've contacted a lot of sellers today. Please try again tomorrow.", "enquiry_limit");
        id = newId("t");
        await c.query("INSERT INTO threads (id, listing_id, buyer_id) VALUES ($1, $2, $3)", [id, l.id, u.id]);
      }
      await addMessage(c, id, u.id, body);
      await c.query("UPDATE threads SET buyer_read_at = now() WHERE id = $1", [id]);
      return id;
    });
    return reply.status(201).send({ threadId });
  });

  app.post<{ Params: { id: string } }>("/threads/:id/messages", { preHandler: member, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { body } = parse(messageSchema, req.body);
    const u = me(req);
    await tx(app.db, async (c) => {
      const t = await loadThread(c, u, req.params.id);
      if (t.status === "removed") throw conflict("This listing was removed by a moderator, so the conversation is closed.");
      await addMessage(c, t.id, u.id, body);
      await markRead(c, t, u);
    });
    return reply.status(201).send({ ok: true });
  });

  // ---------- reports ----------

  app.post<{ Params: { id: string } }>("/listings/:id/report", { preHandler: member, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const r = parse(reportSchema, req.body);
    const u = me(req);
    const held = await tx(app.db, async (c) => {
      const { rows } = await c.query(`SELECT l.id, l.user_id, l.dealer_id, l.status, COALESCE(d.verified, false) AS verified FROM ${LISTING_FROM} WHERE l.id = $1 AND ${PUBLIC_LIVE} FOR UPDATE OF l`, [
        req.params.id,
      ]);
      const l = rows[0];
      if (!l) throw notFound("This listing isn't available.");
      if (canManage(u, l)) throw conflict("You can't report your own listing.");
      const ins = await c.query("INSERT INTO reports (id, listing_id, reporter_id, reason, note) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING", [newId("r"), l.id, u.id, r.reason, r.note]);
      if (!ins.rowCount) throw conflict("You've already reported this listing. A moderator will look at it.");
      await audit(c, { userId: u.id, action: "listing.report", entity: "listing", entityId: l.id, details: { reason: r.reason }, ip: req.ip });
      const open = (await c.query<{ n: number }>("SELECT count(DISTINCT reporter_id)::int AS n FROM reports WHERE listing_id = $1 AND status = 'open'", [l.id])).rows[0].n;
      if (open >= AUTO_HOLD_REPORTS && !l.verified) {
        await c.query("UPDATE listings SET status = 'pending', flags = $2, version = version + 1, updated_at = now() WHERE id = $1", [
          l.id,
          JSON.stringify([`Reported by ${open} members`]),
        ]);
        await audit(c, { userId: null, action: "listing.auto_hold", entity: "listing", entityId: l.id, details: { reports: open } });
        return true;
      }
      return false;
    });
    return reply.status(201).send({ ok: true, held });
  });

  // ---------- badges ----------

  app.get("/unread", { preHandler: member }, async (req): Promise<Unread> => {
    const u = me(req);
    const [msgs, searches] = await Promise.all([
      app.db.query<{ n: number }>(`SELECT COALESCE(sum(${UNREAD}), 0)::int AS n FROM threads t JOIN ${LISTING_FROM} ON l.id = t.listing_id WHERE ${MINE}`, [u.id, u.dealerId]),
      loadSearches(u.id),
    ]);
    let reviewQueue = 0;
    let openReports = 0;
    if (isStaff(u.role)) {
      const r = await app.db.query<{ q: number; rep: number }>(
        "SELECT (SELECT count(*)::int FROM listings WHERE status = 'pending') AS q, (SELECT count(*)::int FROM reports WHERE status = 'open') AS rep",
      );
      reviewQueue = r.rows[0].q;
      openReports = r.rows[0].rep;
    }
    return { messages: msgs.rows[0].n, savedSearchMatches: searches.reduce((a, s) => a + s.newCount, 0), reviewQueue, openReports };
  });
}
