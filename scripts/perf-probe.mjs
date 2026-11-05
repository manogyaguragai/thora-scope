// perf:probe — loads the production build in Chromium (SwiftShader if no GPU), waits for window.__perf.ready,
// runs a scripted sequence (orbit, guided steps, X-ray, M4 phases) then 3 full practice runs with a complication,
// and asserts 0 new shader programs after "ready" on every page + < 10 % practice heap growth run 1 → 3 (CONTEXT §6.10).
// Writes qa/perf.json and appends a summary to the end of docs/PERF.md ("## Probe log (history)").
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
// PERF_QUALITY=low|medium|high adds ?quality= (default: the device check, which picks low on SwiftShader).
const QUALITY = process.env.PERF_QUALITY ?? '';
const VIEWPORT = { width: 1280, height: 720 };
// Same as playwright.config.ts.
// Real GPU via ANGLE/Vulkan; PERF_SWIFTSHADER=1 forces software GL.
const CHROMIUM_ARGS = process.env.PERF_SWIFTSHADER
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : [
      '--use-angle=vulkan',
      '--enable-features=Vulkan',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ];

const MB = 1024 * 1024;
const PERF_P95 = 0.95; // same quantile as config.perf.p95
const PRACTICE_RUNS = 3;
const HEAP_BUDGET_PCT = 10; // CONTEXT §6.10: JS heap growth over 3 full practice runs
const GL = process.env.PERF_SWIFTSHADER ? 'SwiftShader' : 'real GPU (ANGLE/Vulkan)';
const NOTE = process.env.PERF_SWIFTSHADER
  ? 'Headless SwiftShader: fps, frame times and long frames are NOT representative of real hardware.'
  : 'Headless Chromium on the real GPU, driven by a test script (page.evaluate round-trips, GC calls): fps, frame times and long frames are NOT representative of a user session.';

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
  // Rebuild every run (a stale dist measures old code); PERF_NO_BUILD=1 reuses an existing dist.
  if (process.env.PERF_NO_BUILD !== '1' || !existsSync(`${ROOT}dist/index.html`)) {
    console.log('running npm run build');
    if (spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' }).status !== 0) process.exit(1);
  }
  const port = await freePort();
  // Spawn vite itself (not via npx/sh) so killing proc kills the server; also on any exit path (error, Ctrl-C).
  const proc = spawn(`${ROOT}node_modules/.bin/vite`, ['preview', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  process.on('exit', () => proc.kill());
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (!(await isServing(port))) {
    if (Date.now() > deadline) throw new Error('vite preview did not start');
    await sleep(200);
  }
  return { port, proc };
}

// In-page instrumentation (re-runs on every document load): FCP, rAF frame deltas, per-phase max draw calls /
// triangles + frame deltas (for p95). Probe-only code, so the per-frame push is fine here.
function instrument(longFrameMs) {
  const probe = { fcp: 0, phase: '', phases: {}, longFrames: 0, maxFrameMs: 0 };
  window.__probe = probe;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') probe.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
  let last = 0;
  const tick = (now) => {
    if (probe.phase) {
      const p = (probe.phases[probe.phase] ??= { drawCalls: 0, triangles: 0, longFrames: 0, dts: [] });
      const perf = window.__perf;
      if (perf) {
        p.drawCalls = Math.max(p.drawCalls, perf.drawCalls);
        p.triangles = Math.max(p.triangles, perf.triangles);
      }
      const dt = last ? now - last : 0;
      if (dt) p.dts.push(dt);
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
  await cdp.send('Performance.enable'); // idempotent; survives the practice Retry reload either way
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
const toMB = (b) => +(b / MB).toFixed(1);
const pct = (from, to) => +((100 * (to - from)) / from).toFixed(1);

function p95(dts) {
  const s = [...dts].sort((a, b) => a - b);
  return s.length ? +s[Math.floor(PERF_P95 * (s.length - 1))].toFixed(1) : 0;
}
/** __probe.phases with frame deltas replaced by their p95 (JSON-sized). */
const summarise = (phases) =>
  Object.fromEntries(
    Object.entries(phases).map(([k, { dts, ...p }]) => [k, { ...p, frameTimeP95Ms: p95(dts) }]),
  );

function watchErrors(page, errors) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
}

// ── Practice run: the reference sequence PA01→PA32 (same as tests/e2e/practice.spec.ts) + one complication ──
const CAM = 'port_camera_8ICS';
const RET = 'port_retraction_8ICS';
const UTIL = 'port_utility_5ICS';
const RUL = 'lung_upper_lobe_right';
const RML = 'lung_middle_lobe_right';
const FIRE_MS = 2500; // stapler close + fire + open + margin
const PEANUT_MS = 4500; // dissection window + margin
const TWEEN_MS = 1800; // practice result tween + margin
const SHORT_MS = 400;
const BLEED_MS = 3000; // complication phase: ooze + view reddening on screen
const DANGER = 'superior_vena_cava';

function practiceSteps(page) {
  const place = (id, target, sub, port) =>
    page.evaluate(
      ([i, t, s, p]) => window.__sim.placeTool?.(i, t, s, p) ?? 'no helper',
      [id, target, sub, port],
    );
  const press = async (ms = 0) => {
    const r = await page.evaluate(() => window.__sim.m4?.press(true) ?? 'not wired');
    if (ms) await sleep(ms);
    await page.evaluate(() => window.__sim.m4?.press(false));
    return r;
  };
  const retract = async (target, port) => {
    await place('grasper', target, 'retractor', port);
    await page.evaluate(() => window.__sim.m4?.press(true));
    await page.keyboard.press('KeyG');
  };
  const inspect = (n) => page.evaluate((x) => window.__sim.m5?.inspect(x), n);
  const moveScope = async (port) => {
    await page.evaluate((p) => {
      const m3 = window.__sim.m3;
      m3?.hotbar.select(0);
      m3?.scope.switchPort(p);
      m3?.syncScope();
    }, port);
    await sleep(SHORT_MS);
  };
  const fire = async (target, sub, port) => (
    await place('stapler', target, sub, port),
    press(),
    sleep(FIRE_MS)
  );
  const dissect = async (tool, target, ms, sub) => (await place(tool, target, sub, UTIL), press(ms));
  // One complication (after the vein fire, stapler still in hand): a fire on a danger structure → bleed.
  const complication = async () => {
    const r = await page.evaluate((n) => window.__sim.m5?.strike(n), DANGER);
    if (r !== 'complication') throw new Error(`complication strike on ${DANGER}: ${r}`);
    await setPhase(page, 'practice-complication');
    await sleep(BLEED_MS);
    await setPhase(page, 'practice');
  };
  return [
    ['PA01', () => inspect(RML)],
    ['PA02', () => moveScope(RET)],
    ['PA03', () => retract(RUL, CAM)],
    ['PA04', () => dissect('peanut', 'mediastinal_fat', PEANUT_MS)],
    ['PA05', () => dissect('peanut', 'phrenic_nerve_right', SHORT_MS)],
    ['PA06', () => dissect('peanut', 'hilar_connective_tissue', PEANUT_MS)],
    ['PA07', async () => (await inspect('V_RML_common'), inspect('tree_pulm_vein_base'))],
    ['PA08', () => dissect('clamp', 'V_RML_common')],
    ['PA09', () => retract(RUL, UTIL)],
    ['PA10', async () => (await fire('V_RML_common', 'vascular-curved', CAM), complication())],
    ['PA11', () => retract(RUL, CAM)],
    ['PA12', () => dissect('peanut', 'hilar_connective_tissue', SHORT_MS)],
    ['PA13', () => dissect('cautery', 'hilar_connective_tissue', SHORT_MS)],
    ['PA14', () => dissect('grasper', 'LN_11R', 0, 'ring')],
    ['PA15', () => dissect('grasper', 'LN_12R', 0, 'ring')],
    ['PA16', () => dissect('clamp', 'B_RML_common')],
    ['PA17', async () => (await place('stapler', 'B_RML_common', 'bronchial'), press(), sleep(SHORT_MS))],
    ['PA18', () => page.keyboard.press('KeyA')],
    ['PA19', async () => (await press(), sleep(FIRE_MS))],
    [
      'PA20',
      async () => {
        await page.waitForFunction(() => window.__sim.state.deflate_RUL >= 0.95, null, { timeout: 15_000 });
        await retract(RUL, UTIL);
      },
    ],
    ['PA21', () => dissect('clamp', 'A_RML_common')],
    ['PA22', () => fire('A_RML_common', 'vascular-leader', CAM)],
    ['PA23', () => moveScope(CAM)],
    ['PA24', async () => (await retract(RML, UTIL), sleep(TWEEN_MS))],
    ['PA25', () => fire(RML, 'parenchyma', RET)],
    ['PA26', () => inspect('tree_airway_base')],
    ['PA27', () => fire(RML, 'parenchyma', RET)],
    ['PA28', () => page.keyboard.press('KeyB')],
    ['PA29', () => moveScope(RET)],
    ['PA32', () => dissect('sucker', 'tree_airway_base', 0, 'irrigation')],
  ];
}

const practiceReady = async (page) => {
  await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: READY_TIMEOUT_MS });
  await page.waitForFunction(() => window.__sim.m5?.engine != null, null, { timeout: READY_TIMEOUT_MS });
};

/** One full practice run on a page already at practice "ready": heap at start and after the debrief closed (GC'd). */
async function practiceRun(page, cdp) {
  await sleep(SETTLE_MS);
  const ready = await readPerf(page);
  const heapStart = await heapUsed(cdp);
  const t0 = Date.now();
  await setPhase(page, 'practice');
  for (const [id, act] of practiceSteps(page)) {
    await act();
    const done = await page.evaluate((a) => window.__sim.m5?.engine?.isDone(a) ?? false, id);
    if (!done)
      throw new Error(
        `practice ${id} not accepted (toast "${await page.evaluate(() => window.__sim.m4?.lastToast)}")`,
      );
  }
  if (!(await page.evaluate(() => window.__sim.m5?.engine?.finished)))
    throw new Error('practice run not finished');
  await setPhase(page, '');
  // Debrief opens (rendering held), then Close: rendering resumes, so the end sample is a fresh frame.
  const debrief = page.getByRole('dialog', { name: 'Case debrief' });
  await debrief.waitFor({ timeout: 10_000 });
  await debrief.getByRole('button', { name: 'Close' }).click();
  await debrief.waitFor({ state: 'hidden' });
  await sleep(SETTLE_MS);
  const end = await readPerf(page);
  const heapEnd = await heapUsed(cdp);
  const probe = await page.evaluate(() => window.__probe);
  return {
    runMs: Date.now() - t0,
    programs: { ready: ready.programs, after: end.programs },
    phases: summarise(probe.phases),
    longFrames: probe.longFrames,
    maxFrameMs: Math.round(probe.maxFrameMs),
    heapMB: { start: toMB(heapStart), end: toMB(heapEnd), growthPct: pct(heapStart, heapEnd) },
  };
}

async function main() {
  const { port, proc } = await startServer();
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  let failed = false;
  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const errors = [];
    watchErrors(page, errors);
    // Context-level so dedicated-worker fetches (decoders) are counted too.
    const sizes = [];
    context.on('requestfinished', (r) =>
      sizes.push(r.sizes().then((s) => s.responseBodySize + s.responseHeadersSize)),
    );
    await page.addInitScript(instrument, LONG_FRAME_MS);
    const cdp = await context.newCDPSession(page);

    const t0 = Date.now();
    await page.goto(`http://localhost:${port}/?perf${QUALITY && `&quality=${QUALITY}`}`);
    await page.waitForFunction(() => window.__perf?.ready === true, null, { timeout: READY_TIMEOUT_MS });
    const readyMs = Date.now() - t0;
    await setPhase(page, 'ready');
    await sleep(SETTLE_MS);
    const before = await readPerf(page);
    const heapBefore = await heapUsed(cdp);

    await setPhase(page, 'orbit');
    await orbit(page);
    // Step cams, outside, OLV, clamp, variant swaps (src/sim/probe.ts); it tags window.__probe.phase itself.
    const { textureMB } = await page.evaluate(() =>
      window.__sim.probeScript((p) => (window.__probe.phase = p)),
    );
    await sleep(SETTLE_MS);
    const after = await readPerf(page);
    const heapAfter = await heapUsed(cdp);
    const probe = await page.evaluate(() => window.__probe);
    const transferBytes = (await Promise.all(sizes)).reduce((a, b) => a + b, 0);
    const allDts = Object.values(probe.phases).flatMap((p) => p.dts);
    await page.close();

    // Practice: a fresh page straight into ?mode=practice (as practice.spec). Re-entering practice after a run
    // reloads (wireM5 restart(): M4 has no scene reset), so runs 2–3 reload the same ?mode=practice URL.
    const pPage = await context.newPage();
    watchErrors(pPage, errors);
    await pPage.addInitScript(instrument, LONG_FRAME_MS);
    const pCdp = await context.newCDPSession(pPage);
    await pPage.goto(`http://localhost:${port}/?perf&mode=practice${QUALITY && `&quality=${QUALITY}`}`);
    const runs = [];
    for (let i = 0; i < PRACTICE_RUNS; i++) {
      await practiceReady(pPage);
      runs.push(await practiceRun(pPage, pCdp));
      if (i < PRACTICE_RUNS - 1) await pPage.reload(); // = restart(): location.assign(same URL)
    }
    await pPage.close();
    const ends = runs.map((r) => r.heapMB.end);
    const practice = {
      runs,
      heapMethod:
        'Re-entering practice reloads the page (wireM5 restart), so in-page re-entry is impossible: heap (after CDP HeapProfiler.collectGarbage) is read at the same points of each reloaded run — practice ready (start) and after the debrief closed (end). Gate: acrossRunGrowthPct = run-3 end vs run-1 end. perRunGrowthPct (end vs start; includes the lazy debrief chunk) is informational.',
      perRunGrowthPct: runs.map((r) => r.heapMB.growthPct),
      acrossRunGrowthPct: pct(ends[0], ends[ends.length - 1]),
    };

    const phases = summarise(probe.phases);
    const peak = Object.entries(phases).reduce(
      (m, [k, p]) =>
        p.drawCalls > m.drawCalls ? { phase: k, drawCalls: p.drawCalls, triangles: p.triangles } : m,
      { phase: '', drawCalls: 0, triangles: 0 },
    );
    const programsOk =
      after.programs === before.programs && runs.every((r) => r.programs.after === r.programs.ready);
    const heapOk = practice.acrossRunGrowthPct < HEAP_BUDGET_PCT; // per-run growth: informational
    const result = {
      date: new Date().toISOString(),
      headless: true,
      gl: GL,
      note: NOTE,
      script:
        'orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication)',
      preset: after.preset,
      viewport: VIEWPORT,
      fcpMs: Math.round(probe.fcp),
      readyMs,
      transferMB: +(transferBytes / MB).toFixed(2),
      programs: { before: before.programs, after: after.programs },
      textures: after.textures,
      textureMB,
      phases,
      peak,
      longFrames: probe.longFrames,
      maxFrameMs: Math.round(probe.maxFrameMs),
      heapMB: { before: toMB(heapBefore), after: toMB(heapAfter) },
      fpsHeadless: +after.fps.toFixed(1),
      frameTimeP95Ms: p95(allDts), // all rAF deltas over the scripted phases
      practice,
      pass: { programs: programsOk, heap: heapOk, errors: errors.length === 0 },
      errors,
    };
    mkdirSync(`${ROOT}qa`, { recursive: true });
    writeFileSync(`${ROOT}qa/perf.json`, `${JSON.stringify(result, null, 2)}\n`);

    const phaseLine = ([k, p]) =>
      `- ${k}: ${p.drawCalls} draw calls, ${p.triangles} tris, p95 ${p.frameTimeP95Ms} ms, ${p.longFrames} long`;
    const runLine = (r, i) =>
      `- practice run ${i + 1}: ${Math.round(r.runMs / 1000)} s · programs ${r.programs.ready} → ${r.programs.after} · ${r.phases.practice?.drawCalls} calls / ${r.phases.practice?.triangles} tris peak (complication ${r.phases['practice-complication']?.drawCalls} / ${r.phases['practice-complication']?.triangles}) · p95 ${r.phases.practice?.frameTimeP95Ms} ms · ${r.longFrames} long (max ${r.maxFrameMs} ms) · heap ${r.heapMB.start} → ${r.heapMB.end} MB (${r.heapMB.growthPct} %)`;
    console.log(['', ...Object.entries(phases).map(phaseLine), ...runs.map(runLine)].join('\n'));
    console.log(
      `programs ${before.programs} → ${after.programs} · peak ${peak.drawCalls} calls (${peak.phase}) · p95 ${result.frameTimeP95Ms} ms · heap across runs ${practice.acrossRunGrowthPct} %`,
    );

    const md = [
      '',
      `### ${result.date} ${programsOk && heapOk && !errors.length ? 'PASS' : 'FAIL'} (headless ${GL}, preset ${after.preset}, ${VIEWPORT.width}×${VIEWPORT.height}, script: ${result.script})`,
      `- FCP ${result.fcpMs} ms · ready ${readyMs} ms · transfer ${result.transferMB} MB`,
      `- programs ${before.programs} → ${after.programs} · textures ${after.textures} (≈ ${textureMB} MB)`,
      ...Object.entries(phases).map(phaseLine),
      `- heap ${result.heapMB.before} → ${result.heapMB.after} MB`,
      `- long frames ${probe.longFrames} (max ${result.maxFrameMs} ms), fps ${result.fpsHeadless}, frame p95 ${result.frameTimeP95Ms} ms — NOT representative (headless, test-driven)`,
      ...runs.map(runLine),
      `- practice heap: run 1 → 3 end ${practice.acrossRunGrowthPct} % (gate, budget < ${HEAP_BUDGET_PCT} %); per run ${practice.perRunGrowthPct.join(' / ')} % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod`,
      '',
    ].join('\n');
    appendFileSync(`${ROOT}docs/PERF.md`, md);

    if (!programsOk) {
      console.error(
        `FAIL: shader programs changed after ready: ${before.programs} → ${after.programs}; practice ${runs.map((r) => `${r.programs.ready} → ${r.programs.after}`).join(', ')}`,
      );
      failed = true;
    }
    if (!heapOk) {
      console.error(`FAIL: practice heap growth run 1 → 3 ≥ ${HEAP_BUDGET_PCT} %`);
      failed = true;
    }
    if (errors.length) {
      console.error(`FAIL: page errors:\n${errors.join('\n')}`);
      failed = true;
    }
  } finally {
    await browser.close();
    proc.kill();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
