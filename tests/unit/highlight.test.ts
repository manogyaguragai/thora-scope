import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Plane, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GlowFader, buildHighlight, distToPath, pulse, subjectKey } from '../../src/scene/highlight';
import { highlightConfig as C } from '../../src/scene/highlight.config';

describe('highlight fade + pulse (T861)', () => {
  it('pulse: cosine-eased 0 → 1 → 0 over the period', () => {
    expect(pulse(0)).toBeCloseTo(0, 6);
    expect(pulse(C.periodMs / 2)).toBeCloseTo(1, 6);
    expect(pulse(C.periodMs)).toBeCloseTo(0, 6);
    expect(pulse(C.periodMs / 4)).toBeCloseTo(0.5, 6);
  });

  it('fader: linear level over fadeMs, smoothstepped intensity × (base + amp × pulse)', () => {
    const f = new GlowFader();
    expect(f.intensity).toBe(0);
    f.fadeTo(1, 400);
    f.update(200);
    expect(f.level).toBeCloseTo(0.5, 6);
    expect(f.intensity).toBeCloseTo(0.5 * (C.base + C.amp * pulse(200)), 6);
    f.update(400);
    expect(f.level).toBe(1);
    f.restartPulse();
    f.update(C.periodMs / 2);
    expect(f.intensity).toBeCloseTo(C.base + C.amp, 6);
    f.fadeTo(0, 100);
    f.update(150);
    expect(f.level).toBe(0);
    expect(f.intensity).toBe(0);
    f.fadeTo(1, 0); // instant
    f.update(0);
    expect(f.level).toBe(1);
  });

  it('distance to the fissure path (polyline)', () => {
    const path = [new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(1, 1, 0)];
    expect(distToPath(new Vector3(0.5, 0.2, 0), path)).toBeCloseTo(0.2, 6);
    expect(distToPath(new Vector3(1.3, 0.5, 0), path)).toBeCloseTo(0.3, 6);
    expect(distToPath(new Vector3(-1, 0, 0), path)).toBeCloseTo(1, 6);
  });

  it('subject keys', () => {
    expect(subjectKey(['LN_11R', 'LN_12R'])).toBe('LN_11R,LN_12R');
    expect(subjectKey({ fissure: 'oblique' })).toBe('fissure:oblique');
  });
});

describe('highlight overlays (T861)', () => {
  const scene = () => {
    const model = new Group();
    const planes = [new Plane(new Vector3(0, 0, 1), 1)];
    const mk = (name: string, x: number): Mesh => {
      const m = new Mesh(
        new BoxGeometry(0.01, 0.01, 0.01),
        new MeshBasicMaterial({ clippingPlanes: planes }),
      );
      m.name = name;
      m.position.x = x;
      model.add(m);
      return m;
    };
    const a = mk('LN_11R', 0);
    mk('LN_12R', 0.02);
    return { model, a, planes };
  };

  it('one rim + outline per mesh sharing geometry, morph influences and clipping array; show / switch / hide', () => {
    const { model, a, planes } = scene();
    a.morphTargetInfluences = [0];
    const hl = buildHighlight(model, []);
    const over = hl.group.children.filter((o) => o.name.startsWith('LN_11R:')) as Mesh[];
    expect(over.length).toBe(2);
    for (const o of over) {
      expect(o.geometry).toBe(a.geometry);
      expect(o.morphTargetInfluences).toBe(a.morphTargetInfluences);
      expect((o.material as MeshBasicMaterial).clippingPlanes).toBe(planes);
      expect(o.visible).toBe(false);
    }
    model.updateMatrixWorld(true);
    let now = 1;
    const run = (ms: number): void => {
      for (let t = 0; t < ms; t += 50) hl.update((now += 50));
    };
    hl.show(['LN_11R'], 200);
    run(100);
    expect(hl.active).toBe('LN_11R');
    expect(over.every((o) => o.visible)).toBe(true);
    expect(over[0]?.matrixWorld.elements).toEqual(a.matrixWorld.elements);
    hl.show(['LN_12R'], 200); // switch: 11R fades out first, then 12R in
    run(150);
    expect(hl.active).toBe('LN_12R');
    expect(over.every((o) => !o.visible)).toBe(true);
    a.visible = false;
    hl.show(['LN_11R'], 0);
    run(300);
    expect(over.every((o) => !o.visible)).toBe(true); // hidden structures don't glow
    hl.hide(100);
    run(200);
    expect(hl.active).toBeNull();
  });
});
