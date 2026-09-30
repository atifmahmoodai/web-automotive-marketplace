import { describe, expect, it } from "vitest";
import { cleanFilters, describeFilters, listingRef, median, reviewFlags, submitProblems } from "./market";
import { listingSchema, searchQuerySchema, searchSchema } from "./schemas";

const base = { description: "Lovely car, full service history, two keys.", priceCents: 10_000_00, medianCents: 11_000_00, photoCount: 3 };
const money = (c: number) => `£${(c / 100).toLocaleString("en-GB")}`;

describe("reviewFlags", () => {
  it("passes an ordinary listing", () => {
    expect(reviewFlags(base)).toEqual([]);
  });
  it("catches contact details that move buyers off the site", () => {
    expect(reviewFlags({ ...base, description: "Email me at bob@example.com" })).toContain("Email address in the description");
    expect(reviewFlags({ ...base, description: "Call 07700 900123 for a chat" })).toContain("Phone number in the description");
    expect(reviewFlags({ ...base, description: "More pics at www.example.com" })).toContain("Web link in the description");
  });
  it("does not mistake mileage or engine sizes for a phone number", () => {
    expect(reviewFlags({ ...base, description: "1.6 TDCi, 45,000 miles, MOT until 03/2027, cambelt at 60000" })).toEqual([]);
  });
  it("catches deposit and shipping scams", () => {
    expect(reviewFlags({ ...base, description: "Car is with my shipping agent, pay deposit first" })).toContain("Payment or delivery wording often used in scams");
  });
  it("flags a price under half the going rate only when there is something to compare with", () => {
    expect(reviewFlags({ ...base, priceCents: 5_000_00 })).toContain("Price is less than half of similar cars");
    expect(reviewFlags({ ...base, priceCents: 5_600_00 })).toEqual([]);
    expect(reviewFlags({ ...base, priceCents: 100_00, medianCents: null })).toEqual([]);
  });
  it("flags a listing with no photos", () => {
    expect(reviewFlags({ ...base, photoCount: 0 })).toContain("No photos");
  });
});

describe("submitProblems", () => {
  it("needs a photo and a real description", () => {
    expect(submitProblems({ photoCount: 0, description: "short" })).toHaveLength(2);
    expect(submitProblems({ photoCount: 1, description: "A good description of the car that is long enough." })).toEqual([]);
  });
});

describe("search filters", () => {
  it("parse query strings, dropping empty values", () => {
    const f = searchQuerySchema.parse({ make: "Ford", maxPrice: "800000", fuel: "", page: "2", sort: "" });
    expect(f).toMatchObject({ make: "Ford", maxPrice: 800000, page: 2, sort: "newest" });
    expect(f.fuel).toBeUndefined();
  });
  it("reject unknown values", () => {
    expect(searchQuerySchema.safeParse({ sort: "price; DROP TABLE" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ fuel: "Steam" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ page: "1000" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ maxPrice: "abc" }).success).toBe(false);
  });
  it("clean into a stable order", () => {
    const a = cleanFilters(searchSchema.parse({ maxPrice: 5, make: "Ford" }));
    const b = cleanFilters(searchSchema.parse({ make: "Ford", maxPrice: 5, q: "" }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("describe themselves", () => {
    expect(describeFilters({}, money)).toBe("All cars");
    expect(describeFilters({ make: "Ford", model: "Focus", maxPrice: 8_000_00, fuel: "Diesel", seller: "dealer" }, money)).toBe("Ford Focus · under £8,000 · Diesel · dealers only");
    expect(describeFilters({ minYear: 2018, maxYear: 2018 }, money)).toBe("2018");
  });
});

describe("listing input", () => {
  const ok = { make: "Ford", model: "Focus", variant: "", year: 2019, mileage: 40000, fuel: "Petrol", transmission: "Manual", body: "Hatchback", colour: "Blue", priceCents: 9_500_00, city: "Leeds", description: "" };
  it("accepts a normal car", () => {
    expect(listingSchema.safeParse(ok).success).toBe(true);
  });
  it("rejects a free car and a nonsense year", () => {
    expect(listingSchema.safeParse({ ...ok, priceCents: 0 }).success).toBe(false);
    expect(listingSchema.safeParse({ ...ok, year: 1900 }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(3);
  });
  it("listingRef", () => {
    expect(listingRef(42)).toBe("AM-000042");
  });
});
