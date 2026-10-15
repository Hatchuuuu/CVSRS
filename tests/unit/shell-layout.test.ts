import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";

// The root layout is rendered with its server dependencies simulated; the markup is what every page ships with.
const stub = vi.hoisted(() => ({
  viewer: null as unknown,
  demo: false,
  nonce: "test-nonce-123" as string | null,
  path: "/children",
}));
vi.mock("@/lib/server/viewer", () => ({
  ConfigError: class ConfigError extends Error {},
  getViewer: async () => stub.viewer,
}));
vi.mock("@/lib/db/local", () => ({ isDemoDatabase: async () => stub.demo }));
vi.mock("@/lib/env", () => ({ getConfig: () => ({ localDbUrl: "postgresql://demo" }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(stub.nonce ? { "x-nonce": stub.nonce } : {}) }));
vi.mock("next/navigation", () => ({ usePathname: () => stub.path, useRouter: () => ({ refresh() {}, push() {} }) }));
vi.mock("next/font/google", () => ({ Comfortaa: () => ({ variable: "--font-comfortaa" }), Nunito: () => ({ variable: "--font-nunito" }) }));
vi.mock("@/components/toaster", () => ({ AppToaster: () => null }));

import RootLayout from "@/app/layout";

function viewer(unread: number | null, memberships: unknown[] = []) {
  return {
    mode: "local-dev",
    session: { email: "family@demo.cvsrs.test" },
    ctx: { displayName: "Fam Ily", mfa: true, memberships },
    rpc: { rpc: async () => { if (unread === null) throw new Error("down"); return { unread }; } },
  };
}

async function render(): Promise<string> {
  const tree = (await RootLayout({ children: createElement("p", null, "page body") })) as ReactElement;
  return renderToStaticMarkup(tree);
}

describe("root layout shell", () => {
  beforeEach(() => { stub.viewer = viewer(6); stub.demo = false; stub.nonce = "test-nonce-123"; stub.path = "/children"; });

  it("passes the per-request CSP nonce to the theme pre-paint script (UI-09)", async () => {
    const html = await render();
    expect(html).toMatch(/<script[^>]*nonce="test-nonce-123"/);
  });

  it("names the unread count only through the link's accessible name, with no escaping sr-only text (UI-01)", async () => {
    const html = await render();
    expect(html).toContain('aria-label="Messages, 6 unread"');
    expect(html).not.toContain('<span class="sr-only"> unread</span>');
    stub.viewer = viewer(null);
    const failed = await render();
    expect(failed).toContain('aria-label="Messages, unread count unavailable"');
    expect(failed).not.toContain(">Unread count unavailable<");
  });

  it("offers a compact menu below sm with the unread count on the trigger, and no sticky control group (UI-02)", async () => {
    const html = await render();
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/);
    expect(html).toContain("Menu, 6 unread messages");
    expect(html).not.toContain("sticky right-0");
    expect(html).not.toContain("Swipe the navigation row");
  });

  it("uses a scalable brand tag size and a 44px back-to-top target (UI-10, UI-13)", async () => {
    expect(await render()).not.toContain("text-[10px]");
    // Only the landing page's full footer offers "Back to top"; working pages keep a one-line footer.
    stub.path = "/";
    const html = await render();
    expect(html).toMatch(/<a href="#main" class="[^"]*min-h-11[^"]*"[^>]*>Back to top/);
  });

  it("does not render the demo notice banner (UI-16)", async () => {
    stub.demo = true;
    const html = await render();
    expect(html).not.toContain("Local demo");
  });

  it("never shows configuration detail to users and logs it server-side instead (SEC-06)", async () => {
    const { ConfigError } = await import("@/lib/server/viewer");
    const getViewer = vi.spyOn(await import("@/lib/server/viewer"), "getViewer");
    getViewer.mockRejectedValueOnce(new ConfigError("CVSRS_TRUSTED_CLIENT_IP_HEADER must be set in production"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render();
    expect(html).not.toContain("CVSRS_TRUSTED_CLIENT_IP_HEADER");
    expect(html).toContain("The service is not configured.");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[layout]"), expect.stringContaining("CVSRS_TRUSTED_CLIENT_IP_HEADER"));
    log.mockRestore();
    getViewer.mockRestore();
  });

  it("measures the header so sticky regions can clear it (UI-11)", async () => {
    const html = await render();
    expect(html).toMatch(/<header[^>]*data-site-header/);
  });

  it.each(["tech_admin", "clinical_staff", "bhw"])("keeps parent navigation out of the %s header", async (role) => {
    stub.viewer = viewer(0, [{ membershipId: "m1", clinicId: "c1", clinicName: "Clinic", clinicTimezone: "Asia/Manila", role, status: "active", validUntil: null, capabilities: role === "tech_admin" ? ["admin.users"] : ["bhw.followup"] }]);
    const html = await render();
    expect(html).not.toContain(">My Children<");
    expect(html).not.toContain(">Care Info<");
    expect(html).toContain(role === "tech_admin" ? ">Admin console<" : ">Follow-up list<");
    expect(html).toContain('aria-label="Workspace sidebar"');
    expect(html).toContain('href="/account"');
  });

  it("keeps family navigation for parent accounts", async () => {
    const html = await render();
    expect(html).toContain(">My Children<");
    expect(html).toContain(">Care Info<");
    expect(html).not.toContain(">Admin console<");
    expect(html).not.toContain(">Clinic workspace<");
    expect(html).toContain('aria-label="Workspace sidebar"');
  });

  it("makes the skip-link target focusable without adding it to the tab order", async () => {
    const html = await render();
    expect(html).toMatch(/<main[^>]*id="main"[^>]*tabindex="-1"/);
  });
});
