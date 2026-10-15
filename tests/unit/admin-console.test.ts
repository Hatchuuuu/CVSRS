import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The admin console renders only what the viewer's role admits; the database authorizes every action again.
const stub = vi.hoisted(() => ({ staff: null as unknown, notFound: vi.fn(() => { throw new Error("not found"); }) }));
vi.mock("@/lib/server/viewer", () => ({ requireClinicStaff: async () => stub.staff }));
vi.mock("next/navigation", () => ({ notFound: stub.notFound, useRouter: () => ({ refresh() {} }), usePathname: () => "/" }));

import AdminConsole from "@/app/clinic/[clinicId]/admin/page";

const clinicId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "11111111-1111-4111-8111-111111111111";
const TECH_ADMIN = ["admin.users", "admin.config"];
const LEAD = ["child.search", "child.read_clinical", "rules.propose", "rules.approve", "audit.read", "grant.approve.clinical", "report.run"];

const app = (id: string, extra: object = {}) => ({
  applicationId: id, profileId: `p-${id}`, displayName: `Applicant ${id}`, email: `${id}@example.ph`, emailConfirmed: true, requestedRole: "clinical_staff",
  positionTitle: "Midwife", note: "Starting Monday", status: "pending", version: 1, createdAt: "2026-10-03T02:00:00Z", decidedAt: null, decidedByName: null,
  decisionReason: null, membershipId: null, membershipStatus: null, grantedRole: null, requiresClinicalApproval: true, ...extra,
});
const membership = (id: string, extra: object = {}) => ({
  membershipId: id, profileId: `p-${id}`, displayName: `Person ${id}`, role: "assistant", status: "pending_approval", version: 1,
  requestedBy: "someone-else", requiresClinicalApproval: false, ...extra,
});

function staff(caps: string[], data: { pending?: unknown; decided?: unknown; memberships?: unknown } = {}) {
  const fail = (v: unknown) => v instanceof Error;
  stub.staff = {
    ctx: { profileId: ME },
    membership: { clinicId, clinicName: "San Isidro Health Center", clinicTimezone: "Asia/Manila", role: "tech_admin", capabilities: caps },
    rpc: {
      rpc: async (name: string, args: { p_view?: string }) => {
        const v = name === "list_staff_memberships" ? data.memberships : args.p_view === "decided" ? data.decided : data.pending;
        if (fail(v)) throw v;
        return v ?? [];
      },
    },
  };
}
const render = async () => renderToStaticMarkup(await AdminConsole({ params: Promise.resolve({ clinicId }) }));

beforeEach(() => { stub.notFound.mockClear(); });

describe("admin console", () => {
  it("shows waiting applications with their details and the accept and decline actions", async () => {
    staff(TECH_ADMIN, { pending: [app("a1")], memberships: [membership("m1", { status: "active" })] });
    const out = await render();
    expect(out).toContain("Admin console");
    expect(out).toContain("Applicant a1");
    expect(out).toContain("a1@example.ph");
    expect(out).toContain("Clinical staff (nurse or midwife)");
    expect(out).toContain("Midwife");
    expect(out).toContain("Starting Monday");
    expect(out).toContain("3 Oct 2026");
    expect(out).toContain('aria-label="Accept application from Applicant a1"');
    expect(out).toContain('aria-label="Decline application from Applicant a1"');
    expect(out).toContain("/evactrackstafflogin/create-account");
    // Counts: one application, nothing to approve, one active staff member.
    expect(out).toMatch(/Applications waiting<\/span><span[^>]*>1</);
    expect(out).toMatch(/Access requests to approve<\/span><span[^>]*>0</);
    expect(out).toMatch(/Active staff<\/span><span[^>]*>1</);
  });

  it("flags an unconfirmed email, and never offers a decision on the viewer's own application", async () => {
    staff(TECH_ADMIN, { pending: [app("a2", { emailConfirmed: false }), app("mine", { profileId: ME })] });
    const out = await render();
    expect(out).toContain("Email not confirmed yet");
    expect(out).toContain("This is your own application. Another administrator decides it.");
    expect(out).not.toContain('aria-label="Accept application from Applicant mine"');
  });

  it("offers approval only to someone other than the requester, with the right capability", async () => {
    staff(TECH_ADMIN, {
      memberships: [
        membership("by-me", { requestedBy: ME }),
        membership("non-clinical"),
        membership("clinical", { role: "clinical_staff", requiresClinicalApproval: true }),
      ],
    });
    const out = await render();
    expect(out).toContain("You requested this, so someone else must approve it.");
    expect(out).toContain('aria-label="Approve access for Person non-clinical"');
    expect(out).not.toContain('aria-label="Approve access for Person by-me"');
    // A technical administrator cannot approve clinical access; a clinical lead does.
    expect(out).not.toContain('aria-label="Approve access for Person clinical"');
    expect(out).toContain("Your role cannot approve this one.");
  });

  it("lists recent decisions with who decided and the reason", async () => {
    staff(TECH_ADMIN, {
      decided: [
        app("d1", { status: "rejected", decidedByName: "Admin Cruz", decidedAt: "2026-10-03T04:00:00Z", decisionReason: "Not on our staff list" }),
        app("d2", { status: "accepted", decidedByName: "Admin Cruz", decidedAt: "2026-10-03T05:00:00Z", membershipStatus: "pending_approval", grantedRole: "assistant" }),
      ],
    });
    const out = await render();
    expect(out).toContain("Recently decided (2)");
    expect(out).toContain("Declined");
    expect(out).toContain("Not on our staff list");
    expect(out).toContain("waiting for a second approval");
    expect(out).toContain("Registration assistant");
  });

  it("reports failed reads instead of saying nothing is waiting", async () => {
    staff(TECH_ADMIN, { pending: new Error("down"), memberships: new Error("down") });
    const out = await render();
    expect(out).toContain("Applications could not be loaded");
    expect(out).toContain("Access requests could not be loaded");
    expect(out).not.toContain("No applications waiting");
  });

  it("links every administration area the role admits, and only those", async () => {
    staff(TECH_ADMIN);
    const admin = await render();
    for (const href of ["access", "settings", "clinical", "content"]) expect(admin).toContain(`href="/clinic/${clinicId}/${href}"`);
    for (const href of ["audit", "reports"]) expect(admin).not.toContain(`href="/clinic/${clinicId}/${href}"`);
    staff(LEAD);
    const lead = await render();
    for (const href of ["access", "settings", "clinical", "content", "audit", "reports"]) expect(lead).toContain(`href="/clinic/${clinicId}/${href}"`);
  });

  it("is not available to roles without administration rights", async () => {
    staff(["child.search", "queue.manage"]);
    await expect(render()).rejects.toThrow("not found");
    expect(stub.notFound).toHaveBeenCalled();
  });
});
