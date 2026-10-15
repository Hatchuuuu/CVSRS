import { describe, expect, it } from "vitest";
import { RPC_ALLOWLIST } from "@/lib/db/port";
import { capacityBody, closeDayBody } from "@/lib/validation/visits";
import { childRecordStatusBody, contactInvalidBody } from "@/lib/validation/schemas";
import { profileBody } from "@/lib/validation/account";
import { bookableSessions, type BookableSession } from "@/app/clinic/[clinicId]/children/[childId]/visits";

// 0037: request shapes for the commands added after the 2026-10-04 audit.
describe("new commands are reachable through the allowlist", () => {
  it("lists every 0037 command", () => {
    for (const name of ["close_service_day", "service_day_backlog", "list_child_appointments", "list_session_roster", "update_session_capacity",
      "return_schedule_to_draft", "reject_stock_adjustment", "update_my_profile", "set_child_record_status", "mark_guardian_contact_invalid", "close_stock_location"]) {
      expect(RPC_ALLOWLIST).toContain(name);
    }
  });
});

describe("request validation", () => {
  it("closing a day needs a date", () => {
    expect(closeDayBody.safeParse({ serviceDate: "2026-10-03" }).success).toBe(true);
    expect(closeDayBody.safeParse({ serviceDate: "yesterday" }).success).toBe(false);
  });

  it("capacity follows the same rule as creating a session", () => {
    expect(capacityBody.safeParse({ expectedVersion: 2, totalCapacity: 10, onlineCapacity: 6, walkinCapacity: 4 }).success).toBe(true);
    const over = capacityBody.safeParse({ expectedVersion: 2, totalCapacity: 10, onlineCapacity: 8, walkinCapacity: 4 });
    expect(over.success).toBe(false);
    expect(capacityBody.safeParse({ expectedVersion: 0, totalCapacity: 10, onlineCapacity: 6, walkinCapacity: 4 }).success).toBe(false);
  });

  it("an inactive record needs a reason, and 'other' needs words", () => {
    expect(childRecordStatusBody.safeParse({ status: "inactive" }).success).toBe(false);
    expect(childRecordStatusBody.safeParse({ status: "inactive", reason: "moved" }).success).toBe(true);
    expect(childRecordStatusBody.safeParse({ status: "inactive", reason: "other", note: "x" }).success).toBe(false);
    expect(childRecordStatusBody.safeParse({ status: "inactive", reason: "other", note: "adopted abroad" }).success).toBe(true);
    expect(childRecordStatusBody.safeParse({ status: "active" }).success).toBe(true);
  });

  it("a phone marked as not working needs a note", () => {
    expect(contactInvalidBody.safeParse({ note: "" }).success).toBe(false);
    expect(contactInvalidBody.safeParse({ note: "rings another family" }).success).toBe(true);
  });

  it("a profile needs a name and a supported language", () => {
    expect(profileBody.safeParse({ displayName: "  ", locale: "en" }).success).toBe(false);
    expect(profileBody.safeParse({ displayName: "Ana Reyes", locale: "es" }).success).toBe(false);
    expect(profileBody.safeParse({ displayName: "Ana Reyes", locale: "fil" }).success).toBe(true);
  });
});

describe("staff booking offers only sessions that can still take a booking", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 4, h)).toISOString();
  const s = (id: string, status: string, endHour: number): BookableSession => ({ sessionId: id, serviceDate: "2026-10-04", startsAt: at(endHour - 2), endsAt: at(endHour), status, remainingOnline: 3 });
  it("drops cancelled, closed and finished sessions", () => {
    const now = Date.UTC(2026, 9, 4, 6);
    expect(bookableSessions([s("open-later", "open", 9), s("open-over", "open", 5), s("cancelled", "cancelled", 9), s("closed", "closed", 9)], now).map((x) => x.sessionId)).toEqual(["open-later"]);
  });
});
