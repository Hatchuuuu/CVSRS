import { api } from "@/lib/api/handler";
import { contentBody } from "@/lib/validation/config";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("list_content", { p_clinic_id: params.clinicId }));
export const POST = api({ body: contentBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("save_content_draft", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_code: body.code ?? null, p_language: body.language, p_title: body.title, p_body: body.body, p_source: body.source, p_version_id: body.versionId ?? null }),
);
