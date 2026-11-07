import { PerspectiveCamera, Vector3 } from 'three';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  apertureHalf,
  bboxFraming,
  coverageLimits,
  judge,
  miss,
  newFraming,
  subjectKey,
} from '../../src/app/walkthrough/framing';
import type { WalkStep, WalkthroughHook } from '../../src/app/walkthrough/types';
import { config } from '../../src/core/config';
import { walkthroughConfig as W } from '../../src/app/walkthrough/walkthrough.config';
import { createFinishState } from '../../src/sim/actions/finish';
import { createGuided } from '../../src/sim/guided';
import type { Hold } from '../../src/sim/portOccupancy';
import type { Port } from '../../src/sim/ports';
import { ScopeRig } from '../../src/sim/scopeRig';
import { createState } from '../../src/sim/state';
import { createStepVisibility } from '../../src/sim/steps';
import { walkRate } from '../../src/sim/walkLock';

describe('T860 framing math (R3)', () => {
  test('aperture: 5:4 rect letterboxed into the viewport, NDC half-extents', () => {
    const { maskAspect: k, maskFill: f } = config.postfx;
    const a = apertureHalf(1920, 1080, { ax: 0, ay: 0 });
    expect(a.ay).toBeCloseTo(f);
    expect(a.ax).toBeCloseTo((f * 1080 * k) / 1920);
    const b = apertureHalf(800, 1000, { ax: 0, ay: 0 }); // narrow: width-limited
    expect(b.ax).toBeCloseTo(f);
    expect(b.ay).toBeCloseTo((f * 800) / k / 1000);
  });

  test('bbox offset (fraction of the half-size) and clipped coverage', () => {
    const f = newFraming();
    const xs = [-0.25, 0.25, 0.25, -0.25];
    const ys = [-0.25, -0.25, 0.25, 0.25];
    expect(bboxFraming(xs, ys, [1, 1, 1, 1], 4, 0.5, 1, f)).toBe(4);
    expect(f.offset).toEqual([0, 0]);
    expect(f.coverage).toBeCloseTo((0.5 * 0.5) / (1 * 2));
    // Shifted right half out of the aperture: offset 1 (= half-size), coverage clipped.
    bboxFraming([0.25, 0.75], [-0.5, 0.5], [1, 1], 2, 0.5, 1, f);
    expect(f.offset[0]).toBeCloseTo(1);
    expect(f.coverage).toBeCloseTo((0.25 * 1) / 2);
    expect(f.spill).toBeCloseTo(0.5); // T870: half its bbox outside the aperture
    // Points behind the camera are ignored; none in front → no coverage.
    expect(bboxFraming([0], [0], [0], 1, 0.5, 1, f)).toBe(0);
    expect(f.coverage).toBe(0);
  });

  test('contract: offset ±12 %, coverage band (per-subject overrides), ≥ 60 % unoccluded, tip inside', () => {
    const f = newFraming();
    const lim = coverageLimits('middle_lobe_bronchus');
    expect(lim).toEqual({ min: W.framing.coverage.min, max: W.framing.coverage.max });
    Object.assign(f, { offset: [0.1, -0.1], coverage: 0.2, unoccluded: 0.7, tipInside: null });
    expect(judge(f, lim)).toBe(true);
    expect(miss(f, lim)).toBe(0);
    f.offset[0] = 0.2;
    expect(judge(f, lim)).toBe(false);
    expect(miss(f, lim)).toBeCloseTo(0.08);
    f.offset[0] = 0;
    f.tipInside = false;
    expect(judge(f, lim)).toBe(false);
    f.tipInside = true;
    f.unoccluded = 0.5;
    expect(judge(f, lim)).toBe(false);
    // T870: no useless close-ups — lens too near, or the subject spilling far past the aperture.
    f.unoccluded = 0.9;
    expect(judge(f, lim)).toBe(true);
    f.nearM = W.framing.minDistM / 2;
    expect(judge(f, lim)).toBe(false);
    f.nearM = W.framing.minDistM;
    f.spill = W.framing.spillMax + 0.1;
    expect(judge(f, lim)).toBe(false);
    expect(miss(f, lim)).toBeCloseTo(0.1);
    const O = W.framing.overrides; // authors tune these: compare against the config, not literals
    expect(coverageLimits('lung_middle_lobe_right').max).toBeCloseTo(O.lung_middle_lobe_right?.max ?? NaN);
    expect(coverageLimits(subjectKey({ fissure: 'oblique' })).min).toBeCloseTo(
      O['fissure:oblique']?.min ?? NaN,
    );
    expect(coverageLimits(subjectKey(['LN_11R', 'phrenic_nerve_right'])).min).toBeCloseTo(
      Math.min(O.phrenic_nerve_right?.min ?? NaN, O.LN_11R?.min ?? W.framing.coverage.min),
    );
    expect(subjectKey({ bed: true })).toBe('bed');
  });
});

// ── Engine timeline on fakes: fake clock (guided.update(now)), no scene ──
const CAM = 'port_camera_8ICS';
const POST = 'port_retraction_8ICS';
const RML = 'lung_middle_lobe_right';
const STEPS: WalkStep[] = [
  {
    step: 1,
    scopePort: CAM,
    beats: [
      { id: 'a', kind: 'result', say: 'A', ms: 1000, pause: true },
      { id: 'b', kind: 'result', say: 'B', ms: 1000, pause: true },
    ],
    end: { finish: {}, state: {}, scopePort: CAM },
  },
  {
    step: 2,
    scopePort: CAM,
    beats: [{ id: 'c', kind: 'transition', say: 'C', ms: 2000 }],
    end: {
      finish: { veinDivided: true, specimens: ['LN_11R'] },
      state: { retract_hilum: 1 },
      divided: ['middle_lobe_vein'],
      removed: ['LN_11R'],
      holds: [{ port: CAM, target: RML, key: 'retract_hilum' }],
      scopePort: POST,
    },
  },
  {
    step: 3,
    scopePort: POST,
    beats: [
      { id: 'd', kind: 'transition', say: 'D', ms: 3000 },
      { id: 'e', kind: 'transition', say: 'E', ms: 500, msg: 'done' },
    ],
    end: { finish: {}, state: { retract_hilum: 1 }, scopePort: POST },
  },
];

function world() {
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const ports: Port[] = [
    { id: CAM, label: 'cam', skin: v(0, 0, -0.01), pleura: v(0, 0, 0), axis: v(0, 0, 1) },
    { id: POST, label: 'post', skin: v(0.05, 0, -0.01), pleura: v(0.05, 0, 0), axis: v(0, 0, 1) },
  ];
  const state = createState();
  const vis = createStepVisibility((name) => ({ name, visible: true }));
  const guided = createGuided({ vis, state, setCamera: () => {}, setFade: () => {} });
  const calls: string[] = [];
  const holds: Hold[] = [];
  const m4 = {
    tool: null,
    finish: createFinishState(),
    flags: new Set<string>(),
    fx: {},
    control: { tipPos: new Vector3() },
    occupancy: { activePort: null, holds, scopePort: null as string | null, hasRoom: () => true },
    walk: {
      reset: () => {
        calls.push('reset');
        holds.length = 0;
      },
      divided: (n: string) => void calls.push(`divided:${n}`),
      removed: (n: string) => void calls.push(`removed:${n}`),
      hold: (tool: string, sub: string | null, port: string, target: string) =>
        holds.push({ tool: tool as Hold['tool'], sub, port, target }) > 0,
      ventilate: () => 'ok',
      bag: () => 'ok',
    },
  };
  const scope = new ScopeRig(ports);
  const m3 = {
    scope,
    syncScope: () => {},
    writeScope: () => {},
    picker: { ray: () => null, meshes: [] },
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.location = { search: '' };
  g.__perf = { ready: true };
  g.__sim = { state, m3, m4, rig: null, fissure: null };
  return { state, guided, calls, holds, scope };
}

describe('T860 walkthrough engine (fake clock, fake case)', () => {
  let w: ReturnType<typeof world>;
  let hook: WalkthroughHook;
  let now = 0;
  const captions: string[] = [];
  const msgs: string[] = [];
  /** Real ms in frame steps of 50 ms, letting the engine's promises settle between frames. */
  async function advance(ms: number): Promise<void> {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      w.guided.update(now);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    }
  }
  beforeAll(async () => {
    w = world();
    const { createWalkthrough } = await import('../../src/app/walkthrough/engine');
    hook = createWalkthrough({
      guided: w.guided,
      state: w.state,
      camera: new PerspectiveCamera(),
      picker: { ray: () => null } as never,
      meshesOf: () => [],
      onNodeRemoved: [],
      steps: STEPS,
    });
    hook.on('caption', (_, t) => void captions.push(t));
    hook.on('msg', (_, t) => void msgs.push(t));
    w.guided.goTo(1, true);
  });

  test('auto-plays step 1 on ready; pause beats wait for Next (rail sub-progress)', async () => {
    await advance(100);
    expect(hook.state()).toMatchObject({ status: 'playing', step: 1, beat: 0, sub: { at: 1, of: 2 } });
    expect(captions).toEqual(['A']);
    await advance(1100);
    expect(hook.state()).toMatchObject({ status: 'waiting', beat: 0, done: 1 });
    hook.next();
    await advance(100);
    expect(hook.state()).toMatchObject({ status: 'playing', beat: 1, sub: { at: 2, of: 2 } });
    await advance(1100);
    expect(hook.state().status).toBe('holding'); // the last part holds; Next goes to step 2
    hook.prev();
    await advance(50);
    expect(hook.state()).toMatchObject({ step: 1, beat: 0 }); // Prev: back one part
  });

  test('timeScale fast-forwards; seek(3) rebuilds steps 1–2 in place (reset, divided, removed, hold, keys, port)', async () => {
    hook.timeScale = 4;
    await hook.seek(2);
    expect(w.holds).toEqual([]);
    await advance(600); // 2400 engine ms ≥ 2000
    expect(hook.state().status).toBe('holding');
    w.calls.length = 0;
    await hook.seek(3);
    expect(w.calls).toEqual(['reset', 'divided:middle_lobe_vein', 'removed:LN_11R']);
    const s = hook.state();
    expect(s.holds).toEqual([{ port: CAM, target: RML }]);
    expect(s.reflected).toBe(true);
    expect(s.scopePort).toBe(POST);
    expect(w.state.retract_hilum).toBe(1);
    expect(w.state.step).toBe(3);
    const done = hook.settle('step');
    await advance(1000); // (3000 + 500) / 4 ≈ 875 ms
    expect((await done).status).toBe('holding');
    expect(msgs).toEqual(['done']);
  });

  test('pause freezes the engine clock; play resumes; Prev replays the previous step from its start', async () => {
    await hook.seek(3);
    hook.pause();
    await advance(2000);
    expect(hook.state()).toMatchObject({ status: 'paused', beat: 0, done: 0 });
    expect(walkRate.value).toBe(0); // m4's own animations freeze too
    hook.play();
    await advance(50);
    expect(walkRate.value).toBe(4); // × timeScale
    await advance(1000);
    expect(hook.state().status).toBe('holding');
    hook.prev();
    await advance(50);
    expect(hook.state()).toMatchObject({ step: 2, beat: 0, holds: [] });
  });
});
