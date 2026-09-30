import { describe, expect, it } from "vitest";
import { filtersFromParams, paramsFor } from "./filters";

describe("search URLs", () => {
  it("round-trip filters", () => {
    const f = { make: "Ford", maxPrice: 800_000, fuel: "Diesel" as const };
    expect(filtersFromParams(new URLSearchParams(paramsFor(f)))).toEqual(f);
  });
  it("leave defaults out", () => {
    expect(paramsFor({}, "newest", 1)).toBe("");
    expect(paramsFor({}, "price_asc", 3)).toBe("sort=price_asc&page=3");
  });
  it("ignore junk", () => {
    expect(filtersFromParams(new URLSearchParams("maxPrice=abc&minYear=-4&colour=red&make=%20"))).toEqual({});
  });
});
