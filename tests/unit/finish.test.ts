import { describe, expect, it } from 'vitest';
import {
  bagExtract,
  clampBronchus,
  confirmUnderside,
  createFinishState,
  FINISH_CONFIG as C,
  fireBronchus,
  fireFissure,
  irrigate,
  noteDivided,
  placeChestTube,
  removeNode,
  unclampBronchus,
  ventilate,
  type FinishResult,
  type FinishState,
} from '../../src/sim/actions/finish';

const kinds = (r: FinishResult): string[] => (r.ok ? r.requests.map((q) => q.kind) : []);
const flags = (r: FinishResult): string[] =>
  r.ok ? r.requests.flatMap((q) => (q.kind === 'flag' ? [q.flag] : [])) : [];

function toBronchusClamped(): FinishState {
  const s = createFinishState();
  noteDivided(s, 'vein');
  for (const n of C.requiredNodes) expect(removeNode(s, n, C.accessPort).ok).toBe(true);
  expect(clampBronchus(s).ok).toBe(true);
  return s;
}

function toLobeFree(): FinishState {
  const s = toBronchusClamped();
  ventilate(s);
  fireBronchus(s);
  noteDivided(s, 'artery');
  for (let i = 1; i < C.fissureFiresRequired; i++) expect(fireFissure(s, 1).ok).toBe(true);
  expect(confirmUnderside(s, 1).ok).toBe(true);
  expect(fireFissure(s, 1).ok).toBe(true);
  return s;
}

function toIrrigated(leak: boolean): FinishState {
  const s = toLobeFree();
  s.leak = leak;
  expect(bagExtract(s, C.accessPort).ok).toBe(true);
  expect(irrigate(s).ok).toBe(true);
  return s;
}

describe('finish: lymph nodes', () => {
  it('11R/12R go to the specimen tray via the access incision, once', () => {
    const s = createFinishState();
    expect(removeNode(s, 'LN_11R', 'port_camera_8ICS').ok).toBe(false);
    const r = removeNode(s, 'LN_11R', C.accessPort);
    expect(kinds(r)).toEqual(['hide', 'specimen']);
    expect(removeNode(s, 'LN_11R', C.accessPort).ok).toBe(false);
    expect(s.specimens).toEqual(['LN_11R']);
    expect(removeNode(s, 'LN_4R', C.accessPort).ok).toBe(false); // optional nodes only after extraction
    expect(removeNode(s, 'aorta', C.accessPort).ok).toBe(false);
  });
});

describe('finish: bronchus test gating', () => {
  it('clamp needs vein divided and both nodes removed', () => {
    const s = createFinishState();
    expect(clampBronchus(s).ok).toBe(false);
    noteDivided(s, 'vein');
    removeNode(s, 'LN_11R', C.accessPort);
    expect(clampBronchus(s).ok).toBe(false);
    removeNode(s, 'LN_12R', C.accessPort);
    expect(flags(clampBronchus(s))).toEqual(['bronchus_clamped']);
  });

  it('firing without the test is a scored error; test inflates RUL/RLL, RML stays down', () => {
    const s = toBronchusClamped();
    const bad = fireBronchus(s);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toBe(true);
    const t = ventilate(s);
    expect(flags(t)).toEqual(['bronchus_test_passed']);
    const tw = t.ok ? t.requests.filter((q) => q.kind === 'tween') : [];
    expect(tw).toContainEqual({ kind: 'tween', key: 'deflate_RUL', to: 0, ms: C.inflateMs, delayMs: 0 });
    expect(tw).toContainEqual({ kind: 'tween', key: 'deflate_RLL', to: 0, ms: C.inflateMs, delayMs: 0 });
    expect(tw).toContainEqual({ kind: 'tween', key: 'deflate_RML', to: 1, ms: C.inflateMs, delayMs: 0 });
    expect(tw.some((q) => q.key === 'deflate_RML' && q.to === 0)).toBe(false);
    expect(kinds(fireBronchus(s))).toEqual(['divide', 'rmlDivided', 'advance']);
    expect(fireBronchus(s).ok).toBe(false);
  });

  it('re-opening the stapler voids the test', () => {
    const s = toBronchusClamped();
    ventilate(s);
    unclampBronchus(s);
    expect(fireBronchus(s).ok).toBe(false);
    clampBronchus(s);
    expect(fireBronchus(s).ok).toBe(false);
  });
});

describe('finish: fissure + extraction sequence', () => {
  it('final fissure fire needs retraction and the underside check', () => {
    const s = toBronchusClamped();
    ventilate(s);
    fireBronchus(s);
    expect(fireFissure(s, 1).ok).toBe(false); // artery not divided yet
    noteDivided(s, 'artery');
    expect(fireFissure(s, 0.2).ok).toBe(false);
    expect(confirmUnderside(s, 1).ok).toBe(false); // before first fire
    expect(flags(fireFissure(s, 1))).toEqual(['fissure_fire_1']);
    // T851: one fire per fissure-guide segment; only the last one needs the underside check.
    for (let i = 2; i < C.fissureFiresRequired; i++)
      expect(flags(fireFissure(s, 1))).toEqual([`fissure_fire_${i}`]);
    const early = fireFissure(s, 1);
    expect(!early.ok && early.error).toBe(true);
    expect(confirmUnderside(s, 0.1).ok).toBe(false);
    expect(flags(confirmUnderside(s, 1))).toEqual(['stump_above_stapler_confirmed']);
    expect(flags(fireFissure(s, 1))).toEqual(['lobe_free']);
    expect(s.lobeFree).toBe(true);
  });

  it('bag only via access incision after all divisions; re-inflates RUL/RLL', () => {
    const s0 = toBronchusClamped();
    expect(bagExtract(s0, C.accessPort).ok).toBe(false);
    const s = toLobeFree();
    expect(bagExtract(s, 'port_retraction_8ICS').ok).toBe(false);
    const r = bagExtract(s, C.accessPort);
    expect(kinds(r)).toEqual(['hide', 'specimen', 'tween', 'tween', 'flag']);
    expect(
      r.ok && r.requests.filter((q) => q.kind === 'tween').every((q) => q.kind === 'tween' && q.to === 0),
    ).toBe(true);
    expect(s.specimens).toContain(C.lobe);
    expect(bagExtract(s, C.accessPort).ok).toBe(false);
    expect(removeNode(s, 'LN_7', C.accessPort).ok).toBe(true);
  });

  it('chest tube is optional, after extraction, camera port with the scope elsewhere', () => {
    const s = toLobeFree();
    expect(placeChestTube(s, C.chestTubePort, 'port_retraction_8ICS').ok).toBe(false);
    bagExtract(s, C.accessPort);
    expect(placeChestTube(s, C.chestTubePort, C.chestTubePort).ok).toBe(false);
    expect(placeChestTube(s, C.accessPort, 'port_retraction_8ICS').ok).toBe(false);
    expect(flags(placeChestTube(s, C.chestTubePort, 'port_retraction_8ICS'))).toEqual(['chest_tube_placed']);
  });
});

describe('finish: water test', () => {
  it('irrigation needs the lobe out and fills fluid', () => {
    const s = toLobeFree();
    expect(irrigate(s).ok).toBe(false);
    bagExtract(s, C.accessPort);
    expect(irrigate(s)).toEqual({ ok: true, requests: [{ kind: 'fluid', level: C.irrigationLevel }] });
  });

  it('no leak: no bubbles, case complete', () => {
    const s = toIrrigated(false);
    const r = ventilate(s);
    expect(kinds(r)).not.toContain('bubbles');
    expect(flags(r)).toEqual(['case_complete']);
    expect(s.caseComplete).toBe(true);
  });

  it('leak: bubbles at the stump, not complete', () => {
    const s = toIrrigated(true);
    const r = ventilate(s);
    expect(r.ok && r.requests[0]).toEqual({ kind: 'bubbles', node: C.stump });
    expect(s.caseComplete).toBe(false);
  });
});
