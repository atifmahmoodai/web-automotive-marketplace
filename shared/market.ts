// Marketplace rules that both the API and the web app use.
import type { SearchFilters } from "./schemas";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  siteName: "AutoMarket",
  currency: "GBP",
  locale: "en-GB",
  listingDays: 60,
  reviewUnverified: true,
  maxNewEnquiriesPerDay: 20,
  maxListingsPerPrivateSeller: 3,
};

export interface ReviewInput {
  description: string;
  priceCents: number;
  /** Median price of comparable live listings (same make/model, ±2 years), if there are enough of them. */
  medianCents: number | null;
  photoCount: number;
}

/**
 * Reasons a listing should be looked at by a person before it goes live. These catch the common
 * marketplace scams: contact details that move the buyer off the site, payment instructions, and a
 * price far under the going rate to lure deposits.
 */
export function reviewFlags(l: ReviewInput): string[] {
  const flags: string[] = [];
  const d = l.description.toLowerCase();
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(d)) flags.push("Email address in the description");
  if (/(\+?\d[\d\s().-]{8,}\d)/.test(d)) flags.push("Phone number in the description");
  if (/https?:\/\/|www\./.test(d)) flags.push("Web link in the description");
  if (/\b(western union|moneygram|gift ?cards?|crypto|bitcoin|bank transfer only|deposit (first|now|to secure)|courier|shipping agent)\b/.test(d)) {
    flags.push("Payment or delivery wording often used in scams");
  }
  if (l.medianCents !== null && l.priceCents < l.medianCents * 0.5) flags.push("Price is less than half of similar cars");
  if (l.photoCount === 0) flags.push("No photos");
  return flags;
}

/** What a seller must fix before submitting (hard rules, unlike the review flags). */
export function submitProblems(l: { photoCount: number; description: string }): string[] {
  const p: string[] = [];
  if (l.photoCount < 1) p.push("Add at least one photo.");
  if (l.description.trim().length < 30) p.push("Write a description of at least 30 characters.");
  return p;
}

export const FILTER_KEYS = ["q", "make", "model", "minPrice", "maxPrice", "minYear", "maxYear", "maxMileage", "fuel", "transmission", "body", "city", "seller"] as const;

/** Filters without empty values, in a fixed key order (so equal searches compare equal). */
export function cleanFilters(f: SearchFilters): SearchFilters {
  const out: Record<string, unknown> = {};
  for (const k of FILTER_KEYS) {
    const v = f[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out as SearchFilters;
}

/** A short human summary of a search, e.g. "Ford Focus · under £8,000 · Diesel". */
export function describeFilters(f: SearchFilters, money: (cents: number) => string): string {
  const parts: string[] = [];
  const car = [f.make, f.model].filter(Boolean).join(" ");
  if (car) parts.push(car);
  if (f.q) parts.push(`"${f.q}"`);
  if (f.minPrice !== undefined && f.maxPrice !== undefined) parts.push(`${money(f.minPrice)}–${money(f.maxPrice)}`);
  else if (f.maxPrice !== undefined) parts.push(`under ${money(f.maxPrice)}`);
  else if (f.minPrice !== undefined) parts.push(`over ${money(f.minPrice)}`);
  if (f.minYear !== undefined || f.maxYear !== undefined) parts.push(f.minYear === f.maxYear ? `${f.minYear}` : `${f.minYear ?? "any"}–${f.maxYear ?? "now"}`);
  if (f.maxMileage !== undefined) parts.push(`under ${f.maxMileage.toLocaleString("en")} miles`);
  for (const k of ["fuel", "transmission", "body"] as const) if (f[k]) parts.push(f[k]!);
  if (f.city) parts.push(`in ${f.city}`);
  if (f.seller) parts.push(f.seller === "dealer" ? "dealers only" : "private sellers only");
  return parts.join(" · ") || "All cars";
}

/** Middle value of a list (null for an empty one). */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Listing reference shown to buyers and used on the phone: AM-000123. */
export const listingRef = (n: number) => `AM-${String(n).padStart(6, "0")}`;
