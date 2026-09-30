import { describe, expect, it } from "vitest";
import { fitWithin } from "./images";

describe("fitWithin", () => {
  it("shrinks big photos keeping their shape", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ w: 1200, h: 1600 });
  });
  it("never enlarges small ones", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ w: 800, h: 600 });
  });
  it("never produces a zero side", () => {
    expect(fitWithin(10000, 2, 480)).toEqual({ w: 480, h: 1 });
  });
});
