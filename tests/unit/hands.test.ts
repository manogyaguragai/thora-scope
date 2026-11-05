import { Group, Mesh, Scene, Vector3 } from 'three';
import type { BufferGeometry, Material, WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { HANDS_CONFIG, buildHands } from '../../src/scene/hands';
import { createPip } from '../../src/ui/pip';

describe('gloved hands (CONTEXT §6.4)', () => {
  const hands = buildHands('latex');
  const meshes: Mesh[] = [];
  hands.root.traverse((o) => {
    if ((o as Mesh).isMesh && o.name !== 'hands:scope-body') meshes.push(o as Mesh);
  });

  it('builds once: 2 meshes, one shared material, one geometry per grip', () => {
    expect(meshes).toHaveLength(2);
    expect(new Set<Material>(meshes.map((m) => m.material as Material)).size).toBe(1);
    expect(new Set<BufferGeometry>(meshes.map((m) => m.geometry)).size).toBe(2);
    expect(hands.material.transparent).toBe(false);
  });

  it('scope body: one extra opaque standard-material mesh, following the scope grip', () => {
    const body = hands.root.getObjectByName('hands:scope-body') as Mesh;
    expect(body.isMesh).toBe(true);
    expect((body.material as Material).transparent).toBe(false);
  });

  it('glove swap is a colour change only (same material, no recompile)', () => {
    const version = hands.material.version;
    hands.setGlove('nitrile');
    expect(`#${hands.material.color.getHexString()}`).toBe(HANDS_CONFIG.gloves.nitrile.color);
    hands.setGlove('latex');
    expect(`#${hands.material.color.getHexString()}`).toBe(HANDS_CONFIG.gloves.latex.color);
    expect(hands.material.version).toBe(version);
    expect(meshes[0]?.material).toBe(hands.material);
  });

  it('hidden in the scope view, shown in outside view and PiP', () => {
    expect(hands.root.visible).toBe(false);
    hands.setView('outside');
    expect(hands.root.visible).toBe(true);
    hands.setView('scope');
    expect(hands.root.visible).toBe(false);
    hands.setView('pip');
    expect(hands.root.visible).toBe(true);
  });

  it('follows its target allocation-free; no target or hidden target = hidden hand', () => {
    const tool = new Group();
    tool.position.set(0.1, 0.2, 0.3);
    hands.setTarget('tool', tool);
    hands.update();
    const mesh = hands.meshes.tool;
    expect(mesh.visible).toBe(true);
    expect(hands.meshes.scope.visible).toBe(false);
    const p = new Vector3().setFromMatrixPosition(mesh.matrix);
    expect(p.distanceTo(new Vector3(0.1, 0.2, 0.3 + HANDS_CONFIG.hands.tool.position[2]))).toBeLessThan(1e-9);
    const count = hands.root.children.length;
    tool.position.x = 0.5;
    hands.update();
    expect(new Vector3().setFromMatrixPosition(mesh.matrix).x).toBeCloseTo(0.5);
    expect(hands.root.children.length).toBe(count);
    tool.visible = false;
    hands.update();
    expect(mesh.visible).toBe(false);
  });
});

/** Minimal renderer stub: counts scene renders into the PiP target vs inset quad draws to the canvas. */
function fakeRenderer(): { r: WebGLRenderer; scene: number; quad: number } {
  let rt: unknown = null;
  const stats = { scene: 0, quad: 0 };
  const r = {
    autoClear: true,
    setRenderTarget: (t: unknown) => (rt = t),
    render: () => (rt ? stats.scene++ : stats.quad++),
    getSize: (v: { set(x: number, y: number): void }) => v.set(1280, 720),
    getViewport: (v: { set(...n: number[]): void }) => v.set(0, 0, 1280, 720),
    setViewport: () => undefined,
  } as unknown as WebGLRenderer;
  return Object.assign(stats, { r });
}

describe('PiP inset cadence', () => {
  it('renders the scene every Nth frame while shown, the inset every frame, nothing while hidden', () => {
    const f = fakeRenderer();
    const order: string[] = [];
    const pip = createPip(f.r, new Scene(), {
      code: 'KeyI',
      everyNthFrame: 3,
      before: () => order.push('before'),
      after: () => order.push('after'),
    });
    expect(pip.camera.aspect).toBeCloseTo(HANDS_CONFIG.pip.width / HANDS_CONFIG.pip.height);
    for (let i = 0; i < 5; i++) pip.render();
    expect(f.scene + f.quad).toBe(0); // off by default

    expect(pip.handleKey({ code: 'KeyO' })).toBe(false);
    expect(pip.handleKey({ code: 'KeyI' })).toBe(true);
    pip.render();
    expect(f.scene).toBe(0); // enabled but outside view: still hidden
    pip.setScopeMode(true);
    for (let i = 0; i < 7; i++) pip.render();
    expect(f.scene).toBe(3); // frames 0, 3, 6
    expect(f.quad).toBe(7);
    expect(pip.sceneRenders).toBe(3);
    expect(order.slice(0, 2)).toEqual(['before', 'after']);
    expect(f.r.autoClear).toBe(true); // restored

    pip.setScopeMode(false);
    pip.render();
    expect(f.quad).toBe(7);
  });

  it('default cadence stays within 2–3 frames', () => {
    expect(HANDS_CONFIG.pip.everyNthFrame).toBeGreaterThanOrEqual(2);
    expect(HANDS_CONFIG.pip.everyNthFrame).toBeLessThanOrEqual(3);
  });
});
