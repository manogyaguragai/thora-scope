import { describe, expect, it } from 'vitest';
import type { PracticeAttempt, PracticeEvent } from '../../src/sim/practice';
import { loadPracticeActions } from '../../src/sim/practiceActions';
import { SCORING_CONFIG, scoreRun, type ScoreInput } from '../../src/sim/scoring';

const ACTIONS = loadPracticeActions();
const REQUIRED = ACTIONS.filter((a) => !a.optional);

function doneLog(skip: readonly string[] = []): PracticeEvent[] {
  const log: PracticeEvent[] = [{ type: 'start', t: 0 }];
  REQUIRED.forEach((a, i) => {
    if (skip.includes(a.id)) return;
    log.push({ type: 'action', t: i, actionId: a.id, optional: false, alternative: null, result: a.result });
  });
  if (skip.length === 0) log.push({ type: 'finish', t: REQUIRED.length });
  return log;
}

const err = (
  error: Extract<PracticeEvent, { type: 'error' }>['error'],
  attempt: PracticeAttempt,
): PracticeEvent => ({
  type: 'error',
  t: 1,
  error,
  actionId: null,
  attempt,
});
const fireAt = (target: string): PracticeAttempt => ({
  tool: 'stapler',
  subOption: 'vascular-curved',
  target,
  port: 'port_camera_8ICS',
  kind: 'fire',
});

const run = (over: Partial<ScoreInput> = {}) =>
  scoreRun({
    log: doneLog(),
    actions: ACTIONS,
    swaps: SCORING_CONFIG.expectedSwaps,
    elapsedSec: 600,
    ...over,
  });
const item = (b: ReturnType<typeof scoreRun>, id: string) => b.items.find((i) => i.id === id);

describe('scoreRun', () => {
  it('weights sum to 100', () => {
    expect(Object.values(SCORING_CONFIG.weights).reduce((s, w) => s + w, 0)).toBe(100);
  });

  it('perfect run scores 100', () => {
    const b = run();
    expect(b.total).toBe(100);
    expect(b.finished).toBe(true);
    expect(b.requiredDone).toBe(REQUIRED.length);
    expect(b.bronchusTested).toBe(true);
    expect(b.upperLobeVeinPreserved).toBe(true);
    expect(b.items.every((i) => i.score === 1)).toBe(true);
  });

  it('wrong-order run counts errors and loses points', () => {
    const attempt = fireAt('middle_lobe_bronchus');
    const log = [
      ...doneLog(),
      err('wrong-order', attempt),
      err('wrong-order', attempt),
      err('poor-angle', attempt),
    ];
    const b = run({ log });
    expect(b.errors['wrong-order']).toBe(2);
    expect(b.errors['poor-angle']).toBe(1);
    expect(b.portAngleErrors).toBe(1);
    expect(item(b, 'errors')?.score).toBeCloseTo(1 - 2 * SCORING_CONFIG.perError);
    expect(item(b, 'portAngle')?.score).toBeCloseTo(1 - SCORING_CONFIG.perPortError);
    expect(b.total).toBeLessThan(100);
  });

  it('incomplete run without the bronchus test scores order by weight', () => {
    const b = run({ log: doneLog(['PA15', 'PA26']) });
    const w = (ids: string[]) => REQUIRED.filter((a) => ids.includes(a.id)).reduce((s, a) => s + a.weight, 0);
    const all = REQUIRED.reduce((s, a) => s + a.weight, 0);
    expect(b.finished).toBe(false);
    expect(b.bronchusTested).toBe(false);
    expect(item(b, 'order')?.score).toBeCloseTo((all - w(['PA15', 'PA26'])) / all);
  });

  it('stapling the upper lobe vein fails vein preservation', () => {
    const b = run({ log: [...doneLog(), err('wrong-target', fireAt(SCORING_CONFIG.upperLobeVein))] });
    expect(b.upperLobeVeinPreserved).toBe(false);
    expect(item(b, 'veinPreserved')?.points).toBe(0);
    expect(b.total).toBeLessThanOrEqual(100 - SCORING_CONFIG.weights.veinPreserved);
  });

  it('a complication on the upper lobe vein also fails it and costs complication points', () => {
    const complications = [
      { kind: 'bleeding', severity: 'major' as const, t: 3, structure: SCORING_CONFIG.upperLobeVein },
    ];
    const b = run({ complications });
    expect(b.upperLobeVeinPreserved).toBe(false);
    expect(item(b, 'complications')?.score).toBeCloseTo(1 - SCORING_CONFIG.severityPenalty.major);
  });

  it('counts retraction swaps; only extra ones cost points', () => {
    const extra = 2;
    const b = run({ swaps: SCORING_CONFIG.expectedSwaps + extra });
    expect(b.swaps).toBe(SCORING_CONFIG.expectedSwaps + extra);
    expect(item(b, 'swaps')?.score).toBeCloseTo(1 - extra * SCORING_CONFIG.perSwap);
  });

  it('end run at 0 actions scores < 20', () => {
    const b = run({ log: [{ type: 'start', t: 0 }], swaps: 0, elapsedSec: 5 });
    expect(b.requiredDone).toBe(0);
    expect(b.total).toBeLessThan(20);
  });

  it('partial runs increase monotonically with progress', () => {
    let prev = -1;
    for (let k = 0; k <= REQUIRED.length; k++) {
      const total = run({ log: doneLog(REQUIRED.slice(k).map((a) => a.id)) }).total;
      expect(total).toBeGreaterThanOrEqual(prev);
      prev = total;
    }
    expect(prev).toBe(100);
  });

  it('one injury logged as danger-hit + bleed counts once at its highest severity', () => {
    const s = 'tree_pulm_artery_main';
    const danger = { kind: 'danger', severity: 'major' as const, t: 5, structure: s };
    const complications = [
      danger,
      { kind: 'bleeding', severity: 'major' as const, t: 5, structure: s },
      { kind: 'injury', severity: 'minor' as const, t: 5, structure: s },
    ];
    const b = run({ complications });
    expect(b.complications).toHaveLength(1);
    expect(item(b, 'complications')?.score).toBeCloseTo(1 - SCORING_CONFIG.severityPenalty.major);
    // Separate injuries (other time or structure) still count separately.
    const later = { ...danger, t: 5 + SCORING_CONFIG.dedupeWindowSec + 1 };
    const other = { kind: 'injury', severity: 'minor' as const, t: 5, structure: 'other' };
    expect(run({ complications: [...complications, later, other] }).complications).toHaveLength(3);
  });

  it('time decays linearly past the target', () => {
    const { targetSec, maxSec } = SCORING_CONFIG;
    expect(item(run({ elapsedSec: (targetSec + maxSec) / 2 }), 'time')?.score).toBeCloseTo(0.5);
    expect(item(run({ elapsedSec: maxSec * 2 }), 'time')?.score).toBe(0);
  });
});
