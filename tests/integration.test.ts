import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Server } from 'node:http';
import { issueToken, ToolRegistry, type Principal } from '@nli/backend';
import type { Conversation } from '@nli/protocol';
import { createDemoHost, demoPrincipal } from '../apps/demo/server/app';
import { CrmDatabase } from '../apps/demo/server/database';
import { crmCapabilities } from '../apps/demo/server/capabilities';
import { DemoPlanner } from '../apps/demo/server/planner';
import { createRuntimeApp, RuntimeEngine, RuntimeStore } from '../packages/runtime/src/server';
import type { Planner } from '../packages/runtime/src/planner';

const sessionSecret = 'session-test-secret-that-is-at-least-32-chars';
const adapterSecret = 'adapter-test-secret-that-is-at-least-32-chars';
let host: Server;
let origin: string;
let crm: CrmDatabase;
let store: RuntimeStore;
let registry: ToolRegistry;
let token: string;
let app: ReturnType<typeof createRuntimeApp>;
beforeAll(async () => {
  crm = new CrmDatabase(':memory:');
  store = new RuntimeStore(':memory:');
  host = createDemoHost(crm, { sessionSecret, adapterSecret }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => host.on('listening', resolve));
  origin = `http://127.0.0.1:${(host.address() as { port: number }).port}`;
  registry = new ToolRegistry({
    allowedOrigins: [origin],
    allowInsecureLocalhost: true,
    adapterSecret,
  });
  crmCapabilities(origin).forEach((t) => registry.register('meridian', t));
  app = createRuntimeApp(new RuntimeEngine(store, registry, new DemoPlanner()), {
    sessionSecret,
    allowedOrigins: ['https://host.example'],
  });
  token = await issueToken(demoPrincipal, sessionSecret);
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => host.close((e) => (e ? reject(e) : resolve())));
  store.close();
  crm.close();
});
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
const create = async (t = token) =>
  (await request(app).post('/v1/conversations').set(auth(t)).expect(201)).body as Conversation;
const turn = async (id: string, message: string, t = token) =>
  (
    await request(app)
      .post(`/v1/conversations/${id}/messages`)
      .set(auth(t))
      .send({ message })
      .expect(200)
  ).body as Conversation;
const confirm = async (id: string, proposalId: string, t = token, decision = 'confirm') =>
  (
    await request(app)
      .post(`/v1/conversations/${id}/messages`)
      .set(auth(t))
      .send({ confirmation: { proposalId, decision } })
      .expect(200)
  ).body as Conversation;

describe('real HTTP integration: runtime → adapter → tenant-scoped SQLite CRM', () => {
  it('executes the query → contextual first three → confirmation flow, persisting exactly three tasks', async () => {
    const c = await create();
    const count = crm.tasks(demoPrincipal).total;
    const query = await turn(c.id, 'Show customers not contacted in 30 days');
    const records = (query.messages.at(-1)!.results![0].data as { records: { id: string }[] })
      .records;
    expect(records.map((r) => r.id)).toEqual(['cus_1', 'cus_3', 'cus_4', 'cus_6', 'cus_7']);
    const proposed = await turn(c.id, 'Create follow-up tasks for the first three');
    const proposal = proposed.messages.at(-1)!.proposal!;
    expect(proposal.calls[0].arguments.customerIds).toEqual(records.slice(0, 3).map((r) => r.id));
    expect(crm.tasks(demoPrincipal).total).toBe(count);
    const result = await turn(c.id, 'Confirm');
    expect(result.messages.at(-1)!.results![0].tool).toBe('tasks_create');
    expect(result.messages.find((m) => m.proposal)?.proposal?.status).toBe('succeeded');
    expect(crm.tasks(demoPrincipal).total).toBe(count + 3);
    await confirm(c.id, proposal.id);
    expect(crm.tasks(demoPrincipal).total).toBe(count + 3);
    const events = store.db
      .prepare('SELECT event FROM audit WHERE conversation=?')
      .all(c.id)
      .map((r) => r.event);
    expect(events).toContain('action.confirmed');
    expect(events).toContain('tool.succeeded');
  });
  it('does not allow missing, tampered, expired, wrong-audience tokens or mismatched app context', async () => {
    await request(app).post('/v1/conversations').expect(401);
    await request(app)
      .post('/v1/conversations')
      .set(auth(token.slice(0, -8) + 'tampered'))
      .expect(401);
    await request(app)
      .post('/v1/conversations')
      .set(auth(await issueToken(demoPrincipal, sessionSecret, 'nli-runtime', '-1s')))
      .expect(401);
    await request(app)
      .post('/v1/conversations')
      .set(auth(await issueToken(demoPrincipal, sessionSecret, 'demo-ui')))
      .expect(401);
    await request(app)
      .post('/v1/conversations')
      .set(auth())
      .set('X-NLI-App-Id', 'some-other-app')
      .expect(403);
  });
  it('isolates conversations across tenant, user and application', async () => {
    const c = await create();
    for (const change of [
      { tenantId: 'different' },
      { userId: 'different' },
      { appId: 'different' },
    ]) {
      const other = await issueToken({ ...demoPrincipal, ...change }, sessionSecret);
      await request(app).get(`/v1/conversations/${c.id}`).set(auth(other)).expect(404);
      await request(app)
        .post(`/v1/conversations/${c.id}/messages`)
        .set(auth(other))
        .send({ message: 'Confirm' })
        .expect(404);
    }
  });
  it('filters discovery by permission and application', async () => {
    const readOnly = await issueToken(
      { ...demoPrincipal, permissions: ['crm:read'] },
      sessionSecret,
    );
    const { body } = await request(app).get('/v1/capabilities').set(auth(readOnly)).expect(200);
    expect(body.tools).toHaveLength(4);
    expect(JSON.stringify(body)).not.toContain('endpoint');
    const other = await issueToken({ ...demoPrincipal, appId: 'another' }, sessionSecret);
    expect((await request(app).get('/v1/capabilities').set(auth(other))).body.tools).toEqual([]);
  });
  it('rechecks changed permissions when a write is confirmed', async () => {
    const c = await create();
    await turn(c.id, 'Find Acme');
    const proposed = await turn(c.id, 'Create tasks for these customers');
    const readonly = await issueToken(
      { ...demoPrincipal, permissions: ['crm:read'] },
      sessionSecret,
    );
    const count = crm.tasks(demoPrincipal).total;
    const result = await confirm(c.id, proposed.messages.at(-1)!.proposal!.id, readonly);
    expect(result.messages.at(-1)!.error).toBe(true);
    expect(crm.tasks(demoPrincipal).total).toBe(count);
  });
  it('supports cancellation, expiration and superseding a stale proposal', async () => {
    for (const mode of ['cancel', 'expire', 'supersede']) {
      const c = await create();
      await turn(c.id, 'Find Acme');
      const proposed = await turn(c.id, 'Create tasks for these customers');
      const proposal = proposed.messages.at(-1)!.proposal!;
      const count = crm.tasks(demoPrincipal).total;
      if (mode === 'cancel') await confirm(c.id, proposal.id, token, 'cancel');
      if (mode === 'expire')
        store.db
          .prepare('UPDATE proposals SET expires=? WHERE id=?')
          .run(Date.now() - 1, proposal.id);
      if (mode === 'supersede') await turn(c.id, 'Show my tasks');
      const result = await confirm(c.id, proposal.id);
      expect(result.messages.at(-1)!.error).toBe(true);
      expect(crm.tasks(demoPrincipal).total).toBe(count);
    }
  });
  it('keeps confirmation bound to its conversation', async () => {
    const c = await create();
    await turn(c.id, 'Find Acme');
    const proposal = (await turn(c.id, 'Create tasks for these customers')).messages.at(
      -1,
    )!.proposal!;
    const other = await create();
    const count = crm.tasks(demoPrincipal).total;
    const result = await confirm(other.id, proposal.id);
    expect(result.messages.at(-1)!.error).toBe(true);
    expect(crm.tasks(demoPrincipal).total).toBe(count);
  });
  it('streams status and the final persisted conversation over NDJSON', async () => {
    // Use a separate user bucket so the security tests do not consume this request's limit.
    const streamToken = await issueToken(
      { ...demoPrincipal, userId: 'stream-user' },
      sessionSecret,
    );
    const c = await create(streamToken);
    const response = await request(app)
      .post(`/v1/conversations/${c.id}/messages`)
      .set(auth(streamToken))
      .set('Accept', 'application/x-ndjson')
      .send({ message: 'Show all customers' })
      .expect(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    const events = response.text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events[0].type).toBe('status');
    expect(events.at(-1).conversation.messages.at(-1).results[0].data.total).toBe(10);
  });
  it('rejects unknown body fields, blank requests and unapproved origins', async () => {
    const t = await issueToken({ ...demoPrincipal, userId: 'validation-user' }, sessionSecret);
    const c = await create(t);
    for (const body of [
      { message: '  ' },
      { message: 'Hi', permissions: ['admin'] },
      { message: 'Hi', confirmation: { proposalId: 'x', decision: 'confirm' } },
      { message: 'x'.repeat(4001) },
    ])
      await request(app)
        .post(`/v1/conversations/${c.id}/messages`)
        .set(auth(t))
        .send(body)
        .expect(400);
    await request(app)
      .get('/v1/capabilities')
      .set(auth(t))
      .set('Origin', 'https://evil.example')
      .expect(403);
    await request(app)
      .options('/v1/conversations')
      .set('Origin', 'https://host.example')
      .expect(204);
  });
  it('rate-limits repeated authenticated requests', async () => {
    const t = await issueToken({ ...demoPrincipal, userId: 'rate-user' }, sessionSecret);
    for (let i = 0; i < 60; i++)
      await request(app).get('/v1/capabilities').set(auth(t)).expect(200);
    await request(app).get('/v1/capabilities').set(auth(t)).expect(429);
  });
});

describe('host application authority', () => {
  it('honors open-task filtering after a host-side completion', async () => {
    crm.completeTask(demoPrincipal, 'task_initial');
    const result = await registry.execute(
      demoPrincipal,
      { name: 'tasks_list', arguments: { status: 'Open' } },
      'open-tasks',
    );
    const data = result.data as { records: { id: string; status: string }[] };
    expect(data.records.every((task) => task.status === 'Open')).toBe(true);
    expect(data.records.some((task) => task.id === 'task_initial')).toBe(false);
  });
  it('requires a host-audience signature and permissions even when called directly', async () => {
    await request(host)
      .post('/tools/tasks/create')
      .send({ customerIds: ['cus_1'], title: 'Test' })
      .expect(401);
    await request(host)
      .post('/tools/tasks/create')
      .set(auth())
      .send({ customerIds: ['cus_1'], title: 'Test' })
      .expect(401);
    const t = await issueToken(
      { ...demoPrincipal, permissions: ['crm:read'] },
      adapterSecret,
      'nli-host',
    );
    await request(host)
      .post('/tools/tasks/create')
      .set(auth(t))
      .send({ customerIds: ['cus_1'], title: 'Test' })
      .expect(403);
  });
  it('enforces tenant isolation and creates a batch atomically', async () => {
    const other = { ...demoPrincipal, tenantId: 'other' };
    const t = await issueToken(other, adapterSecret, 'nli-host');
    const result = await request(host)
      .post('/tools/customers/search')
      .set(auth(t))
      .send({})
      .expect(200);
    expect(result.body.records).toEqual([]);
    await request(host)
      .post('/tools/tasks/create')
      .set(auth(t))
      .set('Idempotency-Key', 'other')
      .send({ customerIds: ['cus_1'], title: 'No' })
      .expect(404);
    const count = crm.tasks(demoPrincipal).total;
    expect(() =>
      crm.createTasks(
        demoPrincipal,
        { customerIds: ['cus_1', 'nonexistent'], title: 'Test' },
        'atomic',
      ),
    ).toThrow();
    expect(crm.tasks(demoPrincipal).total).toBe(count);
  });
  it('replays the same verified outcome for an idempotency key and rejects payload mismatch', async () => {
    const t = await issueToken(demoPrincipal, adapterSecret, 'nli-host');
    const count = crm.tasks(demoPrincipal).total;
    const invoke = (title = 'Idempotent task') =>
      request(host)
        .post('/tools/tasks/create')
        .set(auth(t))
        .set('Idempotency-Key', 'test-idempotency')
        .send({ customerIds: ['cus_1'], title });
    const first = await invoke().expect(200);
    const second = await invoke().expect(200);
    expect(second.body).toEqual(first.body);
    expect(crm.tasks(demoPrincipal).total).toBe(count + 1);
    await invoke('Changed payload').expect(409);
  });
});

describe('runtime execution safety', () => {
  function engineFor(planner: Planner, useRegistry = registry) {
    const localStore = new RuntimeStore(':memory:');
    return { engine: new RuntimeEngine(localStore, useRegistry, planner), localStore };
  }
  it('rejects hallucinated tools, unauthorized writes, malformed arguments and mixed dependent plans', async () => {
    const cases = [
      { calls: [{ name: 'execute_sql', arguments: { sql: 'DROP TABLE customers' } }] },
      { calls: [{ name: 'customers_search', arguments: { inactiveDays: -1 } }] },
      { calls: [{ name: 'customers_search', arguments: { url: 'https://evil.example' } }] },
      {
        calls: [
          { name: 'customers_search', arguments: {} },
          { name: 'tasks_create', arguments: { customerIds: ['cus_1'], title: 'Test' } },
        ],
      },
    ];
    for (const test of cases) {
      const { engine, localStore } = engineFor({
        name: 'test',
        plan: async () => ({ intent: 'tools', ...test }),
      });
      const c = localStore.create(demoPrincipal);
      const count = crm.tasks(demoPrincipal).total;
      const result = await engine.turn(demoPrincipal, c.id, { message: 'anything' });
      expect(result.messages.at(-1)?.error).toBe(true);
      expect(crm.tasks(demoPrincipal).total).toBe(count);
      localStore.close();
    }
  });
  it('serializes concurrent requests in a conversation', async () => {
    let release!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { engine, localStore } = engineFor({
      name: 'slow',
      plan: async () => {
        await pause;
        return { intent: 'info', message: 'Done' };
      },
    });
    const c = localStore.create(demoPrincipal);
    const first = engine.turn(demoPrincipal, c.id, { message: 'First' });
    await expect(engine.turn(demoPrincipal, c.id, { message: 'Second' })).rejects.toThrow(
      'already running',
    );
    release();
    await first;
    localStore.close();
  });
  it('does not fabricate a write success or retry when the application response is lost', async () => {
    let attempts = 0;
    const broken = new ToolRegistry({
      allowedOrigins: [origin],
      allowInsecureLocalhost: true,
      adapterSecret,
      fetch: async () => {
        attempts++;
        throw new Error('network lost');
      },
    });
    const tool = crmCapabilities(origin).find((t) => t.name === 'tasks_create')!;
    broken.register('meridian', tool);
    const { engine, localStore } = engineFor(
      {
        name: 'test',
        plan: async () => ({
          intent: 'tools',
          calls: [{ name: 'tasks_create', arguments: { customerIds: ['cus_1'], title: 'Test' } }],
        }),
      },
      broken,
    );
    const c = localStore.create(demoPrincipal);
    const proposal = (await engine.turn(demoPrincipal, c.id, { message: 'Create' })).messages.at(
      -1,
    )!.proposal!;
    const result = await engine.turn(demoPrincipal, c.id, {
      confirmation: { proposalId: proposal.id, decision: 'confirm' },
    });
    expect(result.messages.at(-1)?.error).toBe(true);
    expect(localStore.proposal(c.id, proposal.id).status).toBe('unknown');
    await engine.turn(demoPrincipal, c.id, {
      confirmation: { proposalId: proposal.id, decision: 'confirm' },
    });
    expect(attempts).toBe(1);
    localStore.close();
  });
  it('rejects unknown origins, redirects, writes without confirmation and invalid output', async () => {
    const tool = crmCapabilities(origin)[0];
    const r = new ToolRegistry({
      allowedOrigins: [origin],
      allowInsecureLocalhost: true,
      adapterSecret,
      fetch: async () => new Response(JSON.stringify({ madeUp: true }), { status: 200 }),
    });
    expect(() =>
      r.register('meridian', { ...tool, endpoint: 'http://169.254.169.254/metadata' }),
    ).toThrow();
    expect(() => r.register('meridian', { ...tool, kind: 'write', confirmation: false })).toThrow();
    r.register('meridian', tool);
    await expect(
      r.execute(demoPrincipal, { name: tool.name, arguments: {} }, 'test'),
    ).rejects.toThrow('registered contract');
    const redirectHost = (await import('express')).default();
    redirectHost.post('/redirect', (_req, res) =>
      res.redirect(307, `${origin}/tools/customers/search`),
    );
    const s = redirectHost.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => s.on('listening', resolve));
    try {
      const redirectOrigin = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
      const redirectRegistry = new ToolRegistry({
        allowedOrigins: [redirectOrigin],
        allowInsecureLocalhost: true,
        adapterSecret,
      });
      redirectRegistry.register('meridian', { ...tool, endpoint: `${redirectOrigin}/redirect` });
      await expect(
        redirectRegistry.execute(demoPrincipal, { name: tool.name, arguments: {} }, 'redirect'),
      ).rejects.toThrow('valid response');
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });
});
