/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

// three's KTX2Loader bakes `new URL('../libs/basis/basis_transcoder.*', import.meta.url)` defaults, so Vite emits
// a second hashed transcoder (~571 KB) into assets/. The app always sets transcoderPath to public/decoders/,
// which skips those defaults, so blank them. Fails the build if three changes the pattern.
const TRANSCODER_URL =
  /new URL\(\s*'\.\.\/libs\/basis\/basis_transcoder\.(?:js|wasm)',\s*import\.meta\.url\s*\)/g;
const dropBundledTranscoder: Plugin = {
  name: 'drop-bundled-basis-transcoder',
  apply: 'build',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/KTX2Loader.js')) return null;
    const out = code.replace(TRANSCODER_URL, "new URL('data:,')");
    if (out === code) this.error('KTX2Loader transcoder URL pattern not found; update vite.config.ts');
    return { code: out, map: null };
  },
};

// Only src/ (via index.html) and public/ reach the build. assets_src/ is never imported or copied.
export default defineConfig({
  publicDir: 'public',
  plugins: [dropBundledTranscoder],
  build: { target: 'es2022', reportCompressedSize: true },
  server: { fs: { deny: ['assets_src/**'] } },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
