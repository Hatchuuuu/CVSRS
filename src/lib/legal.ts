/**
 * The date the current Terms of Use and Privacy Policy took effect. The sign-up form sends it and the server refuses any other
 * value, so every new account records (in its Auth user metadata, `terms_version`) which version its holder accepted.
 * Change it whenever either document changes in substance.
 */
export const LEGAL_VERSION = "2026-10-08";

/** The public legal documents, in reading order. Shared by the footer and the documents' own switcher. */
export const LEGAL_DOCUMENTS = [
  { href: "/terms", label: "Terms of Use" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/accessibility", label: "Accessibility" },
] as const;
