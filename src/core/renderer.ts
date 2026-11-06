import { ACESFilmicToneMapping, SRGBColorSpace, WebGLRenderer } from 'three';
import type { PerspectiveCamera } from 'three';
import { config } from './config';
import { resetPerfClock, tickPerf } from './perf';
import type { QualityPreset } from './quality';

export function createRenderer(container: HTMLElement, preset: QualityPreset): WebGLRenderer {
  const renderer = new WebGLRenderer({
    antialias: false, // the scene renders into the post-FX target (MSAA there, per preset); the canvas gets one quad
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping; // placeholder; tone mapping moves into the post-FX pass in M1
  renderer.toneMappingExposure = config.renderer.toneMappingExposure;
  renderer.shadowMap.enabled = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.maxPixelRatio));
  renderer.info.autoReset = false; // several renders per frame (scene + post); startLoop resets once per frame
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.style.display = 'block';
  container.append(renderer.domElement);
  return renderer;
}

// Render gate (T703): static screens (debrief, quiz, menus) hold rendering; requestRender() draws one frame anyway.
const holds = new Set<string>();
let pending = false;

/** Stop rendering until every reason is released (same reason twice = one hold). */
export function holdRendering(reason: string): void {
  holds.add(reason);
}

export function releaseRendering(reason: string): void {
  if (holds.delete(reason) && holds.size === 0) resetPerfClock(); // the held gap isn't a frame time
}

/** While held: draw exactly one more frame (e.g. after a static overlay changed what's behind it). */
export function requestRender(): void {
  // Only meaningful while held: the continuous loop draws anyway, and a request queued before a hold must not leak
  // an extra frame into it (visibility.spec render-gate race).
  if (holds.size > 0) pending = true;
}

export function isRenderingHeld(): boolean {
  return holds.size > 0;
}

declare global {
  interface Window {
    /** Test hook for the render gate (tests/e2e/visibility.spec.ts). */
    __render: { hold: typeof holdRendering; release: typeof releaseRendering; request: typeof requestRender };
  }
}
window.__render = { hold: holdRendering, release: releaseRendering, request: requestRender };

/**
 * Continuous loop; paused while the tab is hidden, skipped (no sim tick, no render) while the gate is held
 * except for one frame per requestRender(). onFrame runs before render (scene + post-FX).
 */
export function startLoop(
  renderer: WebGLRenderer,
  camera: PerspectiveCamera,
  onFrame: (now: number) => void,
  render: (now: number) => void,
): void {
  const frame = (now: number): void => {
    if (holds.size > 0) {
      if (!pending) return;
      resetPerfClock(); // a one-off frame after a held gap: no frame-time sample
    }
    pending = false;
    onFrame(now);
    renderer.info.reset();
    render(now);
    tickPerf(renderer, now);
  };
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  document.addEventListener('visibilitychange', () => {
    resetPerfClock();
    renderer.setAnimationLoop(document.hidden ? null : frame);
  });
  renderer.setAnimationLoop(document.hidden ? null : frame);
}
