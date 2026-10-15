# E13 runtime isolation and rate limiting

Status: IMPLEMENTING. No external service will be provisioned in this execution.

- Disable production polling in the web runtime; the separate worker CLI retains its own credential. Add non-login worker and webhook group roles with schema USAGE and only their specific SECURITY DEFINER entry points. Operator creates login roles and supplies secrets later.
- Webhook uses CVSRS_SMS_WEBHOOK_DB_URL exclusively, never a worker/admin fallback. Prove valid callbacks cannot construct a client without that credential.
- Replace production process-local request buckets with an atomic shared Redis REST limit, bounded network timeout and fail-closed configuration/outage handling. Use one global route bucket unless a configured ingress-owned IP header is supplied; never trust arbitrary x-forwarded-for by default. Hash identity and paths before sending keys to the store.
- Emit request-id/code/status denial telemetry without identifiers or request bodies. Operator binds logs/alerts and trusted ingress later.
- Validate meaningful unit failure/success contracts and DB grants; deployment and capacity evidence remain open.
