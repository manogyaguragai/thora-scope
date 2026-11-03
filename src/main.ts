import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import './ui/tokens.css';
import {
  AmbientLight,
  AxesHelper,
  Box3,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from 'three';
import type { Intersection, Object3D } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { config } from './core/config';
import { armReady } from './core/perf';
import { createRenderer, startLoop } from './core/renderer';
import { loadModel } from './scene/loader';

const app = document.getElementById('app');
if (!app) throw new Error('#app missing');

const title = document.createElement('h1');
title.textContent = 'ThoraScope';
title.style.cssText =
  'position:absolute;margin:0;padding:var(--space-4);font-size:var(--font-size-title);font-weight:600;color:var(--color-text);pointer-events:none';
app.append(title);

const debug = new URLSearchParams(location.search).has('debug');
const renderer = createRenderer(app);
const scene = new Scene();
const camera = new PerspectiveCamera(
  config.camera.fovDeg,
  window.innerWidth / window.innerHeight,
  config.camera.near,
  config.camera.far,
);
// Temporary outside view (T004): dim ambient + camera-attached headlight. M1 replaces the look.
scene.add(new AmbientLight(0xffffff, config.viewer.ambientIntensity));
const headlight = new PointLight(0xffffff, config.viewer.headlightIntensity, 0, 0);
camera.add(headlight);
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement);

let overlay: HTMLDivElement | null = null;
if (debug) {
  scene.add(new AxesHelper(config.debug.axesSize));
  overlay = document.createElement('div');
  overlay.id = 'debug-overlay';
  overlay.style.cssText =
    'position:fixed;left:var(--space-2);bottom:var(--space-2);padding:var(--space-1);background:var(--color-surface);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-sm);font:12px/1.4 monospace;white-space:pre;pointer-events:none';
  overlay.textContent = 'loading…';
  app.append(overlay);
}

// ponytail: plain Raycaster over ~770k tris, debug only; BVH picking lands in M3.
const raycaster = new Raycaster();
const pointer = new Vector2();
const hits: Intersection[] = [];
const hoverMs = 1000 / config.pick.hoverHz;
let pointerDirty = false;
let lastPick = 0;
let hoverName = '—';
let axisLine = '';
let model: Object3D | null = null;
if (debug) {
  renderer.domElement.addEventListener('pointermove', (e) => {
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    pointerDirty = true;
  });
}

function hover(now: number): void {
  if (!overlay || !model || !pointerDirty || now - lastPick < hoverMs) return;
  pointerDirty = false;
  lastPick = now;
  raycaster.setFromCamera(pointer, camera);
  raycaster.intersectObject(model, true, hits);
  const name = hits[0]?.object.name || '—';
  hits.length = 0;
  if (name === hoverName) return;
  hoverName = name;
  overlay.textContent = `${axisLine}\nhover: ${hoverName}`;
}

startLoop(renderer, scene, camera, hover);

const { gltf, axis } = await loadModel(renderer);
axisLine = axis;
model = gltf.scene;
const root = model.getObjectByName('thorax_root') ?? model;
const box = new Box3().setFromObject(root);
const center = box.getCenter(new Vector3());
const radius = box.getSize(new Vector3()).length() / 2;
const dist = (radius * config.viewer.frameMargin) / Math.sin((config.camera.fovDeg * Math.PI) / 360);
camera.position.copy(center).addScaledVector(new Vector3(...config.viewer.viewDir).normalize(), dist);
controls.target.copy(center);
controls.update();
scene.add(model);
await renderer.compileAsync(scene, camera); // compile every program before "ready" (§6.10: 0 new programs after)
armReady();
if (overlay) overlay.textContent = `${axisLine}\nhover: ${hoverName}`;
