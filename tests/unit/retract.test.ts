import { BoxGeometry, Group, Mesh, MeshStandardMaterial, ShaderLib, Vector3 } from 'three';
import type { MeshPhysicalMaterial, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { applyMaterials, graspUniforms, type GraspUniforms } from '../../src/scene/materials';
import { RETRACT_CONFIG as C, RETRACT_KEYS, Retract } from '../../src/sim/actions/retract';
import { retractionConfig } from '../../src/sim/retraction.config';
import { createState, tweenTo, type AppState } from '../../src/sim/state';

const P = new Vector3(0.01, 0.02, 0.03);
const fresh = (): GraspUniforms => ({
  uGraspPoint: { value: new Vector3() },
  uGraspOffset: { value: new Vector3() },
  uGraspRadius: { value: 0 },
});
function collapsed(): AppState {
  const s = createState();
  s.deflate_RUL = s.deflate_RML = s.deflate_RLL = 1;
  return s;
}
const pxFor = (v: number): number => v / C.dragPerPx;

// Default view: screen right = world +X, screen up = world +Y. Fallback directions (retraction.config) for the
// upper lobe: retract_hilum lifts (+Y, back), retract_fissure runs to the head (+X); lower lobe fissure to −X.
const RUL = 'lung_upper_lobe_right';
const RLL = 'lung_lower_lobe_right';
const RML = 'lung_middle_lobe_right';
const keys = (s: AppState): number[] => RETRACT_KEYS.map((k) => s[k]);

describe('retract: any-direction blend', () => {
  it('needs a graspable, collapsed lobe', () => {
    const r = new Retract(createState(), fresh());
    expect(r.grasp(RUL, P)).toBe('not-collapsed');
    expect(new Retract(collapsed(), fresh()).grasp('azygos_vein', P)).toBe('no-target');
    expect(RETRACT_KEYS).toEqual(['retract_hilum', 'retract_RML_lateral', 'retract_fissure']);
  });

  it('each drag direction blends the keys differently; clamped 0..1', () => {
    const s = collapsed();
    const u = fresh();
    const r = new Retract(s, u);
    expect(u.uGraspRadius.value).toBe(C.pull.radius);
    expect(r.grasp(RUL, P)).toBe('ok');
    expect(r.key).toBe('retract_hilum'); // the strongest key for this lobe
    expect(u.uGraspPoint.value.equals(P)).toBe(true);
    r.drag(0, -pxFor(0.4)); // up: lifted
    expect(s.retract_hilum).toBeCloseTo(0.4);
    expect(s.retract_fissure).toBe(0);
    const up = keys(s);
    r.drag(pxFor(0.5), 0); // right: towards the head = fissure opens
    expect(s.retract_fissure).toBeGreaterThan(0.3);
    expect(s.retract_hilum).toBeCloseTo(0.4);
    const right = keys(s);
    r.drag(0, pxFor(5)); // down: lifted back to 0 (clamped)
    expect(s.retract_hilum).toBe(0);
    r.drag(-pxFor(5), 0); // left: fissure back to 0
    expect(s.retract_fissure).toBe(0);
    r.drag(0, -pxFor(5));
    expect(s.retract_hilum).toBe(1);
    expect(new Set([up, right, keys(s)].map(String)).size).toBe(3);
    expect(r.release()).toBeGreaterThanOrEqual(0); // the grip stays on (no spring-back by default)
    expect(s.retract_hilum).toBe(1);
  });

  it('two grasps add up (upper lobe to the head + lower lobe to the feet), each lets go on its own', () => {
    const s = collapsed();
    const r = new Retract(s, fresh());
    r.grasp(RUL, P);
    r.drag(pxFor(0.3), 0);
    const a = r.release(true);
    const one = s.retract_fissure;
    expect(one).toBeGreaterThan(0.2);
    r.grasp(RLL, P);
    r.drag(-pxFor(0.3), 0);
    const b = r.release(true);
    expect(s.retract_fissure).toBeGreaterThan(one + 0.2);
    r.letGo(b);
    r.update(retractionConfig.releaseMs / 4);
    expect(s.retract_fissure).toBeLessThan(one + 0.2);
    r.update(retractionConfig.releaseMs * 2);
    expect(s.retract_fissure).toBeCloseTo(one);
    expect(r.engagedSlot(a)).toBe(true);
    expect(r.engagedSlot(b)).toBe(false);
    r.letGoAll();
    r.update(retractionConfig.releaseMs * 2);
    expect(s.retract_fissure).toBe(0);
  });

  it('measured directions (setDirs) replace the fallback; the middle lobe drives its own key', () => {
    const s = collapsed();
    const r = new Retract(s, fresh());
    r.setDirs('RML', [new Vector3(0, 0.2, 0), new Vector3(1, 0, 0), new Vector3()]);
    r.grasp(RML, P);
    expect(r.key).toBe('retract_RML_lateral');
    r.drag(pxFor(0.5), 0);
    expect(s.retract_RML_lateral).toBeCloseTo(0.5);
    expect(s.retract_hilum).toBe(0); // its image is vertical: a sideways drag leaves it
    r.drag(0, -pxFor(0.5));
    expect(s.retract_hilum).toBeCloseTo(0.1);
  });

  it('cancels a running tween on a driven key; reset drops grasps without writing', () => {
    const s = collapsed();
    tweenTo(s, 'retract_hilum', 1, 1000);
    const r = new Retract(s, fresh());
    r.grasp(RUL, P);
    r.drag(0, -pxFor(0.2));
    expect(s.tweens.retract_hilum.active).toBe(false);
    const v = s.retract_hilum;
    r.reset();
    r.update(10_000);
    expect(s.retract_hilum).toBe(v);
  });

  it('spring-back lets go on release unless held', () => {
    const s = collapsed();
    const r = new Retract(s, fresh(), true);
    r.grasp(RUL, P);
    r.drag(0, -pxFor(0.6));
    expect(r.release()).toBe(-1);
    r.update(retractionConfig.releaseMs / 2);
    expect(s.retract_hilum).toBeCloseTo(0.1);
    r.update(10_000);
    expect(s.retract_hilum).toBe(0);
    r.grasp(RUL, P);
    r.drag(0, -pxFor(0.6));
    expect(r.release(true)).toBeGreaterThanOrEqual(0);
    r.update(10_000);
    expect(s.retract_hilum).toBeCloseTo(0.6);
  });
});

describe('retract: grasp-and-pull offset', () => {
  it('follows the view axes, capped at pull.max, relaxes to 0 after release', () => {
    const u = fresh();
    const r = new Retract(collapsed(), u);
    r.grasp('lung_upper_lobe_right', P);
    r.drag(10, 0);
    expect(u.uGraspOffset.value.x).toBeCloseTo(10 * C.pull.perPx);
    r.drag(0, -10); // screen up → +viewUp
    expect(u.uGraspOffset.value.y).toBeCloseTo(10 * C.pull.perPx);
    r.drag(1e6, 0);
    expect(u.uGraspOffset.value.length()).toBeCloseTo(C.pull.max);
    r.update(1000); // still grasped: no relax
    expect(u.uGraspOffset.value.length()).toBeCloseTo(C.pull.max);
    r.release();
    r.update(100);
    expect(u.uGraspOffset.value.length()).toBeCloseTo(C.pull.max * Math.exp(-C.pull.relaxPerSec * 0.1));
    r.update(10_000);
    expect(u.uGraspOffset.value.lengthSq()).toBe(0);
  });

  it('uniforms are in the shared tissue patch from load (vertex offset, constant cache key)', () => {
    const root = new Group();
    const a = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    a.name = 'lung_middle_lobe_right';
    const b = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    b.name = 'aorta';
    root.add(a, b);
    applyMaterials(root);
    const keys = new Set<string>();
    for (const m of [a.material, b.material] as MeshPhysicalMaterial[]) {
      const shader = {
        uniforms: {},
        vertexShader: ShaderLib.physical.vertexShader,
        fragmentShader: ShaderLib.physical.fragmentShader,
      } as unknown as WebGLProgramParametersWithUniforms;
      m.onBeforeCompile(shader, {} as WebGLRenderer);
      expect(shader.uniforms.uGraspOffset).toBe(graspUniforms.uGraspOffset);
      expect(shader.uniforms.uGraspPoint).toBe(graspUniforms.uGraspPoint);
      expect(shader.vertexShader).toContain('uniform vec3 uGraspOffset;');
      expect(shader.vertexShader).toContain('uGraspOffset * graspK');
      expect(shader.vertexShader).toContain('#include <project_vertex>');
      keys.add(m.customProgramCacheKey());
    }
    expect(keys.size).toBe(1);
  }, 20_000); // applyMaterials builds the noise texture (slow under parallel load)
});
