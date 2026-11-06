import { describe, expect, test } from 'vitest';
import raw from '../../src/content/practice_actions.json';
import { ANATOMY, structuresWhere } from '../../src/content/anatomy';
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
    // T851: PA29/PA30 (extra fissure-segment fires) sit in table order inside step 7, so ids are a set, not a run.
    expect(acts.map((a) => a.id).sort()).toEqual(
      Array.from({ length: 30 }, (_, i) => `PA${String(i + 1).padStart(2, '0')}`),
    );
    expect(new Set(acts.map((a) => a.step))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  });

  test('ADR-005 order: vein → bronchus (after ventilation test) → arteries → fissure', () => {
    const acts = loadPracticeActions();
    const idx = (id: string): number => acts.findIndex((a) => a.id === id);
    const fire = (t: string): number => acts.findIndex((a) => a.action === 'fire' && a.targets.includes(t));
    expect(fire('middle_lobe_vein')).toBeLessThan(fire('middle_lobe_bronchus'));
    expect(fire('middle_lobe_bronchus')).toBeLessThan(fire('middle_lobe_artery'));
    expect(fire('middle_lobe_artery')).toBeLessThan(fire('lung_middle_lobe_right'));
    expect(acts[fire('middle_lobe_bronchus')]?.prerequisites).toContain('PA15');
    expect(idx('PA17')).toBeGreaterThan(idx('PA16'));
  });

  test('manifest-driven: divides = divideStep groups, dissections = dissectable layers in their step, nodes cleared', () => {
    const acts = loadPracticeActions();
    for (const step of [3, 5, 6]) {
      const divided = acts.filter((a) => a.result.divide).find((a) => a.step === step)?.result.divide;
      expect([...(divided ?? [])].sort(), `step ${step}`).toEqual(
        structuresWhere((s) => s.divideStep === step).sort(),
      );
    }
    for (const layer of structuresWhere((s) => s.dissectable === true && s.dissectStep !== undefined)) {
      const a = acts.find((x) => x.action === 'dissect' && x.targets.includes(layer));
      expect(a?.step, layer).toBe(ANATOMY.structures[layer]?.dissectStep);
    }
    const cleared = acts.filter((a) => a.action === 'remove-node' && !a.optional).flatMap((a) => a.targets);
    expect(cleared.sort()).toEqual(structuresWhere((s) => s.clearStep !== undefined).sort());
  });

  test('rejects duplicate ids, unknown target/tool/sub-option/port', () => {
    const d = copy();
    at(d, 'PA02').id = 'PA01';
    at(d, 'PA04').targets = ['not_a_node'];
    at(d, 'PA05').tool = 'scalpel';
    at(d, 'PA09').subOption = 'bronchial';
    at(d, 'PA13').port = { preferred: 'port_nowhere', allowed: ['port_nowhere'] };
    const e = practiceActionErrors(d).join('\n');
    expect(e).toMatch(/PA01: duplicate id/);
    expect(e).toMatch(/unknown target "not_a_node"/);
    expect(e).toMatch(/unknown tool "scalpel"/);
    expect(e).toMatch(/PA09: stapler\/bronchial not accepted on target "middle_lobe_vein"/);
    expect(e).toMatch(/PA13: port needs/);
    expect(() => loadPracticeActions(d)).toThrow(/invalid/);
  });

  test('rejects prerequisite cycles and dangling prerequisites', () => {
    const d = copy();
    at(d, 'PA01').prerequisites = ['PA03'];
    at(d, 'PA05').prerequisites = ['PA100'];
    const e = practiceActionErrors(d).join('\n');
    expect(e).toMatch(/prerequisite cycle: .*PA01/);
    expect(e).toMatch(/PA05: unknown prerequisite "PA100"/);
  });

  test('rejects bad result state and schema types', () => {
    const d = copy();
    at(d, 'PA03').result = { state: { retract_hilum: 2 } };
    at(d, 'PA06').video = '1 minute';
    at(d, 'PA07').weight = -1;
    at(d, 'PA10').step = 10;
    const e = practiceActionErrors(d).join('\n');
    expect(e).toMatch(/PA03.result.state: bad state retract_hilum=2/);
    expect(e).toMatch(/PA06: video/);
    expect(e).toMatch(/PA07: weight/);
    expect(e).toMatch(/PA10: step/);
    expect(practiceActionErrors({})).toEqual(['actions must be a non-empty array']);
  });
});
