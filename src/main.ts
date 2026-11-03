import { AmbientLight, AxesHelper, PerspectiveCamera, PointLight, Raycaster, Scene, Vector2 } from 'three';
import type { Intersection, Object3D } from 'three';
import { config } from './core/config';
import { keybindings } from './core/keybindings';
import { armReady } from './core/perf';
import { pickQuality } from './core/quality';
import type { QualityPreset } from './core/quality';
import { createRenderer, startLoop } from './core/renderer';
import { runLoadingStages } from './scene/loadingStages';
import { createCameraRig } from './scene/cameras';
import type { CameraRig, ViewMode } from './scene/cameras';
import { createPostFx } from './scene/postfx';
import { buildMorphBindings, collectMorphMeshes, updateMorphs } from './scene/morphs';
import type { MorphBindings } from './scene/morphs';
import { tickSim } from './sim/physiology';
import { clampRMLReinflate, createState, releaseClamp, setLobe, startOLV } from './sim/state';
import type { AppState, Lobe } from './sim/state';
import { applyStep, applyVisibility, createStepVisibility, STEPS } from './sim/steps';
import { irisOpen, setOverall, setStage, showError } from './ui/loadingScreen';

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const { holdFraction, stages } = config.loading;
// ?view=scope|outside (?scope = legacy alias from T105) and ?step=N (implies a step camera for the scope).
const urlStep = Number(params.get('step'));
const initialStep = STEPS.some((s) => s.step === urlStep) ? urlStep : 0;
const initialView: ViewMode =
  params.get('view') === 'scope' || (!params.has('view') && params.has('scope')) ? 'scope' : 'outside';

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
      /** Apply procedure step n (state tweens, hidden set, step camera); instant skips tweens/transition. */
      setStep: (n: number, instant?: boolean) => void;
      setView: (mode: ViewMode, instant?: boolean) => void;
      /** null until the model is loaded. */
      rig: CameraRig | null;
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
  setStep: () => {},
  setView: () => {},
  rig: null,
};
window.__sim = sim;

if (params.has('holdload')) {
  // Debug only (screenshots): freeze at the download stage; never loads.
  setStage(stages.download.label, holdFraction);
  setOverall(holdFraction * stages.download.weight);
} else {
  main().catch((e: unknown) =>
    showError(e instanceof Error ? e.message : String(e), {
      onRetry: () => location.reload(),
      onLowQuality: () => {
        const url = new URL(location.href);
        url.searchParams.set('quality', 'low');
        location.assign(url);
      },
    }),
  );
}

function makeRenderer(app: HTMLElement): {
  renderer: ReturnType<typeof createRenderer>;
  preset: QualityPreset;
} {
  const { name, preset } = pickQuality(params); // throws if WebGL2 is missing
  window.__perf.preset = name;
  try {
    return { renderer: createRenderer(app, preset), preset };
  } catch {
    throw new Error('WebGL2 is not available. Use a current desktop Chrome, Edge, Firefox or Safari.');
  }
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  const { renderer, preset } = makeRenderer(app);
  if (params.has('failload')) throw new Error('Forced load failure (?failload).');
  const post = createPostFx(renderer, preset);
  const scene = new Scene();
  // viewCamera: the one rendered camera; the rig (created at load) drives its pose for scope + outside views.
  const camera = new PerspectiveCamera(
    config.camera.fovDeg,
    window.innerWidth / window.innerHeight,
    config.camera.near,
    config.camera.far,
  );
  // Temporary look (T004): dim ambient + co-axial headlight on viewCamera. M1 (T104) replaces the look.
  scene.add(new AmbientLight(0xffffff, config.viewer.ambientIntensity));
  const headlight = new PointLight(0xffffff, config.viewer.headlightIntensity, 0, 0);
  camera.add(headlight);
  scene.add(camera);

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
    sim.rig?.update(now);
    if (sim.morphs) updateMorphs(sim.morphs, state);
    hover(now);
  }

  const { axis } = await runLoadingStages(renderer, scene, camera, (gltf) => {
    const m = (model = gltf.scene);
    scene.add(m);
    sim.morphs = buildMorphBindings(collectMorphMeshes(m));
    const v = createStepVisibility((name) => m.getObjectByName(name));
    applyVisibility(v, state); // default_hidden
    const r = (sim.rig = createCameraRig(
      camera,
      renderer.domElement,
      m.getObjectByName('thorax_root') ?? m,
      gltf.cameras,
      post.uniforms.uScopeMode,
      (mode) => {
        v.scope = mode === 'scope';
        applyVisibility(v, state);
      },
    ));
    sim.setStep = (n, instant = false) => r.setScopeCamera(applyStep(v, state, n, instant).camera, instant);
    sim.setView = (mode, instant = false) => {
      if (mode === 'scope' && !state.step) sim.setStep(config.steps.defaultStep, instant);
      r.setView(mode, instant);
    };
    if (initialStep) sim.setStep(initialStep, true);
    sim.setView(initialView, true);
    r.update(0);
  });
  axisLine = axis;
  if (overlay) overlay.textContent = `${axisLine}\nhover: ${hoverName}`;
  window.addEventListener('keydown', (e) => {
    const { rig } = sim;
    if (rig && !e.repeat && e.code === keybindings.toggleView.code)
      sim.setView(rig.target === 'scope' ? 'outside' : 'scope');
  });
  // Visible loop only after all five stages; "ready" once the lens has opened.
  startLoop(renderer, camera, frame, (now) => post.render(scene, camera, now));
  await irisOpen();
  armReady();
}
