import { browserSupabase } from "./supabase-browser";

export async function changePassword(password: string): Promise<{ ok: true } | { ok: false; message: string; unknown?: boolean }> {
  const unconfirmed = { ok: false as const, unknown: true, message: "We could not confirm the change. Sign out and try signing in with the new password before trying another change." };
  try {
    const { data, error } = await browserSupabase().auth.updateUser({ password });
    if (!error) return data?.user ? { ok: true } : unconfirmed;
    if (!error.status || error.status >= 500) return unconfirmed;
    if (error.status === 401 || error.name === "AuthSessionMissingError" || /reauthentication|session_not_found|session_expired|bad_jwt/.test(error.code ?? "")) {
      return { ok: false, message: "For your security, sign out and sign in again, then change the password." };
    }
    if (error.code === "same_password") return { ok: false, message: "This is already your current password. Choose a different one." };
    if (error.code === "weak_password") return { ok: false, message: "The password does not meet the sign-in service's password requirements. Choose a stronger password." };
    if (error.status === 429) return { ok: false, message: "Too many attempts. Wait a moment and try again." };
    return { ok: false, message: "The password could not be changed. Try again shortly." };
  } catch {
    return unconfirmed;
  }
}
