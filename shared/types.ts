import type { z } from "zod";
import type { ListingStatus, Role, SearchFilters, settingsSchema } from "./schemas";

export type Settings = z.infer<typeof settingsSchema>;

export interface Meta {
  settings: Settings;
}

export interface Photo {
  id: string;
  /** Full-size image URL. */
  url: string;
  /** Small image for lists (the full one when no thumbnail was uploaded). */
  thumb: string;
}

export interface SellerInfo {
  kind: "dealer" | "private";
  name: string;
  /** Dealer page slug (dealers only). */
  dealerSlug: string | null;
  verified: boolean;
  city: string;
  phone: string | null;
  memberSince: string;
}

/** A listing as the public sees it. */
export interface ListingCard {
  id: string;
  ref: string;
  make: string;
  model: string;
  variant: string;
  year: number;
  mileage: number;
  fuel: string;
  transmission: string;
  body: string;
  priceCents: number;
  /** Set when the price was lowered: the price before the latest cut. */
  previousPriceCents: number | null;
  city: string;
  photo: Photo | null;
  photoCount: number;
  sellerKind: "dealer" | "private";
  sellerName: string;
  verified: boolean;
  publishedAt: string | null;
  saved?: boolean;
}

export interface ListingDetail extends ListingCard {
  colour: string;
  description: string;
  photos: Photo[];
  status: ListingStatus;
  seller: SellerInfo;
  /** The viewer is the seller (or on the dealer's team). */
  mine: boolean;
  expiresAt: string | null;
}

/** A listing as its seller sees it. */
export interface OwnListing extends ListingCard {
  colour: string;
  description: string;
  photos: Photo[];
  status: ListingStatus;
  version: number;
  rejectReason: string | null;
  flags: string[];
  expiresAt: string | null;
  expired: boolean;
  views: number;
  saves: number;
  enquiries: number;
  createdByName: string;
  updatedAt: string;
}

export interface SearchResult {
  items: ListingCard[];
  total: number;
  page: number;
  pages: number;
  makes: { make: string; n: number }[];
}

export interface SavedSearch {
  id: string;
  name: string;
  filters: SearchFilters;
  summary: string;
  newCount: number;
  lastSeenAt: string;
  createdAt: string;
}

export interface ThreadSummary {
  id: string;
  listingId: string;
  listingTitle: string;
  listingStatus: ListingStatus;
  photo: Photo | null;
  priceCents: number;
  /** The other person in the conversation. */
  otherName: string;
  role: "buyer" | "seller";
  lastBody: string;
  lastAt: string;
  unread: number;
}

export interface Message {
  id: string;
  body: string;
  mine: boolean;
  senderName: string;
  createdAt: string;
}

export interface Dealer {
  id: string;
  slug: string;
  name: string;
  phone: string;
  city: string;
  about: string;
  website: string;
  verified: boolean;
  createdAt: string;
}

export interface Report {
  id: string;
  listingId: string;
  listingTitle: string;
  listingStatus: ListingStatus;
  reason: string;
  note: string;
  reporterName: string;
  status: "open" | "dismissed" | "actioned";
  createdAt: string;
  /** Open reports on the same listing. */
  openOnListing: number;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  locked: boolean;
  dealerName: string | null;
  listings: number;
  createdAt: string;
}

export interface Unread {
  messages: number;
  savedSearchMatches: number;
  reviewQueue: number;
  openReports: number;
}
