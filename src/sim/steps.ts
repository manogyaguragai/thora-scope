// Procedure steps (CONTEXT §7.4): apply a step's state targets, hidden set and camera/port.
// Visibility: the step's hidden set = its JSON `hidden` extras + the manifest-derived hilum set (src/content/anatomy.ts
// hiddenAtStep: always-hidden structures and everything divided / cleared / dissected / removed in an earlier step),
// plus config.scope.hidden and the step's config.scope.stepHidden occluders while the scope view is in effect.
// The morph controller skips hidden meshes and compares against each mesh's stored influences, so a shown
// mesh catches up on its next frame — no extra dirty flag needed here.
import procedure from '../content/procedure_steps.json' with { type: 'json' };
import { hiddenAtStep } from '../content/anatomy';
import { config } from '../core/config';
import { getMode } from './modes';
import { TWEEN_KEYS, tweenTo } from './state';
import type { AppState, TweenKey } from './state';

export interface Step {
  step: number;
  label: string;
  camera: string;
  port: string;
  scope_angle_deg: number; // informational (the sim optic is 30°, VIDEO_STEP_MAP conflict 6)
  /** Targets per tween key; missing keys tween to 0. */
  state: Partial<Record<TweenKey, number>>;
  hidden: string[];
  /** Scope view aimed from `port` at the reference camera's hilar target (cameras.ts aimStepPoses). */
  aimAtHilum?: boolean;
}

export const STEPS: readonly Step[] = procedure.steps.map((s) => ({
  ...s,
  hidden: [...new Set([...s.hidden, ...hiddenAtStep(s.step)])],
}));
const DEFAULT_HIDDEN: readonly string[] = [...new Set([...procedure.default_hidden, ...hiddenAtStep(0)])];
const SCOPE_HIDDEN: readonly string[] = config.scope.hidden;
const SCOPE_STEP_HIDDEN = config.scope.stepHidden;
const GUIDED_HIDDEN: readonly string[] = config.scope.guidedHidden;
const GUIDED_STEP_HIDDEN = config.scope.guidedStepHidden;
const NONE: readonly string[] = [];

/** The subset of Object3D used here (unit tests pass plain objects). */
export interface Toggleable {
  name: string;
  visible: boolean;
}

export interface StepVisibility {
  /** Every node any hidden list can touch; resolved once at load. */
  managed: Toggleable[];
  /** Scope far-field set applies (set from the camera rig's mode). */
  scope: boolean;
}

export function getStep(n: number): Step {
  const s = STEPS.find((x) => x.step === n);
  if (!s) throw new RangeError(`No procedure step ${n}`);
  return s;
}

/** Load time: resolve all names any hidden list mentions. Missing names are warned about, not fatal. */
export function createStepVisibility(lookup: (name: string) => Toggleable | undefined): StepVisibility {
  const names = new Set([
    ...DEFAULT_HIDDEN,
    ...SCOPE_HIDDEN,
    ...Object.values(SCOPE_STEP_HIDDEN).flat(),
    ...GUIDED_HIDDEN,
    ...Object.values(GUIDED_STEP_HIDDEN).flat(),
    ...STEPS.flatMap((s) => s.hidden),
  ]);
  const managed: Toggleable[] = [];
  for (const name of names) {
    const o = lookup(name);
    if (o) managed.push(o);
    else console.warn(`[steps] node not found: ${name}`);
  }
  return { managed, scope: false };
}

/** Is node `name` hidden by the current step / scope sets? (Layer-panel toggles AND with this.) */
export function stepHidden(vis: StepVisibility, s: AppState, name: string): boolean {
  const hidden = s.step ? getStep(s.step).hidden : DEFAULT_HIDDEN;
  if (hidden.includes(name)) return true;
  if (!vis.scope) return false;
  if (SCOPE_HIDDEN.includes(name) || (SCOPE_STEP_HIDDEN[s.step] ?? NONE).includes(name)) return true;
  // T886: Guided walkthrough only (Practice / Explore keep them); main.ts re-applies on every mode change.
  return (
    getMode() === 'guided' &&
    (GUIDED_HIDDEN.includes(name) || (GUIDED_STEP_HIDDEN[s.step] ?? NONE).includes(name))
  );
}

/** Re-apply visibility for the current step and view. Allocation-free. */
export function applyVisibility(vis: StepVisibility, s: AppState): void {
  for (const o of vis.managed) o.visible = !stepHidden(vis, s, o.name);
}

/** Tween state to step n's targets (instant → set now), record camera/port, apply its hidden set. */
export function applyStep(vis: StepVisibility, s: AppState, n: number, instant = false): Step {
  const step = getStep(n);
  const ms = instant ? 0 : config.steps.stateMs;
  for (const key of TWEEN_KEYS) tweenTo(s, key, step.state[key] ?? 0, ms);
  s.step = n;
  s.camera = step.camera;
  s.port = step.port;
  applyVisibility(vis, s);
  return step;
}
