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
import { applyRealism } from './scene/materials';
import { buildMorphBindings, collectMorphMeshes, updateMorphs } from './scene/morphs';
import type { MorphBindings } from './scene/morphs';
import { tickSim } from './sim/physiology';
import { clampRMLReinflate, createState, releaseClamp, setLobe, startOLV } from './sim/state';
import type { AppState, Lobe } from './sim/state';
import { irisOpen, setOverall, setStage, showError } from './ui/loadingScreen';

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const DOWNLOAD = 'Downloading model';
const { downloadWeight, holdFraction } = config.loading;

declare global {
  interface Window {
    __sim: {
      state: AppState;
      morphs: MorphBindings | null;
      cmd: {
        startOLV: () => void;
        clamp: () => void;
        release: () => void;
        setLobe: (lobe: Lobe, v: number) => void;
      };
    };
  }
}

const state = createState();
const sim: Window['__sim'] = {
  state,
  morphs: null,
  cmd: {
    startOLV: () => startOLV(state),
    clamp: () => clampRMLReinflate(state),
    release: () => releaseClamp(state),
    setLobe: (lobe, v) => setLobe(state, lobe, v),
  },
};
window.__sim = sim;

if (params.has('holdload')) {
  // Debug only (screenshots): freeze at the download stage; never loads.
  setStage(DOWNLOAD, holdFraction);
  setOverall(holdFraction * downloadWeight);
} else {
  main().catch((e: unknown) =>
    showError(e instanceof Error ? e.message : String(e), {
      onRetry: () => location.reload(),
      onLowQuality: () => {
        // ponytail: sets ?quality=low only; nothing reads it until quality presets land.
        const url = new URL(location.href);
        url.searchParams.set('quality', 'low');
        location.assign(url);
      },
    }),
  );
}

function makeRenderer(app: HTMLElement): ReturnType<typeof createRenderer> {
  try {
    return createRenderer(app);
  } catch {
    throw new Error('WebGL2 is not available. Use a current desktop Chrome, Edge, Firefox or Safari.');
  }
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  setStage(DOWNLOAD, 0);
  const renderer = makeRenderer(app);
  if (params.has('failload')) throw new Error('Forced load failure (?failload).');
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

  function frame(now: number): void {
    tickSim(state, now);
    if (sim.morphs) updateMorphs(sim.morphs, state);
    hover(now);
  }

  startLoop(renderer, scene, camera, frame);

  const { gltf, axis } = await loadModel(renderer, (loaded, total) => {
    const f = total ? loaded / total : NaN;
    setStage(DOWNLOAD, f);
    setOverall(f * downloadWeight);
  });
  setStage('Preparing scene', NaN);
  setOverall(downloadWeight);
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
  sim.morphs = buildMorphBindings(collectMorphMeshes(model));
  await applyRealism(scene, renderer, camera); // T104 look: headlight, env, tissue variants (X-ray variants compiled)
  await renderer.compileAsync(scene, camera); // compile every program before "ready" (§6.10: 0 new programs after)
  armReady();
  setOverall(1);
  if (overlay) overlay.textContent = `${axisLine}\nhover: ${hoverName}`;
  await irisOpen();
}
