# Natural Language Interface

An embeddable conversational layer for existing software. Let users query authorized application data and review proposed workflows without replacing the host product.

This MVP includes a reusable React SDK, a framework-independent TypeScript client, an authenticated orchestration runtime, an explicit HTTP tool registry, and a working CRM demonstration. The CRM is one integration example; the SDK and runtime contain no CRM tools or business rules.

## Run locally

Requires **Node.js 24+** and npm. No paid API key is required.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The launcher starts the React host application, CRM API on port `4101`, and NLI runtime on port `4100`. All services bind to loopback. Stop them with Ctrl+C.

The default **demo planner** recognizes a bounded set of phrases. It is not an LLM. It calls the same real HTTP adapters, authorization checks and durable SQLite database as the Ollama planner. The interface labels this mode explicitly. Example customer records are seeded on first launch; task creation is persisted in `.data/crm.sqlite` and conversations in `.data/runtime.sqlite`.

### Try the end-to-end workflow

1. Ask **“Show customers not contacted in 30 days.”**
2. Ask **“Create follow-up tasks for the first three.”**
3. Inspect the customer selection and exact parameters. Click **Confirm action** or type **“Confirm.”**
4. Open **Tasks** in the CRM. The actual API-created tasks appear there.
5. Try cancelling a proposal or waiting five minutes: neither can execute later.

Other demo queries: `Find Acme`, followed by `Summarize the latest activities for Acme Corporation`; `Which opportunities close this month?`; `Show my tasks`. Selected table rows can be used with `Create follow-up tasks for the selected customers`.

### Enable local AI

Install and run [Ollama](https://docs.ollama.com/quickstart), then:

```sh
ollama pull qwen3:8b
```

Copy `.env.example` to `.env`, set `NLI_PLANNER=ollama`, and restart `npm run dev`. Configure `OLLAMA_MODEL` and `OLLAMA_URL` as needed. The Ollama implementation uses the [structured-output chat contract](https://docs.ollama.com/capabilities/structured-outputs) to select only registered capabilities. Model availability and language quality depend on your local model. A model failure is surfaced as an error; it never silently switches to demo mode.

## Workspace layout

| Location            | Responsibility                                                             |
| ------------------- | -------------------------------------------------------------------------- |
| `packages/protocol` | Framework-independent types and streaming event contract                   |
| `packages/react`    | `NliProvider`, `Assistant`, `NliClient`, isolated CSS, result renderer     |
| `packages/backend`  | Tool registration, JSON Schema validation, signed identity, HTTP adapter   |
| `packages/runtime`  | Planning, permission checks, persistence, confirmation and orchestration   |
| `apps/demo`         | Meridian React CRM and separately authorized backend with SQLite records   |
| `scripts`           | Local development launcher                                                 |
| `tests`             | Real HTTP integration, authority-boundary, model-contract and stream tests |

## Embed it

```tsx
import { NliProvider, Assistant } from '@nli/react';
import '@nli/react/styles.css';

<NliProvider
  endpoint="https://your-runtime.example"
  appId="your-app"
  user={{ id: signedInUser.id, name: signedInUser.name }}
  getToken={getShortLivedTokenFromYourBackend}
  context={{ page: 'customers', selectedIds }}
  theme="light"
  locale="en"
>
  <Assistant mode="floating" placement="right" />
</NliProvider>;
```

The browser never receives signing secrets. Displayed user details and page context do not grant permissions. The host backend issues the principal, and the runtime verifies its signature on every request. Follow the **[integration guide](docs/integration.md)** for package installation from this repository, a complete adapter example, and runtime configuration.

## Implemented boundaries

- Explicit application-specific allowlist. No arbitrary URLs, SQL, shell commands, or endpoint discovery.
- JSON Schema validation for both tool arguments and results; bounded calls, body sizes, response sizes and timeouts.
- User/application/tenant-scoped conversations and tools. The demo host independently enforces tenant ownership.
- All writes require confirmation of an immutable, single-use proposal, bound to its conversation and identity, valid for five minutes.
- Current token permissions are rechecked at confirmation. New messages supersede pending proposals.
- Host-side transactional idempotency for task creation; no automatic write retries. Interrupted writes are marked **unknown**, not successful.
- Streaming execution status and final conversation snapshots over NDJSON, session history, floating/expanded/inline modes, theme and locale configuration.
- Responsive CRM with real search, filters, row selection, task completion and a live integration catalog.

## Validate

```sh
npm run check    # strict TypeScript, automated tests, all package/app builds
npm run verify:packages  # install packed artifacts in an isolated consumer and smoke-test them
npm audit
```

See **[verification results](docs/verification.md)** and **[architecture and deployment limits](docs/architecture.md)**. CI is configured for Node 24 on Windows and Linux, targeting the existing `master` branch.

## MVP limits

This is a local demonstration and integration foundation, not a managed multi-customer production service. The demo login deliberately issues one predefined local identity and the launcher refuses `NODE_ENV=production`. Deploy with your own host authentication and current authorization checks. SQLite supports one runtime process per database here; there is no distributed queue, key rotation/JWKS integration, managed retention, or fleet-wide rate limiter. The model chooses tools but factual results and success messages are runtime-owned. Streaming currently carries execution events and final results, not model-token deltas. English and Spanish core UI labels are included; technical statuses and proposal explanations remain English.

The product hypothesis remains unvalidated. No customer traction or performance improvement is claimed.

## License

[Apache License 2.0](LICENSE). The repository’s existing license and default branch are preserved.
