import type { FastifyInstance, FastifyRequest } from "fastify";
import { tx } from "../db";
import { badRequest, conflict, HttpError, notFound, parse, requireUser } from "../http";
import { audit, CARD_COLUMNS, iso, LISTING_FROM, newId, PUBLIC_LIVE, toCard } from "../repo/data";
import { dealerSchema, staffAddSchema, type SessionUser } from "../../../shared/schemas";
import type { Dealer } from "../../../shared/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toDealer = (r: any): Dealer => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  phone: r.phone,
  city: r.city,
  about: r.about,
  website: r.website,
  verified: r.verified,
  createdAt: iso(r.created_at)!,
});

/** "Smith & Sons Motors" → "smith-sons-motors". */
export const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "dealer";

export async function dealerRoutes(app: FastifyInstance) {
  const member = requireUser();
  const me = (req: FastifyRequest): SessionUser => req.session!.user;
  const owner = async (req: FastifyRequest) => {
    await member(req);
    if (me(req).dealerRole !== "owner") throw new HttpError(403, "Only the dealer account owner can do that.", "forbidden");
  };

  /** A dealer's public page. */
  app.get<{ Params: { slug: string } }>("/dealers/:slug", async (req) => {
    const d = (await app.db.query("SELECT * FROM dealers WHERE slug = $1 AND active", [req.params.slug])).rows[0];
    if (!d) throw notFound("This dealer isn't on the site.");
    const { rows } = await app.db.query(`SELECT ${CARD_COLUMNS} FROM ${LISTING_FROM} WHERE l.dealer_id = $1 AND ${PUBLIC_LIVE} ORDER BY l.published_at DESC LIMIT 200`, [d.id]);
    return { dealer: toDealer(d), items: rows.map(toCard) };
  });

  app.get("/dealer", { preHandler: member }, async (req) => {
    const u = me(req);
    if (!u.dealerId) return { dealer: null, team: [] };
    const [d, team] = await Promise.all([
      app.db.query("SELECT * FROM dealers WHERE id = $1", [u.dealerId]),
      app.db.query<{ id: string; name: string; email: string; dealer_role: string }>(
        "SELECT id, name, email, dealer_role FROM users WHERE dealer_id = $1 ORDER BY dealer_role, name",
        [u.dealerId],
      ),
    ]);
    return { dealer: toDealer(d.rows[0]), team: team.rows.map((t) => ({ id: t.id, name: t.name, email: t.email, dealerRole: t.dealer_role })) };
  });

  /** Opens a dealer account with the signed-in member as its owner. It starts unverified. */
  app.post("/dealer", { preHandler: member, config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const d = parse(dealerSchema, req.body);
    const u = me(req);
    const id = newId("d");
    await tx(app.db, async (c) => {
      const cur = (await c.query<{ dealer_id: string | null }>("SELECT dealer_id FROM users WHERE id = $1 FOR UPDATE", [u.id])).rows[0];
      if (cur.dealer_id) throw conflict("You're already part of a dealer account.");
      const base = slugify(d.name);
      const taken = new Set((await c.query<{ slug: string }>("SELECT slug FROM dealers WHERE slug = $1 OR slug LIKE $2", [base, `${base}-%`])).rows.map((r) => r.slug));
      let slug = base;
      for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
      await c.query("INSERT INTO dealers (id, slug, name, phone, city, about, website) VALUES ($1, $2, $3, $4, $5, $6, $7)", [id, slug, d.name, d.phone, d.city, d.about, d.website]);
      await c.query("UPDATE users SET dealer_id = $2, dealer_role = 'owner', updated_at = now() WHERE id = $1", [u.id, id]);
      await audit(c, { userId: u.id, action: "dealer.create", entity: "dealer", entityId: id, details: { name: d.name }, ip: req.ip });
    });
    return reply.status(201).send({ id });
  });

  app.put("/dealer", { preHandler: owner }, async (req) => {
    const d = parse(dealerSchema, req.body);
    const u = me(req);
    await app.db.query("UPDATE dealers SET name = $2, phone = $3, city = $4, about = $5, website = $6, updated_at = now() WHERE id = $1", [
      u.dealerId,
      d.name,
      d.phone,
      d.city,
      d.about,
      d.website,
    ]);
    await audit(app.db, { userId: u.id, action: "dealer.update", entity: "dealer", entityId: u.dealerId, ip: req.ip });
    return { ok: true };
  });

  /** Adds an existing member to the team: they can then manage all of the dealer's listings and messages. */
  app.post("/dealer/staff", { preHandler: owner }, async (req) => {
    const { email } = parse(staffAddSchema, req.body);
    const u = me(req);
    await tx(app.db, async (c) => {
      const t = (await c.query<{ id: string; dealer_id: string | null; active: boolean }>("SELECT id, dealer_id, active FROM users WHERE lower(email) = $1 FOR UPDATE", [email])).rows[0];
      if (!t || !t.active) throw badRequest("There's no member with that email. Ask them to sign up first.", { email: "No member with that email" });
      if (t.dealer_id) throw conflict("That member is already part of a dealer account.");
      await c.query("UPDATE users SET dealer_id = $2, dealer_role = 'staff', updated_at = now() WHERE id = $1", [t.id, u.dealerId]);
      await audit(c, { userId: u.id, action: "dealer.staff_add", entity: "dealer", entityId: u.dealerId, details: { userId: t.id }, ip: req.ip });
    });
    return { ok: true };
  });

  app.delete<{ Params: { userId: string } }>("/dealer/staff/:userId", { preHandler: owner }, async (req) => {
    const u = me(req);
    if (req.params.userId === u.id) throw badRequest("The owner can't be removed from the team.");
    const r = await app.db.query("UPDATE users SET dealer_id = NULL, dealer_role = NULL, updated_at = now() WHERE id = $1 AND dealer_id = $2 AND dealer_role = 'staff'", [
      req.params.userId,
      u.dealerId,
    ]);
    if (!r.rowCount) throw notFound("Not on your team");
    await audit(app.db, { userId: u.id, action: "dealer.staff_remove", entity: "dealer", entityId: u.dealerId, details: { userId: req.params.userId }, ip: req.ip });
    return { ok: true };
  });

  app.post("/dealer/leave", { preHandler: member }, async (req) => {
    const u = me(req);
    if (u.dealerRole !== "staff") throw badRequest(u.dealerRole === "owner" ? "The owner can't leave the dealer account." : "You're not part of a dealer account.");
    await app.db.query("UPDATE users SET dealer_id = NULL, dealer_role = NULL, updated_at = now() WHERE id = $1", [u.id]);
    await audit(app.db, { userId: u.id, action: "dealer.leave", entity: "dealer", entityId: u.dealerId, ip: req.ip });
    return { ok: true };
  });
}
