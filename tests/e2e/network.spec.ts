import { expect, test } from '@playwright/test';

// §6.8: no external network calls at runtime. data:/blob: URLs (decoder workers) never leave the page.
const NETWORK_PROTOCOLS = ['http:', 'https:', 'ws:', 'wss:'];

test('no request leaves the local server (load, ready, mode switch)', async ({ page, baseURL }) => {
  test.setTimeout(300_000);
  const local = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (NETWORK_PROTOCOLS.includes(u.protocol) && u.origin !== local) foreign.push(r.url());
  });

  await page.goto('/');
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: 120_000 });
  await page.click('button[data-mode=physiology]');
  await expect(page.getByRole('region', { name: 'Physiology lab' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(foreign).toEqual([]);
});
