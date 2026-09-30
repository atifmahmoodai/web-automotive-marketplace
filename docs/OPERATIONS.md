# Operations guide

## Deploying

The app is one container (`Dockerfile`) that needs a PostgreSQL database. It runs anywhere containers do:

- **A single VPS** (Hetzner, DigitalOcean, Lightsail): use `docker compose up -d --build`, with Caddy or nginx in front for https.
- **A managed platform** (Render, Railway, Fly.io, Cloud Run, App Runner, Azure Container Apps): deploy the image with a managed PostgreSQL database.

Checklist for going live:

1. **Environment:** set `NODE_ENV=production`, and set `PUBLIC_URL` to the exact https address. The sitemap and the CSRF origin check use it.
2. **Proxy:** set `TRUST_PROXY=true` behind a proxy or load balancer that terminates https. Otherwise rate limits and the activity log see the proxy's IP.
3. **Cookies:** leave `COOKIE_SECURE` unset (it's on in production).
4. **First admin:** create it with `node dist/cli/create-admin.js --email … --name …`, then give moderators their role under **Moderation → Members**.
5. **Site settings:** set the name, currency, locale, listing length and limits under **Admin**.
6. **Branding:** replace the icons in `web/public/` (`favicon.svg`, `icon-*.png`, `apple-touch-icon.png`) and the name in `manifest.webmanifest`, then rebuild.
7. **PWA:** a PWA needs https. On http only `localhost` can install it or use the service worker.

Migrations run on start-up under an advisory lock, so several replicas can start at once. To run them as a separate release step, use `node dist/cli/migrate.js`.

```
cars.example.com {
  reverse_proxy app:8080
}
```

## Health, logs and monitoring

- **Health checks:** `GET /healthz` (the process is up) and `GET /readyz` (the database answers). The Docker `HEALTHCHECK` uses `/readyz`.
- **Logs:** one JSON line per request, with a request id that is also returned in `x-request-id`. Cookies and CSRF tokens are redacted.
- **Alerts:** alert on repeated 5xx responses, on `/readyz` failing, and on a growing review queue (the **Moderation** badge shows its size).
- **Activity log:** sign-ups, logins, listing changes, submissions, approvals and rejections, removals, reports, automatic holds, suspensions, dealer verification and settings changes all go to `audit_log`. Admins see it under **Admin → Activity log**.

## Backups and personal data

All data is in PostgreSQL, including photos, so plan for the size: a listing with 12 photos is about 3–4 MB.

```bash
docker compose exec -T db pg_dump -U market -Fc market > backup-$(date +%F).dump
docker compose exec -T db pg_restore -U market -d market --clean < backup-2026-09-30.dump
```

- **Managed databases:** turn on point-in-time recovery.
- **Test restores:** restore a backup to a scratch database regularly.
- **Personal data:** members' names, emails and messages are personal data. Restrict access to backups and decide how long conversations about sold or removed cars are kept.

## Photos

- **How they arrive:** browsers shrink photos to 1600 px (JPEG) with a 480 px thumbnail before uploading. The server accepts JPEG, PNG and WebP, checked by their first bytes, up to `MAX_PHOTO_BYTES` (3 MB by default), with 12 per listing.
- **Caching:** photos of live and recently sold cars are served with `cache-control: public, max-age=86400`, so a CDN in front of `/api/photos/` takes almost all of the load. Photos of hidden listings are only served to the owner and staff.
- **At scale:** move the bytes to object storage (S3, R2, GCS) by changing `routes/photos.ts`: store the object key instead of `data`, and redirect `GET /api/photos/:id` to a signed or public URL. The API shape stays the same.
- **Not stripped:** EXIF data (including GPS) is removed by the browser's re-encoding, but only for uploads made through the web app. Direct API uploads are stored as sent.

## Moderation routines

- **Review queue:** listings wait here, oldest first. A reason given with *Send back* is shown to the seller.
- **Warning signs** always hold a listing, even from verified dealers. The phone-number check is deliberately cautious: a description listing several years of service history ("2018 2019 2020 2021") can trip it, and then a moderator simply approves it.
- **Reports:** three open reports from different members take a listing off the site until a moderator decides. Approving it dismisses those reports. Verified dealers aren't held automatically, but their reports still appear under **Reports**.
- **Suspending:** a member is signed out everywhere and their private cars disappear. A suspended dealer's cars all disappear, but the team can still sign in.
- **Scams:** for anything that looks like fraud, remove the listing *and* suspend the member.

## Limits

| What | Default | Where |
| --- | --- | --- |
| API requests | 300 / min per session (per IP for visitors) | `RATE_LIMIT_PER_MIN` |
| Photo requests | 3000 / min | code (`routes/photos.ts`) |
| Sign-ups | 5 / hour per IP | code (`routes/auth.ts`) |
| Sign-in attempts | 10 / 15 min per IP; the account locks for 15 min after 5 wrong passwords | code |
| New conversations | 20 / member / day | Admin settings |
| Messages | 30 / min | code |
| Reports | 10 / hour | code |
| Private seller listings | 3 at once | Admin settings |
| Saved searches | 20 per member | code |

Rate limits are kept in memory per instance. With several instances, each has its own allowance; use a shared store (the `@fastify/rate-limit` Redis option) if that matters.

## Scaling notes

- **Search:** a GIN full-text index and partial indexes on live listings keep search fast into the hundreds of thousands of listings. Paging is offset-based and capped at page 100.
- **Saved-search counts:** these run one count query per saved search when a member opens the app. That is fine for 20 searches per member. For email alerts at scale, add a job that records matches when listings go live.
- **Housekeeping:** expired sessions are purged hourly. Listings are never deleted, except drafts by their owner, so the history stays complete.

## Known limits (deliberate, for a first release)

- **No email:** there is no email verification, password reset by email, or message notifications by email. Badges show new messages and matches in the app. Adding a mail provider means one call in `routes/member.ts` (new message) and in `routes/auth.ts` (verification and reset).
- **No payments or featured listings:** listing is free.
- **No distance search:** location is a town or city, searched by prefix. For radius search, store a postcode's latitude and longitude and add PostGIS or an earthdistance index.
- **No offline actions:** offline mode shows what you have viewed recently. Sending messages or listing a car needs a connection.
