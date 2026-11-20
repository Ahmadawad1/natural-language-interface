import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
if (existsSync('.env')) process.loadEnvFile('.env');
process.env.NLI_SESSION_SECRET ||= randomBytes(32).toString('hex');
process.env.NLI_ADAPTER_SECRET ||= randomBytes(32).toString('hex');
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'scripts/services.ts'], {
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'apps/demo', '--config', 'apps/demo/vite.config.ts'],
    { stdio: 'inherit', env: process.env },
  ),
];
let closing = false;
const close = (code = 0) => {
  if (closing) return;
  closing = true;
  children.forEach((child) => child.kill());
  setTimeout(() => process.exit(code), 300).unref();
};
children.forEach((child) => {
  child.on('error', (error) => {
    console.error(error.message);
    close(1);
  });
  child.on('exit', (code) => close(code ?? 0));
});
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
