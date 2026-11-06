import { describe, expect, it } from 'vitest';
import { DISSECT_LAYERS } from '../../src/content/targets';
import { DISSECT_CONFIG as C, Dissect } from '../../src/sim/actions/dissect';

const PLEURA = 'mediastinal_pleura_hilum';
const STRANDS = 'hilar_connective_tissue';

function make(): { d: Dissect; log: string[] } {
  const log: string[] = [];
  const d = new Dissect({ clearView: () => log.push('clear') });
  return { d, log };
}
const msToFinish = (tool: 'peanut' | 'cautery'): number => 1000 / C.ratePerSec[tool];

describe('dissect', () => {
  it('the manifest dissectable layers are the v7 pleura + connective strands', () => {
    expect([...DISSECT_LAYERS].sort()).toEqual([STRANDS, PLEURA].sort());
  });

  it('rejects tools/targets that cannot dissect', () => {
    const { d } = make();
    expect(d.begin('azygos_vein', 'peanut')).toBe(false);
    expect(d.begin('phrenic_nerve_right', 'cautery')).toBe(false); // peanut only
    expect(d.begin('phrenic_nerve_right', 'peanut')).toBe(true);
    expect(d.isLayer('phrenic_nerve_right')).toBe(false);
    expect(d.isLayer(PLEURA)).toBe(true);
  });

  it('progress builds while held, is kept on release, reports completion once', () => {
    const { d } = make();
    expect(d.begin(PLEURA, 'cautery')).toBe(true);
    expect(d.update(msToFinish('cautery') / 2)).toBeNull();
    expect(d.progress(PLEURA)).toBeCloseTo(0.5);
    d.end(); // progress kept
    expect(d.update(1000)).toBeNull();
    d.begin(PLEURA, 'cautery');
    expect(d.update(msToFinish('cautery'))).toBe(PLEURA);
    expect(d.progress(PLEURA)).toBe(1);
    expect(d.target).toBeNull();
    expect(d.lastTool).toBe('cautery');
    expect(d.update(100)).toBeNull();
    // A completed target restarts from 0.
    d.begin(PLEURA, 'peanut');
    expect(d.progress(PLEURA)).toBe(0);
  });

  it('cancel (gate refused) restarts progress; reset clears all; sucker clears the view', () => {
    const { d, log } = make();
    expect(C.ratePerSec.cautery).toBeGreaterThan(C.ratePerSec.peanut);
    d.begin(STRANDS, 'peanut');
    d.update(msToFinish('peanut'));
    d.cancel(STRANDS);
    expect(d.progress(STRANDS)).toBe(0);
    d.begin(PLEURA, 'peanut');
    d.update(msToFinish('peanut') / 2);
    d.reset();
    expect(d.progress(PLEURA)).toBe(0);
    expect(d.target).toBeNull();
    d.suction();
    expect(log).toEqual(['clear']);
  });
});
