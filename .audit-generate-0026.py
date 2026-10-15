from pathlib import Path
import re

base = Path('supabase/migrations')
target = base / '0026_ledger_reports_sms_integrity.sql'
sections = [
    ('0018_reports.sql', 'report_daily_activity', 'daily_activity'),
    ('0018_reports.sql', 'report_vaccinations_by_product', 'vaccinations_by_product'),
    ('0019_transfers_temperature.sql', 'report_stock_summary', 'stock_summary'),
]
with target.open('a', encoding='utf-8') as out:
    for filename, function, name in sections:
        source = (base / filename).read_text(encoding='utf-8')
        pattern = rf'create (?:or replace )?function public\.{function}\(.*?\) returns jsonb.*?end \$\$;'
        match = re.search(pattern, source, re.S | re.I)
        if not match:
            raise ValueError(function)
        definition = match.group(0).replace('create function', 'create or replace function', 1)
        definition, n = re.subn(
            rf"  if not p_export then perform private\.audit\(v_org, 'report\.run', 'report\.viewed'.*?'report', '{name}'.*?end if;",
            f"  perform private.audit_report_access(v_org, p_clinic_id, '{name}', p_from, p_to, p_export);",
            definition,
            count=1,
        )
        if n != 1:
            raise ValueError(f'audit replacement for {function}: {n}')
        out.write('\n' + definition + '\n')
