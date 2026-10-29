import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import NotFound from "@/app/not-found";
import ErrorPage from "@/app/error";
import ChildrenError from "@/app/children/error";
import ClinicError from "@/app/clinic/[clinicId]/error";

it("gives the unavailable-page view a primary heading and a route back", () => {
  const html = renderToStaticMarkup(<NotFound />);
  expect(html).toMatch(/<h1[^>]*>Page unavailable<\/h1>/);
  expect(html).toContain('href="/"');
});

it.each([ChildrenError, ClinicError])("gives nested error boundaries a primary heading", Component => {
  const html = renderToStaticMarkup(<Component error={new Error("private detail")} retry={() => {}} />);
  expect(html).toMatch(/<h1[^>]*>This page could not be loaded<\/h1>/);
  expect(html).not.toContain("private detail");
});

it("takes staff back through the role-aware clinic chooser instead of the search-only clinic route", () => {
  const html = renderToStaticMarkup(<ClinicError error={new Error()} retry={() => {}} />);
  expect(html).toContain('href="/clinic"');
  expect(html).not.toContain('href="/clinic/clinic-example"');
});

it("gives the recoverable error view a heading without exposing exception details", () => {
  const html = renderToStaticMarkup(<ErrorPage error={Object.assign(new Error("private database detail"), { digest: "reference-123" })} retry={() => {}} />);
  expect(html).toMatch(/<h1[^>]*>This page could not be loaded<\/h1>/);
  expect(html).toContain("reference-123");
  expect(html).not.toContain("private database detail");
  expect(html).toContain("Try again");
});
