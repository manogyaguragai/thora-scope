import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const BADGE = 'Pending clinician review';
const HELD_WAIT_MS = 600; // several frames: a held gate must not render any
const PICK_GRID = 40; // NDC scan resolution for a screen point on the identify target

test.use({ viewport: { width: 1280, height: 720 } });

/** Screen point (px) over the canvas whose pick is an accepted node of the current identify item, or null. */
function findTarget(page: Page, grid: number): Promise<{ x: number; y: number } | null> {
  return page.evaluate((n) => {
    const s = window.__quiz?.session();
    const q = s?.items[s.index];
    const m3 = window.__sim.m3;
    if (!q || q.kind !== 'identify' || !m3) return null;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (let i = 1; i < n; i++)
      for (let j = 1; j < n; j++) {
        const nx = (i / n) * 2 - 1;
        const ny = (j / n) * 2 - 1;
        const x = ((nx + 1) / 2) * w;
        const y = ((1 - ny) / 2) * h;
        if (document.elementFromPoint(x, y) !== canvas) continue;
        const name = m3.pickAt(nx, ny);
        if (name && q.item.accept.includes(name.replace(/\.\d+$/, ''))) return { x, y };
      }
    return null;
  }, grid);
}

test('quiz: next-step + identify items, feedback badge, render gate, exit to guided', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/?view=scope&step=1');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await page.click('button[data-mode=quiz]');
  const quiz = page.getByRole('dialog', { name: 'Quiz' });
  await expect(quiz).toBeVisible();
  const renders = (): Promise<number> => page.evaluate(() => window.__perf.renders);
  const item = (): Promise<{ kind: string; correctIndex: number } | null> =>
    page.evaluate(() => {
      const s = window.__quiz?.session();
      const q = s?.items[s.index];
      if (!q) return null;
      return { kind: q.kind, correctIndex: q.kind === 'nextStep' ? q.item.correctIndex : -1 };
    });

  let nextStepDone = false;
  let identifyDone = false;
  const feedback = quiz.locator('.quiz-feedback');
  while (!nextStepDone || !identifyDone) {
    const q = await item();
    expect(q, 'quiz ran out of items').not.toBeNull();
    if (!q) break;
    if (q.kind === 'nextStep') {
      const options = quiz.locator('.quiz-option');
      if (!nextStepDone) {
        // Static question: rendering is held.
        const r0 = await renders();
        await page.waitForTimeout(HELD_WAIT_MS);
        expect(await renders()).toBe(r0);
        await page.keyboard.press(`Digit${q.correctIndex + 1}`); // keyboard path
        await expect(feedback).toContainText('Correct');
        await expect(feedback.getByText(BADGE)).toBeVisible();
        await expect(quiz.locator('.quiz-rationale')).not.toBeEmpty();
        nextStepDone = true;
      } else await options.nth(q.correctIndex === 0 ? 1 : 0).click(); // deliberately wrong
    } else {
      const target = identifyDone ? null : await findTarget(page, PICK_GRID);
      if (target) {
        // Identify: the scope stays live (gate released) and the click goes to the quiz, not a label pin.
        const r0 = await renders();
        await expect.poll(renders).toBeGreaterThan(r0);
        await page.mouse.click(target.x, target.y);
        await expect(feedback).toContainText('Correct');
        await expect(feedback.getByText(BADGE)).toBeVisible();
        await expect(page.locator('.label3d-pin')).toBeHidden();
        identifyDone = true;
        await page.screenshot({ path: 'qa/screenshots/quiz.png' });
      } else await quiz.getByRole('button', { name: 'Skip' }).click();
    }
    await quiz.getByRole('button', { name: /^(Next|See results)$/ }).click();
  }
  const correct = await page.evaluate(
    () => window.__quiz?.session()?.answers.filter((a) => a.correct).length,
  );
  expect(correct).toBe(2);
  await expect(quiz).toContainText(/\d+ \/ \d+/);

  await page.keyboard.press('Escape');
  await expect(quiz).toBeHidden();
  await expect(page.locator('button[data-mode=guided]')).toHaveAttribute('aria-pressed', 'true');
  const r0 = await renders();
  await expect.poll(renders).toBeGreaterThan(r0); // gate released on exit
  expect(errors).toEqual([]);
});
