import { expect, test } from '@playwright/test';

// T812 (user request 2026-11-05): no "Pending clinician review" badge/note on any surface.
// Covered: loading screen, guided caption, physiology lab, quiz feedback + results, practice bar + debrief.
const BADGE = 'Pending clinician review';

test('loading screen has no review badge', async ({ page }) => {
  await page.goto('/?holdload');
  await expect(page.locator('#load-tip')).not.toBeEmpty();
  await expect(page.getByText(BADGE)).toHaveCount(0);
});

test('guided caption, physiology lab and quiz have no review badge', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await expect(page.locator('.guided-caption')).toBeVisible();
  await expect(page.getByText(BADGE)).toHaveCount(0);
  await page.click('button[data-mode=physiology]');
  await expect(page.getByRole('region', { name: 'Physiology lab' })).toBeVisible();
  await expect(page.getByText(BADGE)).toHaveCount(0);

  // Quiz: feedback after every answer, then the results summary (Skip identify items, pick option 1 otherwise).
  await page.click('button[data-mode=quiz]');
  const quiz = page.getByRole('dialog', { name: 'Quiz' });
  const finish = quiz.getByRole('button', { name: 'See results' });
  while (!(await finish.isVisible())) {
    const skip = quiz.getByRole('button', { name: 'Skip' });
    const option = quiz.locator('.quiz-option').first();
    // The quiz chunk loads lazily: wait until the item is rendered before choosing Skip vs an option.
    await expect(skip.or(option)).toBeVisible();
    await ((await skip.isVisible()) ? skip : option).click();
    await expect(quiz.locator('.quiz-feedback')).toBeVisible();
    await expect(page.getByText(BADGE)).toHaveCount(0);
    if (await finish.isVisible()) break;
    await quiz.getByRole('button', { name: 'Next' }).click();
  }
  await finish.click();
  await expect(quiz.locator('.quiz-total')).toBeVisible();
  await expect(page.getByText(BADGE)).toHaveCount(0);
});

test('practice bar and debrief have no review badge', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?mode=practice');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const bar = page.getByRole('region', { name: 'Practice' });
  await expect(bar).toBeVisible();
  await expect(page.getByText(BADGE)).toHaveCount(0);
  await bar.getByRole('button', { name: 'End run' }).click();
  const debrief = page.getByRole('dialog', { name: 'Case debrief' });
  await expect(debrief).toBeVisible();
  await expect(page.getByText(BADGE)).toHaveCount(0);
  await debrief.getByRole('button', { name: 'Close' }).click();
  await expect(debrief).toBeHidden();
});
