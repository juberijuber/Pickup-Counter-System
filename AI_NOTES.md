# AI usage notes

This project was implemented in Cursor with the Grok agent using the assignment file `Pickup_Counter_AI_Coding_Prompt.md` as the working spec.

## Tools

- **Cursor agent:** designed the schema, Express services, React screen, Docker Compose, webhook sender, and PostgreSQL integration tests, then ran commands in the workspace.
- No separate Copilot/ChatGPT session was used for this repository beyond that Cursor session.

## A prompt that worked well

The assignment’s own implementation workflow (schema and inventory first, then holds, raw-body webhooks, atomic pickup, then the three real-PostgreSQL tests) kept the work ordered. Asking the agent to treat money as integer paise and to lock product rows with `SELECT … FOR UPDATE` in id order produced a reservation path that matches Test A.

## Incorrect or weak AI output (caught in this session)

The first webhook route sketch registered `express.json()` globally **before** `express.raw()` for `POST /payments/webhook`. That would parse JSON and lose the exact body bytes required for HMAC verification, so signatures would not match what `npm run send-webhook` actually sent.

**How it was detected:** code review against section 6 (“preserve the exact raw HTTP request body; do not parse and re-serialize”). It was corrected before relying on tests, by mounting the raw parser on the webhook route first and only then applying `express.json()` to the rest of the API.

If later test runs expose further mistakes, record them here instead of inventing extra “AI errors”.

## Review before submission

Replace or extend any sentence that does not match how you actually used AI. Keep this note short and factual.
