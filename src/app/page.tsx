/*
 * Landing page direction (see PRODUCT.md, DESIGN.md).
 * THESIS: the health center's public service counter, online. A royal-blue civic arrival that names the service and the
 *   two account actions at once, then one counter with five windows, each showing a sample of its real screen. Refuses
 *   identical icon-card grids, stock trust badges, invented statistics, and an eGovPH clone.
 * OWN-WORLD: royal blue (#0648ef) drenched hero and close, white and pale-blue reading sections, deep navy ink and
 *   footer, hairline rules borrowed from the paper Immunization Card, dose marks (blue check = given, amber ring = due)
 *   reused for schedules, the record trail and access rules. Atkinson Hyperlegible Next throughout.
 * STORY: a guardian learns what eVacTrack is, tries each service window, sees how a dose reaches their account, learns
 *   the three steps to start, finds their health center, learns who can see the record, and signs up or signs in.
 * FIRST VIEWPORT: a light pale-blue field; badge, headline, lede, both account actions and three plain facts on the
 *   left; on the right the family sits in a pale-blue arch window, with three sample record notes landing in turn.
 * FORM: service counter, inherited from the earlier landing build (its seed 5de07eff, structure 7); no new seed was
 *   rolled for this rebuild, which keeps that form and adds the tabbed counter and the record trail.
 */
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { preload } from "react-dom";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  FileCheck2,
  FileHeart,
  GraduationCap,
  KeyRound,
  ListOrdered,
  MapPin,
  Phone,
  Plus,
  ScrollText,
  Store,
  UserCheck,
  Users,
} from "lucide-react";
import { getViewer } from "@/lib/server/viewer";
import { clinicLandingRoute } from "@/lib/auth/destination";
import { BrandMark } from "@/components/brand";
import { NurseMascot } from "@/components/nurse-mascot";
import { LandingMotion } from "./_landing/landing-motion";
import { BookingDemo, CertificateDemo, MessagesDemo, QueueDemo, ScheduleDemo } from "./_landing/service-demos";
import { ServiceExplorer, type Service } from "./_landing/service-explorer";
import "./_landing/landing.css";
import familyPortal from "../../public/images/family-portal.webp";

const TITLE = "eVacTrack — Children's vaccination records for families and community clinics";
const DESCRIPTION =
  "eVacTrack connects families with their community health center: see your child's clinic-reviewed vaccination history, know which vaccine is due next, and book open clinic sessions.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  // The landing page holds no personal data; it is indexable only on a configured public deployment.
  robots: process.env.CVSRS_PUBLIC_URL ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: { title: "eVacTrack — Children's vaccination records", description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: "eVacTrack — Children's vaccination records", description: DESCRIPTION },
};

interface PublicClinic {
  id: string;
  name: string;
  address: string;
  contact: string | null;
  hours: string | null;
}

/** How one dose travels from the clinic to the family account. Each line restates how the system records it. */
const RECORD_TRAIL = [
  {
    title: "At the visit",
    text: "The nurse enters the vaccine, dose and date while your child is still at the health center.",
  },
  {
    title: "Before it is saved",
    text: "Each entry carries the name of the staff member who recorded it. A correction is added beside the original; nothing is erased.",
  },
  {
    title: "In your family account",
    text: "The dose, your child's next due date and any certificate appear for guardians the clinic has verified.",
  },
] as const;

const STEPS = [
  {
    title: "Create your family account",
    text: "Sign up online with your email and add your child's details, or ask your barangay health center to register your family in person.",
  },
  {
    title: "Get verified by your clinic",
    text: "Clinic staff confirm that you are the child's guardian before any clinical history appears in your account.",
  },
  {
    title: "Follow your child's schedule",
    text: "See recorded vaccines and upcoming due dates, and book a visit when your clinic opens sessions.",
  },
] as const;

/** Who sees what. Every cell restates a rule the system enforces; nothing here is a promise beyond it. */
const ACCESS_ROWS = [
  { who: "Guardians your clinic has verified", icon: UserCheck, cells: ["yes", "yes", "yes"] },
  { who: "Clinic staff", note: "Only what their role at that clinic needs", icon: Users, cells: ["role", "role", "role"] },
  { who: "Anyone scanning a certificate's QR code", icon: ScrollText, cells: ["no", "no", "yes"] },
] as const;
const ACCESS_COLUMNS = ["Child's name", "Vaccines and due dates", "Whether a certificate is genuine"] as const;

/** Only what the page does not already answer: registering is the three steps, access is the table, booking is its
 * service window, and the paper card is the note beside the record trail. */
const QUESTIONS = [
  {
    question: "What if I don't have a smartphone or internet?",
    answer:
      "Visit your barangay health center. Staff can look up your child's record, explain it, and give you a printed copy. The portal adds another way to see the record; it never replaces clinic care.",
  },
  {
    question: "Where do the due dates come from?",
    answer:
      "From the vaccination schedule your clinic has approved. Clinic staff apply it alongside their clinical judgment, so contact your clinic if you have a question about a due date or vaccine.",
  },
  {
    question: "What if my child was vaccinated somewhere else?",
    answer:
      "Open your child's page and tell the clinic about the vaccination. It counts toward the record only after staff check it against your child's card or the provider.",
  },
  {
    question: "Something in the record looks wrong. What do I do?",
    answer:
      "Use \"Ask the clinic to correct a detail\" on your child's page, or tell staff at your next visit. Staff check the change against your child's papers before anything is updated.",
  },
] as const;

/** A contact value that reads as a phone number gets a tap-to-call link. */
const telHref = (value: string) => (/^[+\d][\d\s()-]{6,}$/.test(value.trim()) ? `tel:${value.replace(/[^\d+]/g, "")}` : null);

function AccessMark({ value }: { value: "yes" | "no" | "role" }) {
  if (value === "yes")
    return (
      <span className="lp-mark lp-mark--yes">
        <svg aria-hidden viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="10" />
          <path d="m5.8 10.3 2.8 2.7 5.6-5.8" />
        </svg>
        <span className="sr-only">Yes</span>
      </span>
    );
  if (value === "no")
    return (
      <span className="lp-mark lp-mark--no">
        <span aria-hidden />
        <span className="sr-only">No</span>
      </span>
    );
  return <span className="lp-mark lp-mark--role">By role</span>;
}

export default async function Home() {
  preload("/fonts/atkinson-next-800.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  preload("/fonts/atkinson-next-400.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });

  const v = await getViewer();
  // A failed lookup is shown as a failure, never as "no health centers listed"; the rest of the page still works.
  const clinicList = await v.rpc.rpc<PublicClinic[]>("list_public_clinics").then(
    (rows) => rows ?? [],
    (error: unknown) => {
      console.error("[landing] clinic directory unavailable:", error instanceof Error ? error.message : String(error));
      return null;
    },
  );
  const clinics = clinicList ?? [];
  const staffClinic = v.ctx?.memberships.find((m) => m.status === "active");
  const signedIn = Boolean(v.session);
  const accountHref = "/sign-up";
  const accountLabel = "Create a family account";
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const origin = process.env.CVSRS_PUBLIC_URL?.replace(/\/$/, "");

  // Every service lives behind sign-in; a visitor who is signed out is sent to sign in first.
  const to = (href: string) => (signedIn ? href : "/sign-in");

  // Each window says a thing once: the paragraph says what the service is, and the points add only what it leaves out.
  const services: Service[] = [
    {
      id: "records",
      name: "Vaccination history",
      hint: "Recorded doses and what is due next",
      title: "Vaccination history and next due",
      text: "Every dose your clinic has recorded, with the date and where it was given, and the next vaccine worked out from your clinic's approved schedule.",
      points: ["Tell the clinic about a vaccination given elsewhere"],
      action: { href: to("/children"), label: signedIn ? "Open my children" : "Sign in to view" },
      demo: <ScheduleDemo />,
    },
    {
      id: "booking",
      name: "Clinic visits",
      hint: "Book an open session online",
      title: "Book a clinic visit",
      text: "When your health center opens sessions for online booking, choose a day and time that still has room.",
      points: ["A confirmation message once you are booked", "Move or cancel online if your plans change"],
      action: { href: to("/children"), label: signedIn ? "Choose a session" : "Sign in to book" },
      demo: <BookingDemo />,
    },
    {
      id: "certificates",
      name: "Certificates",
      hint: "Issued by your clinic, checkable by QR",
      title: "Vaccination certificates",
      text: "Certificates are issued by your clinic and carry a QR code that a school or another clinic can scan.",
      points: ["Download a copy to print or share", "The QR check shows only whether it is genuine"],
      action: { href: to("/children"), label: signedIn ? "View certificates" : "Sign in to view" },
      demo: <CertificateDemo />,
    },
    {
      id: "queue",
      name: "Waiting-room queue",
      hint: "See which numbers are being called",
      title: "Waiting-room queue",
      text: "Each participating health center has a queue screen. Check which ticket numbers are being called before you leave home.",
      points: ["No account needed to view it", "Ticket numbers only, never names", "Updates on its own while the page is open"],
      action: { href: "#clinics", label: "Find your health center" },
      demo: <QueueDemo />,
    },
    {
      id: "messages",
      name: "Messages and care",
      hint: "Updates and reviewed guidance",
      title: "Messages and care information",
      text: "Booking and certificate updates arrive in your account, along with care guidance your health center has published for families.",
      points: ["Care information is checked by a second person before you see it"],
      action: { href: to("/messages"), label: signedIn ? "Read messages" : "Sign in to read" },
      demo: <MessagesDemo />,
    },
  ];

  const structuredData = origin
    ? [
      { "@context": "https://schema.org", "@type": "WebSite", name: "eVacTrack", url: `${origin}/`, description: DESCRIPTION, inLanguage: "en-PH" },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: QUESTIONS.map((q) => ({ "@type": "Question", name: q.question, acceptedAnswer: { "@type": "Answer", text: q.answer } })),
      },
    ]
    : null;

  return (
    <div className="landing-page lp">
      {structuredData ? (
        <script
          type="application/ld+json"
          nonce={nonce}
          // Structured data names only the site and its own questions; no ratings, organizations or claims.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
        />
      ) : null}

      {/* ── Hero ───────────────────────────────────────── */}
      <section className="lp-hero" aria-labelledby="home-title">
        <div className="lp-container lp-hero-grid">
          <div className="lp-hero-copy">
            <p className="lp-badge">
              <GraduationCap aria-hidden />
              A NORSU BSInfoTech student project
            </p>
            <h1 id="home-title" className="lp-h1">
              Children&apos;s Vaccination <span>Scheduling and Record System</span>
            </h1>
            <p className="lp-lede">
              See your child&apos;s vaccination history, know which vaccine is due next, and book a visit when your health center
              opens sessions.
            </p>
            <div className="lp-actions">
              {signedIn ? (
                <>
                  <Link href="/children" className="lp-btn lp-btn--primary">
                    View my children <ArrowRight aria-hidden />
                  </Link>
                  {staffClinic ? (
                    <Link href={clinicLandingRoute(staffClinic.clinicId, staffClinic.capabilities)} className="lp-btn lp-btn--secondary">
                      Clinic workspace
                    </Link>
                  ) : null}
                </>
              ) : (
                <>
                  <Link href={accountHref} className="lp-btn lp-btn--primary">
                    {accountLabel} <ArrowRight aria-hidden />
                  </Link>
                  <Link href="/sign-in" className="lp-btn lp-btn--secondary">
                    Sign in
                  </Link>
                </>
              )}
            </div>
            <ul className="lp-hero-facts" aria-label="At a glance">
              <li>
                <FileCheck2 aria-hidden /> Clinic-reviewed records
              </li>
              <li>
                <UserCheck aria-hidden /> Verified guardians
              </li>
              <li>
                <Store aria-hidden /> Walk-in registration
              </li>
            </ul>
          </div>
          <div className="lp-hero-visual">
            <div className="lp-hero-arch">
              <Image
                src={familyPortal}
                alt="A mother holding her young son while a nurse in blue scrubs shows them a vaccination record"
                priority
                sizes="(min-width: 1200px) 900px, (min-width: 560px) 840px, 165vw"
              />
            </div>
            {/* Sample notes for illustration; they describe no real child, so assistive technology skips them. */}
            <div className="lp-hero-chip lp-hero-chip--given" style={{ "--n": 0 } as CSSProperties} aria-hidden>
              <span className="lp-hero-chip-icon">
                <svg className="lp-hero-check" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="10" />
                  <path d="m5.8 10.3 2.8 2.7 5.6-5.8" />
                </svg>
              </span>
              <span>
                <strong>Pentavalent, dose 3</strong>
                Recorded by your clinic
              </span>
            </div>
            <div className="lp-hero-chip lp-hero-chip--due" style={{ "--n": 1 } as CSSProperties} aria-hidden>
              <span className="lp-hero-chip-icon">
                <CalendarDays />
              </span>
              <span>
                <strong>Next due: MMR, dose 1</strong>
                at 9 months
              </span>
            </div>
            <div className="lp-hero-chip lp-hero-chip--verified" style={{ "--n": 2 } as CSSProperties} aria-hidden>
              <span className="lp-hero-chip-icon">
                <UserCheck />
              </span>
              <span>
                <strong>Guardian verified</strong>
                Record shared with you
              </span>
            </div>
          </div>
        </div>
        <NurseMascot />
      </section>

      {/* ── Services ───────────────────────────────────── */}
      <section id="services" className="lp-section lp-section--services" aria-labelledby="services-h">
        <div className="lp-container">
          <header className="lp-heading lp-heading--split">
            <h2 id="services-h" className="lp-h2">
              Your child&apos;s immunizations, in one account.
            </h2>
            <p className="lp-body">What your health center has recorded, what comes next, and how to get there.</p>
          </header>
          <ServiceExplorer services={services} />
        </div>
      </section>

      {/* ── How a record reaches the family ────────────── */}
      <section className="lp-section lp-section--tint lp-section--ruled" aria-labelledby="trail-h">
        <div className="lp-container lp-split">
          <div className="lp-split-intro">
            <h2 id="trail-h" className="lp-h2">
              The record your clinic keeps is the record you see.
            </h2>
            <p className="lp-body">
              eVacTrack does not calculate or guess your child&apos;s history. It shows what your health center has recorded and
              reviewed, and nothing else.
            </p>
            <p className="lp-note">
              <FileHeart aria-hidden />
              <span>
                <strong>Keep bringing the paper Immunization Card.</strong> Staff can compare it with the digital record at any visit.
              </span>
            </p>
          </div>

          <ol className="lp-trail" aria-label="How a vaccination reaches your account" data-reveal>
            {RECORD_TRAIL.map((entry, i) => (
              <li key={entry.title} className="lp-trail-entry">
                <span className="lp-trail-node" aria-hidden>
                  {i < RECORD_TRAIL.length - 1 ? (
                    <svg viewBox="0 0 20 20">
                      <circle cx="10" cy="10" r="10" />
                      <path d="m5.8 10.3 2.8 2.7 5.6-5.8" />
                    </svg>
                  ) : (
                    <BrandMark className="lp-trail-brand" />
                  )}
                </span>
                <div className="lp-trail-card">
                  <h3 className="lp-h3">{entry.title}</h3>
                  <p>{entry.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────── */}
      <section id="how-it-works" className="lp-section" aria-labelledby="how-h">
        <div className="lp-container">
          <header className="lp-heading lp-heading--split">
            <h2 id="how-h" className="lp-h2">
              Get started in three steps.
            </h2>
            <p className="lp-body">From signing up to your child&apos;s next clinic visit, online or at your health center.</p>
          </header>
          <ol className="lp-steps" data-reveal>
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="lp-step-number tnum" aria-hidden>
                  {index + 1}
                </span>
                <h3 className="lp-h3">
                  <span className="sr-only">Step {index + 1}: </span>
                  {step.title}
                </h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Clinics ────────────────────────────────────── */}
      <section id="clinics" className="lp-section lp-section--tint" aria-labelledby="clinics-h">
        <div className="lp-container lp-split">
          <div className="lp-split-intro">
            <h2 id="clinics-h" className="lp-h2">
              Find your health center.
            </h2>
            <p className="lp-body">
              Register, ask about your child&apos;s record, or check the waiting-room queue at a health center that uses eVacTrack.
            </p>
          </div>

          <div className="lp-directory" data-reveal>
            {clinicList === null ? null : (
              <p className="lp-directory-count">
                <span>
                  <span className="tnum">{clinics.length}</span> {clinics.length === 1 ? "participating health center" : "participating health centers"}
                </span>
              </p>
            )}
            {clinicList === null ? (
              <div className="lp-directory-empty" role="status">
                <MapPin aria-hidden />
                <h3 className="lp-h3">The health center list could not be loaded</h3>
                <p>Please reload this page in a few minutes. Your barangay health center can also tell you whether it uses eVacTrack.</p>
              </div>
            ) : clinics.length === 0 ? (
              <div className="lp-directory-empty">
                <MapPin aria-hidden />
                <h3 className="lp-h3">No health centers are listed yet</h3>
                <p>Ask your barangay health center whether it registers families and records vaccinations with eVacTrack.</p>
              </div>
            ) : (
              <ul role="list">
                {clinics.map((clinic, i) => {
                  const tel = clinic.contact ? telHref(clinic.contact) : null;
                  return (
                    // The entrance stagger stops growing after six rows, so a long list never waits on its tail.
                    <li key={clinic.id} className="lp-clinic" style={{ "--n": Math.min(i, 6) } as CSSProperties}>
                      <div className="lp-clinic-main">
                        <h3 className="lp-h3">{clinic.name}</h3>
                        <dl>
                          {clinic.address ? (
                            <div>
                              <dt>
                                <MapPin aria-hidden />
                                <span className="sr-only">Address</span>
                              </dt>
                              <dd>{clinic.address}</dd>
                            </div>
                          ) : null}
                          {clinic.hours ? (
                            <div>
                              <dt>
                                <Clock3 aria-hidden />
                                <span className="sr-only">Opening hours</span>
                              </dt>
                              <dd>{clinic.hours}</dd>
                            </div>
                          ) : null}
                          {clinic.contact ? (
                            <div>
                              <dt>
                                <Phone aria-hidden />
                                <span className="sr-only">Contact</span>
                              </dt>
                              <dd>{tel ? <a href={tel}>{clinic.contact}</a> : clinic.contact}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>
                      <Link href={`/display/${clinic.id}`} className="lp-btn lp-btn--secondary lp-btn--small">
                        <ListOrdered aria-hidden />
                        Waiting-room queue<span className="sr-only"> at {clinic.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ── Privacy and access ─────────────────────────── */}
      <section id="privacy" className="lp-section" aria-labelledby="access-h">
        <div className="lp-container lp-split">
          <div className="lp-split-intro">
            <h2 id="access-h" className="lp-h2">
              Who can see your child&apos;s record.
            </h2>
            <p className="lp-body">
              Your clinic decides who has access, and every change to a record is kept in the clinic&apos;s audit log.
            </p>
            {signedIn ? (
              <Link href="/account/security" className="lp-link">
                Review your account security <ArrowRight aria-hidden />
              </Link>
            ) : null}
          </div>

          <div className="lp-access" data-reveal>
            <div className="lp-access-card">
              <table className="lp-access-table">
                <caption className="sr-only">What each kind of person can see in eVacTrack</caption>
                <thead>
                  <tr>
                    <th scope="col">Who</th>
                    {ACCESS_COLUMNS.map((c) => (
                      <th key={c} scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ACCESS_ROWS.map((row) => {
                    const Icon = row.icon;
                    return (
                      <tr key={row.who} className={"note" in row ? "is-role" : undefined}>
                        <th scope="row">
                          <span className="lp-who">
                            <Icon aria-hidden />
                            <span>
                              {row.who}
                              {"note" in row ? <small>{row.note}</small> : null}
                            </span>
                          </span>
                        </th>
                        {row.cells.map((cell, i) => (
                          <td key={i} data-label={ACCESS_COLUMNS[i]}>
                            <AccessMark value={cell} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="lp-access-note">
              <KeyRound aria-hidden />
              <span>
                <strong>Two-step sign-in.</strong> Required for clinic staff. Families can turn it on in their account security settings.
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────── */}
      <section id="questions" className="lp-section lp-section--tint" aria-labelledby="questions-h">
        <div className="lp-container lp-split">
          <div className="lp-split-intro">
            <h2 id="questions-h" className="lp-h2">
              Questions families often ask.
            </h2>
            <p className="lp-body">Can&apos;t find your answer? Your barangay health center can help in person.</p>
            <a href="#clinics" className="lp-link">
              Find your health center <ArrowRight aria-hidden />
            </a>
          </div>
          <div className="lp-faq-list" data-reveal>
            {QUESTIONS.map((item, i) => (
              <details key={item.question} name="landing-faq" style={{ "--n": i } as CSSProperties}>
                <summary>
                  <span>{item.question}</span>
                  <Plus aria-hidden />
                </summary>
                <div className="lp-faq-answer">
                  <p>{item.answer}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <LandingMotion />
    </div>
  );
}
