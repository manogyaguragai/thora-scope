import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/core/config';
import { loadPracticeActions } from '../../src/sim/practiceActions';
import { bandIndices, dotPoints, splitPath, tracePath } from '../../src/scene/fissureGuide';
import { fissureGuideConfig as C, FISSURE_SEGMENTS } from '../../src/scene/fissureGuide.config';

/** Grid of points on the y = `y` plane, x ∈ [0, 1], z ∈ [0, 0.2], `n`×`m` samples. */
function sheet(y: number, n = 21, m = 5): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out.push(i / (n - 1), y, (0.2 * j) / (m - 1));
  return out;
}
const vecs = (a: number[]): Vector3[] =>
  Array.from({ length: a.length / 3 }, (_, i) => new Vector3(a[3 * i], a[3 * i + 1], a[3 * i + 2]));

describe('fissure guide segmentation (T851)', () => {
  it('band = points within the distance of the neighbour, none when apart', () => {
    const lobe = sheet(0);
    expect(bandIndices(lobe, sheet(0.003), 0.004)).toHaveLength(lobe.length / 3);
    expect(bandIndices(lobe, sheet(0.01), 0.004)).toEqual([]);
    // Neighbour only over half the sheet: only that half is in the band.
    const half = sheet(0.002).filter((_, k, a) => (a[k - (k % 3)] as number) <= 0.5);
    const band = bandIndices(lobe, half, 0.004);
    expect(band.length).toBeGreaterThan(0);
    for (const i of band) expect(lobe[3 * i] as number).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('path runs along the long axis on the edge nearest the eye', () => {
    const path = tracePath(vecs(sheet(0)), new Vector3(0.5, 0, 5), 10);
    expect(path).toHaveLength(10);
    const xs = path.map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(0.15);
    expect(Math.max(...xs)).toBeGreaterThan(0.85);
    for (const p of path) expect(p.z).toBeCloseTo(0.2); // the edge facing the eye
    expect(tracePath([], new Vector3(), 10)).toEqual([]);
  });

  it('splits into equal-length segments that chain end to end; dots stay inside each', () => {
    const path = [new Vector3(0, 0, 0), new Vector3(0.3, 0, 0), new Vector3(1, 0, 0)];
    const segs = splitPath(path, 4);
    expect(segs).toHaveLength(4);
    for (const [i, s] of segs.entries()) {
      expect(s.length).toBeCloseTo(0.25);
      expect(s.mid.x).toBeCloseTo(0.125 + 0.25 * i);
      expect(s.dir.x).toBeCloseTo(1);
      const next = segs[i + 1];
      if (next) expect(s.points.at(-1)?.distanceTo(next.points[0] as Vector3)).toBeCloseTo(0);
      const dots = dotPoints(s, 0.02, 0.01);
      expect(dots.length).toBeGreaterThan(8);
      for (const d of dots) {
        expect(d.x).toBeGreaterThanOrEqual(0.25 * i + 0.01 - 1e-9);
        expect(d.x).toBeLessThanOrEqual(0.25 * (i + 1) - 0.01 + 1e-9);
      }
    }
    expect(splitPath([new Vector3()], 3)).toEqual([]);
  });

  it('segments = finish fires = step-7 stapler fire actions in practice', () => {
    expect(config.finish.fissureFiresRequired).toBe(FISSURE_SEGMENTS);
    const fires = loadPracticeActions().filter(
      (a) => a.step === C.step && a.action === 'fire' && a.targets.includes(C.lobe) && !a.optional,
    );
    expect(fires).toHaveLength(FISSURE_SEGMENTS);
    expect(fires.at(-1)?.result.flags).toContain('lobe_free');
  });
});
