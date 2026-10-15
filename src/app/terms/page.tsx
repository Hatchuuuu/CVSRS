import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/legal-page";
import { LEGAL_VERSION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The terms that apply when families and health center staff use eVacTrack, the children's vaccination records service.",
  alternates: { canonical: "/terms" },
  robots: process.env.CVSRS_PUBLIC_URL ? { index: true, follow: true } : { index: false, follow: false },
};

/** Every statement restates how the system works (verification, roles, audit, certificates); nothing promises more than it does. */
const SECTIONS: LegalSection[] = [
  {
    id: "about",
    title: "About these Terms",
    body: (
      <>
        <p>
          These Terms of Use (the &ldquo;Terms&rdquo;) govern your use of eVacTrack (the &ldquo;Service&rdquo;), the Children&apos;s Vaccination
          Scheduling and Records System developed as the CVSRS project by Bachelor of Science in Information Technology students of Negros
          Oriental State University (NORSU). By creating an account or using the Service, you agree to these Terms. If you do not agree,
          do not use the Service; your health center will continue to serve you in person.
        </p>
        <p>In these Terms:</p>
        <ul>
          <li>
            <strong>&ldquo;Health center&rdquo;</strong> or <strong>&ldquo;clinic&rdquo;</strong> means a community or barangay health center
            that uses the Service to keep children&apos;s vaccination records.
          </li>
          <li>
            <strong>&ldquo;We&rdquo;</strong>, <strong>&ldquo;us&rdquo;</strong> and <strong>&ldquo;our&rdquo;</strong> mean the team that
            develops and operates the Service for participating health centers.
          </li>
          <li>
            <strong>&ldquo;You&rdquo;</strong> means the person using the Service, whether as a parent, legal guardian or authorized caregiver
            (a &ldquo;guardian&rdquo;), as a member of a health center&apos;s staff, or as a visitor.
          </li>
          <li>
            <strong>&ldquo;Record&rdquo;</strong> means a child&apos;s vaccination record and the related information a health center keeps in
            the Service.
          </li>
        </ul>
        <p>
          These Terms work together with our <Link href="/privacy">Privacy Policy</Link> and with the privacy notice of each health center
          you deal with.
        </p>
      </>
    ),
  },
  {
    id: "service",
    title: "What the Service does",
    body: (
      <>
        <p>
          The Service lets a health center keep children&apos;s vaccination records and share them with the guardians it has verified.
          Depending on what your health center has turned on, you can use it to:
        </p>
        <ul>
          <li>see the vaccinations your health center has recorded and the next vaccine due under its approved schedule;</li>
          <li>book, move or cancel a visit when the health center opens sessions for online booking;</li>
          <li>view and download vaccination certificates the health center has issued;</li>
          <li>check the waiting-room queue, read messages, and read care information the health center has published; and</li>
          <li>tell the health center about a vaccination given elsewhere, or ask it to correct a detail in a record.</li>
        </ul>
        <p>
          The health center is the source of every record. The Service shows what the health center has entered and reviewed; it does not
          calculate, guess or independently verify a child&apos;s history. eVacTrack is not an application of the Department of Health or
          of the national eGovPH platform, and using it does not replace any official record or process your health center or local
          government requires.
        </p>
      </>
    ),
  },
  {
    id: "medical",
    title: "Not medical advice",
    body: (
      <>
        <p>
          The Service is a record-keeping and scheduling tool. Due dates come from the vaccination schedule your health center has approved,
          and health center staff apply that schedule together with their clinical judgment. Information in the Service, including care
          information and messages, is general and does not replace advice from a doctor, nurse, midwife or other qualified health worker
          who knows your child.
        </p>
        <ul>
          <li>Ask your health center about any question regarding a vaccine, a due date or your child&apos;s health.</li>
          <li>
            If your child has a reaction after a vaccination, contact your health center or seek medical care right away.{" "}
            <strong>In an emergency, call 911 or go to the nearest hospital.</strong> Do not use the Service or its messages for emergencies.
          </li>
          <li>
            Keep bringing your child&apos;s paper Immunization Card to visits. Staff can compare it with the record in the Service.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Your account",
    body: (
      <>
        <p>
          You must be at least 18 years old to create an account. When you create one, you agree to give your real full name and accurate
          contact details and to keep them up to date. Each account is for one person only.
        </p>
        <p>You are responsible for keeping your sign-in details safe. In particular, you agree to:</p>
        <ul>
          <li>keep your password private and not use it for other services;</li>
          <li>
            turn on two-step sign-in in your <Link href="/account/security">account security settings</Link> (it is required for health center
            staff and recommended for everyone);
          </li>
          <li>sign out when you use a shared or public device; and</li>
          <li>tell your health center promptly if you believe someone else has used your account.</li>
        </ul>
        <p>
          No one from your health center or from the eVacTrack team will ask you for your password, by text message, phone call, chat or
          in person.
        </p>
      </>
    ),
  },
  {
    id: "guardians",
    title: "Guardian verification and access to records",
    body: (
      <>
        <p>
          A guardian can see a child&apos;s clinical history only after the child&apos;s health center has verified the guardian&apos;s
          relationship to the child. You agree to request access only to records of children for whom you are a parent, legal guardian or
          authorized caregiver, and to give truthful information when you add or link a child.
        </p>
        <p>
          Before you add or link a child, the health center shows you its privacy notice. The health center may ask for documents, may
          refuse or delay a request it cannot verify, and may limit or end a guardian&apos;s access, for example when guardianship changes
          or a custody question arises. Closing or losing access to your account does not delete the child&apos;s record, which the health
          center keeps as part of the child&apos;s care.
        </p>
        <p>
          If something in a record looks wrong, use &ldquo;Ask the clinic to correct a detail&rdquo; on your child&apos;s page or tell staff at
          your next visit. Staff check each change against your child&apos;s papers; corrections are added beside the original entry, which
          is never erased.
        </p>
      </>
    ),
  },
  {
    id: "staff",
    title: "Additional terms for health center staff",
    body: (
      <>
        <p>If you use the Service as a member of a health center&apos;s staff, these additional terms apply to you:</p>
        <ul>
          <li>
            Your access starts only after an administrator at your health center accepts your application and a second person approves it,
            and it covers only what your role at that health center needs. It ends when your role ends.
          </li>
          <li>You must use two-step sign-in, and the Service may sign you out after a period without activity.</li>
          <li>
            Open, change or export a record only for the care of that child or another duty your role requires. Health information is
            sensitive personal information, and you must keep it confidential under the Data Privacy Act of 2012 and your health
            center&apos;s policies, including after your role ends.
          </li>
          <li>
            Enter information accurately and only for care you gave or verified. Corrections are made as reviewed amendments; records are not
            deleted.
          </li>
          <li>Never share your account, let someone else work under your sign-in, or work under someone else&apos;s.</li>
          <li>
            Each change you make, and each identifiable record you open, is logged with your name in the health center&apos;s audit log,
            which authorized reviewers can examine.
          </li>
        </ul>
        <p>
          These terms add to, and do not replace, your duties under your employment or engagement, professional standards and the law.
        </p>
      </>
    ),
  },
  {
    id: "visits",
    title: "Visits, queue and messages",
    body: (
      <>
        <p>
          Each health center decides whether to offer online booking and which sessions to open. A booking reserves a place in a session; it
          does not guarantee that a particular vaccine will be given, which depends on your child&apos;s assessment on the day and on vaccine
          availability. A health center may need to move or cancel a session, and it will tell you through the Service when it does.
        </p>
        <p>
          The waiting-room queue screen for each health center is public and shows ticket numbers only, never names. Messages in your
          account come from your health center. Text messages are optional, are sent only when you turn them on and your health center has
          checked your number, and never contain your child&apos;s name, vaccines or health details.
        </p>
      </>
    ),
  },
  {
    id: "certificates",
    title: "Vaccination certificates",
    body: (
      <>
        <p>
          Certificates are issued by health centers from the records they keep. Each carries a QR code that opens a public page showing only
          whether the certificate is genuine, which health center issued it, and when; it does not show the child&apos;s name, birth date or
          vaccines.
        </p>
        <p>
          You may download, print and share your child&apos;s certificate for legitimate purposes, such as school enrollment. You must not
          alter a certificate, create a false one, or present a certificate that the verification page shows as withdrawn. A health center
          may withdraw a certificate that was issued in error and issue a corrected one.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p>You agree not to:</p>
        <ul>
          <li>access, or try to access, any record, account or part of the Service you are not authorized to use;</li>
          <li>give false information, impersonate another person, or claim a relationship to a child that you do not have;</li>
          <li>
            probe, scan or test the Service for vulnerabilities, or get around its security, rate limits or access rules, without written
            permission;
          </li>
          <li>
            collect information from the Service by automated means, or copy, sell or publish information about other people obtained from
            it;
          </li>
          <li>submit or send anything unlawful, harmful or abusive, or anything that contains malicious code;</li>
          <li>interfere with the Service or with other people&apos;s use of it, including health center operations; or</li>
          <li>use the Service for any purpose that breaks Philippine law, including the Data Privacy Act of 2012 and the Cybercrime Prevention Act of 2012.</li>
        </ul>
        <p>
          If you find a security problem, please report it to your health center without accessing or changing anyone&apos;s information,
          and give it reasonable time to be fixed before telling anyone else.
        </p>
      </>
    ),
  },
  {
    id: "privacy",
    title: "Privacy",
    body: (
      <p>
        How personal information is collected, used, shared and protected in the Service, and the rights you have under the Data Privacy Act
        of 2012, are explained in our <Link href="/privacy">Privacy Policy</Link> and in each health center&apos;s privacy notice.
      </p>
    ),
  },
  {
    id: "intellectual-property",
    title: "Intellectual property",
    body: (
      <p>
        The Service, including its software, design, text, name and logo, is protected by the Intellectual Property Code of the Philippines
        and other laws. Apart from the right to use the Service under these Terms and to keep copies of your own family&apos;s records and
        certificates, these Terms give you no right to copy, modify, distribute or create works based on any part of the Service. Records
        and care information belong to the health centers and families they concern, not to us.
      </p>
    ),
  },
  {
    id: "availability",
    title: "Availability and changes to the Service",
    body: (
      <p>
        We work to keep the Service available, but it may be interrupted for maintenance, updates, connection problems or causes outside our
        control, and we do not promise that it will always be available or free of errors. We may change, add or remove features. Your health
        center&apos;s in-person services, paper records and walk-in registration remain available whether or not the Service is working.
      </p>
    ),
  },
  {
    id: "suspension",
    title: "Suspension and closing your account",
    body: (
      <>
        <p>
          A health center, or we, may suspend or end your access to the Service, with notice where practical, if you break these Terms, if
          your access puts other people&apos;s information at risk, or if the law requires it.
        </p>
        <p>
          You may stop using the Service at any time. To close your account, ask your health center. Your access ends, and the health center
          keeps your children&apos;s vaccination records for as long as its records-retention obligations require, because those records
          belong to each child&apos;s care.
        </p>
      </>
    ),
  },
  {
    id: "liability",
    title: "Disclaimers and limitation of liability",
    body: (
      <>
        <p>
          To the extent the law allows, the Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We are not responsible for
          decisions made without checking with a qualified health worker, for information entered by others, or for loss caused by events
          outside our reasonable control, by your failure to keep your sign-in details safe, or by your breach of these Terms.
        </p>
        <p>
          Nothing in these Terms excludes or limits any liability that cannot be excluded or limited under Philippine law, including
          liability for fraud or gross negligence, or affects the rights you have under the Data Privacy Act of 2012.
        </p>
      </>
    ),
  },
  {
    id: "law",
    title: "Governing law and disputes",
    body: (
      <p>
        These Terms are governed by the laws of the Republic of the Philippines. If you have a concern about the Service, please raise it
        first with your health center so it can be resolved quickly and informally. Any dispute that cannot be resolved this way will be
        settled by the competent courts of the Philippines. Privacy complaints may also be brought to the National Privacy Commission, as
        explained in our <Link href="/privacy#contact">Privacy Policy</Link>.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these Terms",
    body: (
      <p>
        We may update these Terms when the Service or the law changes. The date at the top of this page shows when the current version took
        effect. When a change is significant, we will take reasonable steps to tell you, for example through a notice in the Service or
        through your health center. If you continue to use the Service after a change takes effect, the updated Terms apply to you.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        For questions about these Terms or your account, contact the health center that keeps your child&apos;s record. Participating health
        centers and their contact details are listed under <Link href="/#clinics">Find your health center</Link> on the home page. Health
        centers forward questions about the Service itself to us.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      current="/terms"
      title="Terms of Use"
      lead="The rules for using eVacTrack, for families and for health center staff. Please read them before you create an account."
      updated={LEGAL_VERSION}
      summary={
        <ul>
          <li>Your health center keeps your child&apos;s record. eVacTrack shows what the health center has recorded and reviewed.</li>
          <li>The Service is not medical advice and is not for emergencies. In an emergency, call 911.</li>
          <li>You may see a child&apos;s record only after the health center verifies that you are the child&apos;s guardian.</li>
          <li>Keep your sign-in details private, and use two-step sign-in.</li>
          <li>Staff may open records only for the care of the child or another duty their role requires, and every action is logged.</li>
        </ul>
      }
      sections={SECTIONS}
    />
  );
}
