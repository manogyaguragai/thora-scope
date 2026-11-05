import {
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
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

describe('nearest surface (T822 cautery contact gating)', () => {
  test('a point in free space has no contact; near a face it returns that mesh, point and normal', () => {
    const { scene } = boxes();
    const picker = buildPickBVH(scene);
    expect(picker.nearest(new Vector3(0, 0, 0.6), 0.05)).toBeNull(); // 0.1 off the near box's +z face
    const hit = picker.nearest(new Vector3(0.1, 0.2, 0.52), 0.05);
    expect(hit?.nodeName).toBe('near');
    expect(hit?.distance).toBeCloseTo(0.02);
    expect(hit?.point.z).toBeCloseTo(0.5);
    expect(hit?.normal.z).toBeCloseTo(1);
  });

  test('pick looks through skipped hits unless raw', () => {
    const { scene } = boxes();
    const picker = buildPickBVH(scene);
    picker.skip = (m) => m.name === 'near';
    expect(picker.pick(0, 0, camera())?.nodeName).toBe('far');
    expect(picker.pick(0, 0, camera(), true)?.nodeName).toBe('near');
  });

  test('nearest honours skip at the contact point (no contact inside an opening)', () => {
    const { scene } = boxes();
    const picker = buildPickBVH(scene);
    const p = new Vector3(0.1, 0.2, 0.52);
    picker.skip = (m, at) => m.name === 'near' && at.x > 0; // an "opening" over x > 0
    expect(picker.nearest(p, 0.05)).toBeNull();
    expect(picker.nearest(p, 0.05, true)?.nodeName).toBe('near'); // raw: mid-stroke the hook rides the layer
    expect(picker.nearest(p.set(-0.1, 0.2, 0.52), 0.05)?.nodeName).toBe('near');
  });
});
