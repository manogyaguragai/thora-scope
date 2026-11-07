import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import sharp from 'sharp';
import { hideShell } from './pixels';

// T802 (§6.7): WCAG AA contrast, keyboard operability with visible focus, prefers-reduced-motion. No deps: the
// checker runs in the page; text over the (transparent-down-to-the) canvas is judged against the darkest and the
// brightest canvas pixel under it, sampled from a screenshot with the shell hidden.
test.use({ viewport: { width: 1280, height: 720 } });

const AA_NORMAL = 4.5;
const AA_LARGE = 3;
const LARGE_PX = 24;
const LARGE_BOLD_PX = 18.66;
const BOLD = 700;
const READY = { timeout: 120_000 };

type RGBA = [number, number, number, number];
interface TextSample {
  label: string;
  fg: RGBA;
  /** Background layers, innermost first; the last is opaque unless the canvas shows through. */
  layers: RGBA[];
  rect: { x: number; y: number; w: number; h: number };
  size: number;
  weight: number;
}

async function ready(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__perf?.ready === true, null, READY);
}

/** Visible text elements under `roots` with their computed colours (canvas-parsed, so color-mix()/color() work). */
function collectText(page: Page, roots: string): Promise<TextSample[]> {
  return page.evaluate((sel) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    const rgba = (c: string): RGBA => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = 'transparent';
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const canvas = document.querySelector('canvas');
    const seen = new Set<Element>();
    const out: TextSample[] = [];
    for (const root of document.querySelectorAll(sel))
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (seen.has(el)) continue;
        seen.add(el);
        const text = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
        if (!text && !el.matches('select')) continue;
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        if (el.closest(':disabled')) continue; // WCAG 1.4.3: inactive controls are exempt
        const r = el.getBoundingClientRect();
        const x = Math.max(0, r.left);
        const y = Math.max(0, r.top);
        const w = Math.min(innerWidth, r.right) - x;
        const h = Math.min(innerHeight, r.bottom) - y;
        if (w < 1 || h < 1) continue;
        const cs = getComputedStyle(el);
        const layers: RGBA[] = [];
        // Ancestors of the canvas paint under it: stop there, the canvas is the base.
        for (let a: Element | null = el; a && !(canvas && a.contains(canvas)); a = a.parentElement) {
          const bg = rgba(getComputedStyle(a).backgroundColor);
          if (bg[3] > 0) layers.push(bg);
          if (bg[3] >= 1) break;
        }
        const name = `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
        out.push({
          label: `${name} "${(el.textContent ?? '').trim().slice(0, 30)}"`,
          fg: rgba(cs.color),
          layers,
          rect: { x: Math.floor(x), y: Math.floor(y), w: Math.ceil(w), h: Math.ceil(h) },
          size: parseFloat(cs.fontSize),
          weight: Number(cs.fontWeight),
        });
      }
    return out;
  }, roots);
}

const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (c: readonly number[]): number =>
  0.2126 * lin(c[0] ?? 0) + 0.7152 * lin(c[1] ?? 0) + 0.0722 * lin(c[2] ?? 0);
const over = (top: RGBA, base: readonly number[]): number[] =>
  [0, 1, 2].map((i) => (top[i] ?? 0) * top[3] + (base[i] ?? 0) * (1 - top[3]));
const ratio = (a: readonly number[], b: readonly number[]): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

/** Raw RGB of the canvas alone (shell hidden), for text whose background is transparent down to the canvas. */
async function canvasPixels(page: Page): Promise<{ data: Buffer; width: number; channels: number }> {
  const style = await hideShell(page);
  const png = await page.screenshot();
  await (style as { evaluate: (f: (e: Element) => void) => Promise<void> }).evaluate((e) => e.remove());
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, channels: info.channels };
}

/** Darkest and brightest canvas pixel inside `rect`. */
function canvasExtremes(px: Awaited<ReturnType<typeof canvasPixels>>, rect: TextSample['rect']): number[][] {
  let lo = [255, 255, 255];
  let hi = [0, 0, 0];
  for (let y = rect.y; y < rect.y + rect.h; y++)
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * px.width + x) * px.channels;
      const c = [px.data[i] ?? 0, px.data[i + 1] ?? 0, px.data[i + 2] ?? 0];
      if (lum(c) < lum(lo)) lo = c;
      if (lum(c) > lum(hi)) hi = c;
    }
  return [lo, hi];
}

/** Every visible text element under `roots` meets AA; returns the failures ("label ratio < min"). */
async function contrastFailures(
  page: Page,
  roots: string,
  canvas: Awaited<ReturnType<typeof canvasPixels>>,
): Promise<string[]> {
  const samples = await collectText(page, roots);
  expect(samples.length, `text found under ${roots}`).toBeGreaterThan(0);
  const fails: string[] = [];
  for (const s of samples) {
    const opaque = s.layers.length > 0 && (s.layers[s.layers.length - 1]?.[3] ?? 0) >= 1;
    const bases = opaque ? [[0, 0, 0]] : canvasExtremes(canvas, s.rect);
    const large = s.size >= LARGE_PX || (s.size >= LARGE_BOLD_PX && s.weight >= BOLD);
    const min = large ? AA_LARGE : AA_NORMAL;
    for (const base of bases) {
      const bg = s.layers.reduceRight<number[]>((acc, l) => over(l, acc), base);
      const r = ratio(over(s.fg, bg), bg);
      if (r < min) fails.push(`${s.label} ${r.toFixed(2)} < ${min}`);
    }
  }
  return fails;
}

interface A11yWin {
  __a11y: { base: string[]; style: (el: Element) => string };
}

/**
 * Tab from the top of the document (or of an open modal): every enabled, visible control under `scope` must take
 * focus and show a focus indicator that differs from its unfocused look. Returns [unreached, no-ring] labels.
 */
async function tabAudit(page: Page, scope: string): Promise<[string[], string[]]> {
  const count = await page.evaluate((sel) => {
    (document.activeElement as HTMLElement | null)?.blur();
    const style = (el: Element): string => {
      const cs = getComputedStyle(el);
      return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}|${cs.boxShadow}`;
    };
    const list = [
      ...document.querySelectorAll<HTMLElement>(
        `${sel} :is(button, summary, input, select, textarea, a[href], [tabindex])`,
      ),
    ].filter(
      (el) =>
        el.tabIndex >= 0 &&
        !(el as HTMLButtonElement).disabled &&
        !((el as HTMLInputElement).type === 'radio' && !(el as HTMLInputElement).checked) && // one tab stop per group
        !el.closest('[inert]') &&
        el.checkVisibility({ checkVisibilityCSS: true }),
    );
    list.forEach((el, i) => (el.dataset.a11y = String(i)));
    (window as unknown as A11yWin).__a11y = { base: list.map(style), style };
    return list.length;
  }, scope);
  expect(count, `controls under ${scope}`).toBeGreaterThan(0);
  const reached = new Set<number>();
  const noRing = new Set<string>();
  for (let i = 0; i < count * 2 + 20 && reached.size < count; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const idx = el?.dataset.a11y;
      if (!el || idx === undefined) return null;
      const { base, style } = (window as unknown as A11yWin).__a11y;
      return { idx: Number(idx), ring: style(el) !== base[Number(idx)], label: el.outerHTML.slice(0, 80) };
    });
    if (!hit) continue;
    reached.add(hit.idx);
    if (!hit.ring) noRing.add(hit.label);
  }
  const unreached = await page.evaluate(
    (got) => {
      const els = [...document.querySelectorAll<HTMLElement>('[data-a11y]')];
      els.forEach((el) => el.removeAttribute('data-a11y'));
      return els.filter((_, i) => !got.includes(i)).map((el) => el.outerHTML.slice(0, 80));
    },
    [...reached],
  );
  return [unreached, [...noRing]];
}

async function expectGuidedToolsHidden(page: Page): Promise<void> {
  const tools = '.shell-hotbar, .shell-ports, .shell-dock, .shell-views, .shell-vents, .shell-inspector';
  await expect(page.locator(tools).filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('.scope-compass-hint')).toBeHidden();
}

/** Focus `el` from the keyboard's point of view and press `key`. */
async function press(el: Locator, key: string): Promise<void> {
  await el.focus();
  await el.press(key);
}

const idle = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => window.__sim.guided?.transitioning === false, null, READY);

test('a11y contrast: shell, guided, hotbar + chips, layers, help, quiz, practice bar and debrief meet WCAG AA', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await ready(page, '/?view=scope&step=1');
  const canvas = await canvasPixels(page);
  // Guided (T881): bar with details open; the practice tools are hidden, what remains must meet AA.
  await page.getByRole('button', { name: 'More' }).click();
  await expectGuidedToolsHidden(page);
  expect(await contrastFailures(page, '.shell', canvas), 'guided').toEqual([]);

  // Explore: Layers + one group expanded, the active slot's tooltip showing.
  await page.click('button[data-mode=explore]');
  await page.locator('.viewing-panel summary', { hasText: 'Layers' }).click();
  await page.locator('.viewing-group summary').first().click();
  await page.locator('.hotbar-slot[aria-pressed=true]').focus();
  expect(await contrastFailures(page, '.shell', canvas), 'explore').toEqual([]);

  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Controls' })).toBeVisible();
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.help') as Element).opacity === '1',
  );
  expect(await contrastFailures(page, '.help', canvas)).toEqual([]);
  await page.keyboard.press('Escape');

  await page.click('button[data-mode=quiz]');
  const quiz = page.getByRole('dialog', { name: 'Quiz' });
  await expect(quiz).toBeVisible();
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.quiz') as Element).opacity === '1',
  );
  expect(await contrastFailures(page, '.quiz', canvas), 'quiz question').toEqual([]);
  // Answer whatever is on screen (option 1 or Skip) to reach the feedback + primary button.
  const skip = quiz.getByRole('button', { name: 'Skip', exact: true });
  if (await skip.isVisible()) await skip.click();
  else await quiz.locator('.quiz-option').first().click();
  await expect(quiz.locator('.quiz-feedback')).toBeVisible();
  expect(await contrastFailures(page, '.quiz', canvas), 'quiz feedback').toEqual([]);

  // Practice bar (T506; T862: side dock above the vitals monitor).
  await page.keyboard.press('Escape');
  await expect(quiz).toBeHidden();
  await page.click('button[data-mode=practice]');
  await expect(page.getByRole('region', { name: 'Practice' })).toBeVisible();
  expect(await contrastFailures(page, '.practice-bar', canvas), 'practice bar').toEqual([]);

  // Debrief (T504/T505): End run → scored case summary dialog.
  await page.getByRole('region', { name: 'Practice' }).getByRole('button', { name: 'End run' }).click();
  await expect(page.getByRole('dialog', { name: 'Case debrief' })).toBeVisible();
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.debrief') as Element).opacity === '1',
  );
  expect(await contrastFailures(page, '.debrief', canvas), 'debrief').toEqual([]);
});

test('a11y keyboard: every control reachable with a visible focus ring; Enter/Space/Esc operate', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page, '/?view=scope&step=1');
  const bar = page.getByRole('region', { name: 'Guided walkthrough' });
  const counter = bar.locator('.guided-counter');

  // Guided (T881): practice tools hidden; the remaining controls are all reachable with a ring.
  await expectGuidedToolsHidden(page);
  expect(await tabAudit(page, '.shell')).toEqual([[], []]);

  // More/Less, Next/Prev.
  await press(bar.getByRole('button', { name: 'More' }), 'Enter');
  await press(bar.getByRole('button', { name: 'Less' }), 'Space');
  await expect(bar.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false');
  // T860: Next / Prev inside step 1 walk its parts; from step 2 they change steps.
  await page.evaluate(() => window.__sim.walkthrough?.seek(2));
  await expect(counter).toHaveText(/^2 \//);
  await idle(page);
  await press(bar.getByRole('button', { name: 'Next step' }), 'Enter');
  await expect(counter).toHaveText(/^3 \//);
  await idle(page);
  await press(bar.getByRole('button', { name: 'Previous step' }), 'Space');
  await expect(counter).toHaveText(/^2 \//);
  await idle(page);

  // Mode buttons; Explore keeps the practice tools.
  const explore = page.locator('button[data-mode=explore]');
  await press(explore, 'Enter');
  await expect(explore).toHaveAttribute('aria-pressed', 'true');

  // Layers (native <details>): Enter opens it, so its controls join the tab order.
  const layers = page.locator('.viewing-panel summary', { hasText: 'Layers' });
  await press(layers, 'Enter');
  await expect(page.locator('.viewing-body')).toHaveAttribute('open', '');
  expect(await tabAudit(page, '.shell')).toEqual([[], []]);

  // Layer toggles: Space flips a checkbox; Enter opens a group.
  const xray = page.getByRole('checkbox', { name: 'X-ray' });
  await press(xray, 'Space');
  await expect(xray).toBeChecked();
  await press(xray, 'Space');
  await expect(xray).not.toBeChecked();
  const group = page.locator('.viewing-group').first();
  await press(group.locator('summary'), 'Enter');
  await expect(group).toHaveAttribute('open', '');

  const guided = page.locator('button[data-mode=guided]');
  await press(guided, 'Space');
  await expect(guided).toHaveAttribute('aria-pressed', 'true');

  // Help: opens from the keyboard, its controls are reachable with a ring, Close (Enter) and Esc close it.
  const helpBtn = page.getByRole('button', { name: 'Keyboard shortcuts' });
  const help = page.getByRole('dialog', { name: 'Controls' });
  await press(helpBtn, 'Enter');
  await expect(help).toBeVisible();
  expect(await tabAudit(page, '.help')).toEqual([[], []]);
  await press(help.getByRole('button', { name: 'Close', exact: true }), 'Enter');
  await expect(help).toBeHidden();
  await press(helpBtn, 'Space');
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();

  // Quiz: Enter opens it (focus moves in), its controls are reachable, Esc closes it.
  await press(page.locator('button[data-mode=quiz]'), 'Enter');
  const quiz = page.getByRole('dialog', { name: 'Quiz' });
  await expect(quiz).toBeVisible();
  await expect(quiz.locator(':focus')).toHaveCount(1);
  expect(await tabAudit(page, '.quiz')).toEqual([[], []]);
  await quiz.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(quiz).toBeHidden();
  expect(errors).toEqual([]);
});

test('a11y reduced motion: guided step change is instant, panel animations ~0', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page, '/?view=scope&step=1');
  const bar = page.getByRole('region', { name: 'Guided walkthrough' });
  // Same task as the click: the heading text and the transition flag after one animation frame.
  const after = await page.evaluate(async () => {
    const before = document.querySelector('.guided-title')?.textContent;
    (document.querySelector('button[aria-label="Next step"]') as HTMLButtonElement).click();
    await new Promise(requestAnimationFrame);
    return {
      changed: document.querySelector('.guided-title')?.textContent !== before,
      transitioning: window.__sim.guided?.transitioning,
    };
  });
  expect(after).toEqual({ changed: true, transitioning: false });
  await expect(bar.locator('.guided-counter')).toHaveText(/^2 \//);

  const slowest = (sel: string): Promise<string[]> =>
    page.evaluate((s) => {
      const ms = (v: string): number =>
        Math.max(...v.split(',').map((d) => parseFloat(d) * (d.includes('ms') ? 1 : 1000)));
      const out: string[] = [];
      for (const root of document.querySelectorAll(s))
        for (const el of [root, ...root.querySelectorAll('*')]) {
          const cs = getComputedStyle(el);
          const t = Math.max(ms(cs.transitionDuration), ms(cs.animationDuration));
          if (t > 0) out.push(`${el.className} ${t} ms`);
        }
      return out;
    }, sel);
  expect(await slowest('.shell')).toEqual([]);
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Controls' })).toBeVisible();
  expect(await slowest('.help')).toEqual([]);
  await page.keyboard.press('Escape');
  await page.click('button[data-mode=quiz]');
  await expect(page.getByRole('dialog', { name: 'Quiz' })).toBeVisible();
  expect(await slowest('.quiz')).toEqual([]);
});
