import type { FastifyInstance } from "fastify";
import { LISTING_FROM, PUBLIC_LIVE } from "../repo/data";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** robots.txt and a sitemap of every live listing and dealer page, for search engines. */
export async function siteRoutes(app: FastifyInstance) {
  const origin = new URL(app.config.PUBLIC_URL).origin;

  app.get("/robots.txt", async (_req, reply) =>
    reply
      .type("text/plain")
      .header("cache-control", "public, max-age=3600")
      // The pages are rendered in the browser from the public API, so crawlers may read those parts of it.
      .send(`User-agent: *\nAllow: /api/listings\nAllow: /api/photos/\nAllow: /api/meta\nAllow: /api/dealers/\nDisallow: /api/\nDisallow: /sell\nDisallow: /saved\nDisallow: /messages\nDisallow: /account\nDisallow: /moderation\nDisallow: /admin\nSitemap: ${origin}/sitemap.xml\n`),
  );

  app.get("/sitemap.xml", async (_req, reply) => {
    const [cars, dealers] = await Promise.all([
      app.db.query<{ id: string; updated_at: Date }>(`SELECT l.id, l.updated_at FROM ${LISTING_FROM} WHERE ${PUBLIC_LIVE} ORDER BY l.published_at DESC LIMIT 45000`),
      app.db.query<{ slug: string; updated_at: Date }>("SELECT slug, updated_at FROM dealers WHERE active ORDER BY slug LIMIT 5000"),
    ]);
    const url = (loc: string, mod?: Date) => `  <url><loc>${xml(origin + loc)}</loc>${mod ? `<lastmod>${mod.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`;
    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      url("/"),
      ...cars.rows.map((c) => url(`/cars/${encodeURIComponent(c.id)}`, c.updated_at)),
      ...dealers.rows.map((d) => url(`/dealers/${encodeURIComponent(d.slug)}`, d.updated_at)),
      "</urlset>",
      "",
    ].join("\n");
    return reply.type("application/xml").header("cache-control", "public, max-age=900").send(body);
  });
}
