/**
 * Readiness for load balancers and uptime checks (audit F14). Liveness (`/api/v1/health`) only says the process answers;
 * readiness also needs valid configuration and a database that answers one cheap anonymous call in time. The reason is for
 * the server log only: the HTTP answer never names settings or infrastructure.
 */
export type Readiness = { ready: true } | { ready: false; reason: "configuration" | "database" };

export interface ReadinessDeps {
  /** Throws when the deployment configuration is invalid. */
  config: () => void;
  /** One cheap database round trip. */
  probe: (signal: AbortSignal) => Promise<unknown>;
}

export async function checkReadiness(deps: ReadinessDeps, timeoutMs = 2000): Promise<Readiness> {
  try {
    deps.config();
  } catch {
    return { ready: false, reason: "configuration" };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("readiness probe timed out"));
    }, timeoutMs);
  });
  try {
    await Promise.race([deps.probe(controller.signal), timeout]);
    return { ready: true };
  } catch {
    return { ready: false, reason: "database" };
  } finally {
    clearTimeout(timer);
  }
}
