import { describe, it, expect } from "vitest";
import { formatDate, formatTime, timeLeft } from "./api";
describe("offer deadline display", () => {
  it("clamps expired deadlines", () =>
    expect(
      timeLeft("2026-11-18T12:00:00Z", Date.parse("2026-11-18T12:00:01Z")),
    ).toBe("0:00"));
  it("shows remaining minutes", () =>
    expect(
      timeLeft("2026-11-18T12:01:05Z", Date.parse("2026-11-18T12:00:00Z")),
    ).toBe("1:05"));
  it("formats both sides of daylight saving", () => {
    expect(formatTime("2026-11-01T06:30:00Z", "America/Chicago")).toBe(
      "1:30 AM CDT",
    );
    expect(formatTime("2026-11-01T07:30:00Z", "America/Chicago")).toBe(
      "1:30 AM CST",
    );
    expect(formatDate("2026-11-18T01:00:00Z", "America/Chicago")).toContain(
      "Nov 17",
    );
  });
});
