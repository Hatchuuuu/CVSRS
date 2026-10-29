import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import picomatch from "picomatch";
import { afterEach, describe, expect, it, vi } from "vitest";
import config from "../../next.config";

const ROOT = join(import.meta.dirname, "..", "..");
const APP = join(ROOT, "src", "app");

afterEach(() => { vi.unstubAllEnvs(); });

it("retains warmed handlers throughout a bounded isolated browser phase", async () => {
  vi.stubEnv("CVSRS_DIST_DIR", ".next-e2e");
  vi.resetModules();
  const { default: isolated } = await import("../../next.config");
  expect(isolated.onDemandEntries?.maxInactiveAge).toBe(3_600_000);
});

it("preserves default handler retention outside the isolated browser run", async () => {
  vi.stubEnv("CVSRS_DIST_DIR", ".next");
  vi.resetModules();
  const { default: normal } = await import("../../next.config");
  expect(normal.onDemandEntries).toBeUndefined();
});

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" || name === "page.tsx" ? [path] : [];
  });
}

const routePath = (file: string) => "/" + relative(APP, file).replace(/\\/g, "/").replace(/\/?(route\.ts|page\.tsx)$/, "");

describe("output file tracing (API-02)", () => {
  const includes = config.outputFileTracingIncludes ?? {};
  const globs = Object.keys(includes);

  it("ships the certificate font with every route that renders a PDF, and with no other route", () => {
    const routes = routeFiles(APP);
    const renderers = routes.filter((f) => /@\/lib\/certificates\/(service|pdf)"/.test(readFileSync(f, "utf8"))).map(routePath);
    expect(renderers.length).toBeGreaterThan(0);
    const traced = routes.map(routePath).filter((r) => globs.some((g) => picomatch(g)(r)));
    expect(traced.sort()).toEqual(renderers.sort());
  });

  it("includes exactly the font file pdf.ts reads, not the unused 16 MB CJK font", () => {
    const pdf = readFileSync(join(ROOT, "src/lib/certificates/pdf.ts"), "utf8");
    const font = /fonts\/([\w.-]+\.ttf)/.exec(pdf)?.[1];
    expect(font).toBeTruthy();
    const files = Object.values(includes).flat();
    expect(files).toContain(`./src/lib/certificates/fonts/${font}`);
    expect(files.some((f) => /\*|\.otf$/.test(f))).toBe(false);
    for (const f of files) expect(existsSync(join(ROOT, f))).toBe(true);
  });
});
