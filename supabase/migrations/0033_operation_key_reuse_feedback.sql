-- A reused operation key with different content means an earlier attempt of the same form was
-- already saved (typically after a lost response). Keep the CV409 rejection, but say so plainly and
-- tag it so the application can tell staff that something was recorded instead of "nothing saved".
-- Idempotent: replaces the function body in place; ownership and grants are preserved.

create or replace function private.begin_command(p_org uuid, p_key uuid, p_type text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text := encode(sha256(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8')), 'hex');
  v_id uuid;
  r private.command_receipts;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if p_key is null then raise exception 'operation key is required' using errcode = 'CV400'; end if;
  insert into private.command_receipts (organization_id, operation_key, actor_id, command_type, payload_hash)
  values (p_org, p_key, auth.uid(), p_type, v_hash)
  on conflict (organization_id, operation_key) do nothing
  returning id into v_id;
  if v_id is not null then return null; end if;
  select * into r from private.command_receipts where organization_id = p_org and operation_key = p_key;
  if r.actor_id <> auth.uid() or r.command_type <> p_type or r.payload_hash <> v_hash then
    raise exception 'An earlier attempt of this form was already saved with different details. Reload the page and check what was recorded before changing anything.'
      using errcode = 'CV409', hint = 'cvsrs:operation_key_reused';
  end if;
  return r.result;
end $$;
