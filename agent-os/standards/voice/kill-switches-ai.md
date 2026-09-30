# Kill Switches & Cheap-First AI

- Optional/costly features get an env kill switch, on by default: `FEATURE_ENABLED !== "off"` (e.g. `CALLER_CLASSIFICATION_ENABLED`). Pausing needs no deploy
- Deterministic rules first (required phrases, existing tags); call Claude only if nothing matched
- AI output is constrained to a fixed list; anything else → `"uncategorized"` for human review
- AI calls never throw into the handler — failure returns `null`
