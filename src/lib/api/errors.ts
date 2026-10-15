/** Stable API error codes. Messages are safe for end users; internals never leave the server (BP30/BP40). */
export type ErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "already_saved"
  | "unprocessable"
  | "rate_limited"
  | "misconfigured"
  | "unavailable"
  | "internal";

/**
 * A finer, stable reason inside a code, for the few conflicts the interface words differently. It comes only from a hint the database
 * attaches on purpose (never from message text), so rewording a database message cannot change what the interface shows.
 */
export type ErrorReason = "duplicate_session_booking";
const REASON_BY_HINT: Record<string, ErrorReason> = {
  "cvsrs:duplicate_session_booking": "duplicate_session_booking",
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
    public readonly retryable = false,
    public readonly reason?: ErrorReason,
  ) {
    super(message);
    this.name = "AppError";
  }
}

const SAFE: Record<ErrorCode, string> = {
  invalid_request: "The request was not understood.",
  unauthenticated: "Sign in to continue.",
  forbidden: "This action is not available to your account.",
  not_found: "This record is unavailable to your account.",
  conflict: "The record changed or this action was already completed. Refresh and check before retrying.",
  already_saved: "An earlier attempt of this form was already saved with different details. Reload the page and check what was recorded before changing anything.",
  unprocessable: "Some details need attention.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  misconfigured: "The service is not configured.",
  unavailable: "The service is temporarily unavailable.",
  internal: "Something went wrong on our side.",
};

const BY_STATE: Record<string, [ErrorCode, number]> = {
  CV400: ["invalid_request", 400],
  CV401: ["unauthenticated", 401],
  CV403: ["forbidden", 403],
  CV404: ["not_found", 404],
  CV409: ["conflict", 409],
  CV422: ["unprocessable", 422],
  "42501": ["forbidden", 403], // insufficient_privilege (grant/RLS)
  "23505": ["conflict", 409], // unique_violation
  "23503": ["unprocessable", 422], // foreign_key_violation
  "23514": ["unprocessable", 422], // check_violation
  "22P02": ["invalid_request", 400], // invalid_text_representation
  "22007": ["unprocessable", 422], // invalid_datetime_format
  "22008": ["unprocessable", 422], // datetime_field_overflow (e.g. year 0000, 30 February)
  "22009": ["unprocessable", 422], // invalid_time_zone_displacement_value
  "40001": ["conflict", 409], // serialization_failure
  "40P01": ["conflict", 409], // deadlock_detected (retryable by the client with the same key)
};

/** Maps a database/PostgREST error (SQLSTATE) to a safe AppError. Raw database text is never exposed. */
export function fromDbError(err: { code?: string; message?: string; hint?: string }): AppError {
  if (err.code === "CV409" && err.hint === "cvsrs:operation_key_reused") return new AppError("already_saved", 409, SAFE.already_saved);
  const hit = err.code ? BY_STATE[err.code] : undefined;
  if (!hit) return new AppError("internal", 500, SAFE.internal, undefined, false);
  const [code, status] = hit;
  // CV422 (invalid input) and CV409 (state conflict) messages are authored by our own functions to be user-actionable and contain no
  // record data ("child name is required", "a visit is in progress at the current clinic"). Every other database message stays hidden.
  const message = (err.code === "CV422" || err.code === "CV409") && err.message ? err.message : SAFE[code];
  const reason = err.code === "CV409" && err.hint ? REASON_BY_HINT[err.hint] : undefined;
  return new AppError(code, status, message, undefined, err.code === "40P01" || err.code === "40001", reason);
}

export const safeMessage = (c: ErrorCode) => SAFE[c];

/** Common safe JSON envelope for API failures, including binary download routes. */
export function errorResponse(error: AppError, requestId: string, retryAfter?: number): Response {
  return Response.json(
    { error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors, retryable: error.retryable, ...(error.reason ? { reason: error.reason } : {}) }, requestId },
    { status: error.status, headers: { "cache-control": "no-store", "x-request-id": requestId, ...(retryAfter ? { "retry-after": String(retryAfter) } : {}) } },
  );
}
