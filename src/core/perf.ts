import type { WebGLRenderer } from 'three';
import { config } from './config';

export interface PerfStats {
  ready: boolean;
  programs: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  fps: number;
  /** Rendered frames since load (tickPerf calls); stops advancing while hidden or held (T703). */
  renders: number;
  frameTimeP95: number;
  /** Quality preset in use (core/quality.ts). */
  preset: string;
  /** Per-stage load timings (scene/loadingStages.ts). */
  loadStages: { name: string; ms: number }[];
}

declare global {
  interface Window {
    __perf: PerfStats;
  }
}

const stats: PerfStats = {
  ready: false,
  programs: 0,
  drawCalls: 0,
  triangles: 0,
  textures: 0,
  fps: 0,
  renders: 0,
  frameTimeP95: 0,
  preset: '',
  loadStages: [],
};
window.__perf = stats;

const size = config.perf.ringSize;
const frames = new Float32Array(size);
const scratch = new Float32Array(size);
const sampleMs = 1000 / config.perf.sampleHz;
let count = 0;
let head = 0;
let last = 0;
let lastSample = 0;
let armed = false;

/** Next tickPerf (i.e. after the next rendered frame) flips __perf.ready. */
export function armReady(): void {
  armed = true;
}

/** Forget the previous timestamp (e.g. after the tab was hidden) so the gap isn't counted. */
export function resetPerfClock(): void {
  last = 0;
}

/** Call once per frame, after renderer.render(). */
export function tickPerf(renderer: WebGLRenderer, now: number): void {
  stats.renders++;
  if (last > 0) {
    frames[head] = now - last;
    head = (head + 1) % size;
    if (count < size) count++;
  }
  last = now;
  if (!armed && now - lastSample < sampleMs) return;
  if (armed) stats.ready = true;
  armed = false;
  lastSample = now;
  sample(renderer);
}

function sample(renderer: WebGLRenderer): void {
  const info = renderer.info;
  stats.programs = info.programs?.length ?? 0;
  stats.drawCalls = info.render.calls;
  stats.triangles = info.render.triangles;
  stats.textures = info.memory.textures;
  if (count === 0) return;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += frames[i] ?? 0;
  stats.fps = sum > 0 ? (1000 * count) / sum : 0;
  // Unfilled slots are 0 and sort first, so the filled samples occupy [size - count, size).
  scratch.set(frames);
  scratch.sort();
  stats.frameTimeP95 = scratch[size - count + Math.floor(config.perf.p95 * (count - 1))] ?? 0;
}
