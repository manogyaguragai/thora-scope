// Procedure steps (CONTEXT §7.4): apply a step's state targets, hidden set and camera/port.
// Visibility: the step's `hidden` list (default_hidden before any step), plus config.scope.hidden and the step's
// config.scope.stepHidden occluders while the scope view is in effect. A step's list replaces default_hidden rather than adding to it: steps 1–2 list exactly the
// default (the `_window` tissue variants), steps 3+ hide the intact tissue instead so the `_window` cut-outs show.
// The morph controller skips hidden meshes and compares against each mesh's stored influences, so a shown
// mesh catches up on its next frame — no extra dirty flag needed here.
import procedure from '../content/procedure_steps.json';
import { config } from '../core/config';
import { TWEEN_KEYS, tweenTo } from './state';
import type { AppState, TweenKey } from './state';

export interface Step {
  step: number;
  label: string;
  camera: string;
  port: string;
  scope_angle_deg: number; // informational (the sim optic is 30°, VIDEO_STEP_MAP conflict 6)
  state: Record<TweenKey, number>;
  hidden: string[];
}

export const STEPS: readonly Step[] = procedure.steps;
const DEFAULT_HIDDEN: readonly string[] = procedure.default_hidden;
const SCOPE_HIDDEN: readonly string[] = config.scope.hidden;
const SCOPE_STEP_HIDDEN = config.scope.stepHidden;
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
  return vis.scope && (SCOPE_HIDDEN.includes(name) || (SCOPE_STEP_HIDDEN[s.step] ?? NONE).includes(name));
}

/** Re-apply visibility for the current step and view. Allocation-free. */
export function applyVisibility(vis: StepVisibility, s: AppState): void {
  for (const o of vis.managed) o.visible = !stepHidden(vis, s, o.name);
}

/** Tween state to step n's targets (instant → set now), record camera/port, apply its hidden set. */
export function applyStep(vis: StepVisibility, s: AppState, n: number, instant = false): Step {
  const step = getStep(n);
  const ms = instant ? 0 : config.steps.stateMs;
  for (const key of TWEEN_KEYS) tweenTo(s, key, step.state[key], ms);
  s.step = n;
  s.camera = step.camera;
  s.port = step.port;
  applyVisibility(vis, s);
  return step;
}
