/** Messages for the `error`, `auth` and `notice` query values that the auth routes redirect with. Shared with the staff sign-in. */
export function signInMessages(query: { error?: string; notice?: string; auth?: string }) {
  const errors: Record<string, string> = {
    staff_portal_required: "This is a staff account. Please use the clinic staff sign-in page.",
    family_portal_required: "This is a family account. Please use the family sign-in page.",
    invalid_credentials: "Email or password was not recognized. Check your details and try again.",
    not_found: "Account unavailable. Please verify your details or create a new account.",
    rate_limited: "Too many attempts. Wait a moment and try again.",
    unavailable: "Sign-in service is temporarily unavailable. Please try again.",
    invalid_input: "Enter your email address and password.",
  };
  return {
    initialError: query.auth === "link-error" ? "The sign-in link could not be used. Request a new link and try again." : query.error ? errors[query.error] || "Sign-in did not complete. Please try again." : undefined,
    notice: query.notice === "password_updated" ? "Your password has been updated. Sign in with your new password." : undefined,
  };
}
