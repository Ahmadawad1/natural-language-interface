import { describe, expect, it } from 'vitest';
import { OllamaPlanner, type PlannerInput } from '../packages/runtime/src/planner';
import { DemoPlanner } from '../apps/demo/server/planner';
import { crmCapabilities } from '../apps/demo/server/capabilities';
import { readEvents } from '../packages/react/src/client';
import type { StreamEvent } from '@nli/protocol';

const input: PlannerInput = {
  message: 'Find customers',
  conversation: { id: 'test', messages: [] },
  tools: crmCapabilities('http://127.0.0.1:4101'),
  context: {},
  locale: 'en',
};
describe('Ollama structured planning contract', () => {
  it('supplies bounded tool schemas and conversation context to the local model', async () => {
    let sent: Record<string, unknown> = {};
    const planner = new OllamaPlanner({
      url: 'http://127.0.0.1:11434',
      model: 'test',
      fetch: async (_url, init) => {
        sent = JSON.parse(init!.body as string);
        return Response.json({
          message: {
            content: JSON.stringify({
              intent: 'tools',
              message: '',
              calls: [{ name: 'customers_search', arguments: { inactiveDays: 30 } }],
            }),
          },
        });
      },
    });
    expect((await planner.plan(input)).intent).toBe('tools');
    expect(sent.model).toBe('test');
    expect(sent.stream).toBe(false);
    expect(JSON.stringify(sent)).toContain('Never invent record IDs');
    expect(JSON.stringify(sent)).toContain('customers_search');
  });
  it('fails closed for invalid JSON, unknown tool names, empty plans and model errors', async () => {
    for (const content of [
      'not json',
      JSON.stringify({
        intent: 'tools',
        message: '',
        calls: [{ name: 'unregistered', arguments: {} }],
      }),
      JSON.stringify({ intent: 'tools', message: '', calls: [] }),
    ]) {
      const planner = new OllamaPlanner({
        url: 'http://localhost:11434',
        model: 'test',
        fetch: async () => Response.json({ message: { content } }),
      });
      await expect(planner.plan(input)).rejects.toThrow('No action was executed');
    }
    const offline = new OllamaPlanner({
      url: 'http://localhost:11434',
      model: 'test',
      fetch: async () => {
        throw new Error('Offline');
      },
    });
    await expect(offline.plan(input)).rejects.toThrow('local model');
  });
  it('uses runtime-owned informational responses and handles an empty permitted tool set', async () => {
    const planner = new OllamaPlanner({
      url: 'http://localhost:11434',
      model: 'test',
      fetch: async () =>
        Response.json({
          message: {
            content: JSON.stringify({
              intent: 'info',
              message: 'I deleted all records',
              calls: [],
            }),
          },
        }),
    });
    expect(JSON.stringify(await planner.plan(input))).not.toContain('deleted');
    expect((await planner.plan({ ...input, tools: [] })).intent).toBe('unsupported');
  });
});
describe('demo planner boundaries', () => {
  it('asks for missing customer selection and inactivity interval', async () => {
    const planner = new DemoPlanner();
    expect((await planner.plan({ ...input, message: 'Create follow-up tasks' })).intent).toBe(
      'clarify',
    );
    expect(
      (await planner.plan({ ...input, message: "Show customers who haven't been contacted" }))
        .intent,
    ).toBe('clarify');
    expect((await planner.plan({ ...input, message: 'Delete all data' })).intent).toBe(
      'unsupported',
    );
  });
});
describe('SDK streaming parser', () => {
  it('handles split UTF-8 chunks, heartbeat lines and an unterminated final line', async () => {
    const events: StreamEvent[] = [];
    const encoded = new TextEncoder().encode(
      '\n{"type":"status","content":"Reading café…"}\n{"type":"conversation","conversation":{"id":"1","messages":[]}}',
    );
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < encoded.length; i += 3) controller.enqueue(encoded.slice(i, i + 3));
        controller.close();
      },
    });
    await readEvents(new Response(stream), (event) => events.push(event));
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'status', content: 'Reading café…' });
  });
  it('reports a truncated stream instead of assuming success', async () => {
    await expect(
      readEvents(new Response('{"type":"status","content":"Working"}\n'), () => {}),
    ).rejects.toThrow('before the result');
  });
});
