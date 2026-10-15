import { describe, expect, it } from "vitest";
import { announceOutcome, clearOutcomeNotice, getOutcomeNotice } from "../../src/components/outcome-notice";

describe("outcome notices that outlive their control (QA-04)", () => {
  it("keeps the newest notice per key, success by default, and clears it", () => {
    announceOutcome("certificates:a", { title: "Certificate revoked" });
    announceOutcome("certificates:b", { title: "Other child", tone: "attention" });
    const first = getOutcomeNotice("certificates:a")!;
    expect(first).toMatchObject({ tone: "success", title: "Certificate revoked" });
    announceOutcome("certificates:a", { title: "Certificate prepared" });
    // A newer notice replaces the older one and gets a new id, so the view re-focuses it.
    expect(getOutcomeNotice("certificates:a")).toMatchObject({ title: "Certificate prepared" });
    expect(getOutcomeNotice("certificates:a")!.id).toBeGreaterThan(first.id);
    expect(getOutcomeNotice("certificates:b")).toMatchObject({ tone: "attention" });
    clearOutcomeNotice("certificates:a");
    expect(getOutcomeNotice("certificates:a")).toBeNull();
    expect(getOutcomeNotice("certificates:b")).not.toBeNull();
  });
});
