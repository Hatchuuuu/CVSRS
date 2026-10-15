import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { SignUpForm } from "@/app/sign-up/sign-up-form";

const alternate = { text: "Account access", href: "/sign-in", link: "Sign in" };
it.each(["family", "staff"] as const)("keeps %s authentication controls inactive until their submit handlers are hydrated", (audience) => {
  for (const element of [createElement(SignInForm, { audience, alternate }), createElement(SignUpForm, { audience, alternate, clinics: [{ id: "clinic", name: "Test clinic" }] })]) {
    expect(renderToStaticMarkup(element)).toMatch(/<fieldset[^>]*disabled=""/);
  }
});
