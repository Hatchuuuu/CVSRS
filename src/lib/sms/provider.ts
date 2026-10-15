/**
 * Provider-neutral SMS contract. A provider only sends a message and reports what happened; the database owns message state.
 * Every provider MUST treat `id` as an idempotency key: sending the same id twice must not send two texts (a worker may crash
 * between "sent" and "recorded", and a stuck message is retried).
 */
export interface SmsRequest {
  /** The database message id (idempotency key). */
  id: string;
  to: string;
  body: string;
}
export type SmsResult = { ok: true; providerMessageId: string } | { ok: false; retryable: boolean; code: string };

export interface SmsProvider {
  readonly name: string;
  send(req: SmsRequest): Promise<SmsResult>;
}

/** What to tell someone whose mobile number `toE164` cannot read. */
export const MOBILE_NUMBER_HINT = "Enter a mobile number such as 0917 123 4567, or one that starts with +63.";

/** Numbers are stored as typed (digits, optional +). Providers expect E.164; the Philippine default is applied only when unambiguous. */
export function toE164(raw: string, defaultCountry = "63"): string | null {
  const s = raw.replace(/[\s\-()]/g, "");
  if (/^\+[1-9][0-9]{7,14}$/.test(s)) return s;
  if (/^0[0-9]{10}$/.test(s)) return `+${defaultCountry}${s.slice(1)}`;
  if (new RegExp(`^${defaultCountry}[0-9]{10}$`).test(s)) return `+${s}`;
  return null;
}
