/**
 * One password rule for new passwords (sign-up form, sign-up route, reset form).
 * This rule runs in the app's own sign-up route and forms. Supabase Auth can also be called directly with the public key, so the
 * project's Auth settings must be at least as strict: minimum length 12 (or more), leaked-password protection on, and
 * "Secure password change" on (docs/engineering/manual-setup.md). A weaker project setting makes this rule bypassable.
 * The 72-byte ceiling is Supabase Auth's bcrypt input limit.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_HINT = `Use at least ${PASSWORD_MIN_LENGTH} characters. A phrase of several unrelated words is strong and easier to remember.`;

/** Returns a user-facing problem, or null when the password meets the rule. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters for the password.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return "This password is too long. Use a shorter phrase (up to about 70 letters).";
  return null;
}
