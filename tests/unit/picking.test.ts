import {
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
} from 'three';
import { describe, expect, test } from 'vitest';
import { buildPickBVH } from '../../src/scene/picking';

function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(50, 1, 0.1, 100);
  c.position.set(0, 0, 10);
  c.updateMatrixWorld();
  return c;
}

function boxes() {
  const scene = new Scene();
  const mat = new MeshBasicMaterial();
  const near = new Mesh(new BoxGeometry(), mat);
  near.name = 'near';
  const far = new Mesh(new BoxGeometry(), mat);
  far.name = 'far';
  far.position.z = -5;
  const farGroup = new Group();
  farGroup.add(far);
  const port = new Mesh(new BoxGeometry(), mat);
  port.name = 'port_camera_8ICS';
  port.position.z = 3;
  scene.add(near, farGroup, port);
  scene.updateMatrixWorld();
  return { scene, near, far, farGroup };
}

describe('BVH picking', () => {
  test('pick returns nearest visible mesh, skips ports, hidden meshes and hidden ancestors', () => {
    const { scene, near, farGroup } = boxes();
    const cam = camera();
    const picker = buildPickBVH(scene);
    expect(picker.meshes.map((m) => m.name)).not.toContain('port_camera_8ICS');
    const hit = picker.pick(0, 0, cam);
    expect(hit?.nodeName).toBe('near');
    expect(hit?.distance).toBeCloseTo(9.5);
    expect(hit?.normal.z).toBeCloseTo(1);
    near.visible = false;
    expect(picker.pick(0, 0, cam)?.nodeName).toBe('far');
    farGroup.visible = false;
    expect(picker.pick(0, 0, cam)).toBeNull();
  });

  test('hover is throttled: cached inside the 33 ms window', () => {
    const { scene, near } = boxes();
    const cam = camera();
    const picker = buildPickBVH(scene);
    expect(picker.hover(0, 0, cam, 1000)).toBe('near');
    near.visible = false;
    expect(picker.hover(0, 0, cam, 1020)).toBe('near');
    expect(picker.hover(0, 0, cam, 1040)).toBe('far');
  });

  test('refreshMorphs bakes the current morph pose into the BVH', () => {
    const scene = new Scene();
    const geo = new SphereGeometry(1, 32, 16);
    const half = Float32Array.from(geo.getAttribute('position').array, (v) => v * 0.5);
    geo.morphAttributes.position = [new Float32BufferAttribute(half, 3)];
    const lung = new Mesh(geo, new MeshBasicMaterial());
    lung.name = 'lung';
    lung.updateMorphTargets();
    scene.add(lung);
    scene.updateMatrixWorld();
    const cam = camera();
    const picker = buildPickBVH(scene);
    expect(picker.pick(0, 0, cam)?.distance).toBeCloseTo(9, 2);
    lung.morphTargetInfluences?.fill(1);
    expect(picker.pick(0, 0, cam)?.distance).toBeCloseTo(9, 2); // stale until refreshed
    picker.refreshMorphs([lung]);
    expect(picker.pick(0, 0, cam)?.distance).toBeCloseTo(9.5, 2);
    expect(picker.pick(0, 0, cam)?.point.z).toBeCloseTo(0.5, 2);
  });
});
