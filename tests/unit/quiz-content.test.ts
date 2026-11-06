import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { STRUCTURE_LABELS } from '../../src/content/labels';
import raw from '../../src/content/practice_actions.json';
import { IDENTIFY_ITEMS, NEXT_STEP_ITEMS, isAccepted } from '../../src/content/quiz';

const actionIds = new Set(raw.actions.map((a) => a.id));
const RUN = 8;
const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const runs = (s: string): Set<string> => {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + RUN <= w.length; i++) out.add(w.slice(i, i + RUN).join(' '));
  return out;
};

describe('quiz content', () => {
  test('counts', () => {
    expect(IDENTIFY_ITEMS.length).toBeGreaterThanOrEqual(15);
    expect(NEXT_STEP_ITEMS.length).toBeGreaterThanOrEqual(10);
  });

  test.each(IDENTIFY_ITEMS.map((i) => [i.node, i] as const))('identify %s', (_, item) => {
    expect(STRUCTURE_LABELS[item.node]).toBeDefined();
    expect(item.accept).toContain(item.node);
    for (const n of item.accept) expect(STRUCTURE_LABELS[n], n).toBeDefined();
    expect(item.prompt.length).toBeGreaterThan(0);
  });

  test('identify nodes are unique', () => {
    expect(new Set(IDENTIFY_ITEMS.map((i) => i.node)).size).toBe(IDENTIFY_ITEMS.length);
  });

  test.each(NEXT_STEP_ITEMS.map((q, i) => [i, q] as const))('next-step %i', (_, q) => {
    expect(q.options.length).toBeGreaterThanOrEqual(3);
    expect(q.options.length).toBeLessThanOrEqual(4);
    expect(Number.isInteger(q.correctIndex)).toBe(true);
    expect(q.options[q.correctIndex]).toBeDefined();
    expect(new Set(q.options).size).toBe(q.options.length);
    expect(q.rationale.length).toBeGreaterThan(0);
    if (q.practiceActionId !== undefined) expect(actionIds.has(q.practiceActionId)).toBe(true);
  });

  test('next-step items follow practice order', () => {
    const ids = NEXT_STEP_ITEMS.flatMap((q) => (q.practiceActionId ? [q.practiceActionId] : []));
    expect(ids).toEqual([...ids].sort());
  });

  test('merged mesh names are accepted', () => {
    const item = IDENTIFY_ITEMS.find((i) => i.node === 'middle_lobe_vein');
    expect(item && isAccepted(item, 'middle_lobe_vein_V4.001')).toBe(true);
    expect(item && isAccepted(item, 'middle_lobe_bronchus')).toBe(false);
  });

  test(`no ${RUN}-word runs copied from source notes`, () => {
    const src = ['docs/BOOK_NOTES.md', 'docs/VIDEO_STEP_MAP.md'].map((f) => runs(readFileSync(f, 'utf8')));
    const texts = [
      ...IDENTIFY_ITEMS.map((i) => i.prompt),
      ...NEXT_STEP_ITEMS.flatMap((q) => [q.situation, q.rationale, ...q.options]),
    ];
    const copied = texts.flatMap((t) => [...runs(t)].filter((r) => src.some((s) => s.has(r))));
    expect(copied).toEqual([]);
  });
});
