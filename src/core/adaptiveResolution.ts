// Adaptive resolution + preset auto-downgrade (§6.10). Pure controller: fed frame times, outputs a pixel ratio.
// No allocations in update(): one fixed Float32Array per window, sorted in place ≤ 1000/windowMs times a second.
import type { WebGLRenderer } from 'three';
import { config } from './config';
import type { QualityName } from './quality';

type AdaptiveConfig = typeof config.perf.adaptive;
const ORDER: readonly QualityName[] = config.quality.order;
const { storageKey } = config.quality;

export class AdaptiveResolution {
  /** Current target pixel ratio, quantised to cfg.step / cfg.precision. */
  ratio: number;
  /** Sustained < downgradeFps at minRatio: switch to nextLowerPreset() and call setMaxRatio(). */
  downgradeRequested = false;
  locked = false;
  private min: number;
  private max: number;
  private readonly frames: Float32Array;
  private n = 0;
  private windowMs = 0;
  private slowMs = 0;
  private fastMs = 0;
  private lowMs = 0;
  private cooldownMs = 0;
  private sinceUpMs = Infinity;
  private upHoldMs: number;

  /** maxRatio = min(devicePixelRatio, preset.maxPixelRatio); starts there. */
  constructor(
    maxRatio: number,
    private readonly cfg: AdaptiveConfig = config.perf.adaptive,
  ) {
    this.frames = new Float32Array(cfg.windowCapacity);
    this.upHoldMs = cfg.upHoldMs;
    this.max = this.min = this.ratio = 0;
    this.setMaxRatio(maxRatio);
    this.ratio = this.max;
  }

  /** New ceiling (preset change / dpr change). Keeps the current ratio clamped, clears the downgrade request. */
  setMaxRatio(maxRatio: number): void {
    this.max = this.round(Math.min(maxRatio, this.cfg.maxRatio));
    this.min = Math.min(this.cfg.minRatio, this.max);
    this.ratio = this.clamp(this.ratio);
    this.downgradeRequested = false;
    this.resetWindow();
    this.slowMs = this.fastMs = this.lowMs = 0;
  }

  /** User override: locked holds the preset's full ratio and never requests a downgrade. */
  setLocked(locked: boolean): void {
    this.locked = locked;
    if (locked) this.ratio = this.max;
    this.setMaxRatio(this.max);
  }

  /** Once per rendered frame with the frame interval in ms. Returns the target pixel ratio. */
  update(frameMs: number): number {
    if (this.locked || !(frameMs > 0) || frameMs > this.cfg.gapMs) return this.ratio;
    this.frames[this.n++] = frameMs;
    this.windowMs += frameMs;
    if (this.windowMs >= this.cfg.windowMs || this.n === this.frames.length) this.evaluate();
    return this.ratio;
  }

  private evaluate(): void {
    const c = this.cfg;
    const n = this.n;
    const ms = this.windowMs;
    this.frames.sort(); // unused slots are 0 and sort first: samples occupy [length - n, length)
    const p = this.frames[this.frames.length - n + Math.floor(c.percentile * (n - 1))] ?? 0;
    const meanFps = (1000 * n) / ms;
    this.resetWindow();
    this.sinceUpMs += ms;

    this.lowMs = this.ratio <= this.min && meanFps < c.downgradeFps ? this.lowMs + ms : 0;
    if (this.lowMs >= c.downgradeHoldMs) this.downgradeRequested = true;

    if (this.cooldownMs > 0) {
      this.cooldownMs -= ms;
      return;
    }
    // Hysteresis: the band between the two thresholds resets both timers.
    const slow = p > 1000 / c.downBelowFps;
    const fast = p < 1000 / c.upAboveFps;
    this.slowMs = slow ? this.slowMs + ms : 0;
    this.fastMs = fast ? this.fastMs + ms : 0;

    if (this.slowMs >= c.downHoldMs && this.ratio > this.min) {
      if (this.sinceUpMs < c.probeFailMs) this.upHoldMs = Math.min(this.upHoldMs * 2, c.upHoldMaxMs);
      this.step(-c.step);
    } else if (this.fastMs >= this.upHoldMs && this.ratio < this.max) {
      this.step(c.step);
      this.sinceUpMs = 0;
    }
  }

  private step(delta: number): void {
    this.ratio = this.clamp(this.ratio + delta);
    this.slowMs = this.fastMs = 0;
    this.cooldownMs = this.cfg.cooldownMs;
  }

  private resetWindow(): void {
    this.frames.fill(0);
    this.n = 0;
    this.windowMs = 0;
  }

  private clamp(r: number): number {
    return this.round(Math.min(this.max, Math.max(this.min, r)));
  }

  private round(r: number): number {
    return Math.round(r * this.cfg.precision) / this.cfg.precision;
  }
}

/**
 * Apply a ratio only when it changed (≤ once per cooldown, never per frame). setPixelRatio resizes the canvas;
 * the post-FX target follows on its next render (postfx.ts compares the drawing-buffer size), so no postfx arg.
 */
export function applyPixelRatio(
  renderer: Pick<WebGLRenderer, 'getPixelRatio' | 'setPixelRatio'>,
  ratio: number,
): boolean {
  if (renderer.getPixelRatio() === ratio) return false;
  renderer.setPixelRatio(ratio);
  return true;
}

export function nextLowerPreset(name: QualityName): QualityName | null {
  const i = ORDER.indexOf(name);
  return i > 0 ? (ORDER[i - 1] ?? null) : null;
}

/** User's manual quality choice (settings). preset null = automatic. */
export interface QualityChoice {
  preset: QualityName | null;
  locked: boolean;
}

export function loadQualityChoice(): QualityChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<QualityChoice> | null;
    return {
      preset: ORDER.find((p) => p === raw?.preset) ?? null,
      locked: raw?.locked === true,
    };
  } catch {
    return { preset: null, locked: false }; // no storage (private mode / sandbox) or corrupt value
  }
}

export function saveQualityChoice(choice: QualityChoice): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(choice));
  } catch {
    // storage blocked or full: the choice lasts this session only
  }
}
