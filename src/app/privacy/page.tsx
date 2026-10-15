import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/legal-page";
import { LEGAL_VERSION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How eVacTrack and participating health centers collect, use, share and protect personal information under the Data Privacy Act of 2012.",
  alternates: { canonical: "/privacy" },
  robots: process.env.CVSRS_PUBLIC_URL ? { index: true, follow: true } : { index: false, follow: false },
};

const NPC_URL = "https://privacy.gov.ph";

/**
 * Each statement restates what the system does (src/lib/auth/cookies.ts, src/lib/sms, the clinic privacy notices, the audit log);
 * nothing here claims a certification, an encryption scheme or a retention period the system does not enforce.
 */
const SECTIONS: LegalSection[] = [
  {
    id: "about",
    title: "About this policy",
    body: (
      <>
        <p>
          This Privacy Policy explains how personal information is collected, used, shared, kept and protected when you use eVacTrack
          (the &ldquo;Service&rdquo;), and the rights you have under the Data Privacy Act of 2012 (Republic Act No. 10173), its
          Implementing Rules and Regulations, and the issuances of the National Privacy Commission.
        </p>
        <p>
          It applies to guardians, health center staff and visitors. Each participating health center also gives you its own privacy notice
          before you add or link a child. That notice explains how the health center handles your child&apos;s record and takes precedence
          over this policy where the two differ. Words defined in our <Link href="/terms">Terms of Use</Link> have the same meaning here.
        </p>
      </>
    ),
  },
  {
    id: "responsible",
    title: "Who is responsible for your information",
    body: (
      <>
        <p>
          <strong>The health center is the personal information controller.</strong> Each participating health center decides why and how
          the children&apos;s records it keeps are processed, verifies guardians, and answers requests about those records. Where a health
          center belongs to a local government unit, that unit&apos;s data protection officer may handle privacy matters on its behalf.
        </p>
        <p>
          <strong>We act as personal information processor.</strong> The eVacTrack team develops and operates the Service for participating
          health centers and processes personal information on their instructions, to provide, secure and support the Service. We do not
          use records for our own purposes.
        </p>
      </>
    ),
  },
  {
    id: "collect",
    title: "Information we collect",
    body: (
      <>
        <p>We collect only what the Service needs for the purposes in section 4.</p>
        <h3>When you create an account</h3>
        <ul>
          <li>Your full name, email address and mobile number, and your preferred language.</li>
          <li>
            Your password. The sign-in service stores it in hashed form, and neither health center staff nor the eVacTrack team can read
            it.
          </li>
          <li>If you set up two-step sign-in, the link to your authenticator app.</li>
          <li>
            For staff applicants: the health center you apply to, the role you apply for, and your job title and note to the administrator,
            if you give them.
          </li>
          <li>The version of the Terms of Use and this Privacy Policy you accepted.</li>
        </ul>
        <h3>About your child</h3>
        <ul>
          <li>Your child&apos;s name and date of birth (or an estimated birth date if the exact date is not known).</li>
          <li>Your relationship to the child, and the health center&apos;s decision on verifying it.</li>
          <li>
            The vaccination record the health center keeps: vaccines and doses given, dates, where they were given, product and lot details,
            staff notes needed for immunization care, corrections, and certificates issued.
          </li>
          <li>Visits you book, waiting-room queue tickets, and vaccinations given elsewhere that you report.</li>
        </ul>
        <p>
          Vaccination information is health information, which the Data Privacy Act treats as <strong>sensitive personal information</strong>.
          The Service does not ask for national ID numbers, scans of birth certificates, photographs or your location.
        </p>
        <h3>When you use the Service</h3>
        <ul>
          <li>Your acknowledgement of each health center&apos;s privacy notice, with its version and the time you accepted it.</li>
          <li>Messages, text message choices, and requests you send to a health center, such as a correction or a record move.</li>
          <li>
            An audit log of actions in the Service: who created, changed or opened a record, what was changed and when. It records staff
            actions in particular.
          </li>
          <li>
            Technical information needed to run and protect the Service: your device&apos;s internet (IP) address, browser type, the pages
            and actions requested, and the time of each request, as found in security and server logs.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "use",
    title: "How we use information",
    body: (
      <>
        <p>Personal information is used only to:</p>
        <ul>
          <li>create and manage your account, and let you sign in securely;</li>
          <li>verify that a guardian is entitled to see a child&apos;s record;</li>
          <li>
            keep each child&apos;s vaccination record, show the next vaccine due under the health center&apos;s approved schedule, and issue
            certificates;
          </li>
          <li>run bookings, the waiting-room queue, messages and optional text messages;</li>
          <li>handle requests to correct, transfer or close records and accounts;</li>
          <li>
            produce reports a health center needs for its immunization program and for reporting required by law, using totals wherever
            names are not needed;
          </li>
          <li>keep the Service secure, investigate misuse, keep audit records, and fix problems; and</li>
          <li>comply with the law and with lawful orders of the courts and authorities.</li>
        </ul>
        <p>
          We do not sell personal information, use it for advertising, or build marketing profiles. The Service calculates due dates from the
          health center&apos;s approved schedule, but decisions about a child&apos;s care and about who may see a record are made by health
          center staff, not by the Service on its own.
        </p>
      </>
    ),
  },
  {
    id: "legal-basis",
    title: "Legal basis for processing",
    body: (
      <>
        <p>Depending on the purpose, information is processed on one or more of these grounds under the Data Privacy Act:</p>
        <ul>
          <li>
            <strong>Medical treatment</strong>: the processing is needed for your child&apos;s care by a health center that protects it
            adequately (Section 13(f)).
          </li>
          <li>
            <strong>Laws and regulations</strong>: laws on immunization and public health, such as the Mandatory Infants and Children Health
            Immunization Act of 2011 (Republic Act No. 10152), and the rules on health records and reporting (Sections 12(c) and 13(c)).
          </li>
          <li>
            <strong>Providing the Service you asked for</strong>: your account, bookings and messages (Section 12(b)).
          </li>
          <li>
            <strong>Consent</strong>: where you are asked for it, for example to receive text messages. You may withdraw consent at any
            time; this does not affect processing that took place before (Sections 12(a) and 13(a)).
          </li>
          <li>
            <strong>Legitimate interests</strong>: keeping the Service and its records secure and accountable (Section 12(f)).
          </li>
        </ul>
        <p>Each health center&apos;s privacy notice states the basis it relies on for the records it keeps.</p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Who can see your information",
    body: (
      <>
        <ul>
          <li>
            <strong>Verified guardians</strong> of a child can see that child&apos;s record after the health center has verified them.
          </li>
          <li>
            <strong>Health center staff</strong> can see only what their role at that health center needs, and their access is logged.
          </li>
          <li>
            <strong>Another participating health center</strong> receives a child&apos;s record when you ask to move it there, or when health
            centers transfer it for the child&apos;s care.
          </li>
          <li>
            <strong>Anyone who scans a certificate&apos;s QR code</strong> sees only whether the certificate is genuine, which health center
            issued it, and when. They do not see the child&apos;s name, birth date or vaccines.
          </li>
          <li>
            <strong>Anyone viewing a waiting-room queue screen</strong> sees ticket numbers only, never names.
          </li>
          <li>
            <strong>Our service providers</strong> (section 13) process information for us under contract, only to run the Service.
          </li>
          <li>
            <strong>Government authorities and courts</strong> receive information only when the law requires it, such as public health
            reporting by a health center or a lawful order.
          </li>
        </ul>
        <p>Information is not shared with anyone else unless you agree to it.</p>
      </>
    ),
  },
  {
    id: "messages",
    title: "Text messages and email",
    body: (
      <>
        <p>
          Text messages are optional. They are sent only if you turn them on in <Link href="/messages">Messages</Link> and your health center
          has checked your number. A text message only tells you to open the Service: it never contains your child&apos;s name, vaccines or
          health details, and the same information is always available in your account. You can turn text messages off at any time.
        </p>
        <p>
          The Service does not send verification or confirmation emails when you create an account. Email is used to sign you in and to send
          a password reset link when you ask for one.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and browser storage",
    body: (
      <>
        <p>
          The Service uses only the cookies and browser storage it needs to work. It uses no advertising, analytics or tracking cookies, and it
          loads no third-party tracking tools. Because these items are strictly necessary, they cannot be turned off in the Service; if you
          block them in your browser, you will not be able to sign in.
        </p>
        <div className="legal-table" role="region" aria-label="Cookies and browser storage the Service uses" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Purpose</th>
                <th scope="col">How long it lasts</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  Sign-in session cookies (<code>sb-&hellip;-auth-token</code>, sometimes split into numbered parts)
                </th>
                <td>Keep you signed in and let the Service confirm who you are on each request.</td>
                <td>Until you sign out, and no longer than the session limit (12 hours unless this Service is set up with a different limit).</td>
              </tr>
              <tr>
                <th scope="row">
                  Password reset cookie (<code>sb-&hellip;-auth-token-code-verifier</code>)
                </th>
                <td>Lets a password reset link finish only in the browser that asked for it.</td>
                <td>Until the reset is complete or the session ends.</td>
              </tr>
              <tr>
                <th scope="row">
                  Staff activity time (browser storage, <code>cvsrs:staff-activity</code>)
                </th>
                <td>For staff only: lets every open tab sign out together after a period without activity. It holds a time, nothing else.</td>
                <td>Until you clear your browser&apos;s site data.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long information is kept",
    body: (
      <ul>
        <li>
          <strong>Children&apos;s vaccination records</strong>, including corrections and certificates, are kept by the health center for as
          long as the laws and records-retention rules that apply to health records require. Closing an account does not delete them,
          because they belong to the child&apos;s care.
        </li>
        <li>
          <strong>Account information</strong> is kept while your account is open. When it is closed, your access ends; your name stays only
          where it is part of a record, such as the guardian verified for a child or the staff member who made an entry.
        </li>
        <li>
          <strong>Audit records</strong> are kept as long as the records they describe, so that every change stays accountable.
        </li>
        <li>
          <strong>Messages, delivery logs and technical logs</strong> are kept only as long as they are needed for their purpose, and then
          deleted or made anonymous.
        </li>
      </ul>
    ),
  },
  {
    id: "security",
    title: "How information is protected",
    body: (
      <>
        <p>The health centers and we use organizational, physical and technical measures to protect personal information, including:</p>
        <ul>
          <li>access rules enforced by the database, so a guardian sees only the children they are verified for and staff see only their own health center&apos;s records, as their role allows;</li>
          <li>two-step sign-in, required for all staff and available to every family;</li>
          <li>an audit log of every change to a record and of staff opening identifiable records;</li>
          <li>sessions that expire, and automatic sign-out of staff after a period without activity;</li>
          <li>limits on repeated sign-in attempts and other requests;</li>
          <li>corrections recorded beside the original entry instead of erasing it; and</li>
          <li>keeping health details out of text messages, queue screens and certificate checks.</li>
        </ul>
        <p>
          No system can be guaranteed completely secure. Please help protect your account by keeping your password private and using two-step
          sign-in.
        </p>
      </>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>Under the Data Privacy Act of 2012, you have the right to:</p>
        <ul>
          <li><strong>be informed</strong> about how your personal information is processed;</li>
          <li><strong>access</strong> your personal information and get a copy of it;</li>
          <li><strong>correct</strong> information that is inaccurate or incomplete;</li>
          <li><strong>object</strong> to processing, including withdrawing consent you have given;</li>
          <li><strong>erasure or blocking</strong> of information that is no longer needed, unlawfully obtained or wrongly processed;</li>
          <li><strong>data portability</strong>, to get your information in an electronic format you can use elsewhere;</li>
          <li><strong>damages</strong>, if you suffer harm from inaccurate, incomplete, outdated, false or unlawfully processed information; and</li>
          <li><strong>file a complaint</strong> with the National Privacy Commission.</li>
        </ul>
        <h3>How to use your rights</h3>
        <p>
          You can update your name and preferred language in <Link href="/account">Account</Link>, and your mobile number and text message
          choices in <Link href="/messages">Messages</Link>. To correct a child&apos;s record, use &ldquo;Ask the clinic to correct a
          detail&rdquo; on your child&apos;s page. For any other request, contact the health center that keeps the record. It will confirm
          your identity before acting, and respond within the period the law requires.
        </p>
        <p>
          Some rights have limits set by law. For example, a health center may keep a vaccination record it is required to keep even if you
          ask for it to be erased, and corrections are made as reviewed amendments rather than by deleting the original entry.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children's information",
    body: (
      <p>
        The Service is used by adults: guardians and health center staff. Information about a child comes from the child&apos;s guardian or
        is recorded by the health center that cares for the child, and the child&apos;s rights over it are exercised by a verified parent or
        legal guardian. Only verified guardians and authorized staff can see a child&apos;s record.
      </p>
    ),
  },
  {
    id: "transfers",
    title: "Service providers and transfers outside the Philippines",
    body: (
      <>
        <p>We use service providers to run the Service, under contracts that require them to protect the information. They include:</p>
        <ul>
          <li>a database and sign-in service (Supabase), which stores records and accounts and sends password reset emails;</li>
          <li>web hosting, which runs the Service and keeps technical logs;</li>
          <li>a request-limiting service, which counts requests to protect against abuse; and</li>
          <li>a text message provider, only if text messages are turned on.</li>
        </ul>
        <p>
          Some of these providers may store or process information on servers outside the Philippines. When that happens, the health centers
          and we remain responsible for the information and require the same level of protection the Data Privacy Act requires.
        </p>
      </>
    ),
  },
  {
    id: "breaches",
    title: "Personal data breaches",
    body: (
      <p>
        If a security incident affects personal information, the health centers and we will act to contain it and reduce harm, and will notify
        the National Privacy Commission and the people affected when the Data Privacy Act and the Commission&apos;s rules require it, within
        the periods those rules set.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        We will update this policy when the Service or the law changes. The date at the top of this page shows when the current version took
        effect. When a change is significant, we will take reasonable steps to tell you, for example through a notice in the Service or
        through your health center.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact and complaints",
    body: (
      <>
        <p>
          For questions or requests about your or your child&apos;s information, contact the health center that keeps the record. Its contact
          details are in its privacy notice and under <Link href="/#clinics">Find your health center</Link> on the home page. Health centers
          forward questions about the Service itself to us.
        </p>
        <p>
          If you believe your rights under the Data Privacy Act have been violated, you may file a complaint with the National Privacy
          Commission at{" "}
          <a href={NPC_URL} target="_blank" rel="noopener noreferrer">
            privacy.gov.ph<span className="sr-only"> (opens in a new tab)</span>
          </a>
          . The Commission generally asks that you first raise the matter with the health center.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      current="/privacy"
      title="Privacy Policy"
      lead="How your information and your child's vaccination record are collected, used, shared and protected, and the rights you have under the Data Privacy Act of 2012."
      updated={LEGAL_VERSION}
      summary={
        <ul>
          <li>Your health center keeps your child&apos;s record and decides how it is used. eVacTrack runs the system for it.</li>
          <li>Only guardians the health center has verified, and staff whose role needs it, can see a child&apos;s record.</li>
          <li>Text messages, queue screens and certificate checks never show your child&apos;s health details.</li>
          <li>No selling, no advertising and no tracking cookies.</li>
          <li>You can ask to see or correct your information, and you can complain to the National Privacy Commission.</li>
        </ul>
      }
      sections={SECTIONS}
    />
  );
}
