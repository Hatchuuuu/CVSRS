import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/server/viewer", () => ({ requireViewer: async () => ({ rpc: { rpc: s.rpc }, ctx: { memberships: [], displayName: "Parent", locale: "en", mfa: false }, session: { email: "parent@example.test" } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/api", () => ({ useMutation: () => ({ state: { phase: "idle" }, run: vi.fn() }) }));
vi.mock("@/app/account/account-forms", () => ({ ProfileForm: () => <div>Profile</div>, PasswordForm: () => <div>Password</div> }));
const prefs = { guardianId: "guardian", language: "en", hasPhone: true, phoneChecked: true, phoneMasked: "09***", smsOptIn: false };
beforeEach(() => s.rpc.mockImplementation(async (name: string) => name === "my_messages" ? { unread: 0, items: [] } : name === "get_contact_preferences" ? prefs : []));
it("keeps the inbox focused and old text anchor links to Account", async () => {
 const { default: Page } = await import("@/app/messages/page");
 const html = renderToStaticMarkup(await Page({}));
 expect(html).toContain('id="txt-h"');
 expect(html).toContain('href="/account?portal=parents#contact-h"');
 expect(html).not.toContain('name="phone"');
 expect(s.rpc).not.toHaveBeenCalledWith("get_contact_preferences");
});
it("places phone preferences in Account without advertising unavailable SMS", async () => {
 const { default: Page } = await import("@/app/account/page");
 const html = renderToStaticMarkup(await Page({}));
 expect(html).toContain('id="contact-h"');
 expect(html).toContain('name="phone"');
 expect(html).not.toContain("Turn text messages on");
 expect(html).toContain("Text delivery is unavailable");
});
it("account contact read failures remain errors", async () => {
 s.rpc.mockResolvedValue(null);
 const { default: Page } = await import("@/app/account/page");
 await expect(Page({})).rejects.toThrow("Contact preferences could not be loaded");
});

it("keeps timestamp ties and portal context in the older-message cursor", async () => {
 const at = "2026-10-17T00:00:00Z";
 s.rpc.mockImplementation(async (name: string) => name === "my_messages" ? { unread: 0, items: Array.from({ length: 51 }, (_, n) => ({ id: `message-${n}`, title: `Update ${n}`, body: "Clinic update", createdAt: at, childId: null, read: true })) } : []);
 const { default: Page } = await import("@/app/messages/page");
 const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ portal: "parents" }) }));
 expect(html).toContain("beforeId=message-49");
 expect(html).toContain("portal=parents");
 expect(html).not.toContain("Update 50");
});
it("message timezone data failure is not presented as a healthy inbox", async () => {
 s.rpc.mockImplementation(async (name: string) => name === "my_children" ? null : { unread: 0, items: [] });
 const { default: Page } = await import("@/app/messages/page");
 await expect(Page({})).rejects.toThrow("Children could not be loaded");
});

it("explains contact setup for a new family without a guardian row", async () => {
 s.rpc.mockImplementation(async (name: string) => name === "get_contact_preferences" ? null : []);
 const { default: Page } = await import("@/app/account/page");
 expect(renderToStaticMarkup(await Page({}))).toContain("after you register or link a child");
});
