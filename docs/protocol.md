# Runtime HTTP protocol v1

Except `/health`, every endpoint requires `Authorization: Bearer <host-issued JWT>`. The optional `X-NLI-App-Id` header, sent by the SDK, must match the verified principal. The runtime ignores browser-supplied identity as an authorization source. Configure an exact CORS origin allowlist.

| Method/path                           | Response                                                              |
| ------------------------------------- | --------------------------------------------------------------------- |
| `GET /health`                         | Runtime status, planner name and version; not a model-readiness check |
| `GET /v1/capabilities`                | Authorized tool metadata, with execution URLs omitted                 |
| `POST /v1/conversations`              | `201 { id, messages: [] }`                                            |
| `GET /v1/conversations/:id`           | Conversation owned by the current app, tenant and user                |
| `POST /v1/conversations/:id/messages` | Updated conversation or NDJSON event stream                           |

Normal request:

```json
{
  "message": "Show unresolved high-priority incidents",
  "context": { "page": "incidents", "selectedIds": [] },
  "locale": "en"
}
```

Explicit action request:

```json
{
  "confirmation": {
    "proposalId": "server-issued-proposal-uuid",
    "decision": "confirm"
  }
}
```

Use `cancel` to reject. A message exactly equal to `Confirm` or `Cancel` (case-insensitive, with optional trailing punctuation) resolves the current pending proposal. Freeform text such as “yes, go ahead” is not server authorization; use the explicit UI or literal command. Do not submit both message and confirmation. A new non-confirmation message cancels earlier pending proposals.

Set `Accept: application/x-ndjson` to receive streaming events. Blank lines are heartbeats. Each complete line is a JSON value:

```jsonl
{"type":"status","content":"Understanding your request…"}
{"type":"status","content":"Reading from incidents_search…"}
{"type":"conversation","conversation":{"id":"...","messages":[...]}}
```

`conversation` is the terminal authoritative snapshot. `error` is a terminal transport/orchestration error; most tool/model failures are persisted as assistant messages with `error: true`. Before streaming begins, errors use an HTTP status with `{ "error": "..." }`. After response headers are sent, terminal errors use `{ "type": "error", "content": "..." }` in the stream. If the stream ends without a terminal event, fetch the conversation before retrying a state change.

Messages include a UUID, role, content, ISO timestamp, optional `results` and optional `proposal`. A tool result contains `tool`, schema-validated `data` and `durationMs`. A proposal contains immutable calls, ID, expiry and lifecycle status. Raw business data is escaped by React; it is never rendered as trusted HTML.

Limits: message 4,000 characters, request body 32KB, at most 20 context properties, four independent calls per plan, 1MB per tool response, 200 messages per conversation, 60 authenticated requests per minute per app/tenant/user per process. Tool timeouts are configured from 100ms to 120 seconds; Ollama planning has a 60-second deadline. Confirmation TTL is five minutes. Create a new conversation when its message limit is reached. All responses are `Cache-Control: no-store`.
