import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/api", () => ({ useMutation: () => ({ state: { phase: "idle" }, run: vi.fn() }) }));
import { PasswordForm, ProfileForm } from "@/app/account/account-forms";
import { TextSettings } from "@/app/messages/text-settings";

it.each([
  { name: "profile", element: <ProfileForm displayName="Synthetic Parent" locale="en" needsName={false} /> },
  { name: "password", element: <PasswordForm /> },
  { name: "contact", element: <TextSettings prefs={{ guardianId: "synthetic-guardian", language: "en", phoneMasked: null, hasPhone: false, phoneChecked: false, smsOptIn: false }} /> },
])("keeps $name values out of native GET submission until hydration", ({ element }) => {
  const html = renderToStaticMarkup(element);
  expect(html).toMatch(/<form[^>]*method="post"/);
  expect(html).toMatch(/<fieldset[^>]*disabled=""/);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
});
