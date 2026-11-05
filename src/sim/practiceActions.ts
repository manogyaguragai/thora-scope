// Practice action table (CONTEXT §6.4, docs/VIDEO_STEP_MAP.md (d), ADR-004/005): typed loader + validator.
// Validation runs once at load; any problem throws with the full list so a bad table never ships silently.
import raw from '../content/practice_actions.json';
import { STRUCTURE_LABELS } from '../content/labels';
import { SUB_IDS, TARGET_BY_ID, type ToolId } from '../content/targets';
import { CONTEXT_ACTIONS, SLOTS } from './hotbar';
import { PORT_LABELS } from './ports';
import { TWEEN_KEYS, type TweenKey } from './state';

export type ContextActionId = (typeof CONTEXT_ACTIONS)[number]['id'];
export type PracticeTool = ToolId | ContextActionId;

export const ACTION_KINDS = [
  'inspect',
  'move-scope',
  'retract',
  'dissect',
  'encircle',
  'close',
  'fire',
  'remove-node',
  'ventilate',
  'bag',
  'chest-tube',
  'irrigate',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface PracticeResult {
  readonly state?: Readonly<Partial<Record<TweenKey, number>>>;
  /** Short-lived state (e.g. test ventilation) that reverts after `seconds`. */
  readonly transient?: {
    readonly state: Readonly<Partial<Record<TweenKey, number>>>;
    readonly seconds: number;
  };
  readonly flags?: readonly string[];
  /** Structures divided (clipping + staple cap). */
  readonly divide?: readonly string[];
  readonly hide?: readonly string[];
  readonly show?: readonly string[];
  /** Nodes moved to the specimen tray. */
  readonly specimen?: readonly string[];
  readonly scopePort?: string;
  /** Procedure step entered after this action. */
  readonly advanceTo?: number;
}

export interface PracticeAlternative {
  readonly tool: PracticeTool;
  readonly subOption: string | null;
  readonly targets: readonly string[];
}

export interface PracticeAction {
  readonly id: string;
  readonly step: number;
  readonly tool: PracticeTool;
  /** Sub-option id from SUB_IDS (src/content/targets.ts); null when the tool has none. */
  readonly subOption: string | null;
  readonly action: ActionKind;
  /** preferred = null for actions that use no port. */
  readonly port: { readonly preferred: string | null; readonly allowed: readonly string[] };
  /** All must be acted on (any order). */
  readonly targets: readonly string[];
  readonly prerequisites: readonly string[];
  readonly result: PracticeResult;
  /** "m:ss" or "m:ss-m:ss", "~" prefix = approximate; null = not in the video. */
  readonly video: string | null;
  readonly optional: boolean;
  readonly weight: number;
  readonly alternatives?: readonly PracticeAlternative[];
  /** Paraphrased teaching note (pending clinician review). */
  readonly note: string;
}

const STEP_COUNT = 7;
const VIDEO_RE = /^~?\d+:\d{2}(-\d+:\d{2})?$/;
const FLAG_RE = /^[a-z][A-Za-z0-9_]*$/;
const TOOL_IDS = new Set<string>([...SLOTS.map((s) => s.id), ...CONTEXT_ACTIONS.map((c) => c.id)]);
const CONTEXT_IDS = new Set<string>(CONTEXT_ACTIONS.map((c) => c.id));
const KINDS = new Set<string>(ACTION_KINDS);
const STATE_KEYS = new Set<string>(TWEEN_KEYS);
const isNode = (n: unknown): boolean =>
  typeof n === 'string' && (n in STRUCTURE_LABELS || TARGET_BY_ID.has(n));
const isPort = (p: unknown): p is string => typeof p === 'string' && p in PORT_LABELS;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** Tool/sub-option/targets combination check, shared by the main action and its alternatives. */
function checkUse(where: string, tool: unknown, sub: unknown, targets: unknown, err: string[]): void {
  if (typeof tool !== 'string' || !TOOL_IDS.has(tool)) {
    err.push(`${where}: unknown tool "${String(tool)}"`);
    return;
  }
  const subs = SUB_IDS[tool as ToolId];
  if (subs ? typeof sub !== 'string' || !subs.includes(sub) : sub !== null)
    err.push(`${where}: bad subOption "${String(sub)}" for ${tool}`);
  if (!strArr(targets)) {
    err.push(`${where}: targets must be a string array`);
    return;
  }
  for (const t of targets) {
    if (!isNode(t)) err.push(`${where}: unknown target "${t}"`);
    // Instrument use must match the actionable-target table (hands and context actions are not instruments).
    if (tool === 'hands' || CONTEXT_IDS.has(tool)) continue;
    const def = TARGET_BY_ID.get(t);
    const okSubs = def?.tools[tool as ToolId];
    if (!okSubs) err.push(`${where}: ${tool} not accepted on target "${t}" (src/content/targets.ts)`);
    else if (okSubs.length > 0 && typeof sub === 'string' && !okSubs.includes(sub))
      err.push(`${where}: ${tool}/${sub} not accepted on target "${t}"`);
  }
}

function checkState(where: string, s: unknown, err: string[]): void {
  if (!isObj(s)) return void err.push(`${where}: state must be an object`);
  for (const [k, v] of Object.entries(s))
    if (!STATE_KEYS.has(k) || typeof v !== 'number' || v < 0 || v > 1)
      err.push(`${where}: bad state ${k}=${String(v)}`);
}

function checkResult(where: string, r: unknown, step: unknown, err: string[]): void {
  if (!isObj(r)) return void err.push(`${where}: result must be an object`);
  if (r.state !== undefined) checkState(`${where}.state`, r.state, err);
  if (r.transient !== undefined) {
    const t = r.transient;
    if (!isObj(t) || typeof t.seconds !== 'number' || !(t.seconds > 0))
      err.push(`${where}.transient: needs state + seconds > 0`);
    else checkState(`${where}.transient.state`, t.state, err);
  }
  if (r.flags !== undefined && !(strArr(r.flags) && r.flags.every((f) => FLAG_RE.test(f))))
    err.push(`${where}: flags must be identifier strings`);
  for (const k of ['divide', 'hide', 'show', 'specimen'] as const) {
    const v = r[k];
    if (v === undefined) continue;
    if (!strArr(v)) err.push(`${where}.${k}: must be a string array`);
    else for (const n of v) if (!isNode(n)) err.push(`${where}.${k}: unknown node "${n}"`);
  }
  if (r.scopePort !== undefined && !isPort(r.scopePort))
    err.push(`${where}: unknown scopePort "${String(r.scopePort)}"`);
  if (r.advanceTo !== undefined) {
    const a = r.advanceTo;
    if (
      !Number.isInteger(a) ||
      typeof step !== 'number' ||
      (a as number) <= step ||
      (a as number) > STEP_COUNT
    )
      err.push(`${where}: advanceTo ${String(a)} must be a later step ≤ ${STEP_COUNT}`);
  }
}

/** All problems in a practice table (empty = valid). */
export function practiceActionErrors(data: unknown): string[] {
  const err: string[] = [];
  const list = isObj(data) ? data.actions : undefined;
  if (!Array.isArray(list) || list.length === 0) return ['actions must be a non-empty array'];
  const byId = new Map<string, Obj>();

  list.forEach((a: unknown, i) => {
    if (!isObj(a)) return void err.push(`actions[${i}]: not an object`);
    const id = a.id;
    const w = typeof id === 'string' ? id : `actions[${i}]`;
    if (typeof id !== 'string' || !/^PA\d{2}$/.test(id)) err.push(`${w}: id must look like PA01`);
    else if (byId.has(id)) err.push(`${w}: duplicate id`);
    else byId.set(id, a);
    if (!Number.isInteger(a.step) || (a.step as number) < 1 || (a.step as number) > STEP_COUNT)
      err.push(`${w}: step must be 1–${STEP_COUNT}`);
    if (typeof a.action !== 'string' || !KINDS.has(a.action))
      err.push(`${w}: unknown action "${String(a.action)}"`);
    checkUse(w, a.tool, a.subOption, a.targets, err);
    const p = a.port;
    if (!isObj(p) || !strArr(p.allowed) || !(p.preferred === null || isPort(p.preferred)))
      err.push(`${w}: port needs preferred (known port or null) + allowed[]`);
    else {
      for (const q of p.allowed) if (!isPort(q)) err.push(`${w}: unknown port "${q}"`);
      if (p.preferred !== null && !p.allowed.includes(p.preferred))
        err.push(`${w}: preferred port not in allowed`);
    }
    if (!strArr(a.prerequisites)) err.push(`${w}: prerequisites must be a string array`);
    checkResult(`${w}.result`, a.result, a.step, err);
    if (!(a.video === null || (typeof a.video === 'string' && VIDEO_RE.test(a.video))))
      err.push(`${w}: video must be "m:ss[-m:ss]" or null`);
    if (typeof a.optional !== 'boolean') err.push(`${w}: optional must be boolean`);
    if (typeof a.weight !== 'number' || !(a.weight >= 0)) err.push(`${w}: weight must be ≥ 0`);
    if (typeof a.note !== 'string' || a.note.length === 0) err.push(`${w}: note required`);
    if (a.alternatives !== undefined) {
      if (!Array.isArray(a.alternatives)) err.push(`${w}: alternatives must be an array`);
      else
        a.alternatives.forEach((alt: unknown, j) => {
          if (!isObj(alt)) err.push(`${w}.alternatives[${j}]: not an object`);
          else checkUse(`${w}.alternatives[${j}]`, alt.tool, alt.subOption, alt.targets, err);
        });
    }
  });

  // Prerequisites: known, not later in the procedure, required actions never wait on optional ones; DAG acyclic.
  for (const [id, a] of byId) {
    if (!strArr(a.prerequisites)) continue;
    for (const pre of a.prerequisites) {
      const b = byId.get(pre);
      if (!b) err.push(`${id}: unknown prerequisite "${pre}"`);
      else if ((b.step as number) > (a.step as number))
        err.push(`${id}: prerequisite ${pre} is in a later step`);
      else if (b.optional === true && a.optional !== true)
        err.push(`${id}: required action depends on optional ${pre}`);
    }
  }
  const state = new Map<string, 1 | 2>(); // 1 = on the DFS stack, 2 = done
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) return void err.push(`prerequisite cycle: ${[...path, id].join(' → ')}`);
    state.set(id, 1);
    const pre = byId.get(id)?.prerequisites;
    if (strArr(pre)) for (const p of pre) if (byId.has(p)) visit(p, [...path, id]);
    state.set(id, 2);
  };
  for (const id of byId.keys()) visit(id, []);
  return err;
}

/** Validated table; throws listing every problem. */
export function loadPracticeActions(data: unknown = raw): readonly PracticeAction[] {
  const err = practiceActionErrors(data);
  if (err.length) throw new Error(`practice_actions.json invalid:\n  ${err.join('\n  ')}`);
  return (data as { actions: PracticeAction[] }).actions;
}
