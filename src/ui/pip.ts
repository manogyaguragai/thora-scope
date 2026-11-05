// PiP "surgeon's view" inset (CONTEXT §6.4 Gloved hands): one low-res render target built at load, re-rendered every
// Nth frame while shown (scope mode + user toggle), then drawn into a bottom-right viewport of the canvas with one
// textured quad. A DOM frame (border + label) sits over the same rect. Nothing is created per frame (§6.10).
import {
  HalfFloatType,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector2,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import type { Scene, WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { HANDS_CONFIG } from '../scene/hands';

export interface PipOptions {
  /** KeyboardEvent.code that toggles the inset (keybindings wiring: 'KeyI'). */
  code: string;
  /** Re-render cadence; default HANDS_CONFIG.pip.everyNthFrame. */
  everyNthFrame?: number;
  /** DOM frame parent; null = no DOM (unit tests). */
  parent?: HTMLElement | null;
  /** Around the scene render into the target, e.g. hands.setView('pip') + outside visibility set, then restore. */
  before?: () => void;
  after?: () => void;
}

export interface Pip {
  readonly target: WebGLRenderTarget;
  /** Surgeon's-view camera (aspect fixed at load); the caller writes its pose. */
  readonly camera: PerspectiveCamera;
  /** User toggle (`I`). */
  readonly enabled: boolean;
  /** Shown = enabled && scope mode. */
  readonly shown: boolean;
  /** Scene renders into the target so far (tests/perf). */
  readonly sceneRenders: number;
  toggle(): void;
  /** True if the event was the toggle key (and it toggled). */
  handleKey(e: Pick<KeyboardEvent, 'code'>): boolean;
  /** Call from the camera rig's onMode. */
  setScopeMode(on: boolean): void;
  /** Per frame, after the post-FX pass drew the canvas. */
  render(): void;
  /** registerWarmupHook(pip.warmup): uploads the target + compiles the inset quad program. */
  warmup(): void;
}

const P = HANDS_CONFIG.pip;
const size = new Vector2();
const saved = new Vector4();

export function createPip(renderer: WebGLRenderer, scene: Scene, opts: PipOptions): Pip {
  const everyN = Math.max(1, Math.round(opts.everyNthFrame ?? P.everyNthFrame));
  const target = new WebGLRenderTarget(P.width, P.height, { type: HalfFloatType });
  const camera = new PerspectiveCamera(P.camera.fovDeg, P.width / P.height, P.camera.near, P.camera.far);
  camera.name = 'pipCamera';
  const quad = new FullScreenQuad(
    new MeshBasicMaterial({ map: target.texture, depthTest: false, depthWrite: false }),
  );
  const cssH = Math.round((P.cssWidth * P.height) / P.width);

  let frame: HTMLDivElement | null = null;
  if (opts.parent) {
    frame = document.createElement('div');
    frame.id = 'pip-inset';
    frame.setAttribute('role', 'img');
    frame.setAttribute('aria-label', "Surgeon's view: gloved hands on the scope and instrument");
    frame.style.cssText = `position:fixed;right:${P.marginPx}px;bottom:${P.marginPx}px;width:${P.cssWidth}px;
height:${cssH}px;pointer-events:none;display:none;box-sizing:border-box;z-index:5;
border:var(--border-width) solid var(--color-border);border-radius:var(--radius-sm)`;
    opts.parent.append(frame);
  }

  let frameNo = 0;
  const sync = (): void => {
    frameNo = 0; // render on the first shown frame (target may be stale)
    if (frame) frame.style.display = pip.shown ? 'block' : 'none';
  };

  function drawScene(): void {
    opts.before?.();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    opts.after?.();
    pip.sceneRenders++;
  }

  function drawInset(): void {
    renderer.getSize(size); // CSS px, matching setViewport
    renderer.getViewport(saved);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false; // keep the main view under/around the inset
    renderer.setViewport(size.x - P.cssWidth - P.marginPx, P.marginPx, P.cssWidth, cssH); // GL y is bottom-up
    quad.render(renderer);
    renderer.setViewport(saved);
    renderer.autoClear = autoClear;
  }

  const pip = {
    target,
    camera,
    enabled: false,
    scopeMode: false,
    sceneRenders: 0,
    get shown() {
      return pip.enabled && pip.scopeMode;
    },
    toggle() {
      pip.enabled = !pip.enabled;
      sync();
    },
    handleKey(e: Pick<KeyboardEvent, 'code'>) {
      if (e.code !== opts.code) return false;
      pip.toggle();
      return true;
    },
    setScopeMode(on: boolean) {
      if (pip.scopeMode === on) return;
      pip.scopeMode = on;
      sync();
    },
    render() {
      if (!pip.shown) return;
      if (frameNo++ % everyN === 0) drawScene();
      drawInset();
    },
    warmup() {
      drawScene();
      drawInset();
    },
  };
  return pip;
}
