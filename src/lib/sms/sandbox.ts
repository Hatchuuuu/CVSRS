import { toE164, type SmsProvider, type SmsRequest, type SmsResult } from "./provider";

/**
 * Sandbox provider: sends nothing anywhere. It lets the whole pipeline (queueing, claiming, retries, callbacks) run and be tested
 * without a provider account. It is NOT a real SMS provider and must never be presented as one.
 */
export class SandboxSmsProvider implements SmsProvider {
  readonly name = "sandbox";
  readonly sent = new Map<string, SmsRequest & { providerMessageId: string }>();
  private failures: { retryable: boolean; code: string }[] = [];

  /** Test hook: the next send fails with this outcome. */
  failNext(retryable: boolean, code = "sandbox_failure") {
    this.failures.push({ retryable, code });
  }

  async send(req: SmsRequest): Promise<SmsResult> {
    const existing = this.sent.get(req.id);
    if (existing) return { ok: true, providerMessageId: existing.providerMessageId }; // idempotent
    const fail = this.failures.shift();
    if (fail) return { ok: false, ...fail };
    if (!toE164(req.to)) return { ok: false, retryable: false, code: "invalid_number" };
    const providerMessageId = `sandbox-${req.id}`;
    this.sent.set(req.id, { ...req, providerMessageId });
    return { ok: true, providerMessageId };
  }
}
