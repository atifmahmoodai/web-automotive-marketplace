import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodePng } from "../src/demo-images";
import { login, makeApp, randomIp, register, type Agent, type TestCtx } from "./helpers";

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => {
  await ctx?.close();
});

const png = (shade = 120) => encodePng(8, 8, new Uint8Array(8 * 8 * 3).fill(shade));
const car = {
  make: "Ford",
  model: "Focus",
  variant: "1.0 EcoBoost Titanium",
  year: 2019,
  mileage: 42000,
  fuel: "Petrol",
  transmission: "Manual",
  body: "Hatchback",
  colour: "Blue",
  priceCents: 9_450_00,
  city: "Leeds",
  description: "Full service history, two keys, new tyres and a fresh MOT. Lovely to drive.",
};
const get = (url: string) => ctx.app.inject({ method: "GET", url });

/** Creates a listing with one photo and submits it; returns its id and the submit result. */
async function listCar(a: Agent, over: Partial<typeof car> = {}) {
  const created = await a.send("POST", "/api/my/listings", { ...car, ...over });
  expect(created.statusCode).toBe(201);
  const id = created.json().id as string;
  expect((await a.upload("POST", `/api/my/listings/${id}/photos`, png())).statusCode).toBe(201);
  const submit = await a.send("POST", `/api/my/listings/${id}/submit`);
  return { id, submit };
}

describe("public search", () => {
  it("shows live cars only, with filters, sorting and paging", async () => {
    const all = await get("/api/listings");
    expect(all.statusCode).toBe(200);
    const body = all.json();
    expect(body.total).toBeGreaterThan(30);
    expect(body.items).toHaveLength(24);
    expect(body.pages).toBe(Math.ceil(body.total / 24));
    const { rows } = await ctx.db.query("SELECT count(*)::int AS n FROM listings WHERE status = 'live' AND expires_at > now()");
    expect(body.total).toBe(rows[0].n);

    const cheap = (await get("/api/listings?sort=price_asc&maxPrice=1500000")).json();
    const prices = cheap.items.map((i: { priceCents: number }) => i.priceCents);
    expect(prices.every((p: number) => p <= 1_500_000)).toBe(true);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);

    const privateOnly = (await get("/api/listings?seller=private")).json();
    expect(privateOnly.items.every((i: { sellerKind: string }) => i.sellerKind === "private")).toBe(true);
    // Private sellers are shown by first name only.
    expect(privateOnly.items.some((i: { sellerName: string }) => i.sellerName.includes(" "))).toBe(false);
  });

  it("offers every make even when one is chosen", async () => {
    const r = (await get("/api/listings?make=ford")).json();
    expect(r.items.every((i: { make: string }) => i.make === "Ford")).toBe(true);
    expect(r.makes.length).toBeGreaterThan(3);
  });

  it("handles free text safely", async () => {
    expect((await get(`/api/listings?q=${encodeURIComponent("golf' OR 1=1 --")}`)).statusCode).toBe(200);
    expect((await get(`/api/listings?q=${encodeURIComponent('"ford focus"')}`)).statusCode).toBe(200);
    expect((await get("/api/listings?city=%25")).json().total).toBe(0);
  });

  it("rejects bad filters", async () => {
    expect((await get("/api/listings?sort=evil")).statusCode).toBe(400);
    expect((await get("/api/listings?page=0")).statusCode).toBe(400);
  });

  it("hides cars waiting for review, and counts views of live ones", async () => {
    const pending = (await ctx.db.query("SELECT id FROM listings WHERE status = 'pending' LIMIT 1")).rows[0].id;
    expect((await get(`/api/listings/${pending}`)).statusCode).toBe(404);
    const live = (await get("/api/listings")).json().items[0];
    const before = (await ctx.db.query("SELECT views FROM listings WHERE id = $1", [live.id])).rows[0].views;
    const detail = await get(`/api/listings/${live.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().photos.length).toBeGreaterThan(0);
    expect(detail.json().mine).toBe(false);
    expect((await ctx.db.query("SELECT views FROM listings WHERE id = $1", [live.id])).rows[0].views).toBe(before + 1);
  });

  it("serves photos of live cars but not of hidden ones", async () => {
    const live = (await get("/api/listings")).json().items[0];
    const res = await get(live.photo.thumb);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toContain("public");
    const hidden = (await ctx.db.query("SELECT p.id FROM photos p JOIN listings l ON l.id = p.listing_id WHERE l.status = 'pending' LIMIT 1")).rows[0].id;
    expect((await get(`/api/photos/${hidden}`)).statusCode).toBe(404);
    expect((await get("/api/photos/../../etc/passwd")).statusCode).toBe(404);
  });

  it("publishes a sitemap of live cars", async () => {
    const res = await get("/sitemap.xml");
    expect(res.statusCode).toBe(200);
    const live = (await get("/api/listings")).json().items[0];
    const pending = (await ctx.db.query("SELECT id FROM listings WHERE status = 'pending' LIMIT 1")).rows[0].id;
    expect(res.body).toContain(`https://cars.example.com/cars/${live.id}`);
    expect(res.body).not.toContain(pending);
    expect(res.body).toContain("/dealers/northside-motors");
  });

  it("shows a dealer page with its cars", async () => {
    const res = await get("/api/dealers/northside-motors");
    expect(res.statusCode).toBe(200);
    expect(res.json().dealer.verified).toBe(true);
    expect(res.json().items.length).toBeGreaterThan(10);
    expect((await get("/api/dealers/nope")).statusCode).toBe(404);
  });
});

describe("accounts", () => {
  it("lets anyone sign up and then sign in", async () => {
    const m = await register(ctx.app, "Casey Tester");
    const me = await m.get("/api/auth/me");
    expect(me.json().user).toMatchObject({ name: "Casey Tester", role: "member", dealerId: null });
    const again = await ctx.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: m.email, name: "X Y", password: "demo-password-1" }, remoteAddress: randomIp() });
    expect(again.statusCode).toBe(409);
    const weak = await ctx.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "weak@test.local", name: "Weak", password: "short" }, remoteAddress: randomIp() });
    expect(weak.statusCode).toBe(400);
  });

  it("limits sign-ups per address", async () => {
    const ip = randomIp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await ctx.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `burst${i}${Date.now()}@test.local`, name: "Burst", password: "demo-password-1" }, remoteAddress: ip });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(codes[5]).toBe(429);
  });

  it("refuses changes without the CSRF token or from another site", async () => {
    const m = await register(ctx.app);
    const noToken = await ctx.app.inject({ method: "POST", url: "/api/my/listings", headers: { cookie: `sid=${m.cookie}` }, payload: car });
    expect(noToken.statusCode).toBe(403);
    const crossSite = await ctx.app.inject({ method: "POST", url: "/api/my/listings", headers: { cookie: `sid=${m.cookie}`, "x-csrf-token": m.csrf, origin: "https://evil.example" }, payload: car });
    expect(crossSite.statusCode).toBe(403);
  });
});

describe("selling privately", () => {
  it("goes draft → review → live, and the moderator's approval puts it in search", async () => {
    const seller = await register(ctx.app, "Robin Seller");
    const created = await seller.send("POST", "/api/my/listings", car);
    const id = created.json().id;
    expect(created.json().status).toBe("draft");

    const early = await seller.send("POST", `/api/my/listings/${id}/submit`);
    expect(early.statusCode).toBe(400);
    expect(early.json().message).toContain("photo");

    const up = await seller.upload("POST", `/api/my/listings/${id}/photos`, png());
    expect(up.statusCode).toBe(201);
    expect((await seller.upload("PUT", `/api/my/listings/${id}/photos/${up.json().id}/thumb`, png(90))).statusCode).toBe(200);
    // The owner can see the photo before the public can.
    expect((await seller.get(`/api/photos/${up.json().id}/thumb`)).statusCode).toBe(200);
    expect((await get(`/api/photos/${up.json().id}`)).statusCode).toBe(404);

    const submitted = await seller.send("POST", `/api/my/listings/${id}/submit`);
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().status).toBe("pending");

    const mod = await login(ctx.app, "mod@demo.local");
    const queue = (await mod.get("/api/mod/queue")).json().items;
    expect(queue.some((q: { id: string }) => q.id === id)).toBe(true);
    expect((await mod.send("POST", `/api/mod/listings/${id}/review`, { decision: "approve" })).statusCode).toBe(200);
    expect((await mod.send("POST", `/api/mod/listings/${id}/review`, { decision: "approve" })).statusCode).toBe(409);

    const found = (await get("/api/listings?q=Robin")).json();
    expect(found.total).toBe(0); // names aren't searchable
    const detail = (await get(`/api/listings/${id}`)).json();
    expect(detail.status).toBe("live");
    expect(detail.seller).toMatchObject({ kind: "private", name: "Robin", phone: null });
    expect(detail.expiresAt).not.toBeNull();
  });

  it("sends the seller the moderator's reason on rejection, and lets them fix and resubmit", async () => {
    const seller = await register(ctx.app);
    const { id } = await listCar(seller);
    const mod = await login(ctx.app, "mod@demo.local");
    expect((await mod.send("POST", `/api/mod/listings/${id}/review`, { decision: "reject", reason: "no" })).statusCode).toBe(400);
    expect((await mod.send("POST", `/api/mod/listings/${id}/review`, { decision: "reject", reason: "Please add photos of the interior." })).statusCode).toBe(200);
    const own = (await seller.get(`/api/my/listings/${id}`)).json();
    expect(own.status).toBe("rejected");
    expect(own.rejectReason).toBe("Please add photos of the interior.");
    expect((await seller.upload("POST", `/api/my/listings/${id}/photos`, png(60))).statusCode).toBe(201);
    expect((await seller.send("POST", `/api/my/listings/${id}/submit`)).json().status).toBe("pending");
  });

  it("checks uploads are real images and limits their number", async () => {
    const seller = await register(ctx.app);
    const id = (await seller.send("POST", "/api/my/listings", car)).json().id;
    const fake = await seller.upload("POST", `/api/my/listings/${id}/photos`, Buffer.from("<script>alert(1)</script>........"), "image/png");
    expect(fake.statusCode).toBe(400);
    const wrongType = await seller.upload("POST", `/api/my/listings/${id}/photos`, png(), "text/html");
    expect(wrongType.statusCode).toBe(415);
    for (let i = 0; i < 12; i++) expect((await seller.upload("POST", `/api/my/listings/${id}/photos`, png(i * 10))).statusCode).toBe(201);
    expect((await seller.upload("POST", `/api/my/listings/${id}/photos`, png())).statusCode).toBe(409);
    const tooBig = await seller.upload("POST", `/api/my/listings/${id}/photos`, Buffer.concat([png(), Buffer.alloc(3_100_000)]));
    expect(tooBig.statusCode).toBe(413);
  });

  it("reorders and deletes photos", async () => {
    const seller = await register(ctx.app);
    const id = (await seller.send("POST", "/api/my/listings", car)).json().id;
    const a = (await seller.upload("POST", `/api/my/listings/${id}/photos`, png(10))).json().id;
    const b = (await seller.upload("POST", `/api/my/listings/${id}/photos`, png(20))).json().id;
    const reordered = await seller.send("PUT", `/api/my/listings/${id}/photos/order`, { order: [b, a] });
    expect(reordered.json().items.map((p: { id: string }) => p.id)).toEqual([b, a]);
    expect((await seller.send("PUT", `/api/my/listings/${id}/photos/order`, { order: [a] })).statusCode).toBe(400);
    const del = await seller.send("DELETE", `/api/my/listings/${id}/photos/${b}`);
    expect(del.json().items.map((p: { id: string }) => p.id)).toEqual([a]);
  });

  it("caps how many cars a private seller lists at once", async () => {
    const admin = await login(ctx.app, "admin@demo.local");
    const settings = (await get("/api/meta")).json().settings;
    await admin.send("PUT", "/api/settings", { ...settings, maxListingsPerPrivateSeller: 2 });
    try {
      const seller = await register(ctx.app);
      expect((await listCar(seller)).submit.json().status).toBe("pending");
      expect((await listCar(seller)).submit.json().status).toBe("pending");
      const third = await listCar(seller);
      expect(third.submit.statusCode).toBe(409);
      expect(third.submit.json().message).toContain("2 cars");
    } finally {
      await admin.send("PUT", "/api/settings", settings);
    }
  });

  it("only lets the owner see or change a listing", async () => {
    const owner = await register(ctx.app);
    const other = await register(ctx.app);
    const id = (await owner.send("POST", "/api/my/listings", car)).json().id;
    expect((await other.get(`/api/my/listings/${id}`)).statusCode).toBe(404);
    expect((await other.send("PUT", `/api/my/listings/${id}`, { ...car, version: 1 })).statusCode).toBe(404);
    expect((await other.upload("POST", `/api/my/listings/${id}/photos`, png())).statusCode).toBe(404);
    expect((await other.send("DELETE", `/api/my/listings/${id}`)).statusCode).toBe(404);
    expect((await owner.send("DELETE", `/api/my/listings/${id}`)).statusCode).toBe(200);
  });
});

describe("selling as a dealer", () => {
  it("skips review for a verified dealer, but not for a flagged listing", async () => {
    const dealer = await login(ctx.app, "dealer@demo.local");
    const clean = await listCar(dealer, { make: "Skoda", model: "Fabia" });
    expect(clean.submit.json().status).toBe("live");
    const shady = await listCar(dealer, { description: "Great car. Call me on 07700 900456 or email sales@example.com for a deal." });
    expect(shady.submit.json().status).toBe("pending");
    expect(shady.submit.json().listing.flags).toEqual(expect.arrayContaining(["Phone number in the description", "Email address in the description"]));
  });

  it("shows a price cut, and holds an edited live listing when the edit looks suspicious", async () => {
    const dealer = await login(ctx.app, "dealer@demo.local");
    const { id, submit } = await listCar(dealer, { make: "Seat", model: "Leon" });
    const v = submit.json().listing.version;
    const cut = await dealer.send("PUT", `/api/my/listings/${id}`, { ...car, make: "Seat", model: "Leon", priceCents: 8_999_00, version: v });
    expect(cut.statusCode).toBe(200);
    expect(cut.json().previousPriceCents).toBe(9_450_00);
    expect(cut.json().heldForReview).toBe(false);
    // Somebody else's stale form is refused rather than overwriting.
    expect((await dealer.send("PUT", `/api/my/listings/${id}`, { ...car, version: v })).statusCode).toBe(409);
    const edited = await dealer.send("PUT", `/api/my/listings/${id}`, { ...car, make: "Seat", model: "Leon", description: "Now cheaper, visit www.cheapcars.example", version: cut.json().version });
    expect(edited.json().heldForReview).toBe(true);
    expect(edited.json().status).toBe("pending");
  });

  it("lets the team manage the dealer's cars and nobody else", async () => {
    const owner = await register(ctx.app, "Owner Person");
    const created = await owner.send("POST", "/api/dealer", { name: "Test Motors", phone: "0113 000 0000", city: "Hull", about: "", website: "" });
    expect(created.statusCode).toBe(201);
    const owner2 = await login(ctx.app, owner.email); // session now carries the dealer
    const staff = await register(ctx.app, "Staff Person");
    expect((await owner2.send("POST", "/api/dealer/staff", { email: staff.email })).statusCode).toBe(200);
    expect((await owner2.send("POST", "/api/dealer/staff", { email: "nobody@test.local" })).statusCode).toBe(400);

    const { id, submit } = await listCar(owner2, { make: "Dacia", model: "Sandero" });
    // A new dealer isn't verified yet, so its cars are reviewed.
    expect(submit.json().status).toBe("pending");
    const staffView = await staff.get(`/api/my/listings/${id}`);
    expect(staffView.statusCode).toBe(200);
    const outsider = await register(ctx.app);
    expect((await outsider.get(`/api/my/listings/${id}`)).statusCode).toBe(404);
    // Staff can't run the account.
    expect((await staff.send("POST", "/api/dealer/staff", { email: outsider.email })).statusCode).toBe(403);

    const slug = (await owner2.get("/api/dealer")).json().dealer.slug;
    expect(slug).toBe("test-motors");
    const mod = await login(ctx.app, "mod@demo.local");
    const dealerId = (await owner2.get("/api/dealer")).json().dealer.id;
    expect((await mod.send("PUT", `/api/mod/dealers/${dealerId}`, { verified: true, active: true })).statusCode).toBe(200);
    const staffCar = await listCar(staff, { make: "Dacia", model: "Duster" });
    expect(staffCar.submit.json().status).toBe("live");

    // Removing staff takes away their access; the dealer keeps its cars.
    const staffId = (await owner2.get("/api/dealer")).json().team.find((t: { email: string }) => t.email === staff.email).id;
    expect((await owner2.send("DELETE", `/api/dealer/staff/${staffId}`)).statusCode).toBe(200);
    expect((await staff.get(`/api/my/listings/${id}`)).statusCode).toBe(404);
    // ...including the cars they listed themselves while on the team.
    expect((await staff.get(`/api/my/listings/${staffCar.id}`)).statusCode).toBe(404);
    expect((await staff.get("/api/my/listings")).json().items).toEqual([]);
    expect((await owner2.get(`/api/my/listings/${staffCar.id}`)).statusCode).toBe(200);
  });

  it("gives a second dealer with the same name its own address", async () => {
    const a = await register(ctx.app);
    const b = await register(ctx.app);
    const body = { name: "Same Name Cars", phone: "", city: "Leeds", about: "", website: "" };
    expect((await a.send("POST", "/api/dealer", body)).statusCode).toBe(201);
    expect((await b.send("POST", "/api/dealer", body)).statusCode).toBe(201);
    expect((await get("/api/dealers/same-name-cars-2")).statusCode).toBe(200);
  });
});

describe("buyers and sellers talking", () => {
  it("starts one conversation per car, with unread counts on both sides", async () => {
    const seller = await register(ctx.app, "Sasha Seller");
    const { id } = await listCar(seller);
    const mod = await login(ctx.app, "mod@demo.local");
    await mod.send("POST", `/api/mod/listings/${id}/review`, { decision: "approve" });

    const buyer = await register(ctx.app, "Blake Buyer");
    const first = await buyer.send("POST", `/api/listings/${id}/messages`, { body: "Is it still available?" });
    expect(first.statusCode).toBe(201);
    const second = await buyer.send("POST", `/api/listings/${id}/messages`, { body: "And does it have a spare key?" });
    expect(second.json().threadId).toBe(first.json().threadId);
    expect((await seller.send("POST", `/api/listings/${id}/messages`, { body: "hi me" })).statusCode).toBe(409);

    expect((await seller.get("/api/unread")).json().messages).toBe(2);
    const threads = (await seller.get("/api/threads")).json().items;
    expect(threads[0]).toMatchObject({ otherName: "Blake Buyer", role: "seller", unread: 2 });

    const opened = (await seller.get(`/api/threads/${first.json().threadId}`)).json();
    expect(opened.messages.map((m: { body: string }) => m.body)).toEqual(["Is it still available?", "And does it have a spare key?"]);
    expect((await seller.get("/api/unread")).json().messages).toBe(0);

    await seller.send("POST", `/api/threads/${first.json().threadId}/messages`, { body: "Yes and yes!" });
    const buyerThreads = (await buyer.get("/api/threads")).json().items;
    expect(buyerThreads[0]).toMatchObject({ otherName: "Sasha", role: "buyer", unread: 1, lastBody: "Yes and yes!" });

    const stranger = await register(ctx.app);
    expect((await stranger.get(`/api/threads/${first.json().threadId}`)).statusCode).toBe(404);
    expect((await stranger.send("POST", `/api/threads/${first.json().threadId}/messages`, { body: "hello" })).statusCode).toBe(404);
  });

  it("limits how many sellers one member can contact a day", async () => {
    const admin = await login(ctx.app, "admin@demo.local");
    const settings = (await get("/api/meta")).json().settings;
    await admin.send("PUT", "/api/settings", { ...settings, maxNewEnquiriesPerDay: 2 });
    try {
      const buyer = await register(ctx.app);
      const cars = (await get("/api/listings?seller=dealer")).json().items.slice(0, 3);
      const codes = [];
      for (const c of cars) codes.push((await buyer.send("POST", `/api/listings/${c.id}/messages`, { body: "Hello, still for sale?" })).statusCode);
      expect(codes).toEqual([201, 201, 429]);
      // Following up in an existing conversation is still fine.
      expect((await buyer.send("POST", `/api/listings/${cars[0].id}/messages`, { body: "Any news?" })).statusCode).toBe(201);
    } finally {
      await admin.send("PUT", "/api/settings", settings);
    }
  });
});

describe("saving cars and searches", () => {
  it("saves and unsaves cars", async () => {
    const m = await register(ctx.app);
    const target = (await get("/api/listings")).json().items[2];
    expect((await m.send("PUT", `/api/saved/${target.id}`)).statusCode).toBe(200);
    expect((await m.send("PUT", `/api/saved/${target.id}`)).statusCode).toBe(200); // idempotent
    expect((await m.get("/api/saved")).json().items.map((i: { id: string }) => i.id)).toEqual([target.id]);
    expect((await m.get("/api/listings")).json().items.find((i: { id: string }) => i.id === target.id).saved).toBe(true);
    await m.send("DELETE", `/api/saved/${target.id}`);
    expect((await m.get("/api/saved")).json().items).toEqual([]);
    const pending = (await ctx.db.query("SELECT id FROM listings WHERE status = 'pending' LIMIT 1")).rows[0].id;
    expect((await m.send("PUT", `/api/saved/${pending}`)).statusCode).toBe(404);
  });

  it("counts new matches for a saved search until they're seen", async () => {
    const m = await register(ctx.app);
    const created = await m.send("POST", "/api/searches", { name: "Mazdas", filters: { make: "Mazda", maxPrice: "" } });
    expect(created.statusCode).toBe(201);
    let s = (await m.get("/api/searches")).json().items[0];
    expect(s.newCount).toBe(0);
    expect(s.filters).toEqual({ make: "Mazda" });

    const dealer = await login(ctx.app, "dealer@demo.local");
    await listCar(dealer, { make: "Mazda", model: "CX-5", body: "SUV" });
    s = (await m.get("/api/searches")).json().items[0];
    expect(s.newCount).toBe(1);
    expect((await m.get("/api/unread")).json().savedSearchMatches).toBe(1);
    await m.send("POST", `/api/searches/${s.id}/seen`);
    expect((await m.get("/api/searches")).json().items[0].newCount).toBe(0);

    const other = await register(ctx.app);
    expect((await other.send("DELETE", `/api/searches/${s.id}`)).statusCode).toBe(404);
    expect((await m.send("DELETE", `/api/searches/${s.id}`)).statusCode).toBe(200);
  });
});

describe("moderation", () => {
  it("takes a listing off the site after three separate reports", async () => {
    const seller = await register(ctx.app);
    const { id } = await listCar(seller);
    const mod = await login(ctx.app, "mod@demo.local");
    await mod.send("POST", `/api/mod/listings/${id}/review`, { decision: "approve" });

    const reporters = [await register(ctx.app), await register(ctx.app), await register(ctx.app)];
    expect((await seller.send("POST", `/api/listings/${id}/report`, { reason: "scam", note: "" })).statusCode).toBe(409);
    const r1 = await reporters[0].send("POST", `/api/listings/${id}/report`, { reason: "scam", note: "Asked for a deposit" });
    expect(r1.json().held).toBe(false);
    expect((await reporters[0].send("POST", `/api/listings/${id}/report`, { reason: "scam", note: "" })).statusCode).toBe(409);
    await reporters[1].send("POST", `/api/listings/${id}/report`, { reason: "wrong_details", note: "" });
    const r3 = await reporters[2].send("POST", `/api/listings/${id}/report`, { reason: "scam", note: "" });
    expect(r3.json().held).toBe(true);
    expect((await get(`/api/listings/${id}`)).statusCode).toBe(404);

    // Removing it closes every report on it; the seller can't put it back.
    const report = (await mod.get("/api/mod/reports")).json().items.find((r: { listingId: string }) => r.listingId === id);
    expect(report.openOnListing).toBe(3);
    expect((await mod.send("POST", `/api/mod/reports/${report.id}/resolve`, { action: "remove_listing", note: "Deposit scam" })).statusCode).toBe(200);
    const open = (await mod.get("/api/mod/reports")).json().items.filter((r: { listingId: string }) => r.listingId === id);
    expect(open).toEqual([]);
    const own = (await seller.get(`/api/my/listings/${id}`)).json();
    expect(own.status).toBe("removed");
    expect((await seller.send("PUT", `/api/my/listings/${id}`, { ...car, version: own.version })).statusCode).toBe(409);
    expect((await seller.send("POST", `/api/my/listings/${id}/submit`)).statusCode).toBe(409);
  });

  it("suspending a member signs them out and hides their cars", async () => {
    const seller = await register(ctx.app);
    const { id } = await listCar(seller);
    const mod = await login(ctx.app, "mod@demo.local");
    await mod.send("POST", `/api/mod/listings/${id}/review`, { decision: "approve" });
    expect((await get(`/api/listings/${id}`)).statusCode).toBe(200);

    expect((await mod.send("PUT", `/api/users/${seller.id}`, { role: "member", active: false })).statusCode).toBe(200);
    expect((await seller.get("/api/auth/me")).statusCode).toBe(401);
    expect((await get(`/api/listings/${id}`)).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: seller.email, password: "demo-password-1" }, remoteAddress: randomIp() })).statusCode).toBe(401);
    await mod.send("PUT", `/api/users/${seller.id}`, { role: "member", active: true });
    expect((await get(`/api/listings/${id}`)).statusCode).toBe(200);
  });

  it("keeps staff tools for staff, and roles for admins", async () => {
    const m = await register(ctx.app);
    expect((await m.get("/api/mod/queue")).statusCode).toBe(403);
    expect((await m.get("/api/users")).statusCode).toBe(403);
    expect((await get("/api/mod/reports")).statusCode).toBe(401);
    const mod = await login(ctx.app, "mod@demo.local");
    expect((await mod.send("PUT", `/api/users/${m.id}`, { role: "moderator", active: true })).statusCode).toBe(403);
    expect((await mod.get("/api/audit")).statusCode).toBe(403);
    const admin = await login(ctx.app, "admin@demo.local");
    expect((await admin.send("PUT", `/api/users/${m.id}`, { role: "moderator", active: true })).statusCode).toBe(200);
    const users = (await admin.get(`/api/users?q=${encodeURIComponent(m.email)}`)).json().items;
    expect(users).toHaveLength(1);
    expect(users[0].role).toBe("moderator");
  });

  it("records moderation in the activity log", async () => {
    const admin = await login(ctx.app, "admin@demo.local");
    expect((await admin.get("/api/audit")).json().items).toHaveLength(100);
    const actions = (await ctx.db.query("SELECT DISTINCT action FROM audit_log")).rows.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["listing.approve", "listing.reject", "listing.remove", "listing.auto_hold", "user.suspend"]));
  });
});

describe("listing lifecycle", () => {
  it("marks sold, keeps the page for people who saved it, and blocks further edits", async () => {
    const dealer = await login(ctx.app, "dealer@demo.local");
    const { id } = await listCar(dealer, { make: "Honda", model: "Jazz" });
    const sold = await dealer.send("POST", `/api/my/listings/${id}/sold`);
    expect(sold.json().status).toBe("sold");
    expect((await get(`/api/listings/${id}`)).json().status).toBe("sold");
    expect((await get("/api/listings?make=Honda&model=Jazz")).json().total).toBe(0);
    expect((await dealer.send("POST", `/api/my/listings/${id}/withdraw`)).statusCode).toBe(409);
  });

  it("drops expired listings from search until renewed", async () => {
    const dealer = await login(ctx.app, "dealer@demo.local");
    const { id } = await listCar(dealer, { make: "Lexus", model: "UX" });
    expect((await get("/api/listings?make=Lexus")).json().total).toBe(1);
    expect((await dealer.send("POST", `/api/my/listings/${id}/renew`)).statusCode).toBe(400); // just listed
    await ctx.db.query("UPDATE listings SET expires_at = now() - interval '1 day' WHERE id = $1", [id]);
    expect((await get("/api/listings?make=Lexus")).json().total).toBe(0);
    expect((await dealer.get(`/api/my/listings/${id}`)).json().expired).toBe(true);
    expect((await dealer.send("POST", `/api/my/listings/${id}/renew`)).statusCode).toBe(200);
    expect((await get("/api/listings?make=Lexus")).json().total).toBe(1);
  });

  it("withdraws and relists as a new listing", async () => {
    const dealer = await login(ctx.app, "dealer@demo.local");
    const { id } = await listCar(dealer, { make: "Volvo", model: "XC40" });
    const firstPublished = (await ctx.db.query("SELECT published_at FROM listings WHERE id = $1", [id])).rows[0].published_at;
    expect((await dealer.send("POST", `/api/my/listings/${id}/withdraw`)).json().status).toBe("withdrawn");
    expect((await get(`/api/listings/${id}`)).statusCode).toBe(404);
    await new Promise((r) => setTimeout(r, 5));
    expect((await dealer.send("POST", `/api/my/listings/${id}/submit`)).json().status).toBe("live");
    const again = (await ctx.db.query("SELECT published_at FROM listings WHERE id = $1", [id])).rows[0].published_at;
    expect(again.getTime()).toBeGreaterThan(firstPublished.getTime());
  });
});

describe("export", () => {
  it("gives a seller their listings as CSV, safe to open in a spreadsheet", async () => {
    const seller = await register(ctx.app);
    await listCar(seller, { variant: "=HYPERLINK(\"http://evil\")" });
    const res = await seller.get("/api/my/listings.csv");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.body.trim().split("\r\n");
    expect(lines[0]).toMatch(/^ref,status,make/);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(lines[1]).toContain(",9450.00,");
  });
});

describe("rate limits", () => {
  it("counts each signed-in session separately", async () => {
    const small = await makeApp({ RATE_LIMIT_PER_MIN: "10" });
    try {
      const a = await login(small.app, "buyer@demo.local");
      const b = await login(small.app, "seller@demo.local");
      const ip = "10.99.99.99";
      const hit = (x: Agent) => small.app.inject({ method: "GET", url: "/api/threads", headers: { cookie: `sid=${x.cookie}` }, remoteAddress: ip });
      for (let i = 0; i < 10; i++) expect((await hit(a)).statusCode).toBe(200);
      expect((await hit(a)).statusCode).toBe(429);
      expect((await hit(b)).statusCode).toBe(200);
    } finally {
      await small.close();
    }
  });
});
