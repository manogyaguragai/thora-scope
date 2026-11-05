import { describe, expect, test } from 'vitest';
import {
  PRACTICE_CONFIG,
  PracticeEngine,
  type PracticeAttempt,
  type PracticeEvent,
} from '../../src/sim/practice';
import { PortOccupancy } from '../../src/sim/portOccupancy';
import type { ToolId } from '../../src/content/targets';

// Pleura points of public/models/thorax_sim.opt.glb (glTF coords), as in port-occupancy.test.ts.
const PORTS = [
  { id: 'port_camera_8ICS', pleura: { x: -0.163, y: 0.0842, z: 0.0136 } },
  { id: 'port_retraction_8ICS', pleura: { x: -0.084, y: 0.0345, z: -0.0749 } },
  { id: 'port_utility_5ICS', pleura: { x: -0.095, y: 0.0833, z: 0.0856 } },
];
const CAM = 'port_camera_8ICS';
const ANT = 'port_retraction_8ICS';
const UTIL = 'port_utility_5ICS';
const RUL = 'lung_upper_lobe_right';
const RML = 'lung_middle_lobe_right';
const HILAR = 'hilar_connective_tissue';
const INSTR = new Set(['grasper', 'sponge', 'peanut', 'cautery', 'clamp', 'stapler', 'clip', 'sucker']);

interface Move extends PracticeAttempt {
  readonly id: string;
  /** G after the attempt (held retraction). */
  readonly hold?: boolean;
  /** Esc before the attempt. */
  readonly withdraw?: boolean;
}
const m = (
  id: string,
  tool: PracticeAttempt['tool'],
  subOption: string | null,
  target: string | null,
  port: string | null,
  kind: PracticeAttempt['kind'],
  extra: { hold?: boolean; withdraw?: boolean } = {},
): Move => ({ id, tool, subOption, target, port, kind, ...extra });

// The video sequence (VIDEO_STEP_MAP (d)); optional PA30/PA31 skipped.
const SCRIPT: readonly Move[] = [
  m('PA01', 'hands', null, RML, CAM, 'inspect'),
  m('PA02', 'hands', null, null, ANT, 'move-scope'),
  m('PA03', 'grasper', 'retractor', RUL, CAM, 'retract', { hold: true }),
  m('PA04', 'peanut', null, 'mediastinal_fat', UTIL, 'dissect'),
  m('PA05', 'peanut', null, 'phrenic_nerve_right', UTIL, 'dissect'),
  m('PA06', 'peanut', null, HILAR, UTIL, 'dissect'),
  m('PA07', 'hands', null, 'V_RML_common', ANT, 'inspect'),
  m('PA07', 'hands', null, 'tree_pulm_vein_base', ANT, 'inspect'),
  m('PA08', 'clamp', null, 'V_RML_common', UTIL, 'encircle'),
  m('PA09', 'grasper', 'retractor', RUL, UTIL, 'retract', { hold: true }),
  m('PA10', 'stapler', 'vascular-curved', 'V_RML_common', CAM, 'fire'),
  m('PA11', 'grasper', 'retractor', RUL, CAM, 'retract', { withdraw: true, hold: true }),
  m('PA12', 'peanut', null, HILAR, UTIL, 'dissect'),
  m('PA13', 'cautery', null, HILAR, UTIL, 'dissect'),
  m('PA14', 'grasper', 'ring', 'LN_11R', UTIL, 'remove-node'),
  m('PA15', 'grasper', 'ring', 'LN_12R', UTIL, 'remove-node'),
  m('PA16', 'clamp', null, 'B_RML_common', UTIL, 'encircle'),
  m('PA17', 'stapler', 'bronchial', 'B_RML_common', UTIL, 'close'),
  m('PA18', 'ventilate', null, 'B_RML_common', null, 'ventilate'),
  m('PA19', 'stapler', 'bronchial', 'B_RML_common', UTIL, 'fire'),
  m('PA20', 'grasper', 'retractor', RUL, UTIL, 'retract', { hold: true }),
  m('PA21', 'clamp', null, 'A_RML_common', UTIL, 'encircle'),
  m('PA22', 'stapler', 'vascular-leader', 'A_RML_common', CAM, 'fire'),
  m('PA23', 'hands', null, null, CAM, 'move-scope', { withdraw: true }),
  m('PA24', 'grasper', 'retractor', RML, UTIL, 'retract', { hold: true }),
  m('PA25', 'stapler', 'parenchyma', RML, ANT, 'fire'),
  m('PA26', 'hands', null, 'tree_airway_base', CAM, 'inspect'),
  m('PA27', 'stapler', 'parenchyma', RML, ANT, 'fire'),
  m('PA28', 'bag', null, RML, UTIL, 'bag'),
  m('PA29', 'hands', null, null, ANT, 'move-scope', { withdraw: true }),
  m('PA32', 'sucker', 'irrigation', 'tree_airway_base', UTIL, 'irrigate'),
];

function setup() {
  const occ = new PortOccupancy(PORTS);
  occ.moveScope(CAM);
  const clock = { now: 0 };
  // The wiring's job, simulated: apply scope moves from the result requests.
  const eng = new PracticeEngine(
    occ,
    () => clock.now,
    undefined,
    (e) => {
      if (e.type === 'action' && e.result.scopePort) occ.moveScope(e.result.scopePort);
    },
  );
  const play = (mv: Move): PracticeEvent => {
    if (mv.withdraw) occ.withdraw();
    if (INSTR.has(mv.tool) && mv.port) occ.insert(mv.tool as ToolId, mv.port);
    clock.now += 1000;
    const e = eng.attempt(mv);
    if (mv.hold && mv.target) occ.hold(mv.target);
    return e;
  };
  let pos = 0;
  /** Continue the script up to (not including) action `id`, skipping actions already done another way. */
  const playUntil = (id: string, edit?: (mv: Move) => Move): void => {
    for (let mv = SCRIPT[pos]; mv && mv.id !== id; mv = SCRIPT[++pos])
      if (!eng.isDone(mv.id)) expect(play(edit ? edit(mv) : mv).type).not.toBe('error');
  };
  return { occ, eng, clock, play, playUntil };
}

const errors = (eng: PracticeEngine) => eng.log.filter((e) => e.type === 'error');

describe('practice engine', () => {
  test('full scripted run PA01→PA32 completes, optional PA30/PA31 skipped', () => {
    const { eng, play, clock, occ } = setup();
    for (const mv of SCRIPT) {
      const e = play(mv);
      expect(e.type, `${mv.id} ${JSON.stringify(e)}`).toMatch(/^(action|progress)$/);
      if (e.type === 'action' || e.type === 'progress') expect(e.actionId).toBe(mv.id);
    }
    expect(errors(eng)).toEqual([]);
    expect(eng.finished).toBe(true);
    expect(eng.step).toBe(7);
    expect(eng.isDone('PA30') || eng.isDone('PA31')).toBe(false);
    expect(eng.completed()).toHaveLength(30);
    expect(eng.log.filter((e) => e.type === 'step').map((e) => (e.type === 'step' ? e.step : 0))).toEqual([
      4, 5, 6, 7,
    ]);
    expect(occ.swaps).toBe(3); // PA09, PA11, PA20
    const t = eng.elapsed();
    expect(t).toBe(SCRIPT.length);
    clock.now += 60_000;
    expect(eng.elapsed()).toBe(t); // timer frozen at finish
    expect(eng.log.at(-1)?.type).toBe('finish');
    // Result requests are passed through untouched.
    const pa19 = eng.log.find((e) => e.type === 'action' && e.actionId === 'PA19');
    expect(pa19?.type === 'action' && pa19.result.divide).toContain('B_RML_common');
    // Optional actions still accepted after the finish.
    const n1 = play(m('PA30', 'grasper', 'ring', 'LN_4R', UTIL, 'remove-node'));
    expect(n1.type).toBe('progress');
    const n2 = play(m('PA30', 'grasper', 'ring', 'LN_7', UTIL, 'remove-node'));
    expect(n2.type === 'action' && n2.optional).toBe(true);
  });

  test('wrong order is logged and does not progress', () => {
    const { eng, play, playUntil } = setup();
    const e = play(m('x', 'stapler', 'vascular-curved', 'V_RML_common', CAM, 'fire'));
    expect(e).toMatchObject({ type: 'error', error: 'wrong-order', actionId: 'PA10' });
    expect(eng.completed()).toEqual([]);
    // Firing on the bronchus before the test ventilation (CONTEXT §6.4: firing without the test = error).
    playUntil('PA18');
    const f = play(m('x', 'stapler', 'bronchial', 'B_RML_common', UTIL, 'fire'));
    expect(f).toMatchObject({ type: 'error', error: 'wrong-order', actionId: 'PA19' });
    expect(eng.isDone('PA19')).toBe(false);
  });

  test('wrong target, wrong tool and unexpected are classified', () => {
    const { eng, play, playUntil } = setup();
    playUntil('PA04');
    expect(play(m('x', 'peanut', null, 'LN_11R', UTIL, 'dissect'))).toMatchObject({
      error: 'wrong-target',
      actionId: 'PA04',
    });
    expect(play(m('x', 'cautery', null, 'mediastinal_fat', UTIL, 'dissect'))).toMatchObject({
      error: 'wrong-tool',
      actionId: 'PA04',
    });
    expect(play(m('x', 'sucker', 'suction', 'LN_7', UTIL, 'irrigate'))).toMatchObject({
      error: 'unexpected',
      actionId: null,
    });
    expect(errors(eng)).toHaveLength(3);
    expect(eng.isDone('PA04')).toBe(false);
  });

  test('wrong port and port occupancy (retraction swap skipped)', () => {
    const { play, playUntil } = setup();
    // Skip the hold in PA09: the retraction stays in the camera port.
    playUntil('PA10', (mv) => (mv.id === 'PA09' ? { ...mv, hold: false } : mv));
    expect(play(m('x', 'stapler', 'vascular-curved', 'V_RML_common', UTIL, 'fire'))).toMatchObject({
      error: 'wrong-port',
      actionId: 'PA10',
    });
    const e = play(m('x', 'stapler', 'vascular-curved', 'V_RML_common', CAM, 'fire'));
    expect(e).toMatchObject({ error: 'wrong-port', actionId: 'PA10', fire: 'retraction-in-port' });
  });

  test('accepted alternatives: PA10 by branch, PA22 by clips', () => {
    const { eng, play, playUntil } = setup();
    playUntil('PA10');
    expect(play(m('PA10', 'stapler', 'vascular-curved', 'V4_lateral', CAM, 'fire')).type).toBe('progress');
    const e = play(m('PA10', 'stapler', 'vascular-curved', 'V5_medial', CAM, 'fire'));
    expect(e).toMatchObject({ type: 'action', actionId: 'PA10', alternative: 0 });
    expect(eng.step).toBe(4);
    playUntil('PA22');
    play(m('PA22', 'clip', null, 'A4_lateral', CAM, 'fire'));
    expect(play(m('PA22', 'clip', null, 'A5_medial', CAM, 'fire'))).toMatchObject({
      type: 'action',
      alternative: 2,
    });
  });

  test('hints list next available actions with short text and are logged', () => {
    const { eng, playUntil } = setup();
    const h = eng.hint();
    expect(h.map((x) => x.actionId)).toEqual(['PA01']);
    expect(h[0]?.text.length).toBeLessThanOrEqual(PRACTICE_CONFIG.hintMaxChars + 1);
    playUntil('PA32');
    const late = eng.hint().map((x) => x.actionId);
    expect(late[0]).toBe('PA32'); // required before optional
    expect(late).toContain('PA30');
    expect(eng.log.filter((e) => e.type === 'hint')).toHaveLength(2);
    eng.reset();
    expect(eng.log).toEqual([{ type: 'start', t: 0 }]);
    expect(eng.completed()).toEqual([]);
  });
});
