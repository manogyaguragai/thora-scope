// perf:probe — loads the production build in Chromium (SwiftShader if no GPU), waits for window.__perf.ready,
// runs a scripted sequence and asserts 0 new shader programs after "ready" (CONTEXT §6.10).
// Writes qa/perf.json and appends a summary to docs/PERF.md "## Probe log".
/* global URL, window, PerformanceObserver, requestAnimationFrame */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const ROOT = new URL('..', import.meta.url).pathname;
const READY_TIMEOUT_MS = 180_000; // SwiftShader is slow
const SERVER_TIMEOUT_MS = 30_000;
const LONG_FRAME_MS = 50;
const SETTLE_MS = 1000; // > one __perf sample period, so sampled stats are fresh
const ORBIT_MS = 3000;
const ORBIT_STEPS = 60;
const ORBIT_RADIUS_PX = 200;
const STEP_COUNT = 7; // procedure_steps.json
const VIEWPORT = { width: 1280, height: 720 };
// Same as playwright.config.ts.
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const MB = 1024 * 1024;

async function isServing(port) {
  try {
    return (await fetch(`http://localhost:${port}/`)).ok;
  } catch {
    return false;
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startServer() {
  // Always serve this checkout's dist on a free port (never reuse a foreign server).
  if (!existsSync(`${ROOT}dist/index.html`)) {
    console.log('dist missing — running npm run build');
    if (spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' }).status !== 0) process.exit(1);
  }
  const port = await freePort();
  const proc = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (!(await isServing(port))) {
    if (Date.now() > deadline) throw new Error('vite preview did not start');
    await sleep(200);
  }
  return { port, proc };
}

// In-page instrumentation: FCP, rAF frame deltas, per-phase max draw calls / triangles.
function instrument(longFrameMs) {
  const probe = { fcp: 0, phase: '', phases: {}, longFrames: 0, maxFrameMs: 0 };
  window.__probe = probe;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') probe.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
  let last = 0;
  const tick = (now) => {
    if (probe.phase) {
      const p = (probe.phases[probe.phase] ??= { drawCalls: 0, triangles: 0, longFrames: 0 });
      const perf = window.__perf;
      if (perf) {
        p.drawCalls = Math.max(p.drawCalls, perf.drawCalls);
        p.triangles = Math.max(p.triangles, perf.triangles);
      }
      const dt = last ? now - last : 0;
      if (dt > longFrameMs) {
        p.longFrames++;
        probe.longFrames++;
      }
      probe.maxFrameMs = Math.max(probe.maxFrameMs, dt);
    }
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function heapUsed(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  return metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
}

async function orbit(page) {
  const cx = VIEWPORT.width / 2;
  const cy = VIEWPORT.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= ORBIT_STEPS; i++) {
    const a = (2 * Math.PI * i) / ORBIT_STEPS;
    await page.mouse.move(cx + ORBIT_RADIUS_PX * Math.sin(a), cy + (ORBIT_RADIUS_PX / 2) * Math.sin(2 * a));
    await sleep(ORBIT_MS / ORBIT_STEPS);
  }
  await page.mouse.up();
}

const setPhase = (page, phase) => page.evaluate((p) => (window.__probe.phase = p), phase);
const readPerf = (page) => page.evaluate(() => ({ ...window.__perf }));

async function main() {
  const { port, proc } = await startServer();
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  let failed = false;
  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    // Context-level so dedicated-worker fetches (decoders) are counted too.
    const sizes = [];
    context.on('requestfinished', (r) =>
      sizes.push(r.sizes().then((s) => s.responseBodySize + s.responseHeadersSize)),
    );
    await page.addInitScript(instrument, LONG_FRAME_MS);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');

    const t0 = Date.now();
    await page.goto(`http://localhost:${port}/?perf`);
    await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: READY_TIMEOUT_MS });
    const readyMs = Date.now() - t0;
    await setPhase(page, 'ready');
    await sleep(SETTLE_MS);
    const before = await readPerf(page);
    const heapBefore = await heapUsed(cdp);

    const hasScript = await page.evaluate(() => typeof window.__sim?.probeScript === 'function');
    if (hasScript) {
      // Later modules register guided walk / practice / x-ray / complication here and set window.__probe.phase.
      await page.evaluate(() => window.__sim.probeScript());
    } else {
      await setPhase(page, 'orbit');
      await orbit(page);
      // Scope view through each step camera (scope far-field set hidden). Phase starts after a fresh
      // __perf sample so the previous view's draw calls aren't attributed to it.
      for (let n = 1; n <= STEP_COUNT; n++) {
        await setPhase(page, '');
        await page.evaluate((step) => {
          window.__sim.setStep(step, true);
          window.__sim.setView('scope', true);
        }, n);
        await sleep(SETTLE_MS);
        await setPhase(page, `scope-step${n}`);
        await sleep(SETTLE_MS);
      }
    }
    await sleep(SETTLE_MS);
    const after = await readPerf(page);
    const heapAfter = await heapUsed(cdp);
    const probe = await page.evaluate(() => window.__probe);
    const transferBytes = (await Promise.all(sizes)).reduce((a, b) => a + b, 0);

    const result = {
      date: new Date().toISOString(),
      headless: true,
      note: 'SwiftShader/headless: fps and long-frame numbers are NOT representative of real hardware.',
      script: hasScript ? 'window.__sim.probeScript' : 'orbit',
      fcpMs: Math.round(probe.fcp),
      readyMs,
      transferMB: +(transferBytes / MB).toFixed(2),
      programs: { before: before.programs, after: after.programs },
      textures: after.textures,
      phases: probe.phases,
      longFrames: probe.longFrames,
      maxFrameMs: Math.round(probe.maxFrameMs),
      heapMB: { before: +(heapBefore / MB).toFixed(1), after: +(heapAfter / MB).toFixed(1) },
      fpsHeadless: +after.fps.toFixed(1),
      errors,
    };
    mkdirSync(`${ROOT}qa`, { recursive: true });
    writeFileSync(`${ROOT}qa/perf.json`, `${JSON.stringify(result, null, 2)}\n`);

    const rows = [
      ['FCP', `${result.fcpMs} ms`],
      ['ready', `${readyMs} ms`],
      ['transfer', `${result.transferMB} MB`],
      ['programs before/after', `${before.programs} / ${after.programs}`],
      ...Object.entries(probe.phases).map(([k, p]) => [
        `phase ${k}`,
        `${p.drawCalls} calls, ${p.triangles} tris, ${p.longFrames} long frames`,
      ]),
      ['textures', String(after.textures)],
      ['heap before/after', `${result.heapMB.before} / ${result.heapMB.after} MB`],
      [
        'long frames >50ms (headless, NOT representative)',
        `${probe.longFrames}, max ${result.maxFrameMs} ms`,
      ],
      ['fps (headless, NOT representative)', String(result.fpsHeadless)],
    ];
    console.table(Object.fromEntries(rows));

    const md = [
      '',
      `### ${result.date} ${after.programs === before.programs ? 'PASS' : 'FAIL'} (headless SwiftShader, script: ${result.script})`,
      `- FCP ${result.fcpMs} ms · ready ${readyMs} ms · transfer ${result.transferMB} MB`,
      `- programs ${before.programs} → ${after.programs} · textures ${after.textures}`,
      ...Object.entries(probe.phases).map(
        ([k, p]) => `- ${k}: ${p.drawCalls} draw calls, ${p.triangles} tris`,
      ),
      `- heap ${result.heapMB.before} → ${result.heapMB.after} MB`,
      `- long frames ${probe.longFrames} (max ${result.maxFrameMs} ms), fps ${result.fpsHeadless} — NOT representative (headless)`,
      '',
    ].join('\n');
    appendFileSync(`${ROOT}docs/PERF.md`, md);

    if (after.programs !== before.programs) {
      console.error(`FAIL: shader programs changed after ready: ${before.programs} → ${after.programs}`);
      failed = true;
    }
    if (errors.length) {
      console.error(`FAIL: page errors:\n${errors.join('\n')}`);
      failed = true;
    }
  } finally {
    await browser.close();
    proc?.kill();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
