# Webhooks Never Break the Call

A webhook failure must never drop or degrade a live call.

- `mya-call-start` always returns 200 with the full `dynamic_variables` set — including on lookup error, no caller ID, unknown caller, or exception
- `dynamic_variables` values are all strings (`"false"`, `"0"`, `""`) — never null/number/bool
- Side work (lead insert, owner SMS, caller classification) is try/caught and logged "(non-fatal)"; a failure never blocks the main response
- Retries are idempotent: check for an existing row (e.g. by `conversation_id`) before inserting or calling AI again
