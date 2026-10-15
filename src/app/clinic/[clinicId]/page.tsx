import type { Metadata } from "next";
import { Notice, PageTitle, Section } from "@/components/ui";
import { requireClinicStaff } from "@/lib/server/viewer";
import { ChildSearch, QrLookup, RegisterChildForm } from "./workspace";

export const metadata: Metadata = { title: "Find or register a child" };

export default async function FindOrRegister({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { membership } = await requireClinicStaff(clinicId);
  const caps = new Set(membership.capabilities);
  if (!caps.has("child.search")) {
    return (
      <>
        <PageTitle title="Find or register a child" />
        <Notice tone="info" title="No patient records for your role">
          Your role does not include patient lookup at this clinic. Use the menu for the tasks you can do.
        </Notice>
      </>
    );
  }
  return (
    <>
      <PageTitle title="Find or register a child" lead="Search first, so nobody is registered twice. A birth certificate, phone or account is never required." />
      <div className="space-y-10">
        <Section id="find-h" title="Find a child" className="border-t-0 pt-0">
          <ChildSearch clinicId={clinicId} />
        </Section>
        <Section id="qr-h" title="Look up by QR pass" description="Scan with a camera if your browser supports it, or type or paste the code from the family's pass.">
          <div className="max-w-md">
            <QrLookup clinicId={clinicId} />
          </div>
        </Section>
        {caps.has("child.register") ? (
          <Section id="reg-h" title="Register a child" description="Use when the search found no match.">
            <details className="group rounded-control border border-line bg-surface">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 py-2 font-semibold text-primary">Open the registration form</summary>
              <div className="border-t border-line p-4 sm:p-5">
                <RegisterChildForm clinicId={clinicId} />
              </div>
            </details>
          </Section>
        ) : null}
      </div>
    </>
  );
}
