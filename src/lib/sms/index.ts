import { SandboxSmsProvider } from "./sandbox";
import type { SmsProvider } from "./provider";

let sandbox: SandboxSmsProvider | undefined;

/**
 * SMS_PROVIDER=sandbox  -> the pipeline runs but nothing is sent (development/demonstration of the flow only).
 * unset / "none"        -> no provider: queued messages wait, visibly, and in-app messages are unaffected.
 * Real providers are added here once an account and its delivery-receipt contract exist (docs/implementation/external-validation.md).
 */
export function getSmsProvider(env: Record<string, string | undefined> = process.env): SmsProvider | null {
  const name = (env.SMS_PROVIDER ?? "none").toLowerCase();
  if (name === "none" || name === "") return null;
  if (name === "sandbox") {
    if (env.NODE_ENV === "production") throw new Error("The sandbox SMS provider is not permitted in production");
    return (sandbox ??= new SandboxSmsProvider());
  }
  throw new Error(`Unknown SMS_PROVIDER "${name}". Supported: none, sandbox.`);
}
