// T851 guided demonstrations ("Show me", Guided + Explore): a timeline player. Each step is a declarative script of
// beats { camera move, action, duration, caption }. Actions drive the REAL instrument / action paths (hotbar select,
// P port cycling, the controller's fulcrum tip, m4.snapTo / press / hold / withdraw / irrigate, the context keys), so
// what the trainee sees is what they will do: shafts slide in through their ports, jaws close, layers open, the
// stapler fires. Camera moves stay in the scope rig (step view, aim from the scope's port, lens glide in), eased by
// the rig. A demo starts from the step's start state (reversible state reset; a case with irreversible changes
// — divisions, nodes out, fissure fires — reloads into the step instead) and leaves the post-action state; "Try it"
// reloads into the step's start. Event-time code: one rAF-driven promise per motion, nothing in the frame loop.
import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { Port } from '../sim/ports';
import { guidedDemoConfig as D } from './guidedDemo.config';
import { config } from '../core/config';
import { ANATOMY } from '../content/anatomy';
import { SUB_IDS, TARGET_BY_ID } from '../content/targets';
import { interactionConfig } from '../sim/interaction.config';
import type { FinishState } from '../sim/actions/finish';
import { CONTEXT_ACTIONS, SLOTS } from '../sim/hotbar';
import { getMode } from '../sim/modes';
import { ease, TWEEN_KEYS, tweenTo } from '../sim/state';
import type { TweenKey } from '../sim/state';
import { getStep } from '../sim/steps';
import { FISSURE_SEGMENTS, fissureGuideConfig } from '../scene/fissureGuide.config';

const CAM = 'port_camera_8ICS';
const UTIL = 'port_utility_5ICS'; // access incision
const RET = 'port_retraction_8ICS'; // anterior working port
const RUL = 'lung_upper_lobe_right';
const RML = 'lung_middle_lobe_right';
const RLL = 'lung_lower_lobe_right';
const VEIN = 'middle_lobe_vein';
const BR = 'middle_lobe_bronchus';
const ART = 'middle_lobe_artery';
const PLEURA = 'mediastinal_pleura_hilum';
const STRANDS = 'hilar_connective_tissue';

/** Camera: the step's scope view, aim from the scope's port at a target (or the midpoint of two, or the next
 *  fissure segment / last node bed), or the lens gliding in along the scope port's axis. */
export type DemoCam = 'step' | 'insert' | 'segment' | 'bed' | string | readonly [string, string];

export type DemoAct =
  /** Ease a state key to a value (the start pose a lift starts from). */
  | { k: 'pose'; key: TweenKey; to: number }
  /** Select the tool (+ sub-option), bring it through the first `port` from which a `target` is reachable, slide in. */
  | {
      k: 'insert';
      tool: string;
      sub?: string;
      port: string | readonly string[];
      target: string | readonly string[];
    }
  /** Jaws on the placed lobe; the lung follows the retract key to `to`; `hold` leaves it holding (G). */
  | { k: 'grasp'; key?: TweenKey; to?: number; hold?: boolean }
  /** Energy / blunt tip pressed while it sweeps back and forth over the placed target's surface. */
  | { k: 'sweep' }
  /** Left button down for the beat, then up (clamp close, stapler close without firing, suction). */
  | { k: 'press' }
  /** Stapler press: close, fire, open; waits for the division of `target`. */
  | { k: 'fire'; target: string }
  /** Ring forceps press on the node, a tug toward the port, out (the node comes out with it and is recorded). */
  | { k: 'node' }
  /** Stapler to the next fissure-guide segment (inserted on the first), fire, wait. */
  | { k: 'segment'; port: string | readonly string[] }
  | { k: 'withdraw' }
  | { k: 'key'; id: 'ventilate' | 'bag' }
  | { k: 'irrigate' }
  /** A check the trainee does by looking (finish.ts flags), narrated with a camera move. */
  | { k: 'set'; finish: Partial<FinishState> };

export interface DemoBeat {
  readonly say: string;
  readonly ms?: number;
  readonly cam?: DemoCam;
  readonly act?: DemoAct;
}

/** One record per beat (e2e): what was in hand, through which port, and whether the scope stayed inside. */
export interface DemoLog {
  beat: number;
  tool: string | null;
  port: string | null;
  /** Fulcrum (port pleura point) distance from the shaft line, m (0 = the shaft passes through the port). */
  offAxisM: number;
  inside: boolean;
  water: number;
  /** Insert beats: the ports the script allows for the instrument. */
  want?: readonly string[];
}

declare global {
  interface Window {
    /** T851 demo status for e2e: idle | running | done | stopped | reload | the refusal that ended it. */
    __demo?: { status: string; step: number; log: DemoLog[] };
  }
}

const VEIN_DONE: Partial<FinishState> = { veinDivided: true };
const NODES_DONE = { ...VEIN_DONE, specimens: ['LN_11R', 'LN_12R'] };
const BRONCHUS_DONE = {
  ...NODES_DONE,
  bronchusClamped: true,
  bronchusTestPassed: true,
  bronchusDivided: true,
};
const HILUM_DONE = { ...BRONCHUS_DONE, arteryDivided: true };
const FREE = { ...HILUM_DONE, fissureFires: FISSURE_SEGMENTS, undersideConfirmed: true, lobeFree: true };

/** Finish state each step starts from (what the earlier steps did; the step visibility already hides it). */
export const START: Readonly<Record<number, Partial<FinishState>>> = {
  1: {},
  2: {},
  3: {},
  4: VEIN_DONE,
  5: NODES_DONE,
  6: BRONCHUS_DONE,
  7: HILUM_DONE,
  8: FREE,
  9: { ...FREE, lobeRemoved: true, specimens: [...NODES_DONE.specimens, fissureGuideConfig.lobe] },
};

/** Per guided step. Captions are paraphrased teaching text. */
export const DEMOS: Readonly<Record<number, readonly DemoBeat[]>> = {
  1: [
    { cam: 'insert', say: 'The 30° scope goes in through the camera port, low in the 8th space.' },
    { cam: RUL, say: 'Upper lobe: collapsed and away from the chest wall on one-lung ventilation.' },
    { cam: [RUL, RML], say: 'The horizontal fissure separates the upper lobe from the middle lobe.' },
    { cam: RML, say: 'The middle lobe, the lobe this operation removes.' },
    { cam: [RML, RLL], say: 'The oblique fissure runs below it, down to the lower lobe.' },
    { cam: RLL, say: 'Lower lobe, resting on the diaphragm.' },
    { cam: 'phrenic_nerve_right', say: 'The phrenic nerve runs down the pericardium in front of the hilum.' },
    { cam: 'step', say: 'Landmarks named: nothing is touched before this survey.' },
  ],
  2: [
    {
      cam: 'step',
      act: { k: 'pose', key: 'retract_hilum', to: 0 },
      say: 'The collapsed lung still lies over the front of the hilum.',
    },
    {
      act: { k: 'insert', tool: 'grasper', sub: 'retractor', port: [RET, CAM], target: [RUL, RLL] },
      say: 'A lung grasper slides in through a working port.',
    },
    {
      act: { k: 'grasp', key: 'retract_hilum', to: 1, hold: true },
      say: 'It takes the lung and lifts it backwards, opening a window onto the hilum.',
    },
    { cam: PLEURA, say: 'The scope follows to the front of the hilum.' },
    {
      act: { k: 'insert', tool: 'cautery', port: [UTIL, CAM], target: PLEURA },
      say: 'The hook cautery comes in through the access incision.',
    },
    {
      act: { k: 'sweep' },
      say: 'Short strokes open the thin mediastinal pleura over the vein, well clear of the phrenic nerve.',
    },
    { act: { k: 'withdraw' }, say: 'Pleura open: the hook comes out, the grasper keeps the lung back.' },
  ],
  3: [
    { cam: STRANDS, say: 'Fine strands still tie the middle lobe vein down.' },
    {
      act: { k: 'insert', tool: 'cautery', port: [UTIL, RET], target: STRANDS },
      say: 'The hook comes in through the access incision…',
    },
    { act: { k: 'sweep' }, say: '…and divides the strands close to the vein wall.' },
    { act: { k: 'withdraw' }, say: 'Hook out.' },
    {
      cam: VEIN,
      act: { k: 'insert', tool: 'peanut', port: [UTIL, RET], target: VEIN },
      say: 'The peanut slips in beside the vein.',
    },
    { act: { k: 'sweep' }, say: 'Gentle sweeps open a passage behind it, away from the artery.' },
    { act: { k: 'withdraw' }, say: 'Passage made.' },
    {
      act: { k: 'insert', tool: 'stapler', sub: 'vascular-curved', port: [RET, UTIL], target: VEIN },
      say: 'The curved-tip vascular stapler follows the passage from the anterior port.',
    },
    {
      act: { k: 'fire', target: VEIN },
      say: 'Close, compress, fire: the vein is divided between staple lines.',
    },
    { act: { k: 'withdraw' }, say: 'Stapler out; the upper lobe vein stays.' },
  ],
  4: [
    { cam: 'LN_11R', say: 'Nodes 11R and 12R sit in the angle at the root of the middle lobe bronchus.' },
    {
      act: { k: 'insert', tool: 'grasper', sub: 'ring', port: UTIL, target: 'LN_11R' },
      say: 'Ring forceps through the access incision onto node 11R.',
    },
    { act: { k: 'node' }, say: 'Grasped, teased free and out: sample 11R recorded.' },
    {
      cam: 'LN_12R',
      act: { k: 'insert', tool: 'grasper', sub: 'ring', port: UTIL, target: 'LN_12R' },
      say: 'Back in for node 12R beside the bronchus.',
    },
    { act: { k: 'node' }, say: 'Node 12R out and recorded.' },
    {
      cam: 'bed',
      act: { k: 'insert', tool: 'cautery', port: [UTIL, RET], target: 'bed' },
      say: 'The node bed oozes a little: the hook goes to the bleeding point.',
    },
    { act: { k: 'press' }, say: 'A short touch of energy seals it, off the bronchus wall.' },
    { act: { k: 'withdraw' }, say: 'Bed dry; the bronchus is now clear to see.' },
  ],
  5: [
    { cam: BR, say: 'The middle lobe bronchus, freed of its nodes.' },
    {
      act: { k: 'insert', tool: 'clamp', port: [UTIL, RET], target: BR },
      say: 'The clamp comes in through the access incision…',
    },
    { act: { k: 'press' }, say: '…and closes across the bronchus.' },
    {
      act: { k: 'insert', tool: 'stapler', sub: 'bronchial', port: [RET, UTIL], target: BR },
      say: 'The bronchial stapler comes in from the anterior port.',
    },
    { act: { k: 'press' }, say: 'Its jaws close across the bronchus, not fired yet.' },
    {
      act: { k: 'key', id: 'ventilate' },
      ms: config.finish.testVentilationMs + 500,
      say: 'A test breath: upper and lower lobes inflate, the middle lobe stays down — the right airway.',
    },
    { act: { k: 'fire', target: BR }, say: 'Confirmed: fire. The bronchus is divided.' },
    { act: { k: 'withdraw' }, say: 'Stapler out.' },
  ],
  6: [
    { cam: ART, say: 'Behind the bronchus: the middle lobe artery and its A4 / A5 branches.' },
    {
      act: { k: 'insert', tool: 'peanut', port: [UTIL, RET], target: ART },
      say: 'The peanut comes in through the access incision.',
    },
    {
      act: { k: 'sweep' },
      say: 'It opens a gentle passage behind the artery; no pull on the lung meanwhile.',
    },
    { act: { k: 'withdraw' }, say: 'Passage made.' },
    {
      act: { k: 'insert', tool: 'stapler', sub: 'vascular-leader', port: [RET, UTIL], target: ART },
      say: 'The leader guides the vascular stapler through.',
    },
    { act: { k: 'fire', target: ART }, say: 'Fire: both middle lobe artery branches divided.' },
    { act: { k: 'withdraw' }, say: 'Stapler out: only the fissures still hold the lobe.' },
  ],
  7: [
    {
      cam: 'step',
      act: { k: 'pose', key: 'retract_fissure', to: 0.5 },
      say: 'The dotted line marks where the middle lobe meets the upper and lower lobes.',
    },
    {
      act: { k: 'insert', tool: 'grasper', sub: 'retractor', port: [UTIL, RET], target: RML },
      say: 'A grasper takes the middle lobe through the access incision…',
    },
    {
      act: { k: 'grasp', key: 'retract_fissure', to: 1, hold: true },
      say: '…and pulls it away from its neighbours, opening both fissures.',
    },
    {
      cam: 'segment',
      act: { k: 'segment', port: [UTIL, RET] },
      say: 'Powered stapler on the first segment: fire.',
    },
    {
      cam: 'segment',
      act: { k: 'segment', port: [UTIL, RET] },
      say: 'Next segment: the horizontal fissure is complete.',
    },
    {
      cam: 'bronchial_tree',
      act: { k: 'set', finish: { undersideConfirmed: true } },
      say: 'A look under the lobe: the bronchial stump lies clear of the stapler jaws.',
    },
    { cam: 'segment', act: { k: 'segment', port: [UTIL, RET] }, say: 'On along the oblique fissure.' },
    {
      cam: 'segment',
      act: { k: 'segment', port: [UTIL, RET] },
      say: 'Last segment: the middle lobe is free.',
    },
    { cam: 'step', act: { k: 'withdraw' }, say: 'The free lobe drifts with the grasper.' },
  ],
  8: [
    { cam: RML, say: 'The free middle lobe, ready to come out.' },
    {
      act: { k: 'insert', tool: 'grasper', sub: 'retractor', port: [UTIL, RET], target: RML },
      say: 'A grasper through the access incision takes it…',
    },
    { act: { k: 'grasp' }, say: '…and guides it into the opened retrieval bag.' },
    { act: { k: 'key', id: 'bag' }, say: 'The closed bag comes out through the access incision.' },
    { cam: 'step', act: { k: 'withdraw' }, say: 'Specimen out; the stumps stay behind.' },
  ],
  9: [
    { cam: 'step', say: 'Last checks: the stumps and the node beds.' },
    {
      act: { k: 'irrigate' },
      ms: 4000,
      say: 'Warm saline fills the chest until the stumps are under water.',
    },
    { act: { k: 'key', id: 'ventilate' }, ms: 3000, say: 'A breath under saline: no bubbles, no air leak.' },
    {
      act: { k: 'insert', tool: 'sucker', sub: 'suction', port: [UTIL, RET], target: 'bronchial_tree' },
      say: 'The sucker comes in through the access incision.',
    },
    { act: { k: 'press' }, ms: 3000, say: 'Suction clears the saline from the field.' },
    { act: { k: 'withdraw' }, say: 'Field dry: the case is complete.' },
  ],
};

export const hasDemo = (step: number): boolean => DEMOS[step] !== undefined;

// ── Small async helpers (one rAF promise per motion; a newer run / stop bumps `token` and every loop exits) ──
let token = 0;
const frame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));
async function sleep(ms: number, me: number): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    await frame();
    if (me !== token) return false;
  }
  return true;
}
async function until(ok: () => boolean, me: number, ms = D.timeoutMs): Promise<boolean> {
  const end = performance.now() + ms;
  while (!ok()) {
    if (me !== token || performance.now() > end) return false;
    await frame();
  }
  return true;
}
async function animate(ms: number, me: number, fn: (e: number) => void): Promise<boolean> {
  const t0 = performance.now();
  for (let p = 0; p < 1;) {
    await frame();
    if (me !== token) return false;
    p = Math.min(1, (performance.now() - t0) / ms);
    fn(ease(p));
  }
  return true;
}

const CODES: Readonly<Record<string, string>> = Object.fromEntries(
  CONTEXT_ACTIONS.map((c) => [c.id, c.code]),
);
const list = <T>(v: T | readonly T[]): readonly T[] => (Array.isArray(v) ? (v as readonly T[]) : [v as T]);
const point = (id: string, out: Vector3): Vector3 => out.fromArray(TARGET_BY_ID.get(id)?.point ?? [0, 0, 0]);

type Sim = Window['__sim'];
type M4 = NonNullable<Sim['m4']>;

/** World vertices of `name` (current morph pose) within `r` of `near` (all when r = Infinity). Action time. */
function vertices(sim: Sim, name: string, near: Vector3, r: number): Vector3[] {
  const out: Vector3[] = [];
  for (const m of sim.m3?.picker.meshes ?? []) {
    let o: Object3D | null = m;
    while (o && o.name !== name) o = o.parent;
    if (!o) continue;
    const n = m.geometry.getAttribute('position').count;
    for (let i = 0; i < n; i++) {
      const v = m.getVertexPosition(i, new Vector3()).applyMatrix4(m.matrixWorld);
      if (v.distanceTo(near) <= r) out.push(v);
    }
  }
  return out;
}

/** Where the straight shaft from `pleura` toward `v` first meets `name` (copied), passing dissectable layers like
 *  the tissue-aware tip does; null when anything else is in the way. */
function seen(sim: Sim, name: string, pleura: Vector3, v: Vector3): Vector3 | null {
  const C = interactionConfig.collide;
  const d = v.clone().sub(pleura);
  const far = d.length() + D.reach.beyondM;
  d.normalize();
  let near = C.skipM;
  for (let i = 0; i <= C.passMax && near < far; i++) {
    const hit = sim.m3?.picker.ray(pleura, d, near, far);
    if (!hit) return null;
    if (hit.nodeName === name) return hit.point.clone();
    if (ANATOMY.structures[hit.nodeName]?.dissectable !== true) return null;
    near = hit.distance + C.passStepM;
  }
  return null;
}

/** Point on `name` the instrument through `pleura` reaches in a straight line (nothing in front of it, so the
 *  tissue-aware tip lands on it): its vertices nearest in angle to the port → centre line, tried in that order. */
function reach(sim: Sim, name: string, port: Port): Vector3 | null {
  const IC = config.instrumentControl;
  const cone = Math.cos(MathUtils.degToRad(IC.coneDeg));
  const pleura = port.pleura;
  const c = point(name, new Vector3());
  const dir = c.clone().sub(pleura).normalize();
  const vs = vertices(sim, name, c, Infinity)
    .filter((v) => {
      const d = v.distanceTo(pleura);
      return d >= IC.depthM.min && d <= IC.depthM.max && v.clone().sub(pleura).dot(port.axis) >= d * cone;
    })
    .map((v) => ({ v, cos: v.clone().sub(pleura).normalize().dot(dir) }))
    .sort((x, y) => y.cos - x.cos);
  const stride = Math.max(1, Math.floor((vs.length * D.reach.topFrac) / D.reach.tries));
  for (let i = 0; i < vs.length && i < stride * D.reach.tries; i += stride) {
    const hit = seen(sim, name, pleura, (vs[i] as { v: Vector3 }).v);
    if (hit) return hit;
  }
  return vs[0]?.v ?? null; // nothing clear: the best-aligned point (the snap reaches through yielding tissue)
}

/** Sweep path through `at` along the local long axis of `name`'s surface: points the shaft from `pleura` reaches
 *  on that surface (others are skipped). */
function sweepPath(sim: Sim, name: string, at: Vector3, pleura: Vector3): Vector3[] {
  const S = D.sweep;
  const pts = vertices(sim, name, at, S.radiusM);
  if (pts.length < 3) return [at.clone()];
  const c = pts.reduce((a, p) => a.add(p), new Vector3()).divideScalar(pts.length);
  let axis = new Vector3(1, 0, 0);
  let spread = -1;
  for (const p of pts) {
    const d = p.distanceTo(c);
    if (d > spread) {
      spread = d;
      axis = p.clone().sub(c).normalize();
    }
  }
  const path: Vector3[] = [];
  for (let i = 0; i < S.points; i++) {
    const q = at.clone().addScaledVector(axis, (i / (S.points - 1) - 0.5) * S.spanM);
    let best = pts[0] as Vector3;
    for (const p of pts) if (p.distanceToSquared(q) < best.distanceToSquared(q)) best = p;
    const hit = seen(sim, name, pleura, best);
    if (hit) path.push(hit);
  }
  return path.length > 1 ? path : [at.clone()];
}

const _pos = new Vector3();
const _quat = new Quaternion();
const _fov = { fov: 0 };
/** The rig's current pose keeps the shaft within the pivot cone (an aim never swings the lens out of the chest). */
function lensInside(scope: NonNullable<Sim['m3']>['scope']): boolean {
  scope.writePose(_pos, _quat, _fov);
  const cos = Math.cos(MathUtils.degToRad(config.scopeRig.pivotConeDeg));
  return _pos.sub(scope.port.pleura).dot(scope.port.axis) >= scope.depth * cos;
}

/** The scope camera pose for a step-view / aim beat (eased by the rig). */
function moveCamera(sim: Sim, cam: DemoCam, bed: Vector3): void {
  const { m3, rig } = sim;
  if (!m3 || !rig) return;
  const scope = m3.scope;
  if (cam === 'step' || cam === 'insert') {
    scope.snapTo(rig.scopePoseOf(sim.state.camera), sim.state.port);
    if (config.scopeRig.levelOnStepSnap) scope.setHorizonLock(true);
    if (cam === 'insert') {
      // Cut to the lens just inside the camera port, then glide in to the step view along the port axis.
      const depth = scope.depth;
      scope.depth = D.scopeEntryM;
      m3.syncScope();
      sim.setView('scope', true);
      rig.update(performance.now());
      scope.depth = depth;
    }
  } else {
    const at = new Vector3();
    if (cam === 'segment') sim.fissure?.next(at);
    else if (cam === 'bed') at.copy(bed);
    else if (typeof cam === 'string') point(cam, at);
    else at.copy(point(cam[0], new Vector3()).add(point(cam[1], new Vector3())).multiplyScalar(0.5));
    // Aim from the scope's port; a pose that would swing the lens out of the chest aims part-way toward the step
    // view's own line of sight instead, else keeps the step view.
    const pose = rig.scopePoseOf(sim.state.camera);
    const look = new Vector3(0, 0, -1)
      .applyQuaternion(pose.quaternion)
      .multiplyScalar(at.distanceTo(pose.position))
      .add(pose.position);
    let ok = false;
    for (const k of D.aimBlend) {
      scope.aimFrom(scope.port.id, new Vector3().lerpVectors(at, look, k));
      if ((ok = lensInside(scope))) break;
    }
    if (!ok) scope.snapTo(pose, sim.state.port);
  }
  m3.syncScope();
  rig.easeScope();
}

/** No irreversible change yet beyond `step`'s start (divisions, nodes out, fissure fires, staple lines)? */
export function pristine(step: number): boolean {
  const m4 = window.__sim.m4;
  const s = START[step] ?? {};
  if (!m4) return false;
  return (
    m4.flags.size === 0 &&
    m4.staples.lineCount === 0 &&
    m4.finish.specimens.length <= (s.specimens?.length ?? 0) &&
    m4.finish.fissureFires <= (s.fissureFires ?? 0) &&
    (!m4.finish.lobeRemoved || s.lobeRemoved === true)
  );
}

/** Reversible reset to `step`'s start: instruments out, step pose, clean field, start finish state. */
export function applyStart(step: number): void {
  const sim = window.__sim;
  const m4 = sim.m4;
  if (!m4) return;
  if (m4.tool) m4.withdraw();
  for (let n = m4.occupancy.holds.length + 1; n > 0 && m4.occupancy.holds.length > 0; n--) m4.releaseHold();
  const st = getStep(step).state;
  for (const key of TWEEN_KEYS)
    if (key.startsWith('deflate_') || key.startsWith('retract_'))
      tweenTo(sim.state, key, st[key] ?? 0, config.steps.stateMs);
  m4.cuts.reset();
  m4.water.reset();
  m4.fx.fog.clear();
  const s = START[step] ?? {};
  Object.assign(m4.finish, s, { specimens: [...(s.specimens ?? [])] });
}

/** Reload into `step` (Guided / Explore kept): 'run' plays the demo there, 'try' just starts the step. */
export function reloadInto(step: number, demo: 'run' | 'try'): void {
  const u = new URL(location.href);
  u.searchParams.set('step', String(step));
  u.searchParams.set('view', 'scope');
  u.searchParams.set('demo', demo);
  if (getMode() === 'explore') u.searchParams.set('mode', 'explore');
  else u.searchParams.delete('mode');
  location.assign(u);
}

let pressed = false;
const bed = new Vector3();
let hooked = false;
function cleanUp(): void {
  if (pressed) window.__sim.m4?.press(false);
  pressed = false;
}

/** Skip: stop at the next frame, the button let go (instruments stay where they are). */
export function stopDemo(): void {
  token++;
  cleanUp();
  if (window.__demo?.status === 'running') window.__demo.status = 'stopped';
}

/** Select tool `id` + sub-option on the hotbar and bring it to the first port of `ports` that takes it. */
function bring(m4: M4, sim: Sim, id: string, sub: string | undefined, ports: readonly string[]): string {
  const hb = sim.m3?.hotbar;
  if (!hb) return 'not wired';
  const slot = SLOTS.findIndex((s) => s.id === id);
  if (hb.slot !== slot) hb.select(slot);
  const k = sub ? (SUB_IDS[id as keyof typeof SUB_IDS]?.indexOf(sub) ?? 0) : 0;
  for (let n = 0; n < (SLOTS[slot]?.subOptions.length ?? 0) && hb.subOption() !== k; n++) hb.select(slot);
  const o = m4.occupancy;
  for (const want of ports)
    for (let n = 0; n <= (sim.m3?.scope.ports.length ?? 0); n++) {
      if (o.activePort === want) return 'ok';
      m4.nextToolPort();
    }
  return `No room for the ${id} in ${ports.join(' / ')}`;
}

async function act(a: DemoAct, ms: number, me: number): Promise<string> {
  const sim = window.__sim;
  const m4 = sim.m4 as M4;
  const c = m4.control;
  switch (a.k) {
    case 'pose':
      tweenTo(sim.state, a.key, a.to, Math.min(ms, config.steps.stateMs));
      return 'ok';
    case 'insert': {
      // Every (port, target) the script allows, in order: the first the tissue-aware snap accepts. The snap seats
      // the instrument (m4.target, jaws); the tip then restarts from its parked depth and slides in along the shaft.
      let r = 'No reachable target';
      for (const port of list(a.port))
        for (const target of list(a.target)) {
          if (bring(m4, sim, a.tool, a.sub, [port]) !== 'ok' || !c.port) continue;
          const at = target === 'bed' ? bed.clone() : reach(sim, target, c.port);
          if (!at) continue;
          r = m4.snapTo(target === 'bed' ? (m4.finish.specimens.at(-1) ?? BR) : target, at);
          if (r !== 'ok') continue;
          c.park(c.port);
          const from = c.tipPos.clone();
          const tip = new Vector3();
          return (await animate(D.insertMs, me, (e) => c.aimAt(tip.lerpVectors(from, at, e))))
            ? 'ok'
            : 'stopped';
        }
      return r;
    }
    case 'grasp': {
      if (m4.press(true) !== 'ok') return m4.lastToast;
      pressed = true;
      if (a.key) tweenTo(sim.state, a.key, a.to ?? 1, Math.min(ms, config.steps.stateMs));
      if (!(await sleep(Math.min(ms, config.steps.stateMs), me))) return 'stopped';
      if (a.hold) {
        m4.hold();
        pressed = false;
      }
      return 'ok';
    }
    case 'sweep': {
      const pleura = c.port?.pleura;
      const path = pleura ? sweepPath(sim, m4.target ?? '', c.tipPos.clone(), pleura) : [c.tipPos.clone()];
      m4.press(true); // the peanut answers with its passage toast: the sweep goes on either way
      pressed = true;
      const n = path.length - 1;
      const S = D.sweep;
      const tip = new Vector3();
      const ok = await animate(ms, me, (e) => {
        // Back and forth `passes` times along the path.
        const u = (e * S.passes) % 2;
        const f = (u > 1 ? 2 - u : u) * n;
        const i = Math.min(n - 1, Math.floor(f));
        if (n > 0) c.aimAt(tip.lerpVectors(path[i] as Vector3, path[i + 1] as Vector3, f - i));
      });
      m4.press(false);
      pressed = false;
      return ok ? 'ok' : 'stopped';
    }
    case 'press': {
      // Answers are toasts the trainee sees (clamp closed, stapler closed: test first …); the step checks judge.
      m4.press(true);
      pressed = true;
      const ok = await sleep(ms, me);
      m4.press(false);
      pressed = false;
      return ok ? 'ok' : 'stopped';
    }
    case 'fire': {
      const r = m4.press(true);
      m4.press(false);
      if (r !== 'ok') return r;
      return (await until(() => m4.flags.has(`divided:${a.target}`), me)) && (await sleep(D.fireMs / 2, me))
        ? 'ok'
        : `${a.target} was not divided`;
    }
    case 'node': {
      if (m4.press(true) !== 'ok') return m4.lastToast;
      m4.press(false);
      const port = c.port?.pleura;
      const from = c.tipPos.clone();
      const to = port ? from.clone().lerp(port, D.tugM / Math.max(D.tugM, from.distanceTo(port))) : from;
      const tip = new Vector3();
      if (!(await animate(D.tugMs, me, (e) => c.aimAt(tip.lerpVectors(from, to, e))))) return 'stopped';
      m4.withdraw();
      return (await until(() => c.phase === 'parked', me)) ? 'ok' : 'stopped';
    }
    case 'segment': {
      const at = new Vector3();
      const before = sim.fissure?.fired ?? 0;
      if (!sim.fissure?.next(at)) return 'No fissure segment left';
      if (m4.tool !== 'stapler') {
        const r = await act(
          { k: 'insert', tool: 'stapler', sub: 'parenchyma', port: a.port, target: RML },
          ms,
          me,
        );
        if (r !== 'ok') return r;
      }
      const r = m4.snapTo(RML, at);
      if (r !== 'ok') return r;
      if (!(await until(() => c.phase === 'placed', me))) return 'stopped';
      const f = m4.press(true);
      m4.press(false);
      if (f !== 'ok') return f;
      if (!(await until(() => (sim.fissure?.fired ?? 0) > before, me))) return 'The segment did not fire';
      return (await sleep(D.fireMs, me)) ? 'ok' : 'stopped';
    }
    case 'withdraw':
      if (m4.tool) m4.withdraw();
      return 'ok';
    case 'key': {
      const code = CODES[a.id];
      if (code) window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      return 'ok';
    }
    case 'irrigate':
      m4.irrigate(); // answers with its "saline in" toast
      return 'ok';
    case 'set':
      Object.assign(m4.finish, a.finish);
      return 'ok';
  }
}

function record(beat: number): DemoLog {
  const sim = window.__sim;
  const m4 = sim.m4 as M4;
  const c = m4.control;
  const p = c.port;
  const off = p ? p.pleura.clone().sub(c.tipPos).cross(c.shaftDir).length() : 0;
  const cam = sim.rig?.camera.position;
  const sp = sim.m3?.scope.port;
  // In the scope rig at its port (never the outside / orbit view), lens within the rig's depth range.
  const inside =
    !!cam &&
    !!sp &&
    sim.rig?.mode === 'scope' &&
    cam.distanceTo(sp.pleura) <= config.scopeRig.depthM.max + 1e-6;
  return { beat, tool: m4.tool, port: m4.occupancy.activePort, offAxisM: off, inside, water: m4.water.level };
}

/** Run step `step`'s demo; `say` gets the captions; `fresh` = just reloaded into the step (no second reload).
 *  Resolves 'done', 'stopped', 'reload' or the refusal that ended it. */
export async function runDemo(step: number, say: (text: string) => void, fresh = false): Promise<string> {
  const beats = DEMOS[step];
  const sim = window.__sim;
  const m4 = sim.m4;
  if (!beats || !m4 || !sim.m3 || !sim.rig) return 'no demo';
  stopDemo();
  const me = token;
  const status = (window.__demo = { status: 'running', step, log: [] as DemoLog[] });
  if (!fresh && !pristine(step)) {
    status.status = 'reload';
    reloadInto(step, 'run');
    return 'reload';
  }
  if (!hooked) {
    hooked = true;
    m4.onNodeRemoved.push((_, p) => void bed.copy(p));
  }
  applyStart(step);
  sim.setView('scope');
  moveCamera(sim, 'step', bed);
  if (!(await sleep(config.scope.transitionMs, me))) return 'stopped';
  for (const [i, b] of beats.entries()) {
    if (me !== token) return 'stopped';
    say(b.say);
    const ms = b.ms ?? D.beatMs;
    const t0 = performance.now();
    if (b.cam) moveCamera(sim, b.cam, bed);
    const r = b.act ? await act(b.act, ms, me) : 'ok';
    if (me !== token) return 'stopped';
    const a = b.act;
    const want = a?.k === 'insert' || a?.k === 'segment' ? a.port : undefined;
    status.log.push({ ...record(i), ...(want ? { want: typeof want === 'string' ? [want] : want } : {}) });
    if (r !== 'ok') {
      cleanUp();
      status.status = r;
      return r;
    }
    if (!(await sleep(Math.max(0, ms - (performance.now() - t0)), me))) return 'stopped';
  }
  status.status = 'done';
  return 'done';
}
