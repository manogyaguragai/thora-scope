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
const PLEURA = 'mediastinal_pleura_hilum';
const VEIN = 'middle_lobe_vein';
const BR = 'middle_lobe_bronchus';
const ART = 'middle_lobe_artery';
const INSTR = new Set(['grasper', 'sponge', 'peanut', 'cautery', 'clamp', 'stapler', 'clip', 'sucker']);

interface Move extends PracticeAttempt {
  readonly id: string;
  /** G after the attempt (held retraction). */
  readonly hold?: boolean;
  /** Esc before the attempt. */
  readonly withdraw?: boolean;
  /** Shift+G on this held target before the attempt. */
  readonly release?: string;
}
const m = (
  id: string,
  tool: PracticeAttempt['tool'],
  subOption: string | null,
  target: string | null,
  port: string | null,
  kind: PracticeAttempt['kind'],
  extra: { hold?: boolean; withdraw?: boolean; release?: string } = {},
): Move => ({ id, tool, subOption, target, port, kind, ...extra });

// T844: the 9-step sequence (same steps as Guided, docs/FEEDBACK_v7_LIVE.md); optional PA27/PA28 skipped.
const SCRIPT: readonly Move[] = [
  m('PA01', 'hands', null, RUL, CAM, 'inspect'),
  m('PA01', 'hands', null, RML, CAM, 'inspect'),
  m('PA01', 'hands', null, 'lung_lower_lobe_right', CAM, 'inspect'),
  m('PA02', 'grasper', 'retractor', RUL, ANT, 'retract', { hold: true }),
  m('PA03', 'peanut', null, 'phrenic_nerve_right', UTIL, 'dissect'),
  m('PA04', 'cautery', null, PLEURA, UTIL, 'dissect'),
  m('PA05', 'cautery', null, HILAR, UTIL, 'dissect'),
  m('PA06', 'hands', null, VEIN, CAM, 'inspect'),
  m('PA06', 'hands', null, 'pulmonary_vein_tree', CAM, 'inspect'),
  m('PA07', 'peanut', null, VEIN, UTIL, 'encircle'),
  m('PA08', 'grasper', 'retractor', RUL, UTIL, 'retract', { hold: true }), // swap: frees the posterior port
  m('PA09', 'stapler', 'vascular-curved', VEIN, ANT, 'fire'),
  m('PA10', 'grasper', 'ring', 'LN_11R', UTIL, 'remove-node'),
  m('PA10', 'grasper', 'ring', 'LN_12R', UTIL, 'remove-node'),
  m('PA11', 'cautery', null, null, UTIL, 'coagulate'),
  // The access incision takes two: let go of the upper lobe, the middle lobe pull takes over.
  m('PA12', 'grasper', 'retractor', RML, UTIL, 'retract', { hold: true, release: RUL }),
  m('PA13', 'clamp', null, BR, UTIL, 'encircle'),
  m('PA14', 'stapler', 'bronchial', BR, ANT, 'close'),
  m('PA15', 'ventilate', null, BR, null, 'ventilate'),
  m('PA16', 'stapler', 'bronchial', BR, ANT, 'fire'),
  m('PA17', 'peanut', null, ART, UTIL, 'encircle'),
  m('PA18', 'stapler', 'vascular-leader', ART, ANT, 'fire'),
  m('PA19', 'grasper', 'retractor', RML, UTIL, 'retract', { hold: true }),
  // T851: one fire per dotted fissure segment (2 horizontal, underside check, 2 oblique).
  m('PA20', 'stapler', 'parenchyma', RML, ANT, 'fire'),
  m('PA29', 'stapler', 'parenchyma', RML, ANT, 'fire'),
  m('PA21', 'hands', null, 'bronchial_tree', CAM, 'inspect'),
  m('PA30', 'stapler', 'parenchyma', RML, ANT, 'fire'),
  m('PA22', 'stapler', 'parenchyma', RML, ANT, 'fire'),
  m('PA23', 'bag', null, RML, UTIL, 'bag'),
  m('PA24', 'sucker', 'irrigation', 'bronchial_tree', UTIL, 'irrigate'),
  m('PA25', 'ventilate', null, 'bronchial_tree', null, 'ventilate'),
  m('PA26', 'sucker', 'suction', null, UTIL, 'suction'),
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
    if (mv.release) occ.release(mv.release);
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
  test('full scripted run PA01→PA26 completes in the 9 guided steps, optional PA27/PA28 skipped', () => {
    const { eng, play, clock, occ } = setup();
    for (const mv of SCRIPT) {
      const e = play(mv);
      expect(e.type, `${mv.id} ${JSON.stringify(e)}`).toMatch(/^(action|progress)$/);
      if (e.type === 'action' || e.type === 'progress') expect(e.actionId).toBe(mv.id);
    }
    expect(errors(eng)).toEqual([]);
    expect(eng.finished).toBe(true);
    expect(eng.step).toBe(9);
    expect(eng.isDone('PA27') || eng.isDone('PA28')).toBe(false);
    expect(eng.completed()).toHaveLength(28); // T851: + PA29/PA30 fissure-segment fires
    expect(eng.log.filter((e) => e.type === 'step').map((e) => (e.type === 'step' ? e.step : 0))).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(occ.swaps).toBe(1); // PA08: the upper lobe re-grasped via the access incision
    const t = eng.elapsed();
    expect(t).toBe(SCRIPT.length);
    clock.now += 60_000;
    expect(eng.elapsed()).toBe(t); // timer frozen at finish
    expect(eng.log.at(-1)?.type).toBe('finish');
    // Result requests are passed through untouched.
    const pa15 = eng.log.find((e) => e.type === 'action' && e.actionId === 'PA16');
    expect(pa15?.type === 'action' && pa15.result.divide).toContain(BR);
    // Optional actions still accepted after the finish.
    const n1 = play(m('PA27', 'grasper', 'ring', 'LN_4R', UTIL, 'remove-node'));
    expect(n1.type).toBe('progress');
    const n2 = play(m('PA27', 'grasper', 'ring', 'LN_7', UTIL, 'remove-node'));
    expect(n2.type === 'action' && n2.optional).toBe(true);
  });

  test('wrong order is logged and does not progress', () => {
    const { eng, play, playUntil } = setup();
    const e = play(m('x', 'stapler', 'vascular-curved', VEIN, UTIL, 'fire'));
    expect(e).toMatchObject({ type: 'error', error: 'wrong-order', actionId: 'PA09' });
    expect(eng.completed()).toEqual([]);
    // Firing on the bronchus before the test ventilation (CONTEXT §6.4: firing without the test = error).
    playUntil('PA15');
    const f = play(m('x', 'stapler', 'bronchial', BR, UTIL, 'fire'));
    expect(f).toMatchObject({ type: 'error', error: 'wrong-order', actionId: 'PA16' });
    expect(eng.isDone('PA16')).toBe(false);
  });

  test('wrong target, wrong tool and unexpected are classified', () => {
    const { eng, play, playUntil } = setup();
    playUntil('PA04');
    expect(play(m('x', 'peanut', null, 'LN_11R', UTIL, 'dissect'))).toMatchObject({
      error: 'wrong-target',
      actionId: 'PA04',
    });
    expect(play(m('x', 'sponge', null, PLEURA, UTIL, 'dissect'))).toMatchObject({
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

  test('wrong port: table port and the stapler approach angle (v8 vein from the access incision)', () => {
    const { play, playUntil } = setup();
    playUntil('PA07');
    expect(play(m('x', 'peanut', null, VEIN, CAM, 'encircle'))).toMatchObject({
      error: 'wrong-port',
      actionId: 'PA07',
    });
    playUntil('PA09'); // the retraction moved to the access incision (PA08)
    // 2026-11-10: the vascular stapler articulates, so the access incision takes it too (no poor-angle).
    const e = play(m('x', 'stapler', 'vascular-curved', VEIN, UTIL, 'fire'));
    expect(e).toMatchObject({ type: 'action', actionId: 'PA09' });
  });

  test('accepted alternatives: PA09 by branch, PA18 by clips, PA04 with the peanut', () => {
    const { eng, play, playUntil } = setup();
    playUntil('PA04');
    expect(play(m('PA04', 'peanut', null, PLEURA, UTIL, 'dissect'))).toMatchObject({ alternative: 0 });
    playUntil('PA09');
    expect(play(m('PA09', 'stapler', 'vascular-curved', 'middle_lobe_vein_V4', UTIL, 'fire')).type).toBe(
      'progress',
    );
    const e = play(m('PA09', 'stapler', 'vascular-curved', 'middle_lobe_vein_V5', UTIL, 'fire'));
    expect(e).toMatchObject({ type: 'action', actionId: 'PA09', alternative: 0 });
    expect(eng.step).toBe(4);
    playUntil('PA18');
    play(m('PA18', 'clip', null, 'middle_lobe_artery_A4', UTIL, 'fire'));
    expect(play(m('PA18', 'clip', null, 'middle_lobe_artery_A5', UTIL, 'fire'))).toMatchObject({
      type: 'action',
      alternative: 2,
    });
  });

  test('hints list next available actions with short text and are logged', () => {
    const { eng, playUntil } = setup();
    const h = eng.hint();
    expect(h.map((x) => x.actionId)).toEqual(['PA01']);
    expect(h[0]?.text.length).toBeLessThanOrEqual(PRACTICE_CONFIG.hintMaxChars + 1);
    playUntil('PA26');
    const late = eng.hint().map((x) => x.actionId);
    expect(late[0]).toBe('PA26'); // required before optional
    expect(late).toContain('PA27');
    expect(eng.log.filter((e) => e.type === 'hint')).toHaveLength(2);
    eng.reset();
    expect(eng.log).toEqual([{ type: 'start', t: 0 }]);
    expect(eng.completed()).toEqual([]);
  });
});
