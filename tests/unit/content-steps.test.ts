import { describe, expect, test } from 'vitest';
import procedure from '../../src/content/procedure_steps.json';
import { GUIDED_STEPS, MODEL_LIMITATIONS } from '../../src/content/steps';

const secs = (t: string): number => {
  const [m = NaN, s = NaN] = t.split(':').map(Number);
  return m * 60 + s;
};

describe('guided step content', () => {
  test('9 steps in order, matching procedure_steps.json', () => {
    expect(GUIDED_STEPS.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(GUIDED_STEPS.map((s) => s.step)).toEqual(procedure.steps.map((s) => s.step));
  });

  test.each(GUIDED_STEPS.map((s) => [s.step, s] as const))('step %i fields', (_, s) => {
    expect(s.title.length).toBeGreaterThan(0);
    expect(s.rail.length).toBeGreaterThan(0);
    expect(s.rail.length).toBeLessThanOrEqual(12); // one rail line
    expect(s.title.toLowerCase()).toContain(s.rail.toLowerCase()); // visible label inside the accessible name
    expect(s.caption.length).toBeGreaterThan(0);
    expect(s.portLabel.length).toBeGreaterThan(0);
    expect(s.points.length).toBeGreaterThanOrEqual(3);
    expect(s.points.length).toBeLessThanOrEqual(5);
    for (const p of s.points) expect(p.length).toBeLessThanOrEqual(160);
    expect(s.video.from).toMatch(/^\d:\d\d$/);
    expect(s.video.to).toMatch(/^\d:\d\d$/);
    expect(secs(s.video.from)).toBeLessThan(secs(s.video.to));
    expect(s.video.text.startsWith('In the reference video:')).toBe(true);
  });

  test('step 7 (fissures) notes the unmodelled tumour and margin', () => {
    const note = GUIDED_STEPS.find((s) => s.step === 7)?.note;
    expect(note).toMatch(/not modelled/i);
    expect(note).toMatch(/tumour/i);
  });

  test('model limitations listed', () => {
    expect(MODEL_LIMITATIONS.length).toBeGreaterThan(0);
  });
});
