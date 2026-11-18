import { describe, it, expect } from "vitest";
import { localInstants } from "./local-time";
describe("local appointment entry", () => {
  it("resolves an ordinary time independently of the machine zone", () =>
    expect(localInstants("2026-11-18T09:00", "America/Chicago")).toEqual([
      "2026-11-18T15:00:00.000Z",
    ]));
  it("rejects nonexistent spring clock times", () =>
    expect(localInstants("2027-03-14T02:30", "America/Chicago")).toEqual([]));
  it("returns both fall clock occurrences in order", () =>
    expect(localInstants("2027-11-07T01:30", "America/Chicago")).toEqual([
      "2027-11-07T06:30:00.000Z",
      "2027-11-07T07:30:00.000Z",
    ]));
  it("handles quarter-hour UTC offsets", () =>
    expect(localInstants("2026-11-18T09:00", "Asia/Kathmandu")).toEqual([
      "2026-11-18T03:15:00.000Z",
    ]));
  it("rejects calendar dates that would normalize", () =>
    expect(localInstants("2027-02-30T09:00", "UTC")).toEqual([]));
});
