import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/children" }));
import { MobileNav } from "@/components/mobile-nav";

it("keeps the workspace menu inactive until its disclosure handler hydrates", () => {
  const html = renderToStaticMarkup(<MobileNav unread={0} sidebar>Destinations</MobileNav>);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Menu"/);
  expect(html).toContain('aria-expanded="false"');
});
