/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    // Las pruebas de UI declaran `// @vitest-environment jsdom` en el propio archivo.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
    // PGlite consume bastante memoria: un archivo a la vez.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
