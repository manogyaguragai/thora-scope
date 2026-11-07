import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { WalkthroughHook } from '../../src/app/walkthrough/types';

// T863 (FEEDBACK_GUIDED_v1 §2.4): everything is fetched, compiled and warmed during the initial loading screen.
// After "ready": walking steps 1→9 and visiting every mode / the help overlay shows no loading UI, navigates
// nowhere, requests no app asset (code, styles, model, decoders, fonts) and compiles no shader program.
test.use({ viewport: { width: 1280, height: 720 } });

const ASSET = /\.(js|mjs|css|glb|gltf|bin|wasm|ktx2|png|jpe?g|webp|woff2?)(\?|$)/;
const STEP_MS = 90_000; // walkthrough step playback cap (timeScale below)
const TIME_SCALE = 20;
const SAMPLE_MS = 1200; // > one __perf sample period (config.perf.sampleHz)

async function ready(page: Page): Promise<{ requests: string[]; navigations: string[] }> {
  const requests: string[] = [];
  const navigations: string[] = [];
  let armed = false;
  page.on('request', (r) => {
    if (armed && ASSET.test(new URL(r.url()).pathname)) requests.push(r.url());
  });
  page.on('framenavigated', (f) => armed && f === page.mainFrame() && navigations.push(f.url()));
  await page.goto('/?view=scope');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await expect(page.locator('#loading')).toHaveCount(0);
  armed = true;
  return { requests, navigations };
}

const programs = async (page: Page): Promise<number> => {
  await page.waitForTimeout(SAMPLE_MS);
  return page.evaluate(() => window.__perf.programs);
};

test('preload: walkthrough steps 1→9 need no loading UI, no asset request, no new program', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { requests, navigations } = await ready(page);
  const before = await programs(page);
  for (let n = 1; n <= 9; n++) {
    await page.evaluate(
      async ([step, scale, cap]) => {
        // W1 walkthrough engine when present (play the whole step), else the step snap.
        const w = (window.__sim as unknown as { walkthrough?: WalkthroughHook | null }).walkthrough;
        if (!w) return window.__sim.setStep(step);
        w.timeScale = scale;
        await w.seek(step);
        const end = Date.now() + cap;
        while (Date.now() < end && w.state().step === step) {
          const s = w.state().status;
          if (s === 'error' || s === 'idle') break;
          if (s === 'holding') w.next();
          await Promise.race([w.settle('beat'), new Promise((r) => setTimeout(r, 2000))]);
        }
      },
      [n, TIME_SCALE, STEP_MS] as const,
    );
    await expect(page.locator('#loading'), `loading UI at step ${n}`).toHaveCount(0);
  }
  expect(await programs(page)).toBe(before);
  expect(requests).toEqual([]);
  expect(navigations).toEqual([]);
  expect(errors).toEqual([]);
});

test('preload: every mode and the help overlay are ready without fetching code', async ({ page }) => {
  test.setTimeout(300_000);
  const { requests, navigations } = await ready(page);
  const before = await programs(page);
  for (const mode of ['practice', 'explore', 'physiology', 'quiz', 'guided']) {
    await page.click(`button[data-mode=${mode}]`);
    await page.waitForTimeout(SAMPLE_MS);
  }
  await page.keyboard.press('Slash');
  await expect(page.getByRole('dialog').first()).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await programs(page)).toBe(before);
  expect(requests).toEqual([]);
  expect(navigations).toEqual([]);
  await expect(page.locator('#loading')).toHaveCount(0);
});
