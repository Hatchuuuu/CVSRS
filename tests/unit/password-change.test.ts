import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[], update: vi.fn(), getUser: vi.fn(), next: "A strong new password 2026", confirm: "A strong new password 2026" }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: (effect: () => unknown) => { state.effects.push(effect); },
  useState: (initial: unknown) => {
    const i = state.cursor++;
    if (!(i in state.values)) state.values[i] = initial;
    return [state.values[i], (value: unknown) => { state.values[i] = value; }];
  },
  useRef: (initial: unknown) => {
    const i = state.cursor++;
    return state.values[i] ?? (state.values[i] = { current: initial });
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/lib/client/supabase-browser", () => ({ browserSupabase: () => ({ auth: { updateUser: state.update, getUser: state.getUser } }) }));
import { PasswordForm } from "@/app/account/account-forms";
import { ResetPasswordForm } from "@/app/account/reset-password/reset-password-form";

function render() { state.cursor = 0; return PasswordForm(); }
function submit(form = render()) {
  const reset = vi.fn();
  return { reset, done: form.props.onSubmit({ preventDefault() {}, currentTarget: { reset } }) as Promise<void> };
}
const feedback = () => renderToStaticMarkup(render());
beforeEach(() => {
  state.values = []; state.cursor = 0; state.effects = [];
  state.next = state.confirm = "A strong new password 2026";
  state.update.mockReset().mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  state.getUser.mockReset().mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  vi.stubGlobal("FormData", class { get(key: string) { return key === "next" ? state.next : state.confirm; } });
});

it("the reset form also blocks duplicate writes and clears passwords after success", async () => {
  state.cursor = 0; ResetPasswordForm();
  state.effects[0]!(); await Promise.resolve();
  state.cursor = 0;
  const form = ResetPasswordForm();
  const first = submit(form);
  await Promise.all([first.done, submit(form).done]);
  expect(state.update).toHaveBeenCalledOnce();
  expect(first.reset).toHaveBeenCalledOnce();
  state.cursor = 0;
  expect(renderToStaticMarkup(ResetPasswordForm())).toContain("Your password has been updated.");
});
afterEach(() => vi.unstubAllGlobals());

it("prevents duplicate submissions before React rerenders", async () => {
  const form = render();
  await Promise.all([submit(form).done, submit(form).done]);
  expect(state.update).toHaveBeenCalledTimes(1);
});
it("only announces confirmed success and clears password fields", async () => {
  const request = submit(); await request.done;
  expect(request.reset).toHaveBeenCalledOnce();
  expect(feedback()).toContain("Your password has been changed.");
});
it.each(["short", "é".repeat(37)])("rejects invalid password %s without calling Auth", async (password) => {
  state.next = state.confirm = password;
  await submit().done;
  expect(state.update).not.toHaveBeenCalled();
});
it("rejects mismatched passwords without calling Auth", async () => {
  state.confirm = "Another strong password";
  await submit().done;
  expect(state.update).not.toHaveBeenCalled();
  expect(feedback()).toContain("do not match");
});
it.each([
  [{ code: "session_not_found", status: 401 }, /sign out and sign in again/i],
  [{ code: "reauthentication_needed", status: 400 }, /sign out and sign in again/i],
  [{ code: "same_password", status: 422 }, /current password/i],
  [{ code: "weak_password", status: 422 }, /password requirements/i],
  [{ code: "over_request_rate_limit", status: 429 }, /too many attempts/i],
])("handles Auth rejection %j without clearing fields", async (error, message) => {
  state.update.mockResolvedValue({ data: { user: null }, error });
  const request = submit(); await request.done;
  expect(request.reset).not.toHaveBeenCalled();
  expect(feedback()).toMatch(message);
  expect(feedback()).not.toContain("Your password has been changed.");
});
it.each(["throw", "missing-user", "server-error"])("does not claim a confirmed outcome after %s", async (failure) => {
  if (failure === "throw") state.update.mockRejectedValue(new Error("fetch failed"));
  else state.update.mockResolvedValue({ data: { user: null }, error: failure === "server-error" ? { status: 500 } : null });
  const request = submit(); await request.done;
  expect(request.reset).not.toHaveBeenCalled();
  expect(feedback()).toMatch(/could not confirm/i);
  expect(feedback()).toMatch(/new password/i);
  expect(feedback()).not.toContain("Your password has been changed.");
});
