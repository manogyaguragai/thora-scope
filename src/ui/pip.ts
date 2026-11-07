// PiP "surgeon's view" inset (CONTEXT §6.4 Gloved hands): one low-res render target built at load, re-rendered every
// Nth frame while shown (scope mode + user toggle), then drawn into a bottom-right viewport of the canvas with one
// textured quad. A DOM frame (border + label) sits over the same rect. Nothing is created per frame (§6.10).
import {
  HalfFloatType,
  Quaternion,
  Vector3,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector2,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import type { Scene, WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { HANDS_CONFIG } from '../scene/hands';
import { walkthroughConfig } from '../app/walkthrough/walkthrough.config';

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

/** T876 walkthrough inset: forced on for a beat, in a dock host, with its own label + render hooks; the caller writes
 *  `camera` after inset() (the surgeon's pose and aspect are restored when it ends). T877: rendered into its own
 *  target (walkthroughConfig.inset.px, taller than the PiP) so it fills more of the dock. */
export interface PipInset {
  /** Dock element the inset frame is prepended to (it sizes the inset: full width, target aspect). */
  readonly host: HTMLElement;
  readonly label: string;
  readonly before: () => void;
  readonly after: () => void;
  /** Inset brightness (quad colour multiplier, a uniform): the target is linear HDR without the post pass's exposure. */
  readonly gain: number;
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
  /** T876: show the inset for a walkthrough beat (null = back to the user's surgeon's view toggle). Event time. */
  inset(o: PipInset | null): void;
}

const P = HANDS_CONFIG.pip;
/** T877: the walkthrough inset's own target (built at load; its size sets the inset aspect, taller than the PiP). */
const I = walkthroughConfig.inset;
const IPX = I.px;
const size = new Vector2();
const saved = new Vector4();
const savedPos = new Vector3();
const savedQuat = new Quaternion();

export function createPip(renderer: WebGLRenderer, scene: Scene, opts: PipOptions): Pip {
  const everyN = Math.max(1, Math.round(opts.everyNthFrame ?? P.everyNthFrame));
  const target = new WebGLRenderTarget(P.width, P.height, { type: HalfFloatType });
  const camera = new PerspectiveCamera(P.camera.fovDeg, P.width / P.height, P.camera.near, P.camera.far);
  camera.name = 'pipCamera';
  const quadMat = new MeshBasicMaterial({ map: target.texture, depthTest: false, depthWrite: false });
  const quad = new FullScreenQuad(quadMat);
  const insetTarget = new WebGLRenderTarget(IPX[0], IPX[1], { type: HalfFloatType });
  const insetMat = new MeshBasicMaterial({ map: insetTarget.texture, depthTest: false, depthWrite: false });
  const insetQuad = new FullScreenQuad(insetMat); // same program as `quad` (identical material parameters)
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

  // T876 walkthrough inset: its own docked frame (built on first use) whose rect the quad follows (resize events).
  let forced: PipInset | null = null;
  let dockFrame: HTMLDivElement | null = null;
  const rect = { x: 0, y: 0, w: 0, h: 0 };
  const measure = (): void => {
    if (!dockFrame || !forced) return;
    const r = dockFrame.getBoundingClientRect();
    // T877: a short dock squeezes the frame (it yields height to the step text first): letterbox, never stretch.
    const w = Math.min(r.width, r.height * (IPX[0] / IPX[1]));
    const h = Math.min(r.height, r.width / (IPX[0] / IPX[1]));
    rect.x = r.left + (r.width - w) / 2;
    rect.y = r.top + (r.height - h) / 2;
    rect.w = w;
    rect.h = h;
  };
  const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);

  let frameNo = 0;
  const sync = (): void => {
    frameNo = 0; // render on the first shown frame (target may be stale)
    if (frame) frame.style.display = pip.shown && !forced ? 'block' : 'none';
    if (dockFrame) dockFrame.style.display = forced ? 'block' : 'none';
  };

  function drawScene(): void {
    (forced ?? opts).before?.();
    renderer.setRenderTarget(forced ? insetTarget : target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    (forced ?? opts).after?.();
    pip.sceneRenders++;
  }

  function drawInset(): void {
    renderer.getSize(size); // CSS px, matching setViewport
    renderer.getViewport(saved);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false; // keep the main view under/around the inset
    if (forced) {
      insetMat.color.setScalar(forced.gain);
      renderer.setViewport(rect.x, size.y - rect.y - rect.h, rect.w, rect.h);
      insetQuad.render(renderer);
    } else {
      renderer.setViewport(size.x - P.cssWidth - P.marginPx, P.marginPx, P.cssWidth, cssH); // GL y is bottom-up
      quad.render(renderer);
    }
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
      return forced !== null || (pip.enabled && pip.scopeMode);
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
      // T877: upload the inset target too, and draw its quad once (into the PiP target, redrawn before use).
      renderer.setRenderTarget(insetTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(target);
      insetQuad.render(renderer);
      renderer.setRenderTarget(null);
    },
    inset(o: PipInset | null) {
      if (o === forced) return;
      if (!forced && o) {
        savedPos.copy(camera.position);
        savedQuat.copy(camera.quaternion);
        camera.aspect = IPX[0] / IPX[1];
        camera.updateProjectionMatrix();
      } else if (forced && !o) {
        camera.position.copy(savedPos);
        camera.quaternion.copy(savedQuat);
        camera.aspect = P.width / P.height;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      }
      forced = o;
      if (o) {
        if (!dockFrame) {
          dockFrame = document.createElement('div');
          dockFrame.id = 'pip-walk-inset';
          dockFrame.setAttribute('role', 'img');
          dockFrame.style.cssText = `position:relative;width:100%;aspect-ratio:${IPX[0]} / ${IPX[1]};
flex-shrink:${I.yield};min-height:${I.minPx}px;pointer-events:none;box-sizing:border-box;border:var(--border-width) solid var(--color-border);
border-radius:var(--radius-sm)`;
          const tag = document.createElement('span');
          tag.className = 'pip-walk-label';
          tag.style.cssText = `position:absolute;left:var(--space-1);top:var(--space-1);padding:0 var(--space-1);
border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);font-size:var(--font-size-small)`;
          dockFrame.append(tag);
          watch?.observe(dockFrame);
          addEventListener('resize', measure);
        }
        dockFrame.setAttribute('aria-label', o.label);
        (dockFrame.firstChild as HTMLElement).textContent = o.label;
        if (dockFrame.parentElement !== o.host) o.host.prepend(dockFrame);
        watch?.observe(o.host); // the dock grows / shrinks with its messages: the inset moves with it
      } else watch?.disconnect();
      sync();
      measure();
      if (o && dockFrame) watch?.observe(dockFrame);
    },
  };
  return pip;
}
