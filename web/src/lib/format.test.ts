import { describe, expect, it } from "vitest";
import { ago, applySettings, daysLeft, fmtPrice, parseMoney } from "./format";

describe("prices", () => {
  it("read what people type", () => {
    expect(parseMoney("12,500")).toBe(1_250_000);
    expect(parseMoney(" 9999.5 ")).toBe(999_950);
    expect(Number.isNaN(parseMoney("12k"))).toBe(true);
    expect(Number.isNaN(parseMoney("-5"))).toBe(true);
    expect(Number.isNaN(parseMoney("1.234"))).toBe(true);
  });
  it("show in the site's currency without pennies", () => {
    applySettings({ currency: "EUR", locale: "de-DE" });
    expect(fmtPrice(1_234_567)).toMatch(/12\.346\s€/);
    applySettings({ currency: "GBP", locale: "en-GB" });
    expect(fmtPrice(1_234_500)).toBe("£12,345");
    expect(fmtPrice(null)).toBe("—");
  });
});

describe("times", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  it("read naturally", () => {
    expect(ago("2026-09-30T11:55:00Z", now)).toBe("5 min ago");
    expect(ago("2026-09-30T09:00:00Z", now)).toBe("3 h ago");
    expect(ago("2026-09-25T12:00:00Z", now)).toBe("5 d ago");
    expect(ago(null)).toBe("—");
  });
  it("count days left, never below zero", () => {
    expect(daysLeft("2026-10-02T11:00:00Z", now)).toBe(2);
    expect(daysLeft("2026-09-01T00:00:00Z", now)).toBe(0);
  });
});
