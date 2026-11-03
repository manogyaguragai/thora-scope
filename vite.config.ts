/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Only src/ (via index.html) and public/ reach the build. assets_src/ is never imported or copied.
export default defineConfig({
  publicDir: 'public',
  build: { target: 'es2022' },
  server: { fs: { deny: ['assets_src/**'] } },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
