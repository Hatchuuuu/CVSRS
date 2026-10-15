-- Non-login privilege groups. Provision login credentials separately; never embed passwords in migrations.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'cvsrs_outbox_worker') then
    create role cvsrs_outbox_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'cvsrs_sms_webhook') then
    create role cvsrs_sms_webhook nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;
grant usage on schema private to cvsrs_outbox_worker, cvsrs_sms_webhook;
grant execute on function private.process_outbox(integer), private.claim_sms(integer),
  private.mark_sms(uuid, integer, text, text, text, text) to cvsrs_outbox_worker;
grant execute on function private.record_sms_event(text, text, text, text, timestamptz) to cvsrs_sms_webhook;
-- No table grants or API membership. SECURITY DEFINER functions retain their existing empty search paths.
