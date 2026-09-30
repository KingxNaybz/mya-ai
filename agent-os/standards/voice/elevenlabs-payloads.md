# ElevenLabs Payload Handling

Treat every ElevenLabs field as untrusted shape.

- Post-call body may be wrapped: `body = raw.data?.conversation_id ? raw.data : raw`
- Data Collection fields may arrive as `{ data_collection_id, value, json_schema, rationale }` → unwrap `.value` (`getCollectedValue` / `unwrapCollectedText` / `cleanText`) before storing or displaying
- Stringified JSON in a text field → parse and take `.value`, else drop
- Phones → E.164 (`+1XXXXXXXXXX`) before any lookup or insert
- Cap display text length (`cleanText(v, 140)`)
