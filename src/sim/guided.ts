// Guided procedure controller (CONTEXT §6.1 item 1): Next/Prev/goTo drive one ~1.5 s eased transition per step —
// rig move to the step camera, deflate/retract tweens (applyStep) and visibility fades. A mesh entering or leaving
// the step's visible set swaps to its pre-compiled transparent variant, fades, then swaps back to opaque (or hides).
// Input during a transition queues only the latest target. Per frame: no allocations (fixed fade slots).
import { config } from '../core/config';
import { ease } from './state';
import type { AppState } from './state';
import { applyStep, STEPS } from './steps';
import type { StepVisibility, Toggleable } from './steps';

export type GuidedEvent = 'stepchange' | 'transitionend';
export type GuidedListener = (step: number) => void;

export interface GuidedDeps {
  vis: StepVisibility;
  state: AppState;
  /** Rig: look through the step's glTF camera (eased unless instant). */
  setCamera(name: string, instant: boolean): void;
  /** Fade factor (materials.setFade, × layer opacity): a < 1 → transparent variant, 1 → back to the layer look. */
  setFade(o: Toggleable, a: number): void;
}

export interface Guided {
  /** Active step (0 = none yet). */
  readonly current: number;
  readonly transitioning: boolean;
  next(): void;
  prev(): void;
  /** Clamped to the step range. During a transition, non-instant calls queue (latest wins). */
  goTo(n: number, instant?: boolean): void;
  update(now: number): void;
  on(ev: GuidedEvent, fn: GuidedListener): void;
  off(ev: GuidedEvent, fn: GuidedListener): void;
}

const FIRST = STEPS[0]?.step ?? 1;
const LAST = STEPS[STEPS.length - 1]?.step ?? FIRST;
const NONE = -1;
// Under prefers-reduced-motion every step change is instant (the rig and the loading iris do the same).
// Live: follows OS setting changes via the media query's 'change' event (no per-frame polling).
const motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
let reducedMotion = motionQuery?.matches ?? false;
motionQuery?.addEventListener('change', (e) => {
  reducedMotion = e.matches;
});

export function createGuided(deps: GuidedDeps): Guided {
  const { vis, state, setCamera, setFade } = deps;
  const G = config.guided;
  const was = new Uint8Array(vis.managed.length);
  const fadeObj: (Toggleable | null)[] = new Array<Toggleable | null>(G.fadeSlots).fill(null);
  const fadeIn = new Uint8Array(G.fadeSlots);
  let fades = 0;
  let start = NONE; // NONE = start on the next update
  let pending = NONE;
  const listeners: Record<GuidedEvent, GuidedListener[]> = { stepchange: [], transitionend: [] };
  const emit = (ev: GuidedEvent): void => {
    for (const fn of listeners[ev]) fn(state.step);
  };

  function endFades(): void {
    for (let i = 0; i < fades; i++) {
      const o = fadeObj[i];
      if (!o) continue;
      setFade(o, 1);
      if (!fadeIn[i]) o.visible = false;
      fadeObj[i] = null;
    }
    fades = 0;
  }

  function finish(): void {
    endFades();
    g.transitioning = false;
    emit('transitionend');
    if (pending !== NONE) {
      const n = pending;
      pending = NONE;
      if (n !== state.step) begin(n, false);
    }
  }

  function begin(n: number, instant: boolean): void {
    const m = vis.managed;
    for (let i = 0; i < m.length; i++) was[i] = m[i]?.visible ? 1 : 0;
    setCamera(applyStep(vis, state, n, instant).camera, instant);
    if (!instant)
      for (let i = 0; i < m.length && fades < G.fadeSlots; i++) {
        const o = m[i];
        if (!o || o.visible === (was[i] === 1)) continue;
        fadeIn[fades] = o.visible ? 1 : 0;
        fadeObj[fades++] = o;
        setFade(o, o.visible ? 0 : G.fadeCeil); // swap to the transparent variant now
        o.visible = true; // leaving meshes stay drawn until their fade ends
      }
    g.transitioning = !instant;
    // Same clock origin as the state tweens (tweenTo starts at state.t), so fades and tweens end in the same frame;
    // NONE (before the first tick) starts on the next update, like the tweens.
    start = state.t > 0 ? state.t : NONE;
    emit('stepchange');
    if (instant) emit('transitionend');
  }

  function goTo(target: number, instant = false): void {
    instant ||= reducedMotion;
    const n = Math.min(LAST, Math.max(FIRST, Math.round(target)));
    if (g.transitioning) {
      if (!instant) {
        pending = n;
        return;
      }
      pending = NONE;
      endFades();
      g.transitioning = false;
    }
    if (n !== state.step) begin(n, instant);
  }

  const g = {
    get current(): number {
      return state.step;
    },
    transitioning: false,
    next: () => goTo((pending !== NONE ? pending : state.step) + 1),
    prev: () => goTo(state.step ? (pending !== NONE ? pending : state.step) - 1 : FIRST),
    goTo,
    update(now: number): void {
      if (!g.transitioning) return;
      if (start === NONE) start = now;
      const p = Math.min(1, (now - start) / G.transitionMs);
      const e = ease(p);
      for (let i = 0; i < fades; i++) {
        const o = fadeObj[i];
        if (o) setFade(o, G.fadeCeil * (fadeIn[i] ? e : 1 - e));
      }
      if (p >= 1) finish();
    },
    on(ev: GuidedEvent, fn: GuidedListener): void {
      listeners[ev].push(fn);
    },
    off(ev: GuidedEvent, fn: GuidedListener): void {
      const i = listeners[ev].indexOf(fn);
      if (i >= 0) listeners[ev].splice(i, 1);
    },
  };
  return g;
}
