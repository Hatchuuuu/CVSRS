import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/api", () => ({ useMutation: () => ({ state: { phase: "idle" }, run: vi.fn() }) }));
import { CreateStaffAccount } from "@/components/technical/create-staff-account";

it("prevents pre-hydration submission from putting a temporary password in the URL", () => {
  const html = renderToStaticMarkup(<CreateStaffAccount clinicId="synthetic-clinic" />);
  expect(html).toMatch(/<form[^>]*method="post"/);
  expect(html).toMatch(/<fieldset[^>]*disabled=""/);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
});
