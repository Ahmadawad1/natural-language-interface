import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToolRegistry } from '@nli/backend';
import {
  createRuntimeApp,
  RuntimeEngine,
  RuntimeStore,
  OllamaPlanner,
} from '../packages/runtime/src/server.js';
import { createDemoHost } from '../apps/demo/server/app.js';
import { CrmDatabase } from '../apps/demo/server/database.js';
import { crmCapabilities } from '../apps/demo/server/capabilities.js';
import { DemoPlanner } from '../apps/demo/server/planner.js';

if (process.env.NODE_ENV === 'production')
  throw new Error(
    'This launcher exposes a development-only demo identity. Use your own authenticated host integration in production.',
  );
const sessionSecret = process.env.NLI_SESSION_SECRET!;
const adapterSecret = process.env.NLI_ADAPTER_SECRET!;
if (!sessionSecret || !adapterSecret) throw new Error('Start with npm run dev.');
const data = resolve('.data');
mkdirSync(data, { recursive: true });
const crm = new CrmDatabase(resolve(data, 'crm.sqlite'));
const store = new RuntimeStore(resolve(data, 'runtime.sqlite'));
const registry = new ToolRegistry({
  allowedOrigins: ['http://127.0.0.1:4101'],
  allowInsecureLocalhost: true,
  adapterSecret,
});
crmCapabilities('http://127.0.0.1:4101').forEach((tool) => registry.register('meridian', tool));
const mode = process.env.NLI_PLANNER ?? 'demo';
if (!['demo', 'ollama'].includes(mode)) throw new Error('NLI_PLANNER must be demo or ollama.');
const planner =
  mode === 'ollama'
    ? new OllamaPlanner({
        url: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
        model: process.env.OLLAMA_MODEL ?? 'qwen3:8b',
      })
    : new DemoPlanner();
const host = createDemoHost(crm, { sessionSecret, adapterSecret }).listen(4101, '127.0.0.1', () =>
  console.log('CRM API: http://127.0.0.1:4101'),
);
const runtime = createRuntimeApp(new RuntimeEngine(store, registry, planner), {
  sessionSecret,
  allowedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
}).listen(4100, '127.0.0.1', () =>
  console.log(`NLI runtime: http://127.0.0.1:4100 (${mode} planner)`),
);
for (const server of [host, runtime])
  server.on('error', (error) => {
    console.error(error.message);
    process.exit(1);
  });
const close = () => {
  host.close();
  runtime.close();
  crm.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
