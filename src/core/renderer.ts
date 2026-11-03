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

/** Continuous loop; paused while the tab is hidden. onFrame runs before render (scene + post-FX). */
export function startLoop(
  renderer: WebGLRenderer,
  camera: PerspectiveCamera,
  onFrame: (now: number) => void,
  render: (now: number) => void,
): void {
  const frame = (now: number): void => {
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
