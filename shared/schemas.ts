import { z } from "zod";

// Input rules shared by the API (enforced) and the web app (early feedback).

const text = (max: number) => z.string().trim().max(max);
const cents = z.number().int().min(0).max(1_000_000_000);
const email = z.string().trim().toLowerCase().email().max(200);

/** member: buys and sells. moderator: reviews listings and reports. admin: also settings and staff roles. */
export const ROLES = ["member", "moderator", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const isStaff = (r: Role | undefined) => r === "moderator" || r === "admin";

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
export const passwordSchema = z
  .string()
  .min(10, "At least 10 characters")
  .max(200)
  .refine((p) => /[a-z]/i.test(p) && /\d/.test(p), "Use letters and at least one number");
export const registerSchema = z.object({ email, name: text(80).min(2, "Enter your name"), password: passwordSchema });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });
export const userUpdateSchema = z.object({ role: z.enum(ROLES), active: z.boolean() });

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  dealerId: string | null;
  dealerRole: "owner" | "staff" | null;
}

export const settingsSchema = z.object({
  siteName: text(80).min(1),
  currency: z.string().regex(/^[A-Z]{3}$/, "3-letter code like GBP"),
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "Like en-GB"),
  /** Days a listing stays up before the seller has to renew it. */
  listingDays: z.number().int().min(7).max(365),
  /** Listings from private sellers and unverified dealers wait for a moderator. */
  reviewUnverified: z.boolean(),
  /** New conversations one member may start per day (spam brake). */
  maxNewEnquiriesPerDay: z.number().int().min(1).max(500),
  /** Live or waiting listings a private seller may have at once. */
  maxListingsPerPrivateSeller: z.number().int().min(1).max(100),
});

// ---- dealers ----
export const dealerSchema = z.object({
  name: text(100).min(2, "Enter the dealership name"),
  phone: text(40).refine((p) => p === "" || /^\+?[\d ()-]{6,}$/.test(p), "Enter a phone number"),
  city: text(60).min(2, "Enter the town or city"),
  about: text(2000),
  website: z.union([z.literal(""), z.string().trim().url().max(300).refine((u) => /^https?:\/\//.test(u), "Use an http(s) link")]),
});
export const staffAddSchema = z.object({ email });

// ---- listings ----
export const FUELS = ["Petrol", "Diesel", "Hybrid", "Plug-in hybrid", "Electric", "Other"] as const;
export const TRANSMISSIONS = ["Manual", "Automatic"] as const;
export const BODIES = ["Hatchback", "Saloon", "Estate", "SUV", "Coupe", "Convertible", "MPV", "Pickup", "Van", "Other"] as const;
export const LISTING_STATUSES = ["draft", "pending", "live", "rejected", "sold", "withdrawn", "removed"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export const MAX_PHOTOS = 12;

export const listingSchema = z.object({
  make: text(40).min(1, "Enter the make"),
  model: text(60).min(1, "Enter the model"),
  variant: text(80),
  year: z.number().int().min(1950, "1950 or later").max(2100),
  mileage: z.number().int().min(0).max(2_000_000),
  fuel: z.enum(FUELS),
  transmission: z.enum(TRANSMISSIONS),
  body: z.enum(BODIES),
  colour: text(40),
  priceCents: cents.min(100_00, "Enter the asking price"),
  city: text(60).min(2, "Enter the town or city"),
  description: text(5000),
});
export const listingUpdateSchema = z.intersection(listingSchema, z.object({ version: z.number().int() }));
export const photoOrderSchema = z.object({ order: z.array(z.string().max(60)).max(MAX_PHOTOS) });

export const SORTS = ["newest", "price_asc", "price_desc", "mileage", "year_desc"] as const;
export type Sort = (typeof SORTS)[number];

const blank = (v: unknown) => v === "" || v === undefined || v === null;
const optInt = (max: number) => z.preprocess((v) => (blank(v) ? undefined : Number(v)), z.number().int().min(0).max(max).optional());
const optStr = (max: number) => z.preprocess((v) => (blank(v) ? undefined : v), text(max).optional());
const optEnum = <T extends readonly [string, ...string[]]>(values: T) => z.preprocess((v) => (blank(v) ? undefined : v), z.enum(values).optional());

/** Search filters: the same object is used in page URLs, the API and saved searches. */
export const searchSchema = z.object({
  q: optStr(100),
  make: optStr(40),
  model: optStr(60),
  minPrice: optInt(1_000_000_000),
  maxPrice: optInt(1_000_000_000),
  minYear: optInt(2100),
  maxYear: optInt(2100),
  maxMileage: optInt(2_000_000),
  fuel: optEnum(FUELS),
  transmission: optEnum(TRANSMISSIONS),
  body: optEnum(BODIES),
  city: optStr(60),
  seller: optEnum(["dealer", "private"] as const),
});
export type SearchFilters = z.infer<typeof searchSchema>;
export const searchQuerySchema = z.intersection(
  searchSchema,
  z.object({
    sort: z.preprocess((v) => (blank(v) ? "newest" : v), z.enum(SORTS)),
    page: z.preprocess((v) => (blank(v) ? 1 : Number(v)), z.number().int().min(1).max(100)),
  }),
);

export const savedSearchSchema = z.object({ name: text(80).min(1, "Name this search"), filters: searchSchema });

// ---- messaging, reports, moderation ----
export const messageSchema = z.object({ body: z.string().trim().min(1, "Write a message").max(2000) });
export const REPORT_REASONS = ["scam", "wrong_details", "already_sold", "offensive", "duplicate", "other"] as const;
export const reportSchema = z.object({ reason: z.enum(REPORT_REASONS), note: text(1000) });
export const reviewSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({ decision: z.literal("reject"), reason: text(500).min(5, "Tell the seller what to change") }),
]);
export const reasonSchema = z.object({ reason: text(500).min(5, "Give a reason") });
export const reportResolveSchema = z.object({ action: z.enum(["dismiss", "remove_listing"]), note: text(500) });
