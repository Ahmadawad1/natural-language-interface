import { describe, expect, it } from 'vitest';
import express from 'express';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry, type Principal } from '@nli/backend';
import { RuntimeEngine, RuntimeStore } from '../packages/runtime/src/server';

const principal: Principal = {
  appId: 'operations',
  tenantId: 'tenant-a',
  userId: 'operator',
  permissions: ['incidents:read'],
};
const adapterSecret = 'resilience-test-secret-at-least-32-characters';
const contract = {
  name: 'incidents_search',
  description: 'Read operations incidents.',
  kind: 'read' as const,
  permissions: ['incidents:read'],
  confirmation: false,
  timeoutMs: 1000,
  inputSchema: { type: 'object', additionalProperties: false },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['records'],
    properties: {
      records: {
        type: 'array',
        items: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
      },
    },
  },
};

describe('reusability and operational resilience', () => {
  it('executes a non-CRM application capability through the same runtime', async () => {
    const registry = new ToolRegistry({
      allowedOrigins: ['https://operations.example'],
      adapterSecret,
      fetch: async () => Response.json({ records: [{ title: 'Shipment delayed' }] }),
    });
    registry.register('operations', {
      ...contract,
      endpoint: 'https://operations.example/incidents/search',
    });
    const store = new RuntimeStore(':memory:');
    try {
      const engine = new RuntimeEngine(store, registry, {
        name: 'test',
        plan: async () => ({
          intent: 'tools',
          calls: [{ name: 'incidents_search', arguments: {} }],
        }),
      });
      const conversation = store.create(principal);
      const result = await engine.turn(principal, conversation.id, {
        message: 'Which shipments are delayed?',
      });
      expect(result.messages.at(-1)?.results?.[0].data).toEqual({
        records: [{ title: 'Shipment delayed' }],
      });
    } finally {
      store.close();
    }
  });
  it('enforces real network deadlines and caps response size', async () => {
    const api = express();
    api.post('/slow', (_req, _res) => {
      /* Deliberately never answers. */
    });
    const server = api.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const registry = new ToolRegistry({
        allowedOrigins: [origin],
        allowInsecureLocalhost: true,
        adapterSecret,
      });
      registry.register('operations', { ...contract, timeoutMs: 100, endpoint: `${origin}/slow` });
      await expect(
        registry.execute(principal, { name: contract.name, arguments: {} }, 'timeout'),
      ).rejects.toThrow('in time');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const huge = new ToolRegistry({
      allowedOrigins: ['https://operations.example'],
      adapterSecret,
      fetch: async () => new Response('x'.repeat(1_000_001)),
    });
    huge.register('operations', { ...contract, endpoint: 'https://operations.example/huge' });
    await expect(
      huge.execute(principal, { name: contract.name, arguments: {} }, 'large'),
    ).rejects.toThrow('valid response');
  });
  it('restores history and marks interrupted writes unknown after a process restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nli-persistence-'));
    const filename = join(directory, 'runtime.sqlite');
    let store = new RuntimeStore(filename);
    try {
      const c = store.create(principal);
      const proposal = store.propose(c.id, [{ name: 'example_write', arguments: {} }]);
      store.append(principal, c.id, {
        id: 'message',
        role: 'assistant',
        content: 'Review',
        createdAt: new Date().toISOString(),
        proposal,
      });
      store.claim(c.id, proposal.id);
      store.close();
      store = new RuntimeStore(filename);
      expect(store.get(principal, c.id).messages[0].proposal?.status).toBe('unknown');
      expect(() => store.claim(c.id, proposal.id)).toThrow('already been handled');
    } finally {
      store.close();
      for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true });
      rmdirSync(directory);
    }
  });
});
