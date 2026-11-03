import { ACESFilmicToneMapping, SRGBColorSpace, WebGLRenderer } from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import { config } from './config';
import { resetPerfClock, tickPerf } from './perf';

export function createRenderer(container: HTMLElement): WebGLRenderer {
  const renderer = new WebGLRenderer({
    antialias: config.renderer.antialias,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping; // placeholder; tone mapping moves into the post-FX pass in M1
  renderer.toneMappingExposure = config.renderer.toneMappingExposure;
  renderer.shadowMap.enabled = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.renderer.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.style.display = 'block';
  container.append(renderer.domElement);
  return renderer;
}

/** Continuous loop; paused while the tab is hidden. onFrame runs before render. */
export function startLoop(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  onFrame: (now: number) => void,
): void {
  const frame = (now: number): void => {
    onFrame(now);
    renderer.render(scene, camera);
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
