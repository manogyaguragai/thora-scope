import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { GUIDED_STEPS } from '../../src/content/steps';

const TRANSITION_MS = 2000; // ~1.5 s eased step transition (§6.1) + margin

test.use({ viewport: { width: 1280, height: 720 } }); // desktop layout: rail + caption bar overlap below this

/** Wall-clock wait, then until the guided fades, camera transition and every state tween have finished. */
async function settled(page: Page): Promise<void> {
  await page.waitForTimeout(TRANSITION_MS);
  await page.waitForFunction(
    () =>
      window.__sim.guided?.transitioning === false &&
      window.__sim.rig?.transitioning === false &&
      Object.values(window.__sim.state.tweens).every((t) => !t.active),
    null,
    { timeout: 120_000 }, // SwiftShader frames can be slow
  );
}

test('guided mode: Next through steps 1–9, captions match, PageUp/PageDown navigate', async ({ page }) => {
  test.setTimeout(720_000); // SwiftShader, full size: 9 steps + key/rail navigation (~3 min alone, ~6 contended)
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const bar = page.getByRole('region', { name: 'Guided procedure' });
  const title = bar.getByRole('heading');
  await expect(page.locator('button[data-mode=guided]')).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: 'Previous step' })).toBeDisabled();

  // T851: the first Next from the theatre only takes the scope in, at step 1.
  await bar.getByRole('button', { name: 'Next step' }).click();
  await expect.poll(() => page.evaluate(() => window.__sim.rig?.target)).toBe('scope');
  await settled(page);
  await expect(title).toHaveText(GUIDED_STEPS[0]?.title ?? '');
  for (const [i, s] of GUIDED_STEPS.entries()) {
    if (i > 0) await bar.getByRole('button', { name: 'Next step' }).click();
    await settled(page);
    await expect(title).toHaveText(s.title);
    await expect(bar).toContainText(`${i + 1} / ${GUIDED_STEPS.length}`);
    await expect(page.locator('.guided-step[aria-current=step]')).toHaveAttribute(
      'aria-label',
      `${s.step}. ${s.title}`,
    );
    await page.screenshot({ path: `qa/screenshots/step-${s.step}.png` });
  }
  await expect(bar.getByRole('button', { name: 'Next step' })).toBeDisabled();
  // T844 step 9 (leak test): in the scope view the lens sits ≥ 5 mm above the full water level.
  await page.evaluate(() => window.__sim.setView('scope', true));
  await settled(page);
  const lens = await page.evaluate(() => ({
    y: window.__sim.rig?.camera.position.y ?? 0,
    top: window.__sim.m4?.water.topY ?? 1,
  }));
  expect(lens.y - lens.top).toBeGreaterThanOrEqual(0.005);

  const last = GUIDED_STEPS.length - 1;
  // Focus away from the buttons (a canvas click lands on the rail at the small test viewport).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('PageUp'); // T816: arrows pivot the scope; guided prev/next is PageUp/PageDown
  await expect(title).toHaveText(GUIDED_STEPS[last - 1]?.title ?? '');
  await settled(page); // input during a transition queues until it ends
  await page.keyboard.press('PageDown');
  await expect(title).toHaveText(GUIDED_STEPS[last]?.title ?? '');
  await settled(page);

  // Rail step click jumps; the rail collapses via its toggle.
  await page.locator('.guided-step').first().click();
  await expect(title).toHaveText(GUIDED_STEPS[0]?.title ?? '');
  const toggle = page.getByRole('button', { name: 'Steps', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.guided-steps')).toBeHidden();
  expect(errors).toEqual([]);
});

test('guided layout: all rail steps visible and clickable at 1280×720 and 1024×640', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const bar = page.getByRole('region', { name: 'Guided procedure' });
  const more = bar.getByRole('button', { name: 'More' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(bar.locator('.guided-points')).toBeHidden();
  await more.click();
  await expect(bar.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true');
  await expect(bar.locator('.guided-points')).toBeVisible();
  await bar.getByRole('button', { name: 'Less' }).press('Enter'); // keyboard-operable
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1024, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    const uncovered = await page.$$eval('.guided-step', (els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const inView = r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
        return inView && el.contains(document.elementFromPoint(x, y));
      }),
    );
    expect(uncovered, `rail at ${viewport.width}×${viewport.height}`).toEqual(GUIDED_STEPS.map(() => true));
  }
  const last = GUIDED_STEPS[GUIDED_STEPS.length - 1];
  await page.locator('.guided-step').last().click();
  await expect(bar.getByRole('heading')).toHaveText(last?.title ?? '');
  await settled(page);
  await expect(page.locator('.guided-step[aria-current=step]')).toContainText(last?.rail ?? '');
});

test('T847a: guided steps enter the scope view (a later Outside click holds); caption + toast placement', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('/'); // opens on the theatre (outside)
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const target = () => page.evaluate(() => window.__sim.rig?.target);
  const bar = page.getByRole('region', { name: 'Guided procedure' });
  const text = bar.locator('.guided-text');
  expect(await target()).toBe('outside');
  await expect(text).toBeHidden(); // the step text describes the scope view
  await expect(bar.getByRole('button', { name: 'Next step' })).toBeVisible();

  await bar.getByRole('button', { name: 'Next step' }).click();
  await expect.poll(target).toBe('scope');
  await expect(text).toBeVisible();
  await expect(bar.getByRole('heading')).toHaveText(GUIDED_STEPS[0]?.title ?? ''); // T851: still step 1
  await settled(page);
  await bar.getByRole('button', { name: 'Next step' }).click(); // step 2
  // Port hint toast: below the topbar and clear of the compass.
  const toast = page.locator('#action-toast');
  await expect(toast).toBeVisible();
  const [t, top, compass] = await Promise.all(
    ['#action-toast', '.shell-top', '.scope-compass'].map((s) => page.locator(s).boundingBox()),
  );
  expect(t && top && t.y >= top.y + top.height).toBe(true);
  if (t && compass) expect(t.x + t.width <= compass.x || t.y + t.height <= compass.y).toBe(true);

  await settled(page);
  await page.getByRole('button', { name: 'Outside (theatre)' }).click();
  await expect.poll(target).toBe('outside');
  await page.waitForTimeout(500);
  expect(await target()).toBe('outside'); // the manual choice holds …
  await bar.getByRole('button', { name: 'Next step' }).click();
  await expect.poll(target).toBe('scope'); // … until the next step change
  await settled(page);
  await page.getByRole('button', { name: 'Outside (theatre)' }).click();
  await expect.poll(target).toBe('outside');
  await page.locator('.guided-step[aria-current=step]').click(); // rail click on the current step
  await expect.poll(target).toBe('scope');
});
