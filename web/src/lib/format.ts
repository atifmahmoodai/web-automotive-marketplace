import type { Settings } from "../../../shared/types";

// Prices and dates follow the site's currency and locale settings. Amounts are integer cents everywhere.
let money0 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
let locale = "en-GB";
export function applySettings(s: Pick<Settings, "currency" | "locale">) {
  try {
    money0 = new Intl.NumberFormat(s.locale, { style: "currency", currency: s.currency, maximumFractionDigits: 0 });
    locale = s.locale;
  } catch {
    // keep the previous format if the settings are somehow invalid
  }
}
const ok = (n: number | null | undefined): n is number => n !== null && n !== undefined && Number.isFinite(n);
/** £12,346 */
export const fmtPrice = (cents: number | null | undefined) => (ok(cents) ? money0.format(Math.round(cents / 100)) : "—");
export const fmtNum = (n: number | null | undefined) => (ok(n) ? Math.round(n).toLocaleString(locale) : "—");
export const fmtMiles = (n: number) => `${fmtNum(n)} miles`;
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" }) : "—");
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/** "12,500" or "12500.00" → 1250000 cents; NaN for anything that isn't a plain whole or decimal amount. */
export function parseMoney(s: string): number {
  const t = s.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}
export const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace(/\.00$/, "");

/** "5 min ago", "3 h ago", "2 d ago". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const m = (now - Date.parse(iso)) / 60_000;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

/** Days until a date, rounded up (0 when it has passed). */
export const daysLeft = (iso: string | null, now = Date.now()) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - now) / 86400_000)) : 0);

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending: "Waiting for review",
  live: "On the site",
  rejected: "Needs changes",
  sold: "Sold",
  withdrawn: "Withdrawn",
  removed: "Removed by moderators",
  expired: "Expired",
};

export const REPORT_REASON_LABEL: Record<string, string> = {
  scam: "Looks like a scam",
  wrong_details: "Details are wrong",
  already_sold: "Already sold",
  offensive: "Offensive content",
  duplicate: "Listed more than once",
  other: "Something else",
};

export const carTitle = (c: { year: number; make: string; model: string }) => `${c.year} ${c.make} ${c.model}`;
