// End-to-end smoke test of the whole stack: a fresh PostgreSQL database with demo data, the built
// server, and the marketplace driven in Chromium: a visitor searching, a new seller listing a car with
// photos, a moderator approving it, a buyer saving and messaging, the seller replying, the phone layout,
// and the installed-app pieces (manifest, service worker, offline car page).
//   npm run build && npm run smoke        (from the project root)
// Uses SMOKE_DATABASE_URL (default postgres://postgres:postgres@localhost:5432/market_smoke).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { chromium } from "playwright-core";

const PORT = 4189;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = "test-results/screenshots";
const DB_URL = process.env.SMOKE_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/market_smoke";
const executablePath = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
mkdirSync(SHOTS, { recursive: true });
if (!existsSync("../server/dist/server.js") || !existsSync("dist/index.html")) throw new Error("Build first: npm run build (from the project root)");

{
  const name = new URL(DB_URL).pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("smoke")) throw new Error("SMOKE_DATABASE_URL must name a database containing 'smoke'");
  const adminUrl = new URL(DB_URL);
  adminUrl.pathname = "/postgres";
  const c = new pg.Client({ connectionString: adminUrl.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${name}`);
  await c.end();
}
// The test clicks far faster than a person, so the per-session limit is raised.
const env = { ...process.env, NODE_ENV: "production", DATABASE_URL: DB_URL, PORT: String(PORT), PUBLIC_URL: BASE, COOKIE_SECURE: "false", WEB_DIST: join(process.cwd(), "dist"), LOG_LEVEL: "warn", ALLOW_DEMO_SEED: "1", RATE_LIMIT_PER_MIN: "3000" };
const seeded = spawnSync("node", ["../server/dist/cli/seed-demo.js"], { env, encoding: "utf8" });
if (seeded.status !== 0) throw new Error(`demo seed failed: ${seeded.stderr}`);
const server = spawn("node", ["../server/dist/server.js"], { env, stdio: ["ignore", "inherit", "inherit"] });

let failures = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
};
const signIn = async (p, email) => {
  await p.goto(`${BASE}login`);
  await p.fill("input[type=email]", email);
  await p.fill("input[type=password]", "demo-password-1");
  await p.click("button:has-text('Sign in')");
  await p.waitForSelector(".appbar");
};
const signOut = async (p) => {
  await p.goto(`${BASE}account`);
  await p.click("button:has-text('Sign out')");
  await p.waitForSelector(".appbar a:has-text('Sign in')");
};

let page;
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}readyz`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({ executablePath });
  const errors = [];
  const watch = (p) => {
    p.on("pageerror", (e) => {
      errors.push(e.stack || e.message);
      console.log(`  ! ${e.stack || e.message}`);
    });
    // 4xx answers are expected here (sign-in checks, refused actions); any 5xx or script error is a failure.
    p.on("console", (m) => m.type() === "error" && !/status of 4\d\d|ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(m.text()) && errors.push(`${p.url()}: ${m.text()}`));
    p.on("dialog", (d) => d.accept());
  };
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await ctx.newPage();
  watch(page);

  console.log("visitor");
  await page.goto(BASE);
  await page.waitForSelector(".car-card");
  const total = Number((await page.textContent(".search-head p")).replace(/\D/g, ""));
  check(total >= 35, `home page lists the live cars (${total})`);
  check((await page.locator(".car-card img").first().evaluate((img) => img.complete && img.naturalWidth > 0)) === true, "thumbnails load");
  await page.screenshot({ path: `${SHOTS}/search.png` });
  await page.selectOption("#filters select >> nth=0", { index: 1 });
  const make = (await page.locator("#filters select >> nth=0").inputValue()).trim();
  await page.click("button:has-text('Show cars')");
  await page.waitForURL(new RegExp(`make=${encodeURIComponent(make)}`));
  await page.waitForFunction((m) => [...document.querySelectorAll(".car-card h3")].every((h) => h.textContent.includes(m)), make);
  check(true, `filtering by make (${make}) shows only that make`);
  await page.selectOption(".sort select", "price_asc");
  await page.waitForURL(/sort=price_asc/);
  await page.waitForFunction(() => !document.querySelector(".car-grid.stale"));
  const prices = await page.$$eval(".car-card .price", (els) => els.map((e) => Number(e.firstChild.textContent.replace(/\D/g, ""))));
  check(prices.every((p, i) => i === 0 || prices[i - 1] <= p), "sorting by price works");
  await page.click(".car-card a");
  await page.waitForSelector(".gallery-main img");
  await page.click(".gallery-nav.next");
  check((await page.textContent(".gallery .photo-count")).startsWith("2 /"), "gallery steps through photos");
  check(await page.isVisible("a:has-text('Sign in to message')"), "visitors are asked to sign in before messaging");
  check((await page.title()).includes("for £"), "car page has a descriptive title");
  await page.screenshot({ path: `${SHOTS}/car.png` });

  console.log("PWA");
  const manifest = await (await fetch(`${BASE}manifest.webmanifest`)).json();
  check(manifest.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable") && manifest.display === "standalone", "manifest is installable (standalone, maskable 512px icon)");
  check((await fetch(`${BASE}icon-192.png`)).headers.get("content-type") === "image/png", "icons are served");
  const swReady = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then((r) => !!r.active), new Promise((r) => setTimeout(() => r(false), 8000))]));
  check(swReady, "service worker is active");
  const robots = await (await fetch(`${BASE}robots.txt`)).text();
  const sitemap = await (await fetch(`${BASE}sitemap.xml`)).text();
  check(robots.includes("Sitemap:") && sitemap.includes("/cars/"), "robots.txt and sitemap.xml are served");

  console.log("new private seller");
  await page.goto(`${BASE}register`);
  await page.fill("input[autocomplete=name]", "Quinn Seller");
  const sellerEmail = `quinn${Date.now()}@example.com`;
  await page.fill("input[type=email]", sellerEmail);
  await page.fill("input[type=password]", "demo-password-1");
  await page.click("button:has-text('Join')");
  await page.waitForSelector(".appbar a:has-text('Quinn Seller')");
  check(true, "a visitor can sign up and is signed straight in");
  await page.goto(`${BASE}sell/new`);
  await page.click("button:has-text('Save and add photos')");
  check(await page.isVisible(".field-error"), "the listing form explains missing fields");
  const fill = async (label, value) => page.fill(`label:has-text('${label}') input`, value);
  await fill("Make", "Peugeot");
  await fill("Model", "208");
  await fill("Version", "1.2 PureTech Allure");
  await fill("Year", "2020");
  await fill("Mileage", "31,500");
  await fill("Colour", "Orange");
  await fill("Where is the car", "Leeds");
  await fill("Asking price", "10995");
  await page.fill("textarea", "One owner, full Peugeot service history, two keys. Apple CarPlay, parking sensors, cruise control.");
  await page.click("button:has-text('Save and add photos')");
  await page.waitForURL(/\/sell\/l-/);
  check(await page.isDisabled("button:has-text('Send to the site')"), "a listing can't be sent without photos");
  // A real photo: render a coloured panel in the browser and save it as a PNG.
  const shotPage = await ctx.newPage();
  await shotPage.setViewportSize({ width: 900, height: 560 });
  await shotPage.setContent('<body style="margin:0;background:linear-gradient(#9cc3ef,#e9eef5)"><div style="position:absolute;left:150px;top:240px;width:600px;height:140px;background:#e0782a;border-radius:40px"></div></body>');
  const photoPath = join(SHOTS, "upload.png");
  writeFileSync(photoPath, await shotPage.screenshot());
  await shotPage.close();
  await page.setInputFiles(".upload input[type=file]", [photoPath, photoPath]);
  await page.waitForFunction(() => document.querySelectorAll(".photo-grid li").length === 2, null, { timeout: 15000 });
  check(true, "photos are resized in the browser and uploaded");
  await page.click("button[aria-label='Move photo 2 earlier']");
  await page.waitForFunction(() => !document.querySelector("button:disabled[aria-label='Move photo 2 earlier']"));
  await page.click("button:has-text('Send to the site')");
  await page.waitForSelector("text=A moderator is checking this listing");
  check(true, "a new private seller's car waits for a moderator");
  const carId = page.url().split("/").pop();
  await page.screenshot({ path: `${SHOTS}/sell.png`, fullPage: true });
  await signOut(page);
  check((await fetch(`${BASE}api/listings/${carId}`)).status === 404, "the waiting car isn't public");

  console.log("moderator");
  await signIn(page, "mod@demo.local");
  await page.goto(`${BASE}moderation`);
  await page.waitForSelector(".review");
  const scam = page.locator(".review", { hasText: "Tesla Model 3" });
  check((await scam.locator(".flags li").count()) >= 2, "the scam listing shows its warning signs");
  await page.screenshot({ path: `${SHOTS}/moderation.png` });
  await scam.locator("button:has-text('Send back')").click();
  await page.fill(".modal textarea", "Payments must not be made before viewing. Please remove the deposit and phone details.");
  await page.click(".modal button:has-text('Send back')");
  await page.waitForFunction(() => ![...document.querySelectorAll(".review h2")].some((h) => h.textContent.includes("Tesla")));
  check(true, "the moderator sends the scam listing back");
  await page.locator(".review", { hasText: "Peugeot 208" }).locator("button:has-text('Approve')").click();
  await page.waitForFunction(() => ![...document.querySelectorAll(".review h2")].some((h) => h.textContent.includes("Peugeot")));
  check((await fetch(`${BASE}api/listings/${carId}`)).status === 200, "the approved car goes public");
  await page.goto(`${BASE}moderation/reports`);
  await page.waitForSelector("td:has-text('Details are wrong')");
  check(true, "open reports are listed");
  await signOut(page);

  console.log("buyer");
  await signIn(page, "buyer@demo.local");
  await page.waitForSelector(".nav a:has-text('Saved') .count");
  check(Number(await page.textContent(".nav a:has-text('Saved') .count")) >= 1, "the saved-search badge shows new matches");
  await page.goto(`${BASE}?make=Peugeot`);
  await page.waitForSelector(".car-card:has-text('Peugeot 208')");
  await page.click(".car-card:has-text('Peugeot 208') .heart");
  await page.waitForSelector(".car-card:has-text('Peugeot 208') .heart.on");
  check(true, "the buyer saves the car");
  await page.click(".car-card:has-text('Peugeot 208') a");
  await page.waitForSelector("text=Message the seller");
  const sellerCard = await page.textContent(".seller-card");
  check(sellerCard.includes("Quinn") && !sellerCard.includes("Quinn Seller"), "private sellers are shown by first name");
  await page.fill(".car-side textarea", "Hello Quinn, is the 208 still available? Could I see it on Saturday?");
  await page.click("button:has-text('Send message')");
  await page.waitForURL(/\/messages\/t-/);
  await page.waitForSelector(".msg.out:has-text('Saturday')");
  check(true, "the message opens the conversation");
  await page.goto(`${BASE}saved`);
  await page.waitForSelector(".saved-searches li");
  const before = await page.locator(".saved-searches .badge").count();
  await page.locator(".saved-searches li", { has: page.locator(".badge") }).first().locator("button:has-text('Show cars')").click();
  await page.waitForSelector(".car-card");
  await page.goto(`${BASE}saved`);
  await page.waitForSelector(".saved-searches li");
  check((await page.locator(".saved-searches .badge").count()) === before - 1, "opening a saved search clears its 'new' count");
  check(await page.isVisible(".car-card:has-text('Peugeot 208')"), "the saved car is on the Saved page");
  await signOut(page);

  console.log("seller replies");
  await signIn(page, sellerEmail);
  await page.waitForSelector(".nav a:has-text('Messages') .count");
  check((await page.textContent(".nav a:has-text('Messages') .count")) === "1", "the seller sees one unread message");
  await page.goto(`${BASE}messages`);
  await page.click(".conv");
  await page.waitForSelector(".msg.in:has-text('Saturday')");
  await page.fill(".compose textarea", "Hi Bailey, yes, Saturday at 11 is fine.");
  await page.click(".compose button");
  await page.waitForSelector(".msg.out:has-text('Saturday at 11')");
  check(true, "the seller replies");
  await page.screenshot({ path: `${SHOTS}/messages.png` });
  await page.goto(`${BASE}sell`);
  await page.waitForSelector(".my-row:has-text('Peugeot 208')");
  check((await page.textContent(".my-row:has-text('Peugeot 208') .mini-stats")).includes("Messages1"), "the seller's list counts the conversation");

  console.log("dealer");
  await signOut(page);
  await signIn(page, "dealer@demo.local");
  await page.goto(`${BASE}sell`);
  await page.waitForSelector(".my-row");
  check((await page.textContent("h1")).includes("Dealer stock"), "a dealer sees the team's stock");
  const csv = await page.evaluate(() => fetch("/api/my/listings.csv").then((r) => r.text()));
  check(csv.startsWith("ref,status,make") && csv.split("\r\n").length > 20, "the stock exports as CSV");
  await page.screenshot({ path: `${SHOTS}/dealer-stock.png` });

  console.log("phone");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mp = await phone.newPage();
  watch(mp);
  await mp.goto(BASE);
  await mp.waitForSelector(".car-card");
  check(await mp.isVisible(".tabbar"), "phones get the bottom tab bar");
  check(!(await mp.isVisible("#filters")), "filters are folded away on phones");
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `search page fits the phone screen (overflow ${overflow}px)`);
  await mp.screenshot({ path: `${SHOTS}/phone-search.png` });
  await mp.click("button:has-text('Filters')");
  check(await mp.isVisible("#filters"), "the Filters button opens them");
  await mp.goto(`${BASE}cars/${carId}`);
  await mp.waitForSelector(".gallery-main img");
  const overflow2 = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow2 <= 0, `car page fits the phone screen (overflow ${overflow2}px)`);
  await mp.screenshot({ path: `${SHOTS}/phone-car.png`, fullPage: true });

  console.log("offline");
  await mp.evaluate(() => navigator.serviceWorker.ready);
  await mp.reload();
  await mp.waitForSelector(".gallery-main img");
  await phone.setOffline(true);
  await mp.reload();
  await mp.waitForSelector(".car-title", { timeout: 10000 });
  check((await mp.textContent(".car-title")).includes("Peugeot 208"), "a recently viewed car opens offline");
  check(await mp.isVisible(".offline"), "the app says it's offline");
  await phone.setOffline(false);

  check(errors.length === 0, `no script errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await browser.close();
} catch (e) {
  failures++;
  console.error(e);
  if (page) await page.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true }).catch(() => {});
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall smoke checks passed");
process.exit(failures ? 1 : 0);
