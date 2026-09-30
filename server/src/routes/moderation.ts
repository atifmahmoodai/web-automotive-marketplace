import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { tx, type Queryable } from "../db";
import { conflict, notFound, parse, requireUser } from "../http";
import { audit, getSettings, iso, listPhotos, toCard, CARD_COLUMNS, LISTING_FROM } from "../repo/data";
import { goLive } from "../repo/listings";
import { toDealer } from "./dealers";
import { reasonSchema, reportResolveSchema, reviewSchema } from "../../../shared/schemas";
import type { Report } from "../../../shared/types";

const dealerModSchema = z.object({ verified: z.boolean(), active: z.boolean() });

export async function moderationRoutes(app: FastifyInstance) {
  const staff = requireUser("moderator", "admin");
  const uid = (req: FastifyRequest) => req.session!.user.id;

  const closeReports = (c: Queryable, listingId: string, status: "dismissed" | "actioned", by: string, note: string) =>
    c.query("UPDATE reports SET status = $2, resolved_by = $3, resolved_at = now(), resolution_note = $4 WHERE listing_id = $1 AND status = 'open'", [listingId, status, by, note]);

  /** Listings waiting for a decision, oldest first, with what the moderator needs to judge them. */
  app.get("/mod/queue", { preHandler: staff }, async () => {
    const { rows } = await app.db.query(
      `SELECT ${CARD_COLUMNS}, l.colour, l.description, l.flags, l.updated_at, l.status,
              u.name AS user_name, u.email AS user_email, u.created_at AS user_since, d.name AS dealer_name,
              (SELECT count(*)::int FROM listings o WHERE o.user_id = l.user_id AND o.status IN ('live', 'sold')) AS seller_live,
              (SELECT count(*)::int FROM listings o WHERE o.user_id = l.user_id AND o.status IN ('rejected', 'removed')) AS seller_rejected,
              (SELECT count(*)::int FROM reports r WHERE r.listing_id = l.id AND r.status = 'open') AS open_reports
         FROM ${LISTING_FROM} WHERE l.status = 'pending' ORDER BY l.updated_at LIMIT 100`,
    );
    const items = await Promise.all(
      rows.map(async (r) => ({
        ...toCard(r),
        colour: r.colour,
        description: r.description,
        flags: r.flags as string[],
        photos: await listPhotos(app.db, r.id),
        waitingSince: iso(r.updated_at),
        seller: { name: r.user_name, email: r.user_email, since: iso(r.user_since), dealerName: r.dealer_name, live: r.seller_live, rejected: r.seller_rejected },
        openReports: r.open_reports,
      })),
    );
    return { items };
  });

  app.post<{ Params: { id: string } }>("/mod/listings/:id/review", { preHandler: staff }, async (req) => {
    const d = parse(reviewSchema, req.body);
    const settings = await getSettings(app.db);
    await tx(app.db, async (c) => {
      const l = (await c.query<{ status: string }>("SELECT status FROM listings WHERE id = $1 FOR UPDATE", [req.params.id])).rows[0];
      if (!l) throw notFound("Listing not found");
      if (l.status !== "pending") throw conflict("Another moderator has already dealt with this listing.");
      if (d.decision === "approve") {
        await goLive(c, req.params.id, settings);
        // Reports that took it off the site have been looked at now.
        await closeReports(c, req.params.id, "dismissed", uid(req), "Listing checked and approved");
      } else {
        await c.query("UPDATE listings SET status = 'rejected', moderation_note = $2, version = version + 1, updated_at = now() WHERE id = $1", [req.params.id, d.reason]);
      }
      await audit(c, { userId: uid(req), action: `listing.${d.decision}`, entity: "listing", entityId: req.params.id, details: d.decision === "reject" ? { reason: d.reason } : {}, ip: req.ip });
    });
    return { ok: true };
  });

  /** Takes a listing down for good (scam, offensive, stolen car). The seller can't put it back. */
  app.post<{ Params: { id: string } }>("/mod/listings/:id/remove", { preHandler: staff }, async (req) => {
    const { reason } = parse(reasonSchema, req.body);
    await tx(app.db, async (c) => {
      const l = (await c.query<{ status: string }>("SELECT status FROM listings WHERE id = $1 FOR UPDATE", [req.params.id])).rows[0];
      if (!l) throw notFound("Listing not found");
      if (l.status === "removed") throw conflict("This listing has already been removed.");
      await c.query("UPDATE listings SET status = 'removed', moderation_note = $2, version = version + 1, updated_at = now() WHERE id = $1", [req.params.id, reason]);
      await closeReports(c, req.params.id, "actioned", uid(req), reason);
      await audit(c, { userId: uid(req), action: "listing.remove", entity: "listing", entityId: req.params.id, details: { reason, from: l.status }, ip: req.ip });
    });
    return { ok: true };
  });

  app.get<{ Querystring: { status?: string } }>("/mod/reports", { preHandler: staff }, async (req) => {
    const status = req.query.status === "closed" ? "closed" : "open";
    const { rows } = await app.db.query(
      `SELECT r.id, r.listing_id, r.reason, r.note, r.status, r.created_at, u.name AS reporter_name,
              l.year || ' ' || l.make || ' ' || l.model AS listing_title, l.status AS listing_status,
              (SELECT count(*)::int FROM reports r2 WHERE r2.listing_id = r.listing_id AND r2.status = 'open') AS open_on_listing
         FROM reports r JOIN users u ON u.id = r.reporter_id JOIN listings l ON l.id = r.listing_id
        WHERE ${status === "open" ? "r.status = 'open'" : "r.status <> 'open'"}
        ORDER BY ${status === "open" ? "r.created_at" : "r.resolved_at DESC"} LIMIT 200`,
    );
    const items: Report[] = rows.map((r) => ({
      id: r.id,
      listingId: r.listing_id,
      listingTitle: r.listing_title,
      listingStatus: r.listing_status,
      reason: r.reason,
      note: r.note,
      reporterName: r.reporter_name,
      status: r.status,
      createdAt: iso(r.created_at)!,
      openOnListing: r.open_on_listing,
    }));
    return { items };
  });

  app.post<{ Params: { id: string } }>("/mod/reports/:id/resolve", { preHandler: staff }, async (req) => {
    const d = parse(reportResolveSchema, req.body);
    await tx(app.db, async (c) => {
      const r = (await c.query<{ listing_id: string; status: string }>("SELECT listing_id, status FROM reports WHERE id = $1 FOR UPDATE", [req.params.id])).rows[0];
      if (!r) throw notFound("Report not found");
      if (r.status !== "open") throw conflict("This report has already been dealt with.");
      if (d.action === "dismiss") {
        await c.query("UPDATE reports SET status = 'dismissed', resolved_by = $2, resolved_at = now(), resolution_note = $3 WHERE id = $1", [req.params.id, uid(req), d.note]);
      } else {
        const note = d.note || "Removed after a report";
        const l = await c.query("UPDATE listings SET status = 'removed', moderation_note = $2, version = version + 1, updated_at = now() WHERE id = $1 AND status <> 'removed'", [r.listing_id, note]);
        await closeReports(c, r.listing_id, "actioned", uid(req), note);
        if (l.rowCount) await audit(c, { userId: uid(req), action: "listing.remove", entity: "listing", entityId: r.listing_id, details: { reason: note, report: req.params.id }, ip: req.ip });
      }
      await audit(c, { userId: uid(req), action: `report.${d.action}`, entity: "report", entityId: req.params.id, ip: req.ip });
    });
    return { ok: true };
  });

  app.get("/mod/dealers", { preHandler: staff }, async () => {
    const { rows } = await app.db.query(
      `SELECT d.*, (SELECT count(*)::int FROM listings l WHERE l.dealer_id = d.id AND l.status = 'live') AS live,
              (SELECT u.email FROM users u WHERE u.dealer_id = d.id AND u.dealer_role = 'owner' LIMIT 1) AS owner_email
         FROM dealers d ORDER BY d.verified, d.created_at DESC LIMIT 500`,
    );
    return { items: rows.map((r) => ({ ...toDealer(r), active: r.active, live: r.live, ownerEmail: r.owner_email })) };
  });

  app.put<{ Params: { id: string } }>("/mod/dealers/:id", { preHandler: staff }, async (req) => {
    const d = parse(dealerModSchema, req.body);
    const r = await app.db.query("UPDATE dealers SET verified = $2, active = $3, updated_at = now() WHERE id = $1", [req.params.id, d.verified, d.active]);
    if (!r.rowCount) throw notFound("Dealer not found");
    await audit(app.db, { userId: uid(req), action: "dealer.moderate", entity: "dealer", entityId: req.params.id, details: d, ip: req.ip });
    return { ok: true };
  });
}
