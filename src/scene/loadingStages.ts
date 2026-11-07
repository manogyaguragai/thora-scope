// Five honest, weighted loading stages (§6.9): download → decode → GPU upload → shader compile → warm-up.
// Everything that compiles or uploads happens here, before "ready" (§6.10: 0 new programs after).
import type { Camera, Object3D, Scene, Texture, WebGLRenderer, WebGLRenderTarget } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { config } from '../core/config';
import { setOverall, setStage } from '../ui/loadingScreen';
import { loadModel } from './loader';
import type { LoadedModel } from './loader';

type StageId = keyof typeof config.loading.stages;
const STAGES = config.loading.stages;

/** Later modules hook extra post-FX/target warm-up renders in here; runs at the end of stage 5. */
export type WarmupHook = (renderer: WebGLRenderer) => void | Promise<void>;

declare global {
  interface Window {
    /** Stage labels in the order they were entered (e2e). */
    __loadStageLog: string[];
  }
}
const stageLog: string[] = [];
window.__loadStageLog = stageLog;

const warmupObjects: Object3D[] = [];
const warmupHooks: WarmupHook[] = [];

/**
 * Register an object (instrument, X-ray/clipping/hands/effect material variant on a mesh, …) whose programs and
 * textures must be ready before "ready". It is forced visible for compilation and restored after; it needn't be
 * in the scene (it is compiled against the scene's lights).
 */
export function registerWarmupObject(obj: Object3D): void {
  warmupObjects.push(obj);
}

export function registerWarmupHook(fn: WarmupHook): void {
  warmupHooks.push(fn);
}

const warmupViews: Camera[] = [];
/** Extra stage-5 warm-up camera (e.g. a walkthrough beat pose, T863): `warmupFrames` renders like the glTF cams. */
export function registerWarmupView(cam: Camera): void {
  warmupViews.push(cam);
}

let sceneTarget: WebGLRenderTarget | null = null;
/** The target the scene is rendered into at runtime (post-FX HDR target); compile + warm-up render into it too. */
export function setWarmupTarget(target: WebGLRenderTarget): void {
  sceneTarget = target;
}

let current: StageId | null = null;
let stageStart = 0;
let done = 0; // summed weight of finished stages

function enter(id: StageId): void {
  finish();
  current = id;
  stageStart = performance.now();
  stageLog.push(STAGES[id].label);
  progress(0);
}

function finish(): void {
  if (!current) return;
  window.__perf.loadStages.push({ name: current, ms: Math.round(performance.now() - stageStart) });
  done += STAGES[current].weight;
  current = null;
}

/** Fraction of the current stage; non-finite shows the name only and leaves the ring. */
function progress(f: number): void {
  if (!current) return;
  setStage(STAGES[current].label, f);
  setOverall(done + STAGES[current].weight * f);
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r));

const hidden: Object3D[] = [];
/** Run fn with every object under root visible (compile traverses visible objects only), then restore. */
export async function withAllVisible(root: Object3D, fn: () => Promise<unknown>): Promise<void> {
  const from = hidden.length;
  root.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  try {
    await fn();
  } finally {
    for (let i = from; i < hidden.length; i++) (hidden[i] as Object3D).visible = false;
    hidden.length = from;
  }
}

function collectTextures(root: Object3D, out: Set<Texture>): void {
  root.traverse((o) => {
    const m = (o as Object3D & { material?: unknown }).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      for (const v of Object.values(mat as object))
        if ((v as Texture | null)?.isTexture) out.add(v as Texture);
      const uniforms = (mat as { uniforms?: Record<string, { value: unknown }> }).uniforms;
      if (uniforms)
        for (const u of Object.values(uniforms))
          if ((u.value as Texture | null)?.isTexture) out.add(u.value as Texture);
    }
  });
}

/**
 * Runs all five stages. `place` puts the decoded model into `scene` (and frames `camera`) before upload/compile.
 * `camera` is the outside view; glTF cameras are warmed up too. `textureDownscale` = the preset's texture cap.
 */
export async function runLoadingStages(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  place: (gltf: GLTF) => void,
  textureDownscale = false,
): Promise<LoadedModel> {
  enter('download');
  const loaded = await loadModel(
    renderer,
    (bytes, total) => progress(total ? bytes / total : NaN),
    () => enter('decode'),
    textureDownscale,
  );
  place(loaded.gltf);

  enter('upload');
  const textures = new Set<Texture>();
  collectTextures(scene, textures);
  for (const o of warmupObjects) collectTextures(o, textures);
  let i = 0;
  for (const t of textures) {
    renderer.initTexture(t);
    if (++i % config.loading.uploadYieldEvery === 0) {
      progress(i / textures.size);
      await tick();
    }
  }

  enter('compile');
  // Program keys depend on the render target (tone mapping/output colour space), so compile against the runtime one.
  renderer.setRenderTarget(sceneTarget);
  // Program keys don't depend on which perspective camera is used, so one compile covers cam_1..cam_7 too.
  await withAllVisible(scene, () => renderer.compileAsync(scene, camera));
  for (let k = 0; k < warmupObjects.length; k++) {
    progress((k + 1) / (warmupObjects.length + 1));
    const obj = warmupObjects[k] as Object3D;
    await withAllVisible(obj, () => renderer.compileAsync(obj, camera, scene));
  }

  enter('warmup');
  // Scene renders go to the same target as at runtime; hooks then draw the post-FX pass to the canvas, which the
  // opaque loading screen still covers.
  const cams = [...loaded.gltf.cameras, ...warmupViews, camera];
  const steps = cams.length * config.loading.warmupFrames + warmupHooks.length;
  let s = 0;
  for (const cam of cams) {
    for (let f = 0; f < config.loading.warmupFrames; f++) {
      renderer.render(scene, cam);
      progress(++s / steps);
      await tick();
    }
  }
  renderer.setRenderTarget(null);
  for (const hook of warmupHooks) {
    await hook(renderer);
    progress(++s / steps);
  }
  finish();
  console.info(`[load] ${window.__perf.loadStages.map((t) => `${t.name} ${t.ms} ms`).join(' · ')}`);
  return loaded;
}
