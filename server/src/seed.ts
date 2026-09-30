// Demo data: dealers, private sellers, a buyer, staff, about fifty cars with pictures, conversations,
// saved searches and a few listings waiting for moderation.
import type pg from "pg";
import { carPicture } from "./demo-images";
import { newId, saveSettings } from "./repo/data";
import { hashPassword } from "./security/password";
import { DEFAULT_SETTINGS } from "../../shared/market";

type RGB = [number, number, number];

/** Small deterministic random generator, so every demo database looks the same. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLOURS: Record<string, RGB> = {
  Black: [34, 36, 40],
  White: [236, 238, 240],
  Silver: [178, 184, 190],
  Grey: [102, 108, 116],
  Blue: [40, 86, 170],
  Red: [178, 34, 40],
  Green: [36, 104, 72],
  Orange: [224, 120, 36],
};

interface Model {
  make: string;
  model: string;
  variants: string[];
  body: string;
  fuels: string[];
  /** Typical price new, in whole currency units. */
  newPrice: number;
}

const MODELS: Model[] = [
  { make: "Ford", model: "Fiesta", variants: ["1.0 EcoBoost Titanium", "1.1 Zetec", "1.0 ST-Line"], body: "Hatchback", fuels: ["Petrol"], newPrice: 21000 },
  { make: "Ford", model: "Focus", variants: ["1.5 EcoBlue Titanium", "1.0 EcoBoost ST-Line"], body: "Hatchback", fuels: ["Petrol", "Diesel"], newPrice: 27000 },
  { make: "Ford", model: "Kuga", variants: ["2.5 PHEV ST-Line", "1.5 EcoBoost Titanium"], body: "SUV", fuels: ["Plug-in hybrid", "Petrol"], newPrice: 36000 },
  { make: "Volkswagen", model: "Golf", variants: ["1.5 TSI Life", "2.0 TDI Style", "GTI"], body: "Hatchback", fuels: ["Petrol", "Diesel"], newPrice: 29000 },
  { make: "Volkswagen", model: "Polo", variants: ["1.0 TSI Match", "1.0 Life"], body: "Hatchback", fuels: ["Petrol"], newPrice: 21000 },
  { make: "Volkswagen", model: "Tiguan", variants: ["2.0 TDI Elegance", "1.5 TSI Life"], body: "SUV", fuels: ["Diesel", "Petrol"], newPrice: 36000 },
  { make: "Toyota", model: "Yaris", variants: ["1.5 Hybrid Icon", "1.5 Hybrid Design"], body: "Hatchback", fuels: ["Hybrid"], newPrice: 23000 },
  { make: "Toyota", model: "Corolla", variants: ["1.8 Hybrid Design", "2.0 Hybrid Excel"], body: "Estate", fuels: ["Hybrid"], newPrice: 30000 },
  { make: "Toyota", model: "RAV4", variants: ["2.5 Hybrid Dynamic", "2.5 PHEV"], body: "SUV", fuels: ["Hybrid", "Plug-in hybrid"], newPrice: 40000 },
  { make: "BMW", model: "3 Series", variants: ["320d M Sport", "330e M Sport"], body: "Saloon", fuels: ["Diesel", "Plug-in hybrid"], newPrice: 42000 },
  { make: "Audi", model: "A3", variants: ["35 TFSI S line", "30 TDI Sport"], body: "Hatchback", fuels: ["Petrol", "Diesel"], newPrice: 31000 },
  { make: "Nissan", model: "Qashqai", variants: ["1.3 DIG-T N-Connecta", "e-POWER Tekna"], body: "SUV", fuels: ["Petrol", "Hybrid"], newPrice: 31000 },
  { make: "Kia", model: "Sportage", variants: ["1.6 T-GDi GT-Line", "1.6 HEV 3"], body: "SUV", fuels: ["Petrol", "Hybrid"], newPrice: 33000 },
  { make: "Tesla", model: "Model 3", variants: ["Long Range AWD", "Standard Range Plus"], body: "Saloon", fuels: ["Electric"], newPrice: 45000 },
  { make: "Honda", model: "Civic", variants: ["2.0 e:HEV Sport", "1.0 VTEC SE"], body: "Hatchback", fuels: ["Hybrid", "Petrol"], newPrice: 30000 },
  { make: "Vauxhall", model: "Corsa", variants: ["1.2 SE", "Corsa-e Elite"], body: "Hatchback", fuels: ["Petrol", "Electric"], newPrice: 20000 },
  { make: "Hyundai", model: "Tucson", variants: ["1.6 T-GDi Premium", "1.6 HEV Ultimate"], body: "SUV", fuels: ["Petrol", "Hybrid"], newPrice: 34000 },
  { make: "Mercedes-Benz", model: "C-Class", variants: ["C220d AMG Line", "C300e AMG Line"], body: "Saloon", fuels: ["Diesel", "Plug-in hybrid"], newPrice: 45000 },
  { make: "Skoda", model: "Octavia", variants: ["2.0 TDI SE L", "1.5 TSI SE"], body: "Estate", fuels: ["Diesel", "Petrol"], newPrice: 28000 },
  { make: "Mazda", model: "MX-5", variants: ["2.0 Sport", "1.5 SE-L"], body: "Convertible", fuels: ["Petrol"], newPrice: 28000 },
];

const DESCRIPTIONS = [
  "Full service history with main dealer stamps, two keys and a fresh MOT. Drives beautifully with no warning lights.",
  "One careful owner from new. Recently serviced, new front tyres and brake pads. Clean interior, non-smoker.",
  "Great condition inside and out. Parking sensors, cruise control, Apple CarPlay and Android Auto. Cambelt done.",
  "Low mileage for the year, always garaged. Heated seats, reversing camera and sat nav. HPI clear.",
  "Economical and reliable. Bluetooth, DAB radio, climate control. Minor stone chips on the bonnet, otherwise very tidy.",
];

export interface SeedOptions {
  force: boolean;
  password: string;
  now?: Date;
}

const BUSINESS_TABLES = ["messages", "threads", "reports", "favourites", "saved_searches", "photos", "listings", "sessions", "audit_log", "users", "dealers", "settings"];

export async function seedDemo(c: pg.PoolClient, opts: SeedOptions) {
  const now = opts.now ?? new Date();
  const existing = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM users")).rows[0].n;
  if (existing > 0 && !opts.force) throw new Error("The database already has accounts. Use --force to replace everything with demo data.");
  for (const t of BUSINESS_TABLES) await c.query(`DELETE FROM ${t}`);
  await saveSettings(c, DEFAULT_SETTINGS);

  const rand = rng(20260930);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const ago = (days: number) => new Date(now.getTime() - days * 86400_000);
  const hash = await hashPassword(opts.password);

  // ---- dealers and people ----
  const dealers = {
    northside: { id: newId("d"), slug: "northside-motors", name: "Northside Motors", phone: "0113 496 0000", city: "Leeds", verified: true, since: 400 },
    city: { id: newId("d"), slug: "city-car-centre", name: "City Car Centre", phone: "0161 496 0123", city: "Manchester", verified: false, since: 20 },
  };
  for (const d of Object.values(dealers)) {
    await c.query(
      "INSERT INTO dealers (id, slug, name, phone, city, about, website, verified, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [d.id, d.slug, d.name, d.phone, d.city, `${d.name} is an independent used car dealer in ${d.city}. Every car is inspected, HPI checked and comes with a warranty.`, "", d.verified, ago(d.since)],
    );
  }
  const people: Record<string, { id: string; email: string; name: string; role: string; dealer?: string; dealerRole?: string; since: number }> = {
    admin: { id: newId("u"), email: "admin@demo.local", name: "Alex Admin", role: "admin", since: 500 },
    mod: { id: newId("u"), email: "mod@demo.local", name: "Morgan Moderator", role: "moderator", since: 450 },
    dealer: { id: newId("u"), email: "dealer@demo.local", name: "Dana Northside", role: "member", dealer: dealers.northside.id, dealerRole: "owner", since: 400 },
    sales: { id: newId("u"), email: "sales@demo.local", name: "Sam Sales", role: "member", dealer: dealers.northside.id, dealerRole: "staff", since: 300 },
    city: { id: newId("u"), email: "citycars@demo.local", name: "Chris City", role: "member", dealer: dealers.city.id, dealerRole: "owner", since: 20 },
    seller: { id: newId("u"), email: "seller@demo.local", name: "Pat Private", role: "member", since: 90 },
    buyer: { id: newId("u"), email: "buyer@demo.local", name: "Bailey Buyer", role: "member", since: 60 },
    jo: { id: newId("u"), email: "jo@demo.local", name: "Jo Bristol", role: "member", since: 40 },
    riley: { id: newId("u"), email: "riley@demo.local", name: "Riley London", role: "member", since: 15 },
    jamie: { id: newId("u"), email: "jamie@demo.local", name: "Jamie New", role: "member", since: 1 },
  };
  for (const p of Object.values(people)) {
    await c.query("INSERT INTO users (id, email, name, role, password_hash, dealer_id, dealer_role, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
      p.id,
      p.email,
      p.name,
      p.role,
      hash,
      p.dealer ?? null,
      p.dealerRole ?? null,
      ago(p.since),
    ]);
  }

  // ---- cars ----
  const pictures = new Map<string, { full: Buffer; thumb: Buffer }>();
  const picture = (colour: string, view: number) => {
    const key = `${colour}:${view}`;
    if (!pictures.has(key)) pictures.set(key, { full: carPicture(COLOURS[colour], view, 960, 600), thumb: carPicture(COLOURS[colour], view, 480, 300) });
    return pictures.get(key)!;
  };

  interface Spec {
    owner: string;
    dealer?: string;
    city: string;
    status: "live" | "pending" | "draft" | "rejected" | "sold";
    days: number;
    model?: Model;
    description?: string;
    priceFactor?: number;
    flags?: string[];
    note?: string;
    photos?: number;
  }
  const specs: Spec[] = [];
  for (let i = 0; i < 24; i++) specs.push({ owner: i % 3 === 0 ? "sales" : "dealer", dealer: dealers.northside.id, city: "Leeds", status: "live", days: Math.floor(rand() * 40) });
  for (let i = 0; i < 12; i++) specs.push({ owner: "city", dealer: dealers.city.id, city: "Manchester", status: "live", days: Math.floor(rand() * 18) });
  specs.push({ owner: "seller", city: "York", status: "live", days: 12, model: MODELS[0] });
  specs.push({ owner: "seller", city: "York", status: "live", days: 3, model: MODELS[6] });
  specs.push({ owner: "seller", city: "York", status: "draft", days: 0, model: MODELS[19], description: "", photos: 0 });
  specs.push({ owner: "jo", city: "Bristol", status: "live", days: 8 });
  specs.push({ owner: "jo", city: "Bristol", status: "live", days: 25 });
  specs.push({ owner: "riley", city: "London", status: "rejected", days: 2, model: MODELS[9], note: "The photos show a different car from the one described. Please upload photos of this car." });
  specs.push({ owner: "dealer", dealer: dealers.northside.id, city: "Leeds", status: "sold", days: 30, model: MODELS[3] });
  // Waiting for a moderator: a scammy private listing, a new dealer's car, and a suspiciously cheap one.
  specs.push({
    owner: "jamie",
    city: "Birmingham",
    status: "pending",
    days: 0,
    model: MODELS[13],
    priceFactor: 0.35,
    description: "Selling quickly as I'm moving abroad. Car is with my shipping agent, pay a deposit first by bank transfer only and it will be delivered. Text me on 07700 900123.",
    flags: ["Phone number in the description", "Payment or delivery wording often used in scams", "Price is less than half of similar cars"],
  });
  specs.push({ owner: "city", dealer: dealers.city.id, city: "Manchester", status: "pending", days: 0, flags: [] });
  specs.push({ owner: "riley", city: "London", status: "pending", days: 0, model: MODELS[17], flags: [] });

  const ids: string[] = [];
  for (const [i, s] of specs.entries()) {
    const m = s.model ?? pick(MODELS);
    const age = 1 + Math.floor(rand() * 9);
    const year = now.getUTCFullYear() - age;
    const mileage = Math.round((age * (6000 + rand() * 6000)) / 100) * 100;
    const factor = s.priceFactor ?? Math.max(0.18, 0.85 * Math.pow(0.86, age) * (1 - mileage / 400_000));
    const price = Math.round((m.newPrice * factor) / 50) * 50 * 100;
    const colour = pick(Object.keys(COLOURS));
    const id = newId("l");
    ids.push(id);
    const published = ["live", "sold"].includes(s.status) ? ago(s.days) : null;
    const expires = published ? new Date(published.getTime() + DEFAULT_SETTINGS.listingDays * 86400_000) : null;
    // A few cars have had a price cut.
    const cut = s.status === "live" && i % 5 === 1 ? price + 50_000 : null;
    const created = ago(s.days + 1);
    await c.query(
      `INSERT INTO listings (id, user_id, dealer_id, status, make, model, variant, year, mileage, fuel, transmission, body, colour, price_cents, previous_price_cents,
                             city, description, flags, moderation_note, views, published_at, expires_at, sold_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
      [
        id,
        people[s.owner].id,
        s.dealer ?? null,
        s.status,
        m.make,
        m.model,
        pick(m.variants),
        year,
        mileage,
        pick(m.fuels),
        m.body === "SUV" || m.newPrice > 35000 || rand() < 0.4 ? "Automatic" : "Manual",
        m.body,
        colour,
        price,
        cut,
        s.city,
        s.description ?? pick(DESCRIPTIONS),
        JSON.stringify(s.flags ?? []),
        s.note ?? null,
        published ? Math.floor(rand() * 300) : 0,
        published,
        expires,
        s.status === "sold" ? ago(5) : null,
        created,
        s.status === "pending" ? ago(0.1 + i * 0.01) : created,
      ],
    );
    const n = s.photos ?? 3;
    for (let v = 0; v < n; v++) {
      const pic = picture(colour, (v + i) % 3);
      await c.query("INSERT INTO photos (id, listing_id, position, mime, data, thumb_mime, thumb, size) VALUES ($1, $2, $3, 'image/png', $4, 'image/png', $5, $6)", [
        newId("p"),
        id,
        v + 1,
        pic.full,
        pic.thumb,
        pic.full.length,
      ]);
    }
  }

  // ---- buyer activity ----
  const buyer = people.buyer.id;
  const soldId = ids[specs.findIndex((s) => s.status === "sold")];
  for (const lid of [ids[1], ids[5], ids[26], soldId]) await c.query("INSERT INTO favourites (user_id, listing_id, created_at) VALUES ($1, $2, $3)", [buyer, lid, ago(6)]);
  await c.query("INSERT INTO saved_searches (id, user_id, name, filters, last_seen_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [
    newId("ss"),
    buyer,
    "Family SUV",
    JSON.stringify({ body: "SUV", maxPrice: 2_500_000 }),
    ago(10),
    ago(30),
  ]);
  await c.query("INSERT INTO saved_searches (id, user_id, name, filters, last_seen_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [
    newId("ss"),
    buyer,
    "Cheap hatchback",
    JSON.stringify({ body: "Hatchback", maxPrice: 1_000_000 }),
    ago(1),
    ago(20),
  ]);

  const thread = async (listingId: string, buyerId: string, msgs: [string, string, number][], sellerRead: number | null) => {
    const tid = newId("t");
    const last = msgs[msgs.length - 1][2];
    await c.query("INSERT INTO threads (id, listing_id, buyer_id, buyer_read_at, seller_read_at, last_message_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      tid,
      listingId,
      buyerId,
      ago(last),
      sellerRead === null ? "-infinity" : ago(sellerRead),
      ago(last),
      ago(msgs[0][2]),
    ]);
    for (const [sender, body, days] of msgs) await c.query("INSERT INTO messages (id, thread_id, sender_id, body, created_at) VALUES ($1, $2, $3, $4, $5)", [newId("m"), tid, sender, body, ago(days)]);
  };
  await thread(
    ids[1],
    buyer,
    [
      [buyer, "Hi, is this car still available? Could I come and see it on Saturday morning?", 2],
      [people.sales.id, "Hi Bailey, yes it is. Saturday at 10 works, we're on Otley Road. Bring your licence if you'd like a test drive.", 1.9],
      [buyer, "Great, see you then. Has the cambelt been done?", 1.5],
    ],
    1.9,
  );
  const patFiesta = ids[specs.findIndex((s) => s.owner === "seller" && s.status === "live")];
  await thread(patFiesta, buyer, [[buyer, "Hello, would you take a little less for a quick sale? I can collect this week.", 0.5]], null);
  await thread(ids[26], people.jo.id, [[people.jo.id, "Does it come with a warranty?", 3], [people.city.id, "Yes, 3 months parts and labour, extendable to 12.", 2.8]], 2.8);

  await c.query("INSERT INTO reports (id, listing_id, reporter_id, reason, note, created_at) VALUES ($1, $2, $3, 'wrong_details', $4, $5)", [
    newId("r"),
    ids[27],
    buyer,
    "The mileage in the photos of the dashboard doesn't match the advert.",
    ago(1),
  ]);
}
