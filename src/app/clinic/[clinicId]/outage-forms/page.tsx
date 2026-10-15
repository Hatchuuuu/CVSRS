import type { Metadata } from "next";
import { PageTitle } from "@/components/ui";
import { requireClinicStaff } from "@/lib/server/viewer";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Outage forms" };

const ROWS = 14;
const th = "border border-black px-1.5 py-1 text-left text-xs font-bold";
const td = "border border-black px-1.5 py-3";

/** Blank paper forms for use when the system is unavailable. They record nothing; entries are typed in later and reconciled (Reports → Paper log check). */
export default async function OutageForms({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { membership } = await requireClinicStaff(clinicId);
  return (
    <>
      <div className="no-print">
        <PageTitle
          title="Outage forms"
          lead="Print these before you need them. If the system is unavailable, write on paper, then enter the doses later and check them under Reports → Paper log check. A paper record is provisional until it is entered and checked."
          action={<PrintButton />}
        />
      </div>

      <section aria-labelledby="pl-h" className="mb-10 break-after-page bg-white text-black p-4 sm:p-6 print:p-0">
        <h2 id="pl-h" className="text-xl font-bold">
          {membership.clinicName} — vaccination paper log
        </h2>
        <p className="mb-3 text-sm">
          PROVISIONAL — not yet entered in the system. Date: ________________ Vaccinator: ______________________ Station: ________
        </p>
        <div tabIndex={0} role="region" aria-label="Vaccination paper log preview" className="overflow-x-auto focus-inset print:overflow-visible">
        <table className="w-full min-w-[48rem] border-collapse text-sm print:min-w-0">
          <thead>
            <tr>
              {["No.", "Child's full name", "Birth date", "Record no. (if known)", "Guardian", "Vaccine", "Lot no.", "Time given", "Site", "Given by (signature)"].map((h) => (
                <th key={h} scope="col" className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, i) => (
              <tr key={i}>
                <td className={td}>{i + 1}</td>
                {Array.from({ length: 9 }, (_, j) => (
                  <td key={j} className={td} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className="mt-3 text-sm">Total doses on this sheet: ______ Checked by: ______________________ Entered in the system on: ______________</p>
      </section>

      <section aria-labelledby="st-h" className="mb-10 break-after-page bg-white text-black p-4 sm:p-6 print:p-0">
        <h2 id="st-h" className="text-xl font-bold">
          {membership.clinicName} — vaccine stock log
        </h2>
        <p className="mb-3 text-sm">PROVISIONAL — not yet entered in the system. Date: ________________ Recorded by: ______________________</p>
        <div tabIndex={0} role="region" aria-label="Vaccine stock paper log preview" className="overflow-x-auto focus-inset print:overflow-visible">
        <table className="w-full min-w-[48rem] border-collapse text-sm print:min-w-0">
          <thead>
            <tr>
              {["Vaccine", "Lot no.", "Expiry", "Received", "Used", "Wasted (reason)", "Counted on shelf", "Fridge temp. (min / max)", "Initials"].map((h) => (
                <th key={h} scope="col" className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }, (_, i) => (
              <tr key={i}>
                {Array.from({ length: 9 }, (_, j) => (
                  <td key={j} className={td} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      <section aria-labelledby="qq-h" className="bg-white text-black p-4 sm:p-6 print:p-0">
        <h2 id="qq-h" className="text-xl font-bold">
          {membership.clinicName} — arrival sheet
        </h2>
        <p className="mb-3 text-sm">Use when the queue screen is unavailable. Write tickets in order of arrival. Date: ________________</p>
        <div tabIndex={0} role="region" aria-label="Arrival sheet preview" className="overflow-x-auto focus-inset print:overflow-visible">
        <table className="w-full min-w-[48rem] border-collapse text-sm print:min-w-0">
          <thead>
            <tr>
              {["Ticket", "Arrived", "Child's full name", "Appointment? (Y/N)", "Priority reason (if any)", "Called at", "Outcome"].map((h) => (
                <th key={h} scope="col" className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, i) => (
              <tr key={i}>
                <td className={td}>{i + 1}</td>
                {Array.from({ length: 6 }, (_, j) => (
                  <td key={j} className={td} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </>
  );
}
