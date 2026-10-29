import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/account", useSearchParams: () => new URLSearchParams() }));
import { ProfileMenu } from "@/components/profile-menu";

it("makes the avatar and name an accessible collapsed account-menu button", () => {
  const html = renderToStaticMarkup(createElement(ProfileMenu, { name: "Admin", initial: "A" }));
  expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"[^>]*aria-label="Account menu for Admin"/);
  expect(html).toMatch(/<div[^>]*hidden=""[^>]*role="group"[^>]*aria-label="Account options"/);
});
it("includes Account and the existing confirmed POST sign-out flow", () => {
  const html = renderToStaticMarkup(createElement(ProfileMenu, { name: "Admin", initial: "A" }));
  expect(html).toContain('href="/account?portal=parents"');
  expect(html).toContain("Sign out of eVacTrack?");
  expect(html).toMatch(/<form[^>]*action="\/auth\/sign-out"[^>]*method="post"/);
});
it("does not accept clicks before the menu has hydrated", () => {
  const html = renderToStaticMarkup(createElement(ProfileMenu, { name: "Admin", initial: "A" }));
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Account menu for Admin"/);
});
