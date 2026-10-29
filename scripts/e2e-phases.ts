/** Explicit selections keep Playwright's CLI behavior; the default suite releases compiler memory every six files. */
export function e2ePhases(files: readonly string[], args: readonly string[]): string[][] {
  if (args.length) return [[...args]];
  const sorted = [...files].sort();
  return Array.from({ length: Math.ceil(sorted.length / 6) }, (_, i) => sorted.slice(i * 6, (i + 1) * 6));
}

export async function runE2ePhases(phases: readonly string[][], run: (args: string[], index: number) => Promise<number>): Promise<number[]> {
  const results: number[] = [];
  for (const [index, args] of phases.entries()) {
    const code = await run(args, index);
    results.push(code);
    if (code !== 0) break;
  }
  return results;
}
/** Called only after terminating an owned child; an occupied initial port still fails immediately. */
export async function waitForE2ePortRelease(exited: Promise<void>, requireFreePort: () => Promise<void>, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const failure = () => new Error(`Owned E2E server did not release its port within ${timeoutMs / 1000} s.`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(failure()), timeoutMs); })]);
  } finally {
    clearTimeout(timer);
  }
  for (;;) {
    try { await requireFreePort(); return; }
    catch {
      if (Date.now() >= deadline) throw failure();
      await new Promise(resolve => setTimeout(resolve, Math.min(100, deadline - Date.now())));
    }
  }
}
