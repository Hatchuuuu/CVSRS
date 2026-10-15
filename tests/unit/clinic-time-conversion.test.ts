import { afterEach, describe, expect, it } from "vitest";
import { clinicLocalToInstant, formatClinicDate, instantToClinicLocal } from "@/lib/format";

// The helpers must not depend on the device/server zone. Node applies a changed TZ to later Date work.
const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe.each(["UTC", "America/New_York", "Asia/Manila"])("clinic wall time with the process zone set to %s", (tz) => {
  it("reads a datetime-local value in the clinic zone, not the device zone", () => {
    process.env.TZ = tz;
    expect(clinicLocalToInstant("2026-10-01T07:00", "Asia/Manila")).toBe("2026-09-30T23:00:00.000Z");
    expect(clinicLocalToInstant("2026-10-01T07:00:30", "Asia/Manila")).toBe("2026-09-30T23:00:30.000Z");
  });

  it("shows an instant as clinic wall time for a datetime-local field", () => {
    process.env.TZ = tz;
    expect(instantToClinicLocal("2026-09-30T23:00:00.000Z", "Asia/Manila")).toBe("2026-10-01T07:00");
    expect(instantToClinicLocal(new Date("2026-10-01T15:59:59Z"), "Asia/Manila")).toBe("2026-10-01T23:59");
  });

  it("dates an early-morning event by the clinic calendar", () => {
    process.env.TZ = tz;
    expect(formatClinicDate("2026-10-01T23:30:00Z", "Asia/Manila")).toBe("2 Oct 2026");
  });
});

describe("daylight saving clinics", () => {
  it("uses the offset in force on that date", () => {
    expect(clinicLocalToInstant("2026-01-15T09:00", "America/New_York")).toBe("2026-01-15T14:00:00.000Z");
    expect(clinicLocalToInstant("2026-07-15T09:00", "America/New_York")).toBe("2026-07-15T13:00:00.000Z");
    expect(instantToClinicLocal("2026-07-15T13:00:00Z", "America/New_York")).toBe("2026-07-15T09:00");
  });

  it("moves a wall time inside the spring-forward gap past the gap", () => {
    // 02:30 does not exist on 8 Mar 2026 in New York; it is read as 03:30 EDT (like Temporal's "compatible").
    expect(clinicLocalToInstant("2026-03-08T02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
  });

  it("takes the earlier of two repeated fall-back wall times", () => {
    // 01:30 happens twice on 1 Nov 2026 in New York: first at EDT (05:30Z), then at EST (06:30Z).
    expect(clinicLocalToInstant("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });

  it("round-trips across the year", () => {
    for (const local of ["2026-03-07T23:15", "2026-03-08T04:00", "2026-11-01T00:59", "2026-11-01T02:00", "2026-12-31T23:59"]) {
      expect(instantToClinicLocal(clinicLocalToInstant(local, "America/New_York")!, "America/New_York")).toBe(local);
    }
  });
});

describe("invalid input", () => {
  it("returns null instead of guessing", () => {
    expect(clinicLocalToInstant("", "Asia/Manila")).toBeNull();
    expect(clinicLocalToInstant("2026-02-30T07:00", "Asia/Manila")).toBeNull();
    expect(clinicLocalToInstant("07:00", "Asia/Manila")).toBeNull();
    expect(instantToClinicLocal("not a date", "Asia/Manila")).toBe("");
  });
});
