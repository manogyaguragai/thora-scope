import { BoxGeometry, Group, Mesh, MeshStandardMaterial, ShaderLib, Vector3 } from 'three';
import type { MeshPhysicalMaterial, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { applyMaterials, graspUniforms, type GraspUniforms } from '../../src/scene/materials';
import { RETRACT_CONFIG as C, Retract } from '../../src/sim/actions/retract';
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

describe('retract: drag → morph', () => {
  it('needs a graspable, collapsed lobe', () => {
    const r = new Retract(createState(), fresh());
    expect(r.grasp('lung_upper_lobe_right', P)).toBe('not-collapsed');
    expect(new Retract(collapsed(), fresh()).grasp('azygos_vein', P)).toBe('no-target');
  });

  it('maps upward drag to retract_posterior / retract_fissure and clamps 0..1', () => {
    const s = collapsed();
    const u = fresh();
    const r = new Retract(s, u);
    expect(u.uGraspRadius.value).toBe(C.pull.radius);
    expect(r.grasp('lung_upper_lobe_right', P)).toBe('ok');
    expect(r.key).toBe('retract_posterior');
    expect(u.uGraspPoint.value.equals(P)).toBe(true);
    r.drag(0, -pxFor(0.4));
    expect(s.retract_posterior).toBeCloseTo(0.4);
    r.drag(0, -pxFor(5));
    expect(s.retract_posterior).toBe(1);
    r.drag(0, pxFor(5));
    expect(s.retract_posterior).toBe(0);
    r.release();
    expect(r.grasp('lung_middle_lobe_right', P)).toBe('ok');
    r.drag(0, -pxFor(0.5));
    expect(s.retract_fissure).toBeCloseTo(0.5);
    expect(s.retract_posterior).toBe(0);
  });

  it('cancels a running tween on the driven key', () => {
    const s = collapsed();
    tweenTo(s, 'retract_posterior', 1, 1000);
    const r = new Retract(s, fresh());
    r.grasp('lung_upper_lobe_right', P);
    r.drag(0, -pxFor(0.2));
    expect(s.tweens.retract_posterior.active).toBe(false);
  });

  it('spring-back returns to the pre-grasp value unless held; off by default', () => {
    const s = collapsed();
    const r = new Retract(s, fresh(), true);
    r.grasp('lung_upper_lobe_right', P);
    r.drag(0, -pxFor(0.6));
    r.release();
    r.update(100);
    expect(s.retract_posterior).toBeCloseTo(0.6 - C.springPerSec * 0.1);
    r.update(10_000);
    expect(s.retract_posterior).toBe(0);

    r.grasp('lung_upper_lobe_right', P);
    r.drag(0, -pxFor(0.6));
    r.release(true); // G: held
    r.update(10_000);
    expect(s.retract_posterior).toBeCloseTo(0.6);

    const s2 = collapsed();
    const d = new Retract(s2, fresh());
    d.grasp('lung_upper_lobe_right', P);
    d.drag(0, -pxFor(0.6));
    d.release();
    d.update(10_000);
    expect(s2.retract_posterior).toBeCloseTo(0.6);
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
