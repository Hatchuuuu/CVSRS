import { api } from "@/lib/api/handler";
import { staffLocationBody } from "@/lib/validation/staff";

export const POST = api({ body: staffLocationBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("update_staff_location", {
    p_operation_key: opKey, p_clinic_id: params.clinicId, p_membership_id: params.membershipId,
    p_expected_version: body.expectedVersion, p_barangay: body.barangay, p_city_municipality: body.cityMunicipality,
  }),
);
