import { describe, expect, it } from 'vitest';
import { DISSECT_CONFIG as C, Dissect } from '../../src/sim/actions/dissect';

function make(): { d: Dissect; log: string[]; fades: number[] } {
  const log: string[] = [];
  const fades: number[] = [];
  const d = new Dissect({
    setFade: (n, f) => {
      fades.push(f);
      log.push(`fade:${n}`);
    },
    swapToWindow: (n, w) => log.push(`swap:${n}>${w}`),
    clearView: () => log.push('clear'),
  });
  return { d, log, fades };
}
const msToFinish = (tool: 'peanut' | 'cautery'): number => 1000 / C.ratePerSec[tool];

describe('dissect', () => {
  it('rejects tools/targets that cannot dissect', () => {
    const { d } = make();
    expect(d.begin('azygos_vein', 'peanut')).toBe(false);
    expect(d.begin('phrenic_nerve_right', 'cautery')).toBe(false); // peanut only
    expect(d.begin('phrenic_nerve_right', 'peanut')).toBe(true);
  });

  it('peanut hold builds progress, fades, swaps to the _window variant once at 1', () => {
    const { d, log, fades } = make();
    expect(d.begin('mediastinal_fat', 'peanut')).toBe(true);
    expect(d.update(msToFinish('peanut') / 2)).toBeNull();
    expect(d.progress('mediastinal_fat')).toBeCloseTo(0.5);
    expect(fades.at(-1)).toBeCloseTo(1 - (1 - C.fadeTo) * 0.5);
    d.end(); // progress kept
    expect(d.update(1000)).toBeNull();
    d.begin('mediastinal_fat', 'peanut');
    expect(d.update(msToFinish('peanut'))).toBe('mediastinal_fat');
    expect(d.progress('mediastinal_fat')).toBe(1);
    expect(fades.at(-1)).toBe(1);
    expect(log.filter((l) => l.startsWith('swap'))).toEqual(['swap:mediastinal_fat>mediastinal_fat_window']);
    expect(d.target).toBeNull();
    expect(d.update(100)).toBeNull();
  });

  it('re-dissecting via the window mesh restarts progress without fading or swapping again', () => {
    const { d, log } = make();
    d.begin('hilar_connective_tissue', 'peanut');
    d.update(msToFinish('peanut'));
    log.length = 0;
    expect(d.begin('hilar_connective_tissue_window', 'peanut')).toBe(true);
    expect(d.progress('hilar_connective_tissue')).toBe(0);
    expect(d.update(msToFinish('peanut'))).toBe('hilar_connective_tissue');
    expect(log).toEqual([]);
  });

  it('cautery is faster; fissure pleura has no window to fade; sucker clears', () => {
    const { d, log } = make();
    expect(C.ratePerSec.cautery).toBeGreaterThan(C.ratePerSec.peanut);
    expect(d.begin('lung_middle_lobe_right', 'cautery')).toBe(true); // fissure pleura: no window, no fade
    d.update(100);
    expect(log.some((l) => l.startsWith('fade'))).toBe(false);
    d.suction();
    expect(log.at(-1)).toBe('clear');
  });

  it('reset clears progress and window state', () => {
    const { d, log } = make();
    d.begin('mediastinal_fat', 'peanut');
    d.update(msToFinish('peanut'));
    d.reset();
    expect(d.progress('mediastinal_fat')).toBe(0);
    log.length = 0;
    d.begin('mediastinal_fat', 'peanut');
    d.update(msToFinish('peanut'));
    expect(log.filter((l) => l.startsWith('swap'))).toHaveLength(1);
  });
});
