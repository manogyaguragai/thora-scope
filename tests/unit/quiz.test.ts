import { describe, expect, it } from 'vitest';
import { IDENTIFY_ITEMS, NEXT_STEP_ITEMS } from '../../src/content/quiz';
import {
  ALL_ITEMS,
  answer,
  checkAnswer,
  createSession,
  currentItem,
  isFinished,
  mulberry32,
  reviewList,
  score,
  shuffle,
  type QuizItem,
} from '../../src/sim/quiz';

const key = (q: QuizItem): string => (q.kind === 'identify' ? q.item.node : q.item.situation);
const order = (seed: number): string[] => createSession(seed).items.map(key);

/** Answer the current item right or wrong. */
function respond(s: ReturnType<typeof createSession>, right: boolean): void {
  const q = currentItem(s);
  if (!q) throw new Error('finished');
  if (q.kind === 'identify') answer(s, right ? q.item.node : 'not_a_node');
  else answer(s, right ? q.item.correctIndex : (q.item.correctIndex + 1) % q.item.options.length);
}

describe('quiz engine', () => {
  it('shuffles deterministically by seed and keeps every item', () => {
    expect(order(42)).toEqual(order(42));
    expect(order(42)).not.toEqual(order(43));
    expect([...order(7)].sort()).toEqual(ALL_ITEMS.map(key).sort());
    expect(ALL_ITEMS.length).toBe(IDENTIFY_ITEMS.length + NEXT_STEP_ITEMS.length);
    const src = [1, 2, 3, 4, 5];
    shuffle(src, mulberry32(1));
    expect(src).toEqual([1, 2, 3, 4, 5]);
  });

  it('mixes both item kinds and honours count', () => {
    const kinds = new Set(createSession(3).items.map((q) => q.kind));
    expect(kinds).toEqual(new Set(['identify', 'nextStep']));
    expect(createSession(3, 5).items).toHaveLength(5);
  });

  it('accepts merged-mesh suffixes and listed alternatives for identify items', () => {
    const vein = ALL_ITEMS.find((q) => q.kind === 'identify' && q.item.node === 'V_RML_common');
    if (!vein) throw new Error('missing item');
    expect(checkAnswer(vein, 'V_RML_common')).toBe(true);
    expect(checkAnswer(vein, 'V4_lateral.001')).toBe(true);
    expect(checkAnswer(vein, 'A_RML_common')).toBe(false);
    expect(checkAnswer(vein, 0)).toBe(false);
  });

  it('checks next-step answers by index', () => {
    const q = ALL_ITEMS.find((i) => i.kind === 'nextStep');
    if (!q || q.kind !== 'nextStep') throw new Error('missing item');
    expect(checkAnswer(q, q.item.correctIndex)).toBe(true);
    expect(checkAnswer(q, q.item.correctIndex + 1)).toBe(false);
  });

  it('scores, advances and lists misses in answer order', () => {
    const s = createSession(11, 6);
    const pattern = [true, false, true, false, false, true];
    for (const right of pattern) respond(s, right);
    expect(isFinished(s)).toBe(true);
    expect(answer(s, 0)).toBeNull();
    expect(score(s)).toEqual({ correct: 3, answered: 6, total: 6 });
    const misses = reviewList(s);
    expect(misses.map((m) => key(m.item))).toEqual([1, 3, 4].map((i) => key(s.items[i] as QuizItem)));
    expect(misses.every((m) => !m.correct)).toBe(true);
  });

  it('shuffles next-step options per item, remapping correctIndex', () => {
    const steps = createSession(42).items.flatMap((q) => (q.kind === 'nextStep' ? [q] : []));
    expect(steps).toHaveLength(NEXT_STEP_ITEMS.length);
    expect(new Set(steps.map((q) => q.item.correctIndex)).size).toBeGreaterThan(1);
    for (const q of steps) {
      const src = NEXT_STEP_ITEMS.find((i) => i.situation === q.item.situation);
      if (!src) throw new Error('missing item');
      expect([...q.item.options].sort()).toEqual([...src.options].sort());
      expect(q.item.options[q.item.correctIndex]).toBe(src.options[src.correctIndex]);
      expect(checkAnswer(q, q.item.correctIndex)).toBe(true);
    }
    const again = createSession(42).items.flatMap((q) => (q.kind === 'nextStep' ? [q.item.options] : []));
    expect(again).toEqual(steps.map((q) => q.item.options));
  });

  it('counts a skip (empty answer) as a miss', () => {
    const s = createSession(5, 1);
    expect(answer(s, '')?.correct).toBe(false);
    expect(reviewList(s)).toHaveLength(1);
  });
});
