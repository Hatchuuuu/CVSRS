import { describe, expect, it } from "vitest";
import { invalidCertificates } from "../../scripts/backup-integrity";

const valid = { status: "issued", content_hash: "snapshot", recomputed: "snapshot", sha256: "pdf", pdf_actual: "pdf" };
describe("restored certificate integrity", () => {
  it("fails when an issued certificate's PDF is missing even if its snapshot is intact", () => {
    expect(invalidCertificates([{ ...valid, sha256: null, pdf_actual: null }])).toBe(1);
  });
  it("accepts intentionally pending documents, but rejects corrupt snapshots and PDF bytes", () => {
    expect(invalidCertificates([{ ...valid, status: "pending", sha256: null, pdf_actual: null }])).toBe(0);
    expect(invalidCertificates([valid])).toBe(0);
    expect(invalidCertificates([{ ...valid, pdf_actual: "wrong" }, { ...valid, recomputed: "wrong" }])).toBe(2);
  });
});
