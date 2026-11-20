# Integrating Natural Language Interface

This guide adds a conversational surface to an existing application. Your frontend, API, database, authentication and business rules remain yours. NLI proposes and invokes an explicitly selected subset of your capabilities.

## 1. Use the SDK packages

These packages are local workspace packages, **not published npm releases**. Within this repository run `npm ci && npm run build`. For another checkout, either use workspace/file references or pack the built libraries into a local directory:

```sh
npm pack --workspace @nli/protocol --pack-destination /absolute/path/to/packages
npm pack --workspace @nli/react --pack-destination /absolute/path/to/packages
npm pack --workspace @nli/backend --pack-destination /absolute/path/to/packages
npm pack --workspace @nli/runtime --pack-destination /absolute/path/to/packages
```

Create the destination first. Install the protocol and React tarballs in the host frontend; install protocol, backend and runtime tarballs in your runtime service. The backend SDK can also be installed in your host API. Install related tarballs together so npm resolves the unpublished `0.1.0` dependencies locally. A private registry is an alternative for pilot distribution. React 18 or later is a peer dependency; the demo runs React 19. Runtime and host demo require Node 24 or later.

## 2. Issue identity from your authenticated backend

The host must derive identity and permissions from its authenticated session and authorization store. Do not accept a user, tenant, application ID or permission list from the browser as proof of access.

```ts
import { issueToken } from '@nli/backend';

app.post('/api/nli-session', requireYourLogin, async (req, res) => {
  // Application-specific functions supplied by your backend:
  const user = req.authenticatedUser;
  const permissions = await yourAuthorizationStore.permissionsFor(user);
  const token = await issueToken(
    {
      appId: 'support-platform',
      tenantId: user.activeTenantId,
      userId: user.id,
      permissions,
    },
    process.env.NLI_SESSION_SECRET!,
  );
  res.set('Cache-Control', 'no-store').json({ token });
});
```

Set a cryptographically random `NLI_SESSION_SECRET` of at least 32 characters in the trusted host and runtime. Tokens use HS256, issuer `nli-host`, audience `nli-runtime`, and expire after 15 minutes by default. Verify the requested tenant membership on the host. Keep CSRF protections on your cookie-authenticated token route. Use HTTPS outside loopback.

**Demo exception:** `apps/demo/server/app.ts` has a loopback-only `/api/session` for a predefined fake account. It is an executable demo shortcut, not a production authentication implementation. Do not expose it to the Internet.

## 3. Mount the assistant in your existing React tree

```tsx
import { NliProvider, Assistant } from '@nli/react';
import '@nli/react/styles.css';

async function fetchNliToken() {
  const response = await fetch('/api/nli-session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': yourCsrfToken },
  });
  if (!response.ok) throw new Error('Sign in to continue.');
  return (await response.json()).token;
}

function ApplicationShell({ currentUser, selectedIds, children }) {
  return (
    <NliProvider
      endpoint="https://nli.your-company.example"
      appId="support-platform"
      user={{ id: currentUser.id, name: currentUser.name, tenantId: currentUser.tenantId }}
      getToken={fetchNliToken}
      context={{ page: 'incidents', selectedIds }}
      locale="en"
      theme="system"
      accentColor="#176449"
    >
      {children}
      <Assistant
        mode="floating"
        placement="right"
        title="Support assistant"
        suggestedPrompts={['Show unresolved high-priority incidents']}
        labels={{ description: 'Find incidents and prepare your next action.' }}
        onConversationChange={() => invalidateHostQueries()}
      />
    </NliProvider>
  );
}
```

`getToken` runs for every runtime request, so your backend can refresh short-lived credentials. Cache only as appropriate for your revocation policy. SDK tokens are not stored in local/session storage. Only the conversation identifier is stored in `sessionStorage`, scoped to endpoint, application, user and optional tenant ID. On logout unmount the provider, discard the host token cache and clear the corresponding session key. The SDK resets rendered history when its endpoint, application, user or tenant changes. Multi-tenant hosts must provide `user.tenantId` or remount the assistant when switching tenants; this display context is not an authorization claim.

Use `mode="inline"` to fit the assistant into a page container. Use controlled `open` and `onOpenChange`, or `defaultOpen`, for visibility. Theme values are `light`, `dark` and `system`; use the `--nli-*` CSS custom properties for further styling. `locale` is supplied to the planner and date formatter; core UI labels support English and Spanish and can be overridden. `renderResult` allows your application to render domain-specific records, currencies and links safely.

Use one mounted assistant per session for predictable synchronization; independent instances do not broadcast state to each other. The demo’s optional inline preview demonstrates placement.

## 4. Register a capability explicitly

The registry runs on the trusted server. No registration endpoint is exposed to browser users or the model.

```ts
import { ToolRegistry } from '@nli/backend';

const registry = new ToolRegistry({
  allowedOrigins: ['https://api.your-company.example'],
  adapterSecret: process.env.NLI_ADAPTER_SECRET!,
});

registry.register('support-platform', {
  name: 'incidents_search',
  description: 'Find unresolved incidents, optionally by priority.',
  kind: 'read',
  permissions: ['incidents:read'],
  confirmation: false,
  timeoutMs: 8000,
  endpoint: 'https://api.your-company.example/nli/incidents/search',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { priority: { enum: ['high', 'medium', 'low'] } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['records'],
    properties: {
      records: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title'],
          properties: { id: { type: 'string' }, title: { type: 'string' } },
        },
      },
    },
  },
});
```

Only the registered fixed URL is called. HTTP adapters use `POST` with a JSON body. Tools cannot supply another URL or request headers. Redirects are rejected. Production origins must use HTTPS; `allowInsecureLocalhost: true` permits HTTP only on literal loopback hostnames for development. Restrict network egress in your deployment as a separate infrastructure control.

Inputs and outputs use strict Ajv JSON Schema validation. Prefer `additionalProperties: false`, required fields, enum values, length/size limits and explicit bounds. Permissions are an all-of list. Tools are bound to an application ID; the planner sees only those allowed by the verified user principal. Output contracts should include only data appropriate for conversation history and the model.

## 5. Connect your endpoint to existing business logic

The adapter signs a separate short-lived token with audience `nli-host`. Use a different `NLI_ADAPTER_SECRET` known only to the runtime and host backend. Never forward an end-user browser token as a trusted service credential.

```ts
import { verifyToken } from '@nli/backend';
import Ajv from 'ajv';

const validateSearch = new Ajv().compile({
  type: 'object',
  additionalProperties: false,
  properties: { priority: { enum: ['high', 'medium', 'low'] } },
});

app.post('/nli/incidents/search', async (req, res, next) => {
  try {
    const principal = await verifyToken(
      req.headers.authorization?.replace(/^Bearer /, '') ?? '',
      process.env.NLI_ADAPTER_SECRET!,
      'nli-host',
    );
    if (principal.appId !== 'support-platform') return res.sendStatus(403);
    if (!validateSearch(req.body)) return res.sendStatus(400);
    // Recheck LIVE authorization and tenant membership using your existing API rules.
    await yourAuthz.require(principal.userId, principal.tenantId, 'incidents:read');
    const records = await yourIncidentService.search({
      tenantId: principal.tenantId,
      priority: req.body.priority,
      resolved: false,
    });
    res.json({ records: records.map(({ id, title }) => ({ id, title })) });
  } catch (error) {
    next(error);
  }
});
```

The `your*` functions above are your existing application services. The complete executable CRM equivalent is in `apps/demo/server/app.ts`, `database.ts` and `capabilities.ts`. The host remains the final authorization authority. The runtime does not invent row-level permissions, and a valid token does not substitute for current application authorization.

## 6. Run the generic runtime

```ts
import { createRuntimeApp, RuntimeEngine, RuntimeStore, OllamaPlanner } from '@nli/runtime';

const store = new RuntimeStore('/absolute/private-data/runtime.sqlite');
const planner = new OllamaPlanner({
  url: 'http://127.0.0.1:11434',
  model: 'qwen3:8b',
});
const engine = new RuntimeEngine(store, registry, planner);
createRuntimeApp(engine, {
  sessionSecret: process.env.NLI_SESSION_SECRET!,
  allowedOrigins: ['https://app.your-company.example'],
}).listen(4100, '127.0.0.1');
```

Create the private data directory first. Place the runtime behind your HTTPS reverse proxy. Disable response buffering for streaming and permit request durations longer than your chosen model/tool timeout. Do not run multiple runtime processes against this SQLite database: startup recovery intentionally clears old process locks and marks interrupted writes unknown. See the architecture guide for the scaling boundary.

## 7. Propose and execute writes

Register a write with `kind: 'write'`, `confirmation: true`, and required permissions. The registry rejects write tools without confirmation. The model can propose parameters; it cannot claim approval. The server stores an immutable proposal, identifies it with an opaque UUID and returns it for review.

Confirmation rechecks the current principal, conversation ownership, tool availability, parameters, expiry and pending state. A compare-and-set claims execution exactly once. Each call receives an `Idempotency-Key` built from the proposal ID and call index. Implement deduplication in the host transaction with a request fingerprint and the stored response. Scope it to application, tenant, user and tool. The CRM’s `createTasks` method demonstrates this.

Do not automatically retry writes after timeouts. A backend could have committed before the network failed. The runtime marks those results **unknown**, shows only verified successful results, and asks the user to check the host. A new proposal has a new key; it is not a safe recovery strategy for an uncertain previous result without reconciliation. Cancellation is available only while a proposal is pending. Closing the panel does not cancel an executing write.

Multi-call plans are bounded to four independent calls. A partially completed batch is not rolled back by the runtime. Put workflows requiring atomicity into a single host capability, as the demo’s multi-customer task creation does.

## 8. Use another frontend

`NliClient` can be used without the React component, or implement the [HTTP protocol](protocol.md) in any language. `packages/protocol` defines the wire types. Existing non-React applications can mount a small React root only for this widget; a native Web Component is a future integration option.

OpenAPI may be used later to help developers author registry entries. This MVP never automatically exposes all application endpoints.
