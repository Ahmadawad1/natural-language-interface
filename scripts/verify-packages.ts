import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Installs real package tarballs in an isolated directory, without workspace aliases.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check with npm run verify:packages.');
const root = resolve('.');
const data = join(root, '.data');
mkdirSync(data, { recursive: true });
const destination = mkdtempSync(join(data, 'package-check-'));
function run(args: string[], cwd = root) {
  const result = spawnSync(process.execPath, [npmCli!, ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
  return result.stdout;
}
const tarballs = ['protocol', 'backend', 'runtime', 'react'].map((name) => {
  const result = JSON.parse(
    run(['pack', '--workspace', `@nli/${name}`, '--pack-destination', destination, '--json']),
  );
  return join(destination, result[0].filename as string);
});
writeFileSync(
  join(destination, 'package.json'),
  JSON.stringify({ name: 'nli-independent-consumer', private: true, type: 'module' }),
);
run(
  [
    'install',
    ...tarballs,
    'react@^19.0.0',
    'react-dom@^19.0.0',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ],
  destination,
);
writeFileSync(
  join(destination, 'smoke.mjs'),
  `
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Assistant, NliProvider, NliClient } from '@nli/react';
import { ToolRegistry, issueToken, verifyToken } from '@nli/backend';
import { RuntimeStore, RuntimeEngine, OllamaPlanner, createRuntimeApp } from '@nli/runtime';
const secret = 'standalone-package-test-secret-32-characters';
const principal = { appId: 'test', tenantId: 'tenant', userId: 'user', permissions: [] };
assert.deepEqual(await verifyToken(await issueToken(principal, secret), secret), principal);
const store = new RuntimeStore(':memory:');
const registry = new ToolRegistry({ allowedOrigins: [], adapterSecret: secret });
assert.equal(typeof createRuntimeApp(new RuntimeEngine(store, registry, new OllamaPlanner({ url: 'http://localhost:11434', model: 'test' })), { sessionSecret: secret, allowedOrigins: [] }), 'function');
store.close();
const html = renderToString(createElement(NliProvider, { endpoint: '/runtime', appId: 'test', user: { id: 'user' }, getToken: async () => '' }, createElement(Assistant, { mode: 'inline' })));
assert.match(html, /Workspace assistant/);
assert.ok(existsSync(fileURLToPath(import.meta.resolve('@nli/react/styles.css'))));
assert.equal(typeof NliClient, 'function');
console.log('PASS: standalone runtime/backend imports, JWT roundtrip, React SSR, and exported CSS.');
`,
);
const result = spawnSync(process.execPath, ['smoke.mjs'], { cwd: destination, encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
console.log(result.stdout.trim());
console.log('Isolated consumer files are under .data (ignored by Git).');
