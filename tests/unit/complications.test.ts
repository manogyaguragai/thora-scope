import { describe, expect, it } from 'vitest';
import {
  COMPLICATIONS_CONFIG as C,
  ComplicationController,
  isVascular,
  type ComplicationAction,
  type ComplicationInput,
} from '../../src/sim/complications';
import { cauteryConfig } from '../../src/scene/cautery.config';

function setup() {
  let now = 10;
  const stopped: number[] = [];
  const ctl = new ComplicationController(
    () => now,
    (slot) => stopped.push(slot),
  );
  const input: ComplicationInput = { suction: false, pressure: false, retract: 0 };
  const run = (sec: number, step = 0.1) => {
    for (let s = 0; s < sec - 1e-9; s += step) {
      now += step;
      ctl.update(step, input);
    }
  };
  return { ctl, input, stopped, run, tick: (s: number) => (now += s) };
}

const act = (a: Partial<ComplicationAction> & Pick<ComplicationAction, 'tool' | 'target' | 'kind'>) => ({
  subOption: null,
  ...a,
});
const HIT = { x: 1, y: 2, z: 3 };

describe('complications triggers', () => {
  it('ignores correct actions', () => {
    const { ctl } = setup();
    expect(ctl.onAction(act({ tool: 'stapler', target: 'V_RML_common', kind: 'fire' }))).toEqual([]);
    expect(
      ctl.onAction(act({ tool: 'cautery', target: 'hilar_connective_tissue', kind: 'dissect' })),
    ).toEqual([]);
    expect(ctl.onAction(act({ tool: 'clamp', target: 'azygos_vein', kind: 'encircle' }))).toEqual([]);
    expect(ctl.log).toEqual([]);
  });

  it('stapler on a vascular danger structure → danger event + major bleed at the point', () => {
    const { ctl } = setup();
    const req = ctl.onAction(
      act({ tool: 'stapler', target: 'superior_vena_cava', kind: 'fire', point: HIT }),
    );
    expect(req).toEqual([
      { type: 'toast', key: 'complication.danger' },
      { type: 'blood', bleed: 0, point: HIT, severity: 'major' },
    ]);
    expect(ctl.log.map((e) => e.type)).toEqual(['danger-hit', 'bleed']);
    expect(ctl.log[0]).toMatchObject({ t: 10, target: 'superior_vena_cava', tool: 'stapler' });
    expect(ctl.activeBleeds).toBe(1);
  });

  it('cautery on a non-vascular danger structure → danger event only', () => {
    const { ctl } = setup();
    const req = ctl.onAction(act({ tool: 'cautery', target: 'phrenic_nerve_right', kind: 'dissect' }));
    expect(req).toEqual([{ type: 'toast', key: 'complication.danger' }]);
    expect(ctl.activeBleeds).toBe(0);
  });

  it('cautery on a target vessel → bleed at its centroid when no point given', () => {
    const { ctl } = setup();
    const req = ctl.onAction(act({ tool: 'cautery', target: 'V4_lateral', kind: 'dissect' }));
    expect(req[0]).toMatchObject({
      type: 'blood',
      severity: 'major',
      point: { x: -0.0479, y: 0.0736, z: 0.044 },
    });
    expect(req[1]).toEqual({ type: 'toast', key: 'complication.bleed' });
  });

  it('other non-vascular hit → injury toast', () => {
    const { ctl } = setup();
    const req = ctl.onAction(act({ tool: 'stapler', target: 'LN_11R', kind: 'fire' }));
    expect(req).toEqual([{ type: 'toast', key: 'complication.injury' }]);
    expect(ctl.log).toEqual([{ type: 'injury', t: 10, target: 'LN_11R', tool: 'stapler' }]);
  });

  it('vessel classification by node name', () => {
    for (const id of [
      'A_RML_common',
      'A4_lateral',
      'V5_medial',
      'tree_pulm_vein_base',
      'azygos_vein',
      'aorta',
    ]) {
      expect(isVascular(id), id).toBe(true);
    }
    for (const id of ['B_RML_common', 'tree_airway_base', 'vagus_nerve_right', 'lung_middle_lobe_right']) {
      expect(isVascular(id), id).toBe(false);
    }
  });
});

describe('bleed control', () => {
  it('pool grows, reddens the view and warns until sucker + pressure stop it', () => {
    const { ctl, input, stopped, run } = setup();
    ctl.onAction(act({ tool: 'cautery', target: 'tree_pulm_artery_base', kind: 'dissect', point: HIT }));
    ctl.bindSlot(0, 7);
    run(5);
    expect(ctl.pool).toBeCloseTo(C.oozeRate.major * 5, 5);
    expect(ctl.redden).toBeCloseTo(ctl.pool * C.reddenGain, 5);
    expect(ctl.vitalsKey).toBe('vitals.bleed.major');

    // Pressure with a full pool doesn't count (can't see the bleed).
    input.pressure = true;
    run(C.pressureSec.major + 1);
    expect(ctl.activeBleeds).toBe(1);

    // Suck the pool clear while pressing; ooze stops after the held time.
    input.suction = true;
    run(15);
    expect(ctl.activeBleeds).toBe(0);
    expect(stopped).toEqual([7]);
    expect(ctl.vitalsKey).toBeNull();
    expect(ctl.oozeRate).toBe(0);
    expect(ctl.pool).toBe(0);
    expect(ctl.redden).toBe(0);
    expect(ctl.log.at(-1)).toMatchObject({
      type: 'bleed-controlled',
      target: 'tree_pulm_artery_base',
      severity: 'major',
    });
  });

  it('releasing pressure resets the hold', () => {
    const { ctl, input, run } = setup();
    ctl.onAction(act({ tool: 'cautery', target: 'V5_medial', kind: 'dissect' }));
    input.suction = true;
    input.pressure = true;
    run(C.pressureSec.major - 1);
    input.pressure = false;
    run(0.1);
    input.pressure = true;
    run(C.pressureSec.major - 1);
    expect(ctl.activeBleeds).toBe(1);
  });
});

describe('over-traction during artery passage', () => {
  it('retract above threshold while encircling an artery → one minor bleed', () => {
    const { ctl, input, run } = setup();
    ctl.onAction(act({ tool: 'clamp', target: 'A_RML_common', kind: 'encircle', point: HIT }));
    input.retract = C.overTractionRetract - 0.05;
    expect(ctl.update(0.1, input)).toBeNull();
    input.retract = C.overTractionRetract + 0.05;
    expect(ctl.update(0.1, input)).toEqual([
      { type: 'blood', bleed: 0, point: HIT, severity: 'minor' },
      { type: 'toast', key: 'complication.tear' },
    ]);
    expect(ctl.update(0.1, input)).toBeNull(); // once per passage
    expect(ctl.vitalsKey).toBe('vitals.bleed.minor');
    expect(ctl.log.at(-1)).toMatchObject({ type: 'bleed', cause: 'over-traction', target: 'A_RML_common' });
    input.retract = 0;
    input.suction = true;
    input.pressure = true;
    run(C.pressureSec.minor + 0.5);
    expect(ctl.activeBleeds).toBe(0);
  });

  it('no tear when encircling a vein or after the passage ends', () => {
    const { ctl, input } = setup();
    input.retract = 1;
    ctl.onAction(act({ tool: 'clamp', target: 'V_RML_common', kind: 'encircle' }));
    expect(ctl.update(0.1, input)).toBeNull();
    ctl.onAction(act({ tool: 'clamp', target: 'A4_lateral', kind: 'encircle' }));
    ctl.onAction(act({ tool: 'stapler', target: 'A4_lateral', kind: 'fire' }));
    expect(ctl.update(0.1, input)).toBeNull();
    expect(ctl.log).toEqual([]);
  });
});

describe('log + pool capacity', () => {
  it('logs with injected time and reuses the oldest episode when full', () => {
    const { ctl, stopped, tick } = setup();
    for (let i = 0; i < C.maxBleeds + 1; i++) {
      tick(1);
      ctl.onAction(act({ tool: 'cautery', target: 'azygos_vein', kind: 'dissect' }));
      ctl.bindSlot(i % C.maxBleeds, 100 + i);
    }
    expect(ctl.activeBleeds).toBe(C.maxBleeds);
    expect(stopped).toEqual([100]);
    const bleeds = ctl.log.filter((e) => e.type === 'bleed');
    expect(bleeds.map((e) => e.t)).toEqual([11, 12, 13, 14, 15]);
  });
});

describe('cautery coagulation (T822)', () => {
  const K = cauteryConfig.coag;
  const tear = (ctl: ComplicationController) => {
    ctl.onAction(act({ tool: 'clamp', target: 'A4_lateral', kind: 'encircle', point: HIT }));
    ctl.update(0.01, { suction: false, pressure: false, retract: 1 });
  };

  it('energised contact at a minor bleed slows then seals it after the dwell', () => {
    const { ctl, input, stopped, run } = setup();
    tear(ctl);
    expect(ctl.activeBleeds).toBe(1);
    expect(ctl.bleedNear(HIT)).toBe(true);
    expect(ctl.bleedNear({ x: 9, y: 9, z: 9 })).toBe(false);
    input.coagAt = { x: HIT.x + K.radiusM * 2, y: HIT.y, z: HIT.z }; // too far: nothing
    run(K.sec + 0.5);
    expect(ctl.activeBleeds).toBe(1);
    input.coagAt = HIT;
    run(K.sec / 2);
    expect(ctl.oozeRate).toBeLessThan(C.oozeRate.minor);
    expect(ctl.activeBleeds).toBe(1);
    input.coagAt = null; // lifting off restarts the dwell
    run(0.2);
    input.coagAt = HIT;
    run(K.sec + 0.2);
    expect(ctl.activeBleeds).toBe(0);
    expect(ctl.coagulated).toBe(1);
    expect(stopped).toHaveLength(1);
    expect(ctl.log.at(-1)?.type).toBe('bleed-controlled');
  });

  it('a major vessel injury is never sealed by the cautery (refused flag for the toast)', () => {
    const { ctl, input, run } = setup();
    ctl.onAction(act({ tool: 'stapler', target: 'superior_vena_cava', kind: 'fire', point: HIT }));
    input.coagAt = HIT;
    run(K.sec * 4);
    expect(ctl.activeBleeds).toBe(1);
    expect(ctl.coagulated).toBe(0);
    expect(ctl.coagRefused).toBe(true);
    input.coagAt = null;
    run(0.1);
    expect(ctl.coagRefused).toBe(false);
  });
});
