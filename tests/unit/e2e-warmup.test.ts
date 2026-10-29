import { expect, it, vi } from "vitest";
import { warmE2eApp } from "../../scripts/e2e-warmup";
it("warms entry, API and page modules anonymously without successful writes", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => new Response(null, { status: url.endsWith("/e2e-unavailable-page") ? 404 : init?.method === "OPTIONS" ? 204 : init?.method === "POST" ? 400 : 200 }));
  await warmE2eApp("http://localhost:3100", fetcher);
  expect(fetcher.mock.calls.slice(0, 9).map(([url]) => new URL(url).pathname)).toEqual(["/", "/sign-up", "/sign-in", "/children", "/evactrackstafflogin", "/account/security", "/auth/sign-up", "/auth/sign-in", "/e2e-unavailable-page"]);
  for (const [, init] of fetcher.mock.calls) {
    expect(init?.credentials).toBe("omit");
    if (init?.method === "POST") expect(init.body).toBe("{}");
  }
  const api = fetcher.mock.calls.filter(([, init]) => init?.method === "OPTIONS");
  expect(api.some(([url]) => url.endsWith("/stock/wastage"))).toBe(true);
  for (const [, init] of api) expect(init?.body).toBeUndefined();
  const pages = fetcher.mock.calls.filter(([, init]) => init?.redirect === "manual");
  expect(pages.some(([url]) => /\/developer\/[0-9a-f-]{36}\/staff\/create$/.test(url))).toBe(true);
  expect(pages.some(([url]) => /\/clinic\/[0-9a-f-]{36}\/children\/[0-9a-f-]{36}$/.test(url))).toBe(true);
  for (const [, init] of pages) expect(init?.method).toBe("GET");
});
it.each(["API", "page"])("refuses a failed %s compile before journeys begin", async kind => {
  const fetcher = async (url: string, init?: RequestInit) => new Response(null, {
    status: (kind === "API" ? init?.method === "OPTIONS" : init?.redirect === "manual") ? 500 : url.endsWith("/e2e-unavailable-page") ? 404 : init?.method === "OPTIONS" ? 204 : init?.method === "POST" ? 400 : 200,
  });
  await expect(warmE2eApp("http://localhost:3100", fetcher)).rejects.toThrow(`${kind} warmup failed`);
});
it.each(["/sign-in", "/e2e-unavailable-page"])("rejects a failed warmup at %s", async failed => {
  await expect(warmE2eApp("http://localhost:3100", async (url, init) => new Response(null, { status: url.endsWith(failed) ? 500 : init?.method === "POST" ? 400 : 200 }))).rejects.toThrow("warmup failed");
});


function requests() {
  return vi.fn(async (url: string, init?: RequestInit) => new Response(null, { status: url.endsWith("/e2e-unavailable-page") ? 404 : init?.method === "OPTIONS" ? 204 : init?.method === "POST" ? 400 : 200 }));
}
it("warms the recorded stock/review phase APIs including every prior cold-failure module", async () => {
  const fetcher = requests();
  await warmE2eApp("http://localhost:3100", fetcher, ["tests/e2e/07-records.spec.ts", "tests/e2e/08-stock.spec.ts"]);
  const api = fetcher.mock.calls.filter(([, init]) => init?.method === "OPTIONS").map(([url]) => new URL(url).pathname);
  expect(api.some(path => path.endsWith("/stock/wastage"))).toBe(true);
  expect(api.some(path => path.endsWith("/stock/adjustments"))).toBe(true);
  expect(api.some(path => /\/evidence\/[^/]+\/verify$/.test(path))).toBe(true);
  expect(api.some(path => path.endsWith("/staff-accounts"))).toBe(false);
  expect(api.length).toBeLessThan(100);
  expect(fetcher.mock.calls.some(([url, init]) => url.endsWith("/children/link") && init?.redirect === "manual")).toBe(true);
});
it("keeps final portal/report dependencies warm while omitting unrelated stock commands", async () => {
  const fetcher = requests();
  await warmE2eApp("http://localhost:3100", fetcher, ["tests/e2e/33-portal-zoom.spec.ts"]);
  const api = fetcher.mock.calls.filter(([, init]) => init?.method === "OPTIONS").map(([url]) => new URL(url).pathname);
  for (const suffix of ["/privacy-notice", "/me/profile", "/paper-tallies"]) expect(api.some(path => path.endsWith(suffix))).toBe(true);
  expect(api.some(path => /\/reports\/[^/]+\/export$/.test(path))).toBe(true);
  expect(api.some(path => path.endsWith("/stock/wastage"))).toBe(false);
  expect(fetcher.mock.calls.some(([url, init]) => /\/developer\/[0-9a-f-]{36}$/.test(url) && init?.redirect === "manual")).toBe(true);
});
it("falls back to every API for an unknown/new spec or unrecognized selection", async () => {
  const all = requests(); await warmE2eApp("http://localhost:3100", all);
  const unknown = requests(); await warmE2eApp("http://localhost:3100", unknown, ["tests/e2e/99-new.spec.ts"]);
  const mixed = requests(); await warmE2eApp("http://localhost:3100", mixed, ["tests/e2e/33-portal-zoom.spec.ts", "--grep", "zoom"]);
  const paths = (fetcher: ReturnType<typeof requests>) => fetcher.mock.calls.map(([url]) => url);
  expect(paths(unknown)).toEqual(paths(all));
  expect(paths(mixed)).toEqual(paths(all));
});
