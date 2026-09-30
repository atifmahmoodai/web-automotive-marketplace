import type { FastifyInstance, FastifyRequest } from "fastify";
import { tx } from "../db";
import { badRequest, conflict, HttpError, notFound, parse, requireUser } from "../http";
import { audit, getSettings, listPhotos, newId, PUBLIC_LIVE, SELLER_ACTIVE } from "../repo/data";
import { canManage, loadOwn, needsReview } from "../repo/listings";
import { isStaff, MAX_PHOTOS, photoOrderSchema } from "../../../shared/schemas";

/** The real type of an image from its first bytes (the Content-Type header is only a claim). */
export function sniffImage(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

const THUMB_MAX = 400_000;
const EDITABLE = ["draft", "pending", "live", "rejected", "withdrawn"];

/** Upload, order and delete a listing's photos. Bodies are the raw image bytes. */
export async function photoRoutes(app: FastifyInstance) {
  const member = requireUser();
  app.addContentTypeParser(/^image\/(jpeg|png|webp)$/, { parseAs: "buffer", bodyLimit: app.config.MAX_PHOTO_BYTES }, (_req, body, done) => done(null, body));
  const image = (req: FastifyRequest, max: number) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest("Send a JPEG, PNG or WebP image.");
    if (body.length > max) throw new HttpError(413, "That photo is too large.", "too_large");
    const mime = sniffImage(body);
    if (!mime) throw badRequest("That file isn't a JPEG, PNG or WebP image.");
    return { body, mime };
  };

  app.post<{ Params: { id: string } }>("/my/listings/:id/photos", { preHandler: member, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { body, mime } = image(req, app.config.MAX_PHOTO_BYTES);
    const u = req.session!.user;
    const settings = await getSettings(app.db);
    const id = newId("p");
    await tx(app.db, async (c) => {
      const cur = await loadOwn(c, u, req.params.id, true);
      if (!EDITABLE.includes(cur.status)) throw conflict("Photos can't be changed on this listing.");
      const { rows } = await c.query<{ n: number; last: number }>("SELECT count(*)::int AS n, COALESCE(max(position), 0) AS last FROM photos WHERE listing_id = $1", [cur.id]);
      if (rows[0].n >= MAX_PHOTOS) throw conflict(`A listing can have up to ${MAX_PHOTOS} photos.`);
      await c.query("INSERT INTO photos (id, listing_id, position, mime, data, size) VALUES ($1, $2, $3, $4, $5, $6)", [id, cur.id, rows[0].last + 1, mime, body, body.length]);
      // A new photo on an approved listing from a seller who needs review is checked again: photos can carry phone numbers too.
      if (cur.status === "live" && needsReview(settings, cur, [])) {
        await c.query("UPDATE listings SET status = 'pending', flags = $2, version = version + 1, updated_at = now() WHERE id = $1", [cur.id, JSON.stringify(["Photos added after approval"])]);
      }
      await c.query("UPDATE listings SET updated_at = now() WHERE id = $1", [cur.id]);
      await audit(c, { userId: u.id, action: "photo.add", entity: "listing", entityId: cur.id, details: { photoId: id, bytes: body.length }, ip: req.ip });
    });
    return reply.status(201).send({ id, url: `/api/photos/${id}`, thumb: `/api/photos/${id}` });
  });

  /** The small version for search results, made by the browser before upload. */
  app.put<{ Params: { id: string; photoId: string } }>("/my/listings/:id/photos/:photoId/thumb", { preHandler: member, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const { body, mime } = image(req, THUMB_MAX);
    const cur = await loadOwn(app.db, req.session!.user, req.params.id);
    const r = await app.db.query("UPDATE photos SET thumb = $3, thumb_mime = $4 WHERE id = $1 AND listing_id = $2", [req.params.photoId, cur.id, body, mime]);
    if (!r.rowCount) throw notFound("Photo not found");
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>("/my/listings/:id/photos/order", { preHandler: member }, async (req) => {
    const { order } = parse(photoOrderSchema, req.body);
    const u = req.session!.user;
    await tx(app.db, async (c) => {
      const cur = await loadOwn(c, u, req.params.id, true);
      const ids = (await c.query<{ id: string }>("SELECT id FROM photos WHERE listing_id = $1", [cur.id])).rows.map((r) => r.id);
      if (order.length !== ids.length || new Set(order).size !== order.length || !order.every((id) => ids.includes(id))) {
        throw badRequest("The photo order doesn't match this listing's photos. Reload and try again.");
      }
      await c.query("UPDATE photos p SET position = o.pos FROM unnest($2::text[]) WITH ORDINALITY AS o(id, pos) WHERE p.id = o.id AND p.listing_id = $1", [cur.id, order]);
    });
    return { items: await listPhotos(app.db, req.params.id) };
  });

  app.delete<{ Params: { id: string; photoId: string } }>("/my/listings/:id/photos/:photoId", { preHandler: member }, async (req) => {
    const u = req.session!.user;
    await tx(app.db, async (c) => {
      const cur = await loadOwn(c, u, req.params.id, true);
      if (!EDITABLE.includes(cur.status)) throw conflict("Photos can't be changed on this listing.");
      const n = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM photos WHERE listing_id = $1", [cur.id])).rows[0].n;
      if (n <= 1 && ["live", "pending"].includes(cur.status)) throw conflict("A listing on the site needs at least one photo. Add another before removing this one.");
      const r = await c.query("DELETE FROM photos WHERE id = $1 AND listing_id = $2", [req.params.photoId, cur.id]);
      if (!r.rowCount) throw notFound("Photo not found");
      await audit(c, { userId: u.id, action: "photo.delete", entity: "listing", entityId: cur.id, details: { photoId: req.params.photoId }, ip: req.ip });
    });
    return { items: await listPhotos(app.db, req.params.id) };
  });
}

/** Serves photos. Only photos of listings the viewer may see; public ones may be cached by browsers and CDNs for a day. */
export async function publicPhotoRoutes(app: FastifyInstance) {
  const serve = (thumb: boolean) => async (req: FastifyRequest<{ Params: { id: string } }>, reply: import("fastify").FastifyReply) => {
    if (!/^p-[0-9a-f-]{36}$/.test(req.params.id)) throw notFound();
    const { rows } = await app.db.query<{ mime: string; data: Buffer; user_id: string; dealer_id: string | null; public: boolean }>(
      `SELECT ${thumb ? "COALESCE(p.thumb_mime, p.mime)" : "p.mime"} AS mime, ${thumb ? "COALESCE(p.thumb, p.data)" : "p.data"} AS data,
              l.user_id, l.dealer_id, ((${PUBLIC_LIVE}) OR (l.status = 'sold' AND ${SELLER_ACTIVE})) AS public
         FROM photos p JOIN listings l ON l.id = p.listing_id JOIN users u ON u.id = l.user_id LEFT JOIN dealers d ON d.id = l.dealer_id
        WHERE p.id = $1`,
      [req.params.id],
    );
    const r = rows[0];
    const viewer = req.session?.user;
    if (!r || (!r.public && !(viewer && (canManage(viewer, r) || isStaff(viewer.role))))) throw notFound();
    reply.header("cache-control", r.public ? "public, max-age=86400" : "private, max-age=300");
    reply.header("content-disposition", "inline");
    return reply.type(r.mime).send(r.data);
  };
  // Pages show many photos at once, so these get a higher allowance than the API default.
  const config = { rateLimit: { max: 3000, timeWindow: "1 minute" } };
  app.get("/api/photos/:id", { config }, serve(false));
  app.get("/api/photos/:id/thumb", { config }, serve(true));
}
