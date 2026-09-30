import type { FastifyInstance, FastifyRequest } from "fastify";
import { tx } from "../db";
import { badRequest, HttpError, notFound, parse, requireUser } from "../http";
import { audit, getSettings, iso, saveSettings } from "../repo/data";
import { deleteUserSessions } from "../security/sessions";
import { settingsSchema, userUpdateSchema, type Role } from "../../../shared/schemas";
import type { AdminUser, Meta } from "../../../shared/types";

export async function adminRoutes(app: FastifyInstance) {
  const staff = requireUser("moderator", "admin");
  const admin = requireUser("admin");
  const uid = (req: FastifyRequest) => req.session!.user.id;

  /** Site name, currency and limits: public, every page needs them. */
  app.get("/meta", async (): Promise<Meta> => ({ settings: await getSettings(app.db) }));

  app.put("/settings", { preHandler: admin }, async (req) => {
    const s = parse(settingsSchema, req.body);
    try {
      new Intl.NumberFormat(s.locale, { style: "currency", currency: s.currency });
    } catch {
      throw badRequest("That currency / locale combination isn't valid.", { currency: "Not a valid currency" });
    }
    await saveSettings(app.db, s);
    await audit(app.db, { userId: uid(req), action: "settings.update", entity: "settings", entityId: "app", details: s, ip: req.ip });
    return s;
  });

  app.get<{ Querystring: { q?: string } }>("/users", { preHandler: staff }, async (req) => {
    const q = String(req.query.q ?? "").trim().slice(0, 100);
    const { rows } = await app.db.query(
      `SELECT u.id, u.email, u.name, u.role, u.active, (u.locked_until IS NOT NULL AND u.locked_until > now()) AS locked, u.created_at,
              d.name AS dealer_name, (SELECT count(*)::int FROM listings l WHERE l.user_id = u.id) AS listings
         FROM users u LEFT JOIN dealers d ON d.id = u.dealer_id
        WHERE $1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%'
        ORDER BY (u.role <> 'member') DESC, u.created_at DESC LIMIT 100`,
      [q.replace(/[%_\\]/g, "\\$&")],
    );
    const items: AdminUser[] = rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      active: r.active,
      locked: r.locked,
      dealerName: r.dealer_name,
      listings: r.listings,
      createdAt: iso(r.created_at)!,
    }));
    return { items };
  });

  /** Moderators can suspend and restore members; only admins change roles or touch staff accounts. */
  app.put<{ Params: { id: string } }>("/users/:id", { preHandler: staff }, async (req) => {
    const u = parse(userUpdateSchema, req.body);
    const me = req.session!.user;
    if (req.params.id === me.id) throw badRequest("You can't change your own account here.");
    await tx(app.db, async (c) => {
      const cur = (await c.query<{ role: Role; active: boolean }>("SELECT role, active FROM users WHERE id = $1 FOR UPDATE", [req.params.id])).rows[0];
      if (!cur) throw notFound("User not found");
      if (me.role !== "admin" && (cur.role !== "member" || u.role !== cur.role)) throw new HttpError(403, "Only an admin can change staff accounts or roles.", "forbidden");
      await c.query("UPDATE users SET role = $2, active = $3, updated_at = now() WHERE id = $1", [req.params.id, u.role, u.active]);
      if ((await c.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active")).rows[0].n === 0) throw badRequest("There must be at least one active admin.");
      if (!u.active) await deleteUserSessions(c, req.params.id);
      const action = cur.active && !u.active ? "user.suspend" : !cur.active && u.active ? "user.restore" : "user.update";
      await audit(c, { userId: me.id, action, entity: "user", entityId: req.params.id, details: { role: u.role, active: u.active }, ip: req.ip });
    });
    return { ok: true };
  });

  app.get<{ Querystring: { before?: string } }>("/audit", { preHandler: admin }, async (req) => {
    const before = Number(req.query.before) || null;
    const { rows } = await app.db.query(
      `SELECT a.id, a.at, a.action, a.entity, a.entity_id AS "entityId", a.details, a.ip, u.name AS "userName"
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE ($1::bigint IS NULL OR a.id < $1) ORDER BY a.id DESC LIMIT 100`,
      [before],
    );
    return { items: rows, nextBefore: rows.length === 100 ? rows[rows.length - 1].id : null };
  });
}
