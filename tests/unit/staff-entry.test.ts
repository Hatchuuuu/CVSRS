import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Staff entry: the unlisted staff address, its absence from every public page, the staff forms, and /clinic without access yet.
const stub = vi.hoisted(() => ({ viewer: null as unknown, redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`); }) }));
vi.mock("@/lib/server/viewer", () => ({ requireViewer: async () => stub.viewer, getViewer: async () => stub.viewer }));
vi.mock("next/navigation", () => ({ redirect: stub.redirect, usePathname: () => "/", useRouter: () => ({ refresh() {}, push() {} }) }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PublicNav } from "@/components/public-nav";
import { SiteFooter } from "@/components/site-footer";
import SignInPage from "@/app/sign-in/page";
import SignUpPage from "@/app/sign-up/page";
import StaffSignIn, { metadata as staffSignInMeta } from "@/app/evactrackstafflogin/page";
import StaffSignUp, { metadata as staffSignUpMeta } from "@/app/evactrackstafflogin/create-account/page";
import robots from "@/app/robots";
import { STAFF_SIGN_IN_PATH, STAFF_SIGN_UP_PATH, staffEntryRedirect } from "@/lib/auth/staff-entry";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { SignUpForm } from "@/app/sign-up/sign-up-form";
import ClinicHome from "@/app/clinic/page";
import { staffRoleLabel } from "@/lib/staff-roles";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const clinicId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const membership = (status: string, extra: object = {}) => ({
  membershipId: `m-${status}`, clinicId, clinicName: "San Isidro Health Center", clinicTimezone: "Asia/Manila", role: "clinical_staff",
  status, validUntil: null, capabilities: ["queue.manage"], ...extra,
});
const CLINICS = [{ id: clinicId, name: "San Isidro Health Center" }];
/** A signed-in viewer; `rpc` answers the applicant's applications and the public clinic list (or fails, to test failure states). */
const viewer = (memberships: unknown[], mfa = false, applications: unknown[] | Error = []) => ({
  session: { userId: "u", email: "nurse@example.ph" },
  ctx: { memberships, mfa },
  rpc: {
    rpc: async (name: string) => {
      if (name === "my_staff_applications") { if (applications instanceof Error) throw applications; return applications; }
      if (name === "list_public_clinics") return CLINICS;
      throw new Error(`unexpected rpc ${name}`);
    },
  },
});
const application = (status: string, extra: object = {}) => ({
  applicationId: `a-${status}`, clinicId, clinicName: "San Isidro Health Center", clinicTimezone: "Asia/Manila", requestedRole: "clinical_staff",
  positionTitle: "Midwife", status, decisionReason: null, createdAt: "2026-10-03T02:00:00Z", decidedAt: null, membershipStatus: null, grantedRole: null, ...extra,
});

const FAMILY_SIGN_IN = { text: "New to the family portal?", href: "/sign-in", link: "Create a family account" };
const STAFF_SIGN_UP = { text: "New staff member?", href: STAFF_SIGN_UP_PATH, link: "Create a staff account" };

describe("the unlisted staff address", () => {
  it("is one lowercase path for sign-in and one for new staff accounts", () => {
    expect(STAFF_SIGN_IN_PATH).toBe("/evactrackstafflogin");
    expect(STAFF_SIGN_UP_PATH).toBe("/evactrackstafflogin/create-account");
  });

  it.each([
    ["/EVACTRACKSTAFFLOGIN", "/evactrackstafflogin"],
    ["/EvacTrackStaffLogin", "/evactrackstafflogin"],
    ["/evactrackstafflogin/", "/evactrackstafflogin"],
    ["/EVACTRACKSTAFFLOGIN/CREATE-ACCOUNT", "/evactrackstafflogin/create-account"],
  ])("accepts %s typed by hand and settles on %s", (typed, canonical) => {
    expect(staffEntryRedirect(typed)).toBe(canonical);
  });

  it.each(["/evactrackstafflogin", "/evactrackstafflogin/create-account", "/children", "/evactrackstaffloginx", "/x/evactrackstafflogin", "/EVACTRACKSTAFFLOGIN/other"])(
    "leaves %s alone",
    (path) => expect(staffEntryRedirect(path)).toBeNull(),
  );

  it("redirects a capitalised address with a 308 to the same host, keeping the query", async () => {
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    const response = await proxy(new NextRequest("http://localhost:3000/EVACTRACKSTAFFLOGIN?notice=check_email"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost:3000/evactrackstafflogin?notice=check_email");
  });
});

describe("no public page shows or ships a staff sign-in", () => {
  const hidden = (markup: string) => {
    expect(markup).not.toContain(STAFF_SIGN_IN_PATH);
    expect(markup).not.toMatch(/href="\/staff\//);
    expect(markup).not.toMatch(/staff sign[ -]?in|clinic staff\?|create a staff account/i);
  };

  it("landing footer, signed out and signed in", () => {
    hidden(html(createElement(SiteFooter, { signedIn: false })));
    hidden(html(createElement(SiteFooter, { signedIn: true })));
  });

  it("public header and its menu", () => hidden(html(createElement(PublicNav))));

  it("family sign-in and sign-up pages", async () => {
    hidden(html(await SignInPage({ searchParams: Promise.resolve({}) })));
    hidden(html(await SignUpPage()));
  });

  it("the shared browser code of the public forms, header and footer never contains the staff address", () => {
    for (const file of ["src/app/sign-in/sign-in-form.tsx", "src/app/sign-up/sign-up-form.tsx", "src/components/public-nav.tsx", "src/components/site-footer.tsx"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).not.toContain("evactrackstafflogin");
      expect(source, file).not.toMatch(/from "@\/lib\/auth\/staff-entry"/);
    }
  });

  it("robots.txt does not publish the staff address, and the staff pages ask not to be indexed", () => {
    expect(JSON.stringify(robots())).not.toContain("evactrackstafflogin");
    expect(staffSignInMeta.robots).toMatchObject({ index: false, follow: false });
    expect(staffSignUpMeta.robots).toMatchObject({ index: false, follow: false });
  });
});

describe("staff variants of the shared account forms", () => {
  it("each form shows the link its page supplies", () => {
    expect(html(createElement(SignInForm, { audience: "staff", alternate: STAFF_SIGN_UP }))).toContain(`href="${STAFF_SIGN_UP_PATH}"`);
    expect(html(createElement(SignInForm, { audience: "family", alternate: FAMILY_SIGN_IN }))).toContain('href="/sign-in"');
  });

  it("staff sign-up uses staff wording, makes the phone optional, and files an application to a chosen health center", () => {
    const staff = html(createElement(SignUpForm, { audience: "staff", clinics: CLINICS, alternate: { text: "Already have a staff account?", href: STAFF_SIGN_IN_PATH, link: "Sign in" } }));
    expect(staff).toContain("Work mobile number (optional)");
    expect(staff).not.toMatch(/id="reg-phone"[^>]*required/);
    expect(staff).toMatch(/id="reg-name"[^>]*required/);
    expect(staff).toContain("Create staff account and apply");
    expect(staff).toContain("second person approves my access");
    expect(staff).toMatch(/id="reg-clinic"[^>]*required/);
    expect(staff).toContain("San Isidro Health Center");
    expect(staff).toMatch(/id="reg-role"[^>]*required/);
    expect(staff).toContain("Clinical staff (nurse or midwife)");
    expect(staff).toContain('id="reg-pass"');
    expect(staff).toContain(`href="${STAFF_SIGN_IN_PATH}"`);
    expect(staff).not.toContain("guardian relationship");
    const family = html(createElement(SignUpForm, { audience: "family", alternate: { text: "Already registered?", href: "/sign-in", link: "Sign in" } }));
    expect(family).toMatch(/id="reg-phone"[^>]*required/);
    expect(family).toContain("Create family account");
    expect(family).not.toContain('id="reg-clinic"');
  });

  it("every account form asks for a password twice; no form offers an email-only account", () => {
    for (const audience of ["staff", "family"] as const) {
      const form = html(createElement(SignUpForm, { audience, clinics: CLINICS, alternate: STAFF_SIGN_UP }));
      expect(form).toMatch(/id="reg-pass"[^>]*required/);
      expect(form).toMatch(/id="reg-pass-confirm"[^>]*required/);
      expect(form).not.toMatch(/demo|sandbox/i);
    }
    expect(html(createElement(SignInForm, { audience: "staff", alternate: STAFF_SIGN_UP }))).toMatch(/id="signin-password"[^>]*required/);
  });

  it("a staff form with no health center to apply to says so instead of offering a form that cannot succeed", () => {
    const none = html(createElement(SignUpForm, { audience: "staff", clinics: [], alternate: STAFF_SIGN_UP }));
    expect(none).toContain("No health center is accepting staff applications yet");
    expect(none).not.toContain("<form");
  });

  it("the staff pages render their forms with links that stay inside the staff area", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_xxxxxxxxxxxxxxxxxxxx");
    const signIn = html(await StaffSignIn({ searchParams: Promise.resolve({}) }));
    expect(signIn).toContain("Clinic staff sign in");
    expect(signIn).toContain(`href="${STAFF_SIGN_UP_PATH}"`);
    stub.viewer = viewer([]);
    const signUp = html(await StaffSignUp());
    expect(signUp).toContain("Create a staff account");
    expect(signUp).toContain(`href="${STAFF_SIGN_IN_PATH}"`);
    vi.unstubAllEnvs();
  });

  it("a copy not connected to the sign-in service says so and shows no form that could never succeed", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const signIn = html(await StaffSignIn({ searchParams: Promise.resolve({}) }));
    expect(signIn).toContain("Sign-in is unavailable here right now.");
    expect(signIn).not.toContain("<form");
    const familySignUp = html(await SignUpPage());
    expect(familySignUp).toContain("Accounts cannot be created here right now.");
    expect(familySignUp).not.toContain("<form");
    vi.unstubAllEnvs();
  });
});

describe("/clinic for someone without an active clinic", () => {
  beforeEach(() => { stub.redirect.mockClear(); });
  const render = async () => html(await ClinicHome());

  it("before any application: offers the application form and says two-step sign-in is still needed", async () => {
    stub.viewer = viewer([]);
    const out = await render();
    expect(out).toContain("Clinic workspace");
    expect(out).toContain("nurse@example.ph");
    expect(out).toContain('aria-label="Apply for clinic access"');
    expect(out).toContain("San Isidro Health Center");
    expect(out).toContain("(to do)");
    expect(out).toContain('href="/account/security"');
    expect(out).not.toContain("Waiting for approval");
  });

  it("while an application waits: names the clinic, role and date, offers to withdraw, and hides the form", async () => {
    stub.viewer = viewer([], true, [application("pending")]);
    const out = await render();
    expect(out).toContain("Sent to <strong");
    expect(out).toContain("Midwife");
    expect(out).toContain("3 Oct 2026");
    expect(out).toContain("Withdraw application to San Isidro Health Center");
    expect(out).toContain("Waiting for an administrator at your health center to review your application.");
    expect(out).not.toContain('aria-label="Apply for clinic access"');
  });

  it("after a decline: shows the reason and lets the person apply again", async () => {
    stub.viewer = viewer([], true, [application("rejected", { decisionReason: "Not on our staff list", decidedAt: "2026-10-03T04:00:00Z" })]);
    const out = await render();
    expect(out).toContain("was declined");
    expect(out).toContain("Not on our staff list");
    expect(out).toContain('aria-label="Apply for clinic access"');
  });

  it("reports a failed read of the person's applications instead of showing none", async () => {
    stub.viewer = viewer([], true, new Error("down"));
    const out = await render();
    expect(out).toContain("Your applications could not be loaded");
  });

  it("while access waits for a second approval: names the clinic and role, and says the step is waiting", async () => {
    stub.viewer = viewer([membership("pending_approval")], true, [application("accepted", { membershipStatus: "pending_approval", decidedAt: "2026-10-03T04:00:00Z" })]);
    const out = await render();
    expect(out).toContain("Waiting for approval at <strong");
    expect(out).toContain("San Isidro Health Center");
    expect(out).toContain(staffRoleLabel("clinical_staff"));
    expect(out).toContain("(waiting)");
    expect(out).toContain("Confirmed for this sign-in.");
    expect(out).not.toContain('href="/account/security"');
  });

  it("opens the only active clinic directly, at the page its role starts on", async () => {
    stub.viewer = viewer([membership("active")], true);
    await expect(render()).rejects.toThrow(`redirect:/clinic/${clinicId}/today`);
  });

  it("lists several active clinics with readable role names", async () => {
    stub.viewer = viewer([membership("active"), membership("active", { membershipId: "m2", clinicId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", clinicName: "Riverside", role: "bhw" })], true);
    const out = await render();
    expect(out).toContain("Choose a clinic");
    expect(out).toContain("Barangay health worker");
    expect(out).not.toContain("bhw<");
  });
});

describe("role names", () => {
  it("names every grantable role and falls back to plain words", () => {
    expect(staffRoleLabel("clinical_staff")).toBe("Clinical staff (nurse or midwife)");
    expect(staffRoleLabel("tech_admin")).toBe("Technical administrator");
    expect(staffRoleLabel("some_new_role")).toBe("some new role");
  });
});
