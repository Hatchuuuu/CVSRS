import { describe, expect, it } from "vitest";
import { authDestination, authCallbackResult, clinicReturnPath, entryDestination, securityPageFor } from "@/lib/auth/redirect";

describe("auth callback destinations", () => {
  it("accepts only the intended internal destinations", () => {
    expect(authDestination("/children")).toBe("/children");
    expect(authDestination("/account/reset-password")).toBe("/account/reset-password");
    expect(authDestination("/account/security")).toBe("/account/security");
    expect(authDestination("/clinic")).toBe("/clinic");
  });

  it("starts staff in the clinic workspace and everyone else at the family home", () => {
    expect(entryDestination("/clinic")).toBe("/clinic");
    for (const next of ["/children", "/account/security", "/clinic/", "//evil.example", "", null, undefined]) expect(entryDestination(next)).toBe("/children");
  });

  it.each(["//evil.example", "https://evil.example", "/children?next=//evil", "/clinic/", "%2F%2Fevil", null])("rejects unsafe or unexpected destination %s", (next) => {
    expect(authDestination(next)).toBe("/children");
  });

  it("never reflects provider error text in the result URL", () => {
    expect(authCallbackResult("provider_error", "/account/reset-password")).toBe("/sign-in?auth=link-error");
    expect(authCallbackResult(null, "/account/reset-password")).toBe("/account/reset-password");
  });
});

describe("clinic return paths after two-step sign-in (FE-03)", () => {
  const clinic = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const child = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  it.each([`/clinic/${clinic}`, `/clinic/${clinic}/today`, `/clinic/${clinic}/children/${child}`, `/clinic/${clinic}/outage-forms`])("accepts %s", (path) => {
    expect(clinicReturnPath(path)).toBe(path);
    expect(authDestination(path)).toBe(path);
    expect(securityPageFor(path)).toBe(`/account/security?next=${encodeURIComponent(path)}`);
  });
  it.each([
    "/clinic", "/clinic/", `/clinic/${clinic}/`, `/clinic/${clinic}/unknown`, `/clinic/${clinic}/today/extra`, `/clinic/${clinic}/children/${child}/x`,
    `//clinic/${clinic}`, `/clinic//${clinic}`, `\clinic\${clinic}`, `/clinic/${clinic}\today`, `/clinic/${clinic.toUpperCase()}`,
    `/clinic/${clinic}?x=1`, `/clinic/${clinic}#x`, `/clinic/%2F%2Fevil.example`, `/clinic/${clinic}/%74oday`, `https://evil.example/clinic/${clinic}`,
    `/clinic/${clinic}/children/not-a-uuid`, `/clinic/${clinic}/../../children`, " /clinic/" + clinic, "", null, undefined,
  ])("rejects %s", (path) => {
    expect(clinicReturnPath(path)).toBeNull();
    expect(securityPageFor(path)).toBe("/account/security");
    // "/clinic" itself is the staff start page (allowed), but never a clinic return path.
    expect(authDestination(path ?? null)).toBe(path === "/clinic" ? "/clinic" : "/children");
  });
});
