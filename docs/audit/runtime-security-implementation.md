# Runtime security changes

Status: NEEDS REVIEW. E13 remains pending independent review and real deployment verification.

Production web processes no longer start an in-process outbox poller. Run the existing worker CLI separately with a login granted the non-login `cvsrs_outbox_worker` group, and do not put its URL into the web environment. Migration 0028 creates that group and `cvsrs_sms_webhook`, grants schema USAGE and only the exact worker or callback SECURITY DEFINER entry points. It embeds no passwords and grants no table access.

The SMS callback uses only `CVSRS_SMS_WEBHOOK_DB_URL`; a valid signed callback with only a worker URL now returns 503 without constructing a DB client. Regression observed 200 before the fix and 503 after.

Production API limits now use an atomic Redis script over the [documented REST command contract](https://upstash.com/docs/redis/features/restapi). Configure the HTTPS store origin and token later. Missing configuration, network timeout (2.5 seconds), redirects, HTTP errors and invalid responses fail closed with 503. Development units retain process-local buckets. Keys hash identity and normalized route, including verification tokens; default buckets are shared per route. Only configure an ingress-owned IP header when ingress overwrites it and direct origin access is blocked. Global buckets are conservative and need load/capacity validation; provider Auth rate limits remain separately configured in Supabase.

API denials emit code, status and request id, without identifiers or request bodies. Logging collection, alerts, credential provisioning and trusted ingress remain deployment gates. No external service was provisioned. Unit contracts for absent store, store errors, count/expiry interpretation, forwarded-address distrust and webhook isolation pass; complete regression and real Redis checks remain pending.
