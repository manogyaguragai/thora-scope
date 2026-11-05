import { defineConfig, devices } from '@playwright/test';

// E2E_PORT lets a run sidestep a busy :4173 (e.g. an orphaned preview) without touching it.
const port = Number(process.env.E2E_PORT ?? 4173);
const baseURL = `http://localhost:${port}`;
/** Default test viewport: small, so SwiftShader frames stay cheap. Full-look screenshot specs override it. */
// Real GPU via ANGLE/Vulkan (~10x faster than SwiftShader); E2E_SWIFTSHADER=1 forces software GL.
const GL_ARGS = process.env.E2E_SWIFTSHADER
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : [
      '--use-angle=vulkan',
      '--enable-features=Vulkan',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ];
const SMALL_VIEWPORT = { width: 640, height: 400 };

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  reporter: 'list',
  timeout: 180_000, // SwiftShader (software GL); multi-view specs raise their own
  workers: 2, // SwiftShader WebGL pages are CPU-bound; more in parallel just starve each other into timeouts
  use: {
    baseURL,
    viewport: SMALL_VIEWPORT,
    // Same as ?quality=low (locked: no adaptive pixel-ratio changes mid-test). A ?quality= in the URL still wins.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: baseURL,
          localStorage: [
            { name: 'thorascope.quality', value: JSON.stringify({ preset: 'low', locked: true }) },
          ],
        },
      ],
    },
    launchOptions: {
      args: GL_ARGS,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: SMALL_VIEWPORT } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
