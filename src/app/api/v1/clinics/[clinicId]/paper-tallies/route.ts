import { z } from "zod";
import { api } from "@/lib/api/handler";

const body = z
  .object({
    serviceDate: z.iso.date("Choose the date of the paper log."),
    productId: z.uuid("Choose the vaccine."),
    paperCount: z.number().int("Enter a whole number.").min(0).max(10000),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const POST = api({ body }, async ({ rpc, params, body: b, opKey }) =>
  rpc.rpc("record_paper_tally", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_service_date: b.serviceDate, p_product_id: b.productId, p_paper_count: b.paperCount, p_note: b.note ?? null }),
);
