import { describe, expect, it } from "vitest";
import { clinicDateBoundary, clinicToday, formatClinicTime } from "@/lib/format";

describe("clinic calendar boundaries", () => {
  it("uses the clinic date around the UTC midnight boundary", () => {
    expect(clinicToday("Pacific/Honolulu", new Date("2026-09-30T02:00:00Z"))).toBe("2026-09-29");
    expect(clinicToday("Asia/Manila", new Date("2026-09-30T02:00:00Z"))).toBe("2026-09-30");
  });

  it("converts a clinic date range to inclusive UTC audit bounds across daylight saving", () => {
    expect(clinicDateBoundary("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(clinicDateBoundary("2026-03-08", "America/New_York", true).toISOString()).toBe("2026-03-09T03:59:59.999Z");
  });

  it("renders the same appointment instant in each clinic's timezone", () => {
    expect(formatClinicTime("2026-09-30T02:00:00Z", "Asia/Manila")).toContain("10:00");
    expect(formatClinicTime("2026-09-30T02:00:00Z", "Pacific/Honolulu")).toContain("4:00");
  });
});
