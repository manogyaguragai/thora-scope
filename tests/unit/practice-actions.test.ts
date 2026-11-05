import { describe, expect, test } from 'vitest';
import raw from '../../src/content/practice_actions.json';
import { loadPracticeActions, practiceActionErrors } from '../../src/sim/practiceActions';

type Mut = { actions: Record<string, unknown>[] };
const copy = (): Mut => structuredClone(raw) as unknown as Mut;
const at = (d: Mut, id: string): Record<string, unknown> => {
  const a = d.actions.find((x) => x.id === id);
  if (!a) throw new Error(id);
  return a;
};

describe('practice_actions.json', () => {
  test('shipped table is valid (schema, DAG, known targets/tools/ports)', () => {
    expect(practiceActionErrors(raw)).toEqual([]);
    const acts = loadPracticeActions();
    expect(acts.map((a) => a.id)).toEqual(
      Array.from({ length: 32 }, (_, i) => `PA${String(i + 1).padStart(2, '0')}`),
    );
    expect(new Set(acts.map((a) => a.step))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
  });

  test('ADR-005 order: vein → bronchus (after ventilation test) → arteries → fissure', () => {
    const acts = loadPracticeActions();
    const idx = (id: string): number => acts.findIndex((a) => a.id === id);
    const fire = (t: string): number => acts.findIndex((a) => a.action === 'fire' && a.targets.includes(t));
    expect(fire('V_RML_common')).toBeLessThan(fire('B_RML_common'));
    expect(fire('B_RML_common')).toBeLessThan(fire('A_RML_common'));
    expect(fire('A_RML_common')).toBeLessThan(fire('lung_middle_lobe_right'));
    expect(acts[fire('B_RML_common')]?.prerequisites).toContain('PA18');
    expect(idx('PA16')).toBeGreaterThan(idx('PA15'));
  });

  test('rejects duplicate ids, unknown target/tool/sub-option/port', () => {
    const d = copy();
    at(d, 'PA02').id = 'PA01';
    at(d, 'PA04').targets = ['not_a_node'];
    at(d, 'PA05').tool = 'scalpel';
    at(d, 'PA10').subOption = 'bronchial';
    at(d, 'PA12').port = { preferred: 'port_nowhere', allowed: ['port_nowhere'] };
    const e = practiceActionErrors(d).join('\n');
    expect(e).toMatch(/PA01: duplicate id/);
    expect(e).toMatch(/unknown target "not_a_node"/);
    expect(e).toMatch(/unknown tool "scalpel"/);
    expect(e).toMatch(/PA10: stapler\/bronchial not accepted on target "V_RML_common"/);
    expect(e).toMatch(/PA12: port needs/);
    expect(() => loadPracticeActions(d)).toThrow(/invalid/);
  });

  test('rejects prerequisite cycles and dangling prerequisites', () => {
    const d = copy();
    at(d, 'PA01').prerequisites = ['PA03'];
    at(d, 'PA05').prerequisites = ['PA99'];
    const e = practiceActionErrors(d).join('\n');
    expect(e).toMatch(/prerequisite cycle: .*PA01/);
    expect(e).toMatch(/PA05: unknown prerequisite "PA99"/);
  });

  test('rejects bad result state and schema types', () => {
    const d = copy();
    at(d, 'PA03').result = { state: { retract_posterior: 2 } };
    at(d, 'PA06').video = '1 minute';
    at(d, 'PA07').weight = -1;
    at(d, 'PA08').step = 9;
    const e = practiceActionErrors(d).join('\n');
    expect(e).toMatch(/PA03.result.state: bad state retract_posterior=2/);
    expect(e).toMatch(/PA06: video/);
    expect(e).toMatch(/PA07: weight/);
    expect(e).toMatch(/PA08: step/);
    expect(practiceActionErrors({})).toEqual(['actions must be a non-empty array']);
  });
});
