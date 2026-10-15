import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/api", () => ({ useMutation: () => ({
  state: { phase: "error", error: { message: "Check the form.", fieldErrors: { message: "Message is too short.", text: "Notice is too short.", body: "Content is too short." } } }, run: vi.fn(),
}) }));

import { AskTheClinic } from "@/app/children/[childId]/checkin";
import { PrivacyNoticeForm } from "@/app/clinic/[clinicId]/clinical/privacy-form";
import { ContentForm } from "@/app/clinic/[clinicId]/content/forms";
import { DisplayBoard } from "@/app/display/[clinicId]/board";

it.each([
  ["ck-msg", createElement(AskTheClinic, { childId: "child", clinicTimezone: "Asia/Manila", view: { enabled: true, safetyNotice: "Call for urgent help.", items: [] } }), "Message is too short."],
  ["pn-text", createElement(PrivacyNoticeForm, { clinicId: "clinic", current: { configured: false } }), "Notice is too short."],
  ["ct-body-new", createElement(ContentForm, { clinicId: "clinic" }), "Content is too short."],
])("describes the inline error when revisiting textarea %s", (id, element, error) => {
  const html = renderToStaticMarkup(element);
  const field = html.match(new RegExp(`<textarea[^>]*id="${id}"[^>]*>`))![0];
  const descriptions = field.match(/aria-describedby="([^"]+)"/)?.[1]?.split(" ") ?? [];
  expect(descriptions.length).toBeGreaterThan(0);
  expect(descriptions.some((description) => html.includes(`id="${description}"`) && html.match(new RegExp(`<p[^>]*id="${description}"[^>]*>([^<]*)`))?.[1] === error)).toBe(true);
});

it("keeps a calling region mounted before the first ticket and freshness outside status announcements", () => {
  const html = renderToStaticMarkup(createElement(DisplayBoard, { clinicId: "clinic", initial: { asOf: "2026-10-14T00:00:00Z", nowCalling: [], waiting: [] } }));
  expect(html).toMatch(/aria-live="polite"[^>]*>[\s\S]*No one is being called/);
  expect(html).not.toMatch(/<p[^>]*role="status"[^>]*>Numbers only/);
});
