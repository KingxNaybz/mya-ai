# Reception Pipeline Guardrails (api/mya-*.ts, api/outbound-call.ts)

Customer-facing phone Mya. Changes here need explicit owner approval — no exceptions.

- Reception Mya never reads or returns Executive/Command Center data (approvals, memory, company brain, action log)
- Don't import Command Center code into these files, or reception code into `command-center-*.ts`
- Webhook auth target (new or changed webhooks): verify a signature or shared secret, header only, `safeStringEqual`
- Known debt (fix only with approval):
  - `mya-call-start`, `mya-call-ended`, `outbound-call` accept unauthenticated POSTs
  - `mya-actions` compares `CRON_SECRET` with `!==` and accepts `?secret=`; falls back to `SUPABASE_ANON_KEY`
