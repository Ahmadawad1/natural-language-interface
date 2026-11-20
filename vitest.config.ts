import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      ['protocol', 'backend', 'react'].map((p) => [
        `@nli/${p}`,
        fileURLToPath(
          new URL(`./packages/${p}/src/index.${p === 'react' ? 'tsx' : 'ts'}`, import.meta.url),
        ),
      ]),
    ),
  },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 15000, fileParallelism: false },
});
