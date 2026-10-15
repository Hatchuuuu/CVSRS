import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Accessibility",
  description: "How eVacTrack is built to be usable by everyone, how it is tested, its known limitations, and how to get help.",
  alternates: { canonical: "/accessibility" },
  robots: process.env.CVSRS_PUBLIC_URL ? { index: true, follow: true } : { index: false, follow: false },
};

const WCAG_URL = "https://www.w3.org/TR/WCAG22/";

/** States only what the interface does and how it is tested (tests/e2e/05-accessibility.spec.ts); no conformance is claimed. */
const SECTIONS: LegalSection[] = [
  {
    id: "commitment",
    title: "Our commitment",
    body: (
      <p>
        eVacTrack is used by families with different abilities, devices and levels of reading confidence, often on a phone at a health
        center. We want everyone to be able to see their child&apos;s record and use the Service without help. Our target is Level AA of
        the{" "}
        <a href={WCAG_URL} target="_blank" rel="noopener noreferrer">
          Web Content Accessibility Guidelines (WCAG) 2.2<span className="sr-only"> (opens in a new tab)</span>
        </a>
        .
      </p>
    ),
  },
  {
    id: "features",
    title: "What we have built in",
    body: (
      <ul>
        <li>Pages are built to work with a keyboard alone, start with a &ldquo;Skip to main content&rdquo; link, and shows a clear outline around the item in focus.</li>
        <li>Buttons and links are at least 44 pixels tall, so they are easy to tap.</li>
        <li>Main text is at least 16 pixels, set in typefaces chosen to be easy to read, with strong contrast against its background.</li>
        <li>Status is always given in words and with an icon, never by color alone.</li>
        <li>Form fields have visible labels, and error messages say what went wrong and how to fix it.</li>
        <li>Pages fit narrow phone screens without sideways scrolling, and you can zoom with your browser.</li>
        <li>Movement on the home page stops when your device is set to reduce motion.</li>
        <li>The waiting-room queue screen announces newly called numbers to screen readers.</li>
        <li>Two-step sign-in can be set up by typing a key instead of scanning a QR code, and staff can type a pass code instead of scanning it with a camera.</li>
      </ul>
    ),
  },
  {
    id: "testing",
    title: "How we test",
    body: (
      <>
        <p>
          Our automated test suite checks the family and staff screens, and these public pages, with axe-core against the WCAG 2.0, 2.1 and
          2.2 Level A and AA rules, at phone and desktop widths and with real records. The same checks confirm that pages do not scroll
          sideways on a phone.
        </p>
        <p>
          Automated checks find only some kinds of problems. Keyboard, screen reader and zoom checks are done by hand and do not yet cover
          every page. The Service has not been through an independent accessibility audit.
        </p>
      </>
    ),
  },
  {
    id: "status",
    title: "Conformance status",
    body: (
      <p>
        We consider eVacTrack <strong>partially conformant</strong> with WCAG 2.2 Level AA: most of it meets the standard, but some parts,
        listed in section 5, do not yet fully do so.
      </p>
    ),
  },
  {
    id: "limitations",
    title: "Known limitations",
    body: (
      <ul>
        <li>
          <strong>Language.</strong> You can choose Filipino as your language, but most wording, messages and some care information are
          still in English only. We are adding reviewed Filipino text.
        </li>
        <li>
          <strong>Downloaded certificates.</strong> Certificate PDF files may not be fully readable with a screen reader. Your health center
          can read the certificate with you or give you a printed copy.
        </li>
        <li>
          <strong>Information written by health centers.</strong> Care information and privacy notices are written by each health center,
          and how easy they are to read depends on how they are written.
        </li>
        <li>
          <strong>Authenticator apps.</strong> Two-step sign-in uses an authenticator app on your phone, which is not part of eVacTrack.
          How accessible it is depends on the app you choose.
        </li>
      </ul>
    ),
  },
  {
    id: "help",
    title: "Other ways to get help",
    body: (
      <p>
        You never need the Service to get care. Staff at your health center can look up your child&apos;s record, explain it, give you a
        printed copy, and register your family in person. Health centers that use eVacTrack are listed under{" "}
        <Link href="/#clinics">Find your health center</Link> on the home page.
      </p>
    ),
  },
  {
    id: "feedback",
    title: "Feedback",
    body: (
      <>
        <p>
          If something in eVacTrack is hard for you to use, please tell your health center. Say which page you were on, what you were trying
          to do, and the device or assistive technology you use, if you can. Health centers pass these reports to us, and we use them to
          decide what to fix first.
        </p>
        <p>
          Our <Link href="/terms">Terms of Use</Link> and <Link href="/privacy">Privacy Policy</Link> explain the rest of how the Service works.
        </p>
      </>
    ),
  },
];

export default function AccessibilityPage() {
  return (
    <LegalPage
      current="/accessibility"
      title="Accessibility"
      lead="How eVacTrack is built to be usable by everyone, how we test it, what still falls short, and how to get help."
      updated="2026-10-08"
      sections={SECTIONS}
    />
  );
}
