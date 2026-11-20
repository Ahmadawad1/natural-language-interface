import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@nli/react/styles.css': fileURLToPath(
        new URL('../../packages/react/src/styles.css', import.meta.url),
      ),
      '@nli/react': fileURLToPath(new URL('../../packages/react/src/index.tsx', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4101',
      '/runtime': {
        target: 'http://127.0.0.1:4100',
        rewrite: (path) => path.replace(/^\/runtime/, ''),
      },
    },
  },
});
