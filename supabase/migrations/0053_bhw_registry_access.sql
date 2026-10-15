-- BHWs can find families and enter non-clinical registration details; clinical history and vaccine administration remain restricted.
create or replace function private.role_preset(p_role text) returns text[] language sql immutable as $$
  select case p_role
    when 'assistant' then array['child.search','child.register','guardian.verify','appointment.manage','queue.manage']
    when 'clinical_staff' then array['child.search','child.register','child.read_clinical','guardian.verify','appointment.manage','queue.manage','vaccination.record','evidence.verify','rules.propose']
    when 'clinical_lead' then array['child.search','child.register','child.read_clinical','guardian.verify','appointment.manage','queue.manage','vaccination.record','evidence.verify','rules.propose','correction.approve','rules.approve','review.resolve','certificate.issue','audit.read','export.identifiable','inventory.approve','grant.approve.clinical','report.run']
    when 'inventory' then array['inventory.manage']
    when 'bhw' then array['bhw.followup','child.search','child.register']
    when 'tech_admin' then array['admin.users','admin.config']
    else array[]::text[] end
$$;
