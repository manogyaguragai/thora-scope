import { expect, test } from '@playwright/test';

// CLAUDE.md hard rule: every teaching surface shows the "Pending clinician review" badge.
// Covered: loading tip, guided caption, physiology lab, quiz feedback + results, practice bar + debrief.
// TODO when wired into the app: click-to-label inspector (src/ui/labels3d.ts / src/content/labels.ts), practice teaching notes / tips.
const BADGE = 'Pending clinician review';

test('loading tip carries the review badge', async ({ page }) => {
  await page.goto('/?holdload');
  await expect(page.locator('#load-tip')).not.toBeEmpty();
  await expect(page.locator('#loading').getByText(BADGE)).toBeVisible();
});

test('guided caption, physiology lab and quiz carry the review badge', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await expect(page.locator('.guided-caption').getByText(BADGE)).toBeVisible();
  await page.click('button[data-mode=physiology]');
  await expect(page.getByRole('region', { name: 'Physiology lab' }).getByText(BADGE)).toBeVisible();

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
    await expect(quiz.locator('.quiz-feedback').getByText(BADGE)).toBeVisible();
    if (await finish.isVisible()) break;
    await quiz.getByRole('button', { name: 'Next' }).click();
  }
  await finish.click();
  await expect(quiz.locator('.quiz-total')).toBeVisible();
  await expect(quiz.locator('.quiz-body').getByText(BADGE)).toBeVisible();
});

test('practice bar and debrief carry the review badge', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?mode=practice');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  const bar = page.getByRole('region', { name: 'Practice' });
  await expect(bar.getByText(BADGE)).toBeVisible();
  await bar.getByRole('button', { name: 'End run' }).click();
  const debrief = page.getByRole('dialog', { name: 'Case debrief' });
  await expect(debrief.getByText(BADGE)).toBeVisible();
  await debrief.getByRole('button', { name: 'Close' }).click();
  await expect(debrief).toBeHidden();
});
