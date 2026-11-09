// M4 glue (T409): instruments + port occupancy, snap / steer / activate control, grasp-retract, dissect, encircle,
// staple-divide (division planes + staple-line caps), clips, the finish sequence (bronchus test, nodes, fissure,
// bag, chest tube, irrigation + water test), effect pools, gloved hands + the PiP inset. Called once from the
// loader's place() callback right after wireM3, so every object below is in the scene before the compile and
// warm-up stages (§6.10: 0 new programs after ready). Input is event-driven; update(now) is allocation-free.
// Practice mode: `gate` (T505 sets it to the PracticeEngine) is the single authority on action order; while it is
// null actions just apply. finish.ts keeps only its physical prerequisites (no bag before the lobe is free, …).
import { Line3, Matrix3, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { IUniform, Mesh, Scene, WebGLRenderer } from 'three';
import { config } from '../core/config';
import { CONTEXT_KEYS, keybindings as K, matchesKey } from '../core/keybindings';
import type { QualityPreset } from '../core/quality';
import { labelFor } from '../content/labels';
import { ANATOMY } from '../content/anatomy';
import { SUB_IDS, TARGET_BY_ID, TARGETS, divisionGroup, lobeOf } from '../content/targets';
import { cauteryConfig as CAUTERY } from '../scene/cautery.config';
import { createEffects, CutPool } from '../scene/effects';
import type { FissureGuide, Segment } from '../scene/fissureGuide';
import { buildHands } from '../scene/hands';
import { buildInstruments, TOOL_IDS } from '../scene/instruments';
import { buildRetrievalBag } from '../scene/retrievalBag';
import type { ToolId } from '../scene/instruments';
import { instrumentAnim, instrumentGeom, instrumentLook } from '../scene/instruments.config';
import { registerWarmupHook, withAllVisible } from '../scene/loadingStages';
import { getDivisionPlanes, graspUniforms, openedLayers, pushUniforms } from '../scene/materials';
import type { PickHit } from '../scene/picking';
import { DISSECTABLE } from '../scene/materials.config';
import { localAxis, setDivisionPlane, Staples, STAPLES_CONFIG } from '../scene/staples';
import { Water } from '../scene/water';
import { waterConfig } from '../scene/water.config';
import { Dissect } from '../sim/actions/dissect';
import * as F from '../sim/actions/finish';
import { irrigateField, mountIrrigateButton } from '../sim/actions/irrigation';
import { RETRACT_KEYS, Retract } from '../sim/actions/retract';
import { ClipFire, closedJawFor, Encircle, jawPose, needsEncircle, StapleFire } from '../sim/actions/staple';
import type { JawTool } from '../sim/actions/staple';
import { getStumps, setStumpHeartbeat } from '../scene/stumps';
import { parkDivisionPlanes } from '../scene/staples';
import { STUMPS } from '../scene/stumps.config';
import { SLOTS } from '../sim/hotbar';
import { InstrumentController } from '../sim/instrumentControl';
import { getMode, onModeChange } from '../sim/modes';
import { interactionConfig as I, invKind } from '../sim/interaction.config';
import { PortOccupancy } from '../sim/portOccupancy';
import { loadPracticeActions } from '../sim/practiceActions';
import { contactOf, TipCollision } from '../sim/tipCollision';
import type { Hold } from '../sim/portOccupancy';
import type { Port } from '../sim/ports';
import type { PracticeAttempt } from '../sim/practice';
import type { ActionKind, PracticeTool } from '../sim/practiceActions';
import { retractionConfig as R } from '../sim/retraction.config';
import { startOLV, tweenTo } from '../sim/state';
import { applyVisibility, STEPS } from '../sim/steps';
import { asEngine, inputLocked, walkRate } from '../sim/walkLock';
import { createWalkthrough } from './walkthrough/engine';
import { createVoice } from './walkthrough/voice';
import type { TweenKey } from '../sim/state';
import { keyCap } from '../ui/helpOverlay';
import { mountPortPicker, mountRetractionStrip } from '../ui/hotbar';
import { createPip } from '../ui/pip';
import type { Pip } from '../ui/pip';
import type { M3, M3Context } from './wireM3';

export interface M4Context extends M3Context {
  m3: M3;
  scene: Scene;
  renderer: WebGLRenderer;
  preset: QualityPreset;
  /** Post-FX lens-fog amount (uFog), driven by the effect pools. */
  fog: IUniform<number>;
  /** T860 post-FX grade gain (uGain): the walkthrough's reduced-motion dip-to-black cuts. */
  gain?: IUniform<Vector3>;
}

export interface M4 {
  occupancy: PortOccupancy;
  control: InstrumentController;
  finish: F.FinishState;
  staples: Staples;
  pip: Pip;
  /** Instrument in hand (null = Hands / scope). */
  readonly tool: ToolId | null;
  /** Structure the tip is placed on (target id), null until a snap lands. */
  readonly target: string | null;
  /** Finish / action flags raised so far (practice_actions.json result.flags; T505 hands them to the engine). */
  readonly flags: Set<string>;
  /** Scored trainee errors (finish.ts `error: true` reasons) for the debrief (T505). */
  readonly errors: string[];
  /** Last toast text (e2e). */
  readonly lastToast: string;
  /** Practice gate (T505: PracticeEngine.attempt → accepted?). null = explore/free: actions just apply. */
  gate: ((a: PracticeAttempt) => boolean) | null;
  /** Same as a left-click on node `name` at world `point` with the current tool; 'ok' or the toast reason. */
  snapTo: (name: string, point: Vector3) => string;
  /** Same as left button down/up on the placed target; 'ok' or the toast reason. */
  press: (down: boolean) => string;
  /** Same as P with a tool selected: next port with room. */
  nextToolPort: () => string;
  /** T850, same as an "Insert via" button / C · N · U: the hand's instrument (re-)enters through `port`; a parked
   *  one in that port resumes following. 'ok' or the toast reason. */
  insertVia: (port: string) => string;
  /** T850, same as a right click: the hand's instrument stays where it is (still holding), the cursor is free. */
  park: () => string;
  /** T850: the hand's instrument is parked (re-select it to resume). */
  readonly parked: boolean;
  /** T850: lymph-node samples recorded so far (station ids, e.g. '11R'), for the practice debrief. */
  readonly samples: string[];
  /** T850, same as "Record sample" / S: the grasped node comes out as a sample; 'ok' or the toast reason. */
  recordSample: () => string;
  /** T850 tissue-aware tip (limit along the shaft, lung press) and the lung-indent uniforms it drives. */
  readonly collision: TipCollision;
  readonly push: typeof pushUniforms;
  /** T820, same as G / the Hold button: lock the placed grasper / sponge-stick (and its retraction) in its port. */
  hold: () => string;
  /** Same as Shift+G / the Release button: open the clamp in hand, let go of the hand's grip, else withdraw the most
   *  recent instrument left in a port (a retraction eases back). */
  releaseHold: () => string;
  /** T840, same as Esc: withdraw the instrument in hand (a grasped node comes out with it). */
  withdraw: () => string;
  /** T840, same as a port chip's ⏏: withdraw the hand's instrument if it is in `port`, else the last one left there. */
  withdrawPort: (port: string) => string;
  /** T840: structure the clamp is closed on (in hand or left in its port), null = open. */
  readonly clamped: string | null;
  /** T840: lymph node in the jaws (it follows the tip until withdrawn), null = none. */
  readonly grasped: string | null;
  /** T840: called when a node is taken out (hidden) with its name and bed point (shared vector: copy it). Starts
   *  with the node-bed ooze (startOoze); T844 may add practice hooks. */
  readonly onNodeRemoved: ((name: string, point: Vector3) => void)[];
  /** Instruments left in ports drawn right now. */
  heldShown: () => number;
  /** Frame loop, after M3. Allocation-free. */
  update: (now: number) => void;
  /** After the post-FX pass drew the canvas (PiP inset). */
  afterRender: () => void;
  /** Effect pools (T505: complication blood decals + ooze). */
  fx: ReturnType<typeof createEffects>;
  /** T842 persistent cautery dissection openings (per-vertex opened attribute on each dissectable layer). */
  cuts: CutPool;
  /** T842 irrigation saline (level, surface, leak bubbles via water.setLeak(point)). */
  water: Water;
  /** T842 "Irrigate the field" (button / key); 'ok' or the toast reason. */
  irrigate: () => string;
  /** T842 node-bed ooze at world `point` (T840 onNodeRemoved calls this); energised cautery contact seals it. */
  startOoze: (point: Vector3) => void;
  /** T853 step-7 fissure guide (main.ts sets it at load): while active the powered stapler on the middle lobe seats
   *  on its next segment, jaws along it, and the guide (not M4) draws that fire's staple line. */
  fissure: FissureGuide | null;
  /** T822: energised cautery tip touching a surface right now, and where (valid while `contact`). */
  readonly contact: boolean;
  readonly contactPoint: Vector3;
  /** T822 (wireM5): an active bleed near this point → the cautery may be placed there to coagulate. */
  bleedNear: ((p: Vector3) => boolean) | null;
  /** Show the action toast (T505: practice feedback); returns `msg`. */
  toast: (msg: string) => string;
  /** T860 walkthrough engine hooks (src/app/walkthrough): instant case reset + end-state pieces for seek, and the
   *  context actions without the key layer. */
  walk: {
    /** Fresh case in place: instruments out, holds and grips gone, divisions / nodes / staples / openings / fluid /
     *  fissure fires undone, finish + flags cleared, step visibility re-applied. */
    reset(): void;
    /** Instant division (stumps + staple caps, branches hidden) as after a stapler fire. */
    divided(name: string): void;
    /** Instant removal (node / lobe out, sample recorded). */
    removed(name: string): void;
    /** A holding instrument placed instantly in `port` on `target` at world `at` (false: no room). */
    hold(tool: ToolId, sub: string | null, port: string, target: string, at: Vector3): boolean;
    /** Same as A (bronchus clamp test / leak test); 'ok' or the reason. */
    ventilate(): string;
    /** Same as B (bag out through the access incision); 'ok' or the reason. */
    bag(): string;
    /** A stapler / clip fire is still closing, firing or opening. */
    busy(): boolean;
    /** The instrument left in `port` on `target`: a setter sliding it out along its shaft (0 = on the target,
     *  1 = out at the port: the hold is released and it is gone); null if there is none. Event time. */
    heldOut(port: string, target: string): ((f: number) => void) | null;
    /** T883: world tip (jaws) of the grasper left holding in `port` (any port when null) into `out`; false if none
     *  is drawn. Event time. */
    heldTip(port: string | null, out: Vector3): boolean;
  };
}

const A = config.actions;
const ENG = instrumentAnim.engage; // T841 jaws engaged across a structure
const IC = config.instrumentControl;
const FIN = config.finish;
const BRONCHUS = FIN.bronchus[0];
const SKIP_TARGETS = 'input, select, textarea, [contenteditable], dialog';
const REASONS: Readonly<Record<string, string>> = {
  'no-target': 'Nothing to do there with this instrument',
  'no-port': 'No port for this instrument',
  'wrong-tool': 'Wrong instrument or sub-option for this structure',
  'poor-angle': 'Poor stapler angle from this port: try another port (P)',
  'retraction-in-port': 'This port holds the retraction: transfer it via another port (G), then retry',
  'port-full': 'This port is occupied: move the scope (port chips, Shift+P) or use another port (P)',
  'not-collapsed': 'Collapse the lung first (one-lung ventilation)',
  'not-stapleable': 'This structure is not stapled',
  'wrong-cartridge': 'Wrong cartridge for this tissue: press 7 again to change it',
  'not-encircled': 'Pass the right-angle clamp (6) behind it first',
  busy: 'The stapler is still working',
  place: 'Click a structure first to bring the instrument to it',
};

// Module-level temps (no per-frame allocation).
const Z = new Vector3(0, 0, 1);
const tA = new Vector3();
const tB = new Vector3();
const tQ = new Quaternion();
const tN = new Vector3();
const tT = new Vector3();
const tQ2 = new Quaternion();
const tM = new Matrix4();
const tM2 = new Matrix4();
const tM3 = new Matrix3();
const lP = new Vector3(); // lens-exclusion temps (scope limit: event time + settle at follow.hz)
const lQ = new Vector3();
const lK = new Vector3();
const lT = new Vector3();
const lD = new Vector3();
const FOLLOW_MS = 1000 / I.follow.hz;
const FULL = 'All ports are full: withdraw an instrument first (Esc, Shift+G or ⏏ on a port chip)';
const NONE: Mesh[] = [];
const PARKED = '@parked:'; // T850 hold target of an instrument parked off any structure (+ a sequence number)
const INSERT_KEYS = [K.insertVia1, K.insertVia2, K.insertVia3] as const;
/** 'LN_11R' → '11R'. */
const station = (node: string): string => node.replace(/^LN_/, '');

/** An instrument left in its port (T820 holds, T840 any placed tool) or the guided static grasper: its look + where
 *  its tip sits (a target vertex, read morph-aware so the tip rides the retraction / pulse). */
interface Held {
  tool: ToolId | null;
  sub: string | null;
  target: string | null;
  /** Its occupancy entry (null = guided / free). */
  ref: Hold | null;
  /** Retract slot its grip keeps engaged (−1 = none). */
  slot: number;
  /** T853: left while parked (right click): selecting its kind again resumes it. */
  parked: boolean;
  /** T860: walkthrough withdrawal, 0 = on its target … 1 = tip back at the port. */
  out: number;
  port: Port | null;
  obj: Object3D | null;
  mesh: Mesh | null;
  vi: number;
  /** Per tool: a clone of the hand's instrument (shared geometry + materials → no new programs). */
  clones: Record<string, Object3D>;
  /** Per tool: the clone's nodes in traversal order (jaw / sub-option pose copied from the hand when left). */
  nodes: Record<string, Object3D[]>;
}
const fovRef = { fov: 0 };
const SAMPLE_MS = 1000 / CAUTERY.contact.sampleHz;
const SOIL = instrumentLook.soil;

export function wireM4(ctx: M4Context): M4 {
  const { app, canvas, model, camera, rig, guided, state, m3, scene, renderer, preset } = ctx;
  const ports = m3.scope.ports;
  const portLabel = (id: string | null): string => ports.find((p) => p.id === id)?.label ?? '—';
  const toolName = (id: string | null): string => SLOTS.find((s) => s.id === id)?.name ?? 'Hands';

  // Built once, in the scene before compile / warm-up.
  const inst = buildInstruments();
  const fx = createEffects(preset);
  fx.surface = (p, d) => m3.picker.nearest(p, d); // T861: the node-bed rivulet runs down the visible surface
  // T872 retrieval bag (walkthrough step 8: window.__sim.m4.fx.bag.play(lobe, port, t)), on the instruments' programs.
  fx.bag = buildRetrievalBag(
    inst.materials,
    camera,
    (n) => model.getObjectByName(n) ?? null,
    (id) => ports.find((p) => p.id === id) ?? null,
  );
  fx.group.add(fx.bag.group);
  const cuts = new CutPool(openedLayers);
  // Dissected openings are looked through: hover / click reach the structure beneath (same attribute as the shader).
  m3.picker.skip = (m, p) => grab.meshes.includes(m) || cuts.inside(m, p); // T840: nor is a node in the jaws
  const staples = new Staples();
  // T842: level 1 covers the stump and every divided segment's site (manifest divideStep).
  const water = new Water(
    TARGETS.filter((t) => t.id === FIN.stump || ANATOMY.structures[t.id]?.divideStep !== undefined).map(
      (t) => new Vector3(...t.point),
    ),
  );

  const hands = buildHands();
  scene.add(inst.root, fx.group, staples.group, water.mesh, hands.root);
  const stump = new Vector3(...(TARGET_BY_ID.get(FIN.stump)?.point ?? [0, 0, 0]));

  const control = new InstrumentController();
  const occupancy = new PortOccupancy(ports);
  const enc = new Encircle();
  const fire = new StapleFire();
  // T841: jaws engaged across a structure (stapler / clamp / clip): centre + axis at the planned cut, refreshed per
  // frame from the stump split's cut ring (or fixed from a local PCA); clip applications per target.
  const eng = {
    tool: null as JawTool | null,
    target: '',
    split: false,
    offset: 0,
    closed: 0, // clamp: jaw value on the squeezed structure
    done: false, // its structure was divided: let go once the jaws are open
    centre: new Vector3(),
    axis: new Vector3(),
    radius: 0,
  };
  const jawDir = new Vector3();
  const clipFire = new ClipFire();
  const clipsOn = new Map<string, number>();
  let lineOn = false;
  let clipLoaded = true;
  let divideIn = 0;
  const finish = F.createFinishState();
  const retract = new Retract(state, graspUniforms);

  // Node → meshes, filled at load for every target so per-frame fades never allocate.
  const meshCache = new Map<string, Mesh[]>();
  const meshesOf = (name: string): Mesh[] => {
    let list = meshCache.get(name);
    if (!list) {
      const found: Mesh[] = [];
      model.getObjectByName(name)?.traverse((o) => (o as Mesh).isMesh && found.push(o as Mesh));
      meshCache.set(name, (list = found));
    }
    return list;
  };
  for (const t of TARGETS) meshesOf(t.id);

  // T840: each retract key's world direction per lobe = the lobe mesh's mean morph delta (load time, manifest-driven).
  model.updateMatrixWorld();
  for (const [name, s] of Object.entries(ANATOMY.structures)) {
    if (!s.lobe || s.group !== 'lungs') continue;
    const dirs = RETRACT_KEYS.map(() => new Vector3());
    for (const m of meshesOf(name)) {
      const dict = m.morphTargetDictionary;
      const morphs = m.geometry.morphAttributes.position;
      if (!dict || !morphs) continue;
      const base = m.geometry.getAttribute('position');
      tM3.setFromMatrix4(m.matrixWorld);
      RETRACT_KEYS.forEach((k, i) => {
        const a = morphs[dict[k] ?? -1];
        if (!a) return;
        tA.set(0, 0, 0);
        for (let v = 0; v < a.count; v++) {
          tA.add(tB.fromBufferAttribute(a, v));
          if (!m.geometry.morphTargetsRelative) tA.sub(tB.fromBufferAttribute(base, v));
        }
        dirs[i]?.add(tA.divideScalar(Math.max(1, a.count)).applyMatrix3(tM3));
      });
    }
    retract.setDirs(s.lobe, dirs);
  }

  // Action visibility (divided segments, removed nodes / lobe) survives step + view visibility passes.
  const overrides = new Map<string, boolean>();
  const applyOverrides = (): void => {
    for (const [n, v] of overrides) {
      const o = model.getObjectByName(n);
      if (o) o.visible = v;
    }
  };
  const setShown = (n: string, v: boolean): void => {
    overrides.set(n, v);
    applyOverrides();
  };
  const reapplyLayers = m3.reapplyLayers;
  m3.reapplyLayers = () => {
    reapplyLayers();
    applyOverrides();
  };
  guided.on('stepchange', applyOverrides);
  guided.on('transitionend', applyOverrides);

  const dissect = new Dissect({
    clearView: () => fx.suck(control.tipPos), // T842: held sucker aspirates at the tip (release() stops it)
  });

  // Toast (reasons + results), one element reused.
  const toastEl = document.createElement('div');
  toastEl.id = 'action-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.style.cssText =
    'position:fixed;left:50%;top:var(--space-6);transform:translateX(-50%);max-width:60ch;padding:var(--space-1) var(--space-2);background:var(--color-surface-overlay);color:var(--color-text);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-sm);pointer-events:none;z-index:6;visibility:hidden';
  ctx.shell.caption.append(toastEl); // T862: side dock (R5), styles in panels.css
  let toastTimer = 0;
  const toast = (msg: string): string => {
    m4.lastToast = msg;
    if (getMode() === 'guided') return msg; // T878: the walkthrough shows its own captions
    toastEl.textContent = msg;
    toastEl.style.visibility = 'visible';
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.style.visibility = 'hidden'), A.toastMs);
    return msg;
  };

  // Delayed state tweens (bronchus-test re-collapse): fixed pool.
  const pending = Array.from({ length: A.pendingTweens }, () => ({
    at: -1,
    key: 'deflate_RUL' as TweenKey,
    to: 0,
    ms: 0,
  }));

  /** Apply a finish.ts result; false (+ toast) when refused. */
  function dispatch(r: F.FinishResult): boolean {
    if (!r.ok) {
      if (r.error) m4.errors.push(r.reason);
      toast(r.reason);
      return false;
    }
    for (const q of r.requests) {
      if (q.kind === 'tween') {
        if (q.delayMs <= 0) tweenTo(state, q.key, q.to, q.ms);
        else {
          const p = pending.find((s) => s.at < 0);
          if (p) Object.assign(p, { at: performance.now() + q.delayMs, key: q.key, to: q.to, ms: q.ms });
        }
      } else if (q.kind === 'hide') setShown(q.node, false);
      else if (q.kind === 'specimen') toast(`${labelFor(q.node).name}: to the specimen tray`);
      else if (q.kind === 'flag') m4.flags.add(q.flag);
      else if (q.kind === 'rmlDivided') state.rmlDivided = true;
      else if (q.kind === 'fluid') water.fill(q.level);
      else if (q.kind === 'bubbles') {
        fx.bubbleBurst(stump);
        water.setLeak(stump); // keeps streaming while the stump is under water
      }
      // 'divide': the stapler fire already cut its target (onDivide); 'advance': step progression is T505's.
    }
    irrigateBtn.setShown(irrigable()); // the lobe may be out now
    return true;
  }

  const allowed = (
    kind: ActionKind,
    tool: PracticeTool,
    target: string | null,
    port: string | null,
  ): boolean => !m4.gate || m4.gate({ tool, subOption: sub, target, port, kind, point });

  const refreshPorts = (): void => {
    m3.syncScope();
    // T840: hotbar tooltips count the instruments of each kind in the chest; Release shows how many are left in.
    for (const kind of Object.keys(I.inventory)) m3.hotbar.setInUse(kind, occupancy.inUse(kind));
    strip.setHeld(occupancy.holds.length);
    refreshPicker();
  };
  const kindName = (tool: string | null, s: string | null): string =>
    tool ? (I.names[invKind(tool, s)] ?? toolName(tool)) : 'Hands';
  // T850: the step's recommended / allowed (practice) ports per tool, from practice_actions.json (event time).
  const practiceActions = loadPracticeActions();
  function recommendedPort(tool: ToolId | null, s: string | null): string | null {
    let best: string | null = null;
    for (const a of practiceActions)
      if (a.step === state.step && a.tool === tool && a.port.preferred) {
        if (a.subOption === s) return a.port.preferred;
        best ??= a.port.preferred;
      }
    return best;
  }
  const allowedPorts = (tool: ToolId): string[] =>
    getMode() !== 'practice'
      ? []
      : practiceActions.flatMap((a) => (a.step === state.step && a.tool === tool ? a.port.allowed : []));
  const freePort = (): Port | undefined => {
    const rec = recommendedPort(m4.tool, sub);
    return (
      ports.find((q) => q.id === rec && occupancy.hasRoom(q.id)) ??
      ports.find((q) => q.id === lastPort && occupancy.hasRoom(q.id)) ??
      ports.find((q) => occupancy.hasRoom(q.id))
    );
  };
  /** T850 "Insert via": why the hand's instrument may not enter through `id` ('' = it may). */
  function insertWhy(id: string): string {
    const r = m4.tool ? occupancy.insertRefusal(id, allowedPorts(m4.tool)) : 'unknown';
    if (r !== 'full')
      return r === 'not-allowed' ? 'not used for this step' : r === 'unknown' ? 'no instrument' : '';
    const who = [occupancy.scopePort === id ? 'Scope' : '', m3.portHooks.occupant(id)].filter(Boolean);
    return `full (${who.join(' + ')})`;
  }
  // T808: why the scope may not enter a port (toast text), '' = it may.
  m3.portHooks.refusal = (id) =>
    occupancy.hasRoom(id)
      ? ''
      : occupancy.heldIn(id) > 0
        ? `${portLabel(id)} holds an instrument: withdraw it (⏏ on its chip, Shift+G) or transfer it first`
        : occupancy.activePort === id
          ? `${portLabel(id)} is occupied by the ${toolName(occupancy.activeTool).toLowerCase()}: withdraw it (Esc) or move it (P)`
          : `${portLabel(id)} is full`;
  m3.portHooks.toast = toast;
  // T840: every instrument in the port, the hand's one marked.
  m3.portHooks.occupant = (id) => {
    const names: string[] = [];
    for (const h of occupancy.holds) if (h.port === id) names.push(kindName(h.tool, h.sub));
    if (occupancy.activePort === id)
      names.push(`${kindName(occupancy.activeTool, occupancy.activeSub)} (hand)`);
    return names.join(' + ');
  };
  m3.portHooks.canWithdraw = (id) => occupancy.activePort === id || occupancy.heldIn(id) > 0;
  m3.portHooks.withdraw = (id) => void withdrawPort(id);

  // ── Tool selection ──
  let sub: string | null = null;
  let pressing = false;
  const point = new Vector3(); // live target point (pick hit)
  let lastPort: string = config.ports.toolDefault;
  /** T850 right click: the hand's instrument stays where it is, the cursor is free (re-select it to resume). */
  let stayPut = false;
  let parkSeq = 0;
  // T850 tissue-aware tip: one BVH ray along the shaft (event time + ≤ follow.hz), own result object.
  const collHit: PickHit = { nodeName: '', point: new Vector3(), normal: new Vector3(), distance: 0 };
  const coll = new TipCollision((o, d, n, f) => m3.picker.ray(o, d, n, f, collHit));
  pushUniforms.uPushRadius.value = I.collide.push.radiusM;
  let collAcc = 0;
  // Depth of the surface point the tip was last aimed at (0 = none); `anchorOn` = placed on it by a click-snap or
  // an energised sweep (reached even through tissue in the way), else the cursor's (only overlapping layers).
  let anchorM = 0;
  let anchorOn = false;
  let anchorLayer = false; // T853: aimed at a dissectable layer (a lobe in the shaft path yields to the dissector)
  const anchorAt = (p: Vector3, on: boolean, node = ''): void => {
    anchorM = control.port ? p.distanceTo(control.port.pleura) : 0;
    anchorOn = on;
    anchorLayer = contactOf(node) === 'pass';
  };
  let pickerScope: string | null = null;

  // ── Instruments left in ports (T820 holds, T840 any placed tool); clones built once ──
  const srcNodes: Record<string, Object3D[]> = {};
  for (const id of TOOL_IDS) {
    const list: Object3D[] = [];
    inst.tools[id].traverse((o) => void list.push(o));
    srcNodes[id] = list;
  }
  const newHeld = (tools: readonly string[]): Held => {
    const clones: Record<string, Object3D> = {};
    const nodes: Record<string, Object3D[]> = {};
    for (const id of tools) {
      const c = inst.tools[id as ToolId].clone();
      c.visible = false;
      inst.root.add(c);
      clones[id] = c;
      const list: Object3D[] = [];
      c.traverse((o) => void list.push(o));
      nodes[id] = list;
    }
    return {
      tool: null,
      sub: null,
      target: null,
      ref: null,
      slot: -1,
      parked: false,
      out: 0,
      port: null,
      obj: null,
      mesh: null,
      vi: 0,
      clones,
      nodes,
    };
  };
  const userHeld = Array.from({ length: I.maxLeft }, () => newHeld(TOOL_IDS));

  // ── T847b lens exclusion: the scope's depth limit also keeps the lens I.lens.clearM off every instrument ──
  const heads = new Map<Object3D, Object3D>(); // stapler → its articulated head (knuckle + jaw direction)
  for (const o of [inst.tools.stapler, ...userHeld.map((h) => h.clones.stapler)]) {
    const head = o?.getObjectByName('stapler_head');
    if (o && head) heads.set(o, head);
  }
  const segs = Array.from({ length: (userHeld.length + 1) * 2 }, () => new Line3());
  const segClear = new Float64Array(segs.length);
  let nSegs = 0;
  /** Its distal shaft (from portSkipM past the pleura) to the tip, + the stapler's jaws (knuckle → jaw tip). */
  function addTool(obj: Object3D, port: Port, tool: string): void {
    const head = heads.get(obj);
    const clear = I.lens.clearM[tool] ?? I.lens.defaultClearM;
    lT.copy(obj.position);
    if (head) {
      lK.setFromMatrixPosition(head.matrixWorld);
      lT.setFromMatrixColumn(head.matrixWorld, 2).setLength(instrumentGeom.stapler.headLength).add(lK);
      segClear[nSegs] = clear;
      (segs[nSegs++] as Line3).set(lK, lT);
      lT.copy(lK);
    }
    lK.subVectors(lT, port.pleura);
    const len = lK.length();
    if (len <= I.lens.portSkipM) return;
    segClear[nSegs] = clear;
    (segs[nSegs++] as Line3).set(lK.multiplyScalar(I.lens.portSkipM / len).add(port.pleura), lT);
  }
  function collectTools(): number {
    nSegs = 0;
    const tool = m4.tool;
    if (tool && control.port && inst.tools[tool].visible) addTool(inst.tools[tool], control.port, tool);
    for (const h of userHeld) if (h.obj?.visible && h.port) addTool(h.obj, h.port, h.tool ?? 'grasper');
    return nSegs;
  }
  /** Deepest lens depth along unit `dir` from `origin` (a port's pleura point) clear of the instruments, ≤ `max`. */
  function toolLimit(origin: Vector3, dir: Vector3, max: number): number {
    if (collectTools() === 0) return max;
    for (let s = 0; s <= Math.min(max, config.scopeRig.depthM.max); s += I.lens.stepM) {
      lP.copy(origin).addScaledVector(dir, s);
      for (let i = 0; i < nSegs; i++)
        if ((segs[i] as Line3).closestPointToPoint(lP, true, lQ).distanceTo(lP) < (segClear[i] as number))
          return s - I.lens.stepM;
    }
    return max;
  }
  const tissueLimit = m3.scope.limit;
  m3.scope.limit = (origin, dir) => toolLimit(origin, dir, tissueLimit ? tissueLimit(origin, dir) : Infinity);
  let lensAcc = 0;
  /** The hand's grip: the vertex its tip rides while it grasps a lobe / clamps a structure, and its retract slot. */
  const act = newHeld([]);
  let olvGrasp: string | null = null;
  /** T840 clamp (one in the set): structure it is closed on, in hand or left; the squeeze is a node transform only. */
  let clamped: string | null = null;
  const squeeze = {
    obj: null as Object3D | null,
    auto: true,
    m0: new Matrix4(),
    p: new Vector3(),
    n: new Vector3(),
    k: 0,
    to: 0,
  };
  /** T840 lymph node in the jaws: follows the tip until withdrawn, then removed. */
  const grab = {
    name: null as string | null,
    obj: null as Object3D | null,
    meshes: NONE,
    p0: new Vector3(),
    w0: new Vector3(),
    at: new Vector3(),
  };
  const isNode = (id: string): boolean => ANATOMY.structures[id]?.tissue === 'lymphNode';
  const isLobe = (id: string): boolean => ANATOMY.structures[id]?.group === 'lungs' && lobeOf(id) !== null;
  /** Jaws closed while pressed, gripping a lobe, clamped or holding a node. */
  const syncJaw = (): void =>
    control.activate(
      pressing || act.slot >= 0 || (m4.tool === 'clamp' && clamped !== null) || grab.name !== null,
    );

  function abort(): void {
    if (pressing) release();
    if (fire.phase === 'closing' || fire.phase === 'closed') {
      fire.release();
      if (fire.result.target === BRONCHUS && clamped !== BRONCHUS) F.unclampBronchus(finish);
    }
  }

  function park(port: Port): void {
    abort();
    freeHand();
    m4.target = null;
    inst.show(m4.tool, m3.hotbar.subOption());
    control.park(port);
    anchorM = 0;
    occupancy.insert(m4.tool as ToolId, port.id, sub);
    lastPort = port.id;
    refreshPorts();
  }

  function select(slot: number, subIdx: number): void {
    const id = SLOTS[slot]?.id ?? 'hands';
    const next = (TOOL_IDS as readonly string[]).includes(id) ? (id as ToolId) : null;
    const nsub = next ? (SUB_IDS[next]?.[subIdx] ?? null) : null;
    if (next !== null && next === m4.tool) {
      // Sub-option change only.
      stayPut = false;
      sub = nsub;
      if (occupancy.activeTool !== null) occupancy.activeSub = nsub;
      abort();
      inst.show(next, subIdx);
      return refreshPorts();
    }
    leaveActive(); // T840: a placed instrument stays in its port
    stayPut = false;
    sub = nsub;
    m4.tool = next;
    m4.target = null;
    hands.setTarget('tool', next ? inst.tools[next] : null);
    inst.show(null);
    if (next) {
      const kind = invKind(next, sub);
      // T853: one left parked (right click) resumes, spare inventory or not; at the cap the latest
      // left one comes back to the hand (Insert via then moves it).
      const parkedOne = latestLeft(kind, true);
      const h = parkedOne ?? (occupancy.canTake(next, sub) ? undefined : latestLeft(kind));
      const p = h ? undefined : freePort();
      if (h) {
        const where = portLabel(h.port?.id ?? null).toLowerCase();
        pickUp(h, subIdx);
        toast(
          parkedOne
            ? `${I.names[kind]}: the one parked in the ${where} follows the cursor again`
            : `${I.names[kind]}: all ${I.inventory[kind]} in use, took the one in the ${where} (Insert via moves it)`,
        );
      } else if (p) park(p);
      else toast(occupancy.canTake(next, sub) ? FULL : `${I.names[kind]}: all in use`);
    }
    refreshPorts();
  }
  m3.hotbar.on('change', (e) => select(e.slot, e.subOption));
  // T850: re-selecting a parked instrument's slot resumes it (no sub-option cycle).
  m3.hotbar.reselect = (slot) => stayPut && SLOTS[slot]?.id === m4.tool && resume() === 'ok';

  /** T850: right click: the hand's instrument stays exactly where it is (still holding / retracting / clamped). */
  function parkHere(): string {
    const tool = m4.tool;
    if (!tool || occupancy.activePort === null) return 'hands';
    if (stayPut) return 'ok';
    stayPut = true;
    control.stopFollow();
    toast(`${kindName(tool, sub)} parked: select it again (hotbar or Insert via) to move it`);
    return 'ok';
  }
  function resume(): string {
    stayPut = false;
    toast(`${kindName(m4.tool, sub)} follows the cursor again`);
    return 'ok';
  }
  /** T850 "Insert via": the hand's instrument (re-)enters through port `id` (its own parked one resumes). */
  function insertVia(id: string): string {
    const port = ports.find((p) => p.id === id);
    const why = insertWhy(id);
    if (!m4.tool || !port) return toast('Pick an instrument first (hotbar 2–9)');
    if (why) return toast(`${port.label}: ${why}`);
    if (stayPut && occupancy.activePort === id) return resume();
    stayPut = false;
    park(port);
    constrain();
    toast(`${kindName(m4.tool, sub)} in via the ${port.label.toLowerCase()}`);
    return 'ok';
  }

  function nextToolPort(): string {
    const cur = ports.findIndex((p) => p.id === occupancy.activePort);
    for (let k = 1; k <= ports.length; k++) {
      const p = ports[(cur + k + ports.length) % ports.length] as Port;
      if (p.id === occupancy.activePort || !occupancy.hasRoom(p.id)) continue;
      stayPut = false;
      park(p);
      toast(`${toolName(m4.tool)}: ${p.label}`);
      return 'ok';
    }
    return toast('No other free port');
  }

  // ── Snap (left-click a structure); `instant` = the click of a cursor-driven tip already there ──
  function snapTo(name: string, pick: Vector3, instant = false): string {
    const tool = m4.tool;
    if (!tool) return 'hands';
    const tid = name;
    // T853: the powered stapler on the lobe while the dotted guide shows goes to its next segment (in order).
    const seg =
      tool === 'stapler' && tid === FIN.lobe && m4.fissure?.active ? m4.fissure.nextSegment() : null;
    const at = seg ? seg.mid : pick;
    const t = TARGET_BY_ID.get(tid);
    const coag = tool === 'cautery' && bleedAt(at); // T822: on a bleed = coagulate it
    if (!coag && (!t || t.tools[tool] === undefined))
      return toast(`${toolName(tool)}: no action on the ${labelFor(name).name.toLowerCase()}`);
    let port = ports.find((p) => p.id === occupancy.activePort);
    if (!port) {
      // Withdrawn (Esc) or no port was free at selection: back in through a free port.
      port = freePort();
      if (!port) return toast(FULL);
      park(port);
    }
    let c: string = coag ? 'ok' : occupancy.canFire(tool, tid, port.id, sub, at);
    if (c === 'wrong-tool' && tool === 'stapler') c = 'wrong-cartridge';
    if (c !== 'ok') return toast(REASONS[c] ?? c);
    abort();
    freeHand(); // moving lets go: grip eases back, clamp opens, a grasped node comes out
    const now = instant && control.phase !== 'parked' && control.tipPos.distanceTo(at) <= I.follow.instantM;
    const r = control.snapTo(port, at, null, now);
    if (!r.ok) return toast(`${r.reason}: try another port (P)`);
    m4.target = tid;
    point.copy(at);
    seat(tool, tid, seg);
    stayPut = false;
    anchorAt(at, true);
    constrain();
    return 'ok';
  }

  // ── Activate (left button on the placed target) ──
  function press(down: boolean): string {
    const tool = m4.tool;
    if (!tool) return 'hands';
    if (!down) {
      release();
      return 'ok';
    }
    // T852: suction aspirates wherever the cursor-driven tip is (no target to place on first).
    const busyTip = control.phase === 'inserting' || control.phase === 'withdrawing';
    if (tool === 'sucker' && sub !== 'irrigation' && !busyTip) {
      pressing = true;
      control.activate(true);
      dissect.suction();
      return 'ok';
    }
    const tid = m4.target;
    if (!tid || busyTip) return toast(REASONS.place as string);
    const port = occupancy.activePort;
    if (tool === 'clamp') return clampPress(tid, port);
    pressing = true;
    control.activate(true);
    // T840: lung grasper or ring forceps on a node: it follows the tip, out when the instrument is withdrawn.
    if (tool === 'grasper' && isNode(tid)) {
      if (!allowed('remove-node', tool, tid, port)) return 'gated';
      return grabNode(tid);
    }
    if (tool === 'grasper' || tool === 'sponge' || (tool === 'peanut' && isLobe(tid))) {
      if (!allowed('retract', tool, tid, port)) return 'gated';
      if (act.slot >= 0) retract.letGo(act.slot); // a fresh grasp: the previous grip lets go
      act.slot = -1;
      const g = retract.grasp(tid, point);
      if (g === 'ok') {
        act.slot = retract.active;
        track(act, tid, point);
        control.stopFollow();
      }
      if (g !== 'not-collapsed') return g === 'ok' ? g : toast(REASONS[g] ?? g);
      // The user chose two-lung ventilation (topbar switch): an inflated lung can't be retracted — say so, don't override.
      if (m3.twoLungChosen())
        return toast('The lung is ventilated: switch to one-lung ventilation to retract it');
      // §7.3: retraction morphs exist for the collapsed lung only → collapse it, grasp once it is down (update).
      startOLV(state);
      olvGrasp = tid;
      return toast('One-lung ventilation started');
    }
    // T844: the peanut opens the passage behind a vessel / the bronchus (the clamp only clamps).
    if (tool === 'peanut' && needsEncircle(tid)) {
      if (!allowed('encircle', tool, tid, port)) return 'gated';
      enc.pass(tid, tool);
      return toast(`Passage made behind the ${labelFor(tid).name.toLowerCase()}`);
    }
    if (tool === 'peanut' || tool === 'cautery') {
      // A cautery on a bleed (practice) coagulates it: no dissection attempt there.
      const coag = tool === 'cautery' && bleedAt(point);
      if (!coag && (tool === 'peanut' || TARGET_BY_ID.get(tid)?.tools.cautery !== undefined)) {
        // A manifest layer is judged when its dissection completes (onDissected): progress needs tip contact.
        if (!dissect.isLayer(tid) && !allowed('dissect', tool, tid, port)) return 'gated';
        if (dissect.isLayer(tid)) reseat(tid);
        dissect.begin(tid, tool);
      }
      if (tool === 'cautery') {
        // T817/T822: energy on (tip glow, ECG diathermy interference); smoke / openings / marks only at contact.
        inst.setGlow(1);
        state.cauteryActive = true;
        fx.cautery(control.tipPos);
        sampleAcc = SAMPLE_MS; // first contact sample on the next frame
      }
      return 'ok';
    }
    if (tool === 'clip') {
      if (!allowed('fire', tool, tid, port)) return 'gated';
      if (clipFire.phase !== 'idle') return toast('The clip applier is still closing');
      if (eng.tool !== 'clip' || eng.target !== tid) engage('clip', tid, clipOffset(tid));
      clipFire.closedJaw = closedJawFor('clip', eng.radius);
      clipFire.start();
      return 'ok';
    }
    if (tool === 'sucker') {
      if (!allowed('irrigate', tool, tid, port)) return 'gated';
      return dispatch(F.irrigate(finish)) ? 'ok' : m4.lastToast;
    }
    return staple(tid, port);
  }

  function staple(tid: string, port: string | null): string {
    // Second activation on the clamped bronchus fires (armed if the jaws are still closing).
    if ((fire.phase === 'closed' || fire.phase === 'closing') && fire.result.target === BRONCHUS) {
      if (!allowed('fire', 'stapler', tid, port)) return 'gated';
      if (!dispatch(F.fireBronchus(finish))) return m4.lastToast;
      fire.fire();
      return 'ok';
    }
    const c = occupancy.canFire('stapler', tid, port ?? '', sub, point);
    if (c !== 'ok') return toast(REASONS[c] ?? c);
    const bronchus = tid === BRONCHUS;
    if (!allowed(bronchus ? 'close' : 'fire', 'stapler', tid, port)) return 'gated';
    if (sub === 'vascular-leader') enc.pass(tid, 'stapler', sub);
    // T841: vessels / bronchus: jaws across the planned cut, closing onto the compressed structure.
    const across = needsEncircle(tid);
    if (across && (eng.tool !== 'stapler' || eng.target !== tid)) engage('stapler', tid);
    fire.closedJaw = across ? closedJawFor('stapler', eng.radius) : 0;
    const s = fire.close(tid, sub, enc, across ? eng.centre : point);
    if (s !== 'ok') {
      disengage();
      return toast(REASONS[s] ?? s);
    }
    if (across) {
      const n = fire.result.normal; // toward the proximal stump
      n.x = eng.axis.x;
      n.y = eng.axis.y;
      n.z = eng.axis.z;
    }
    const gate = bronchus
      ? F.clampBronchus(finish)
      : tid === FIN.lobe
        ? F.fireFissure(finish, state.retract_fissure)
        : null;
    if (gate && !dispatch(gate)) {
      fire.release();
      return m4.lastToast;
    }
    if (bronchus) return toast('Stapler closed on the bronchus: test ventilation (A) before firing');
    fire.fire();
    return 'ok';
  }

  function release(): void {
    olvGrasp = null;
    if (!pressing) return;
    pressing = false;
    inst.setGlow(0);
    fx.cautery(null);
    fx.suck(null);
    lift();
    sweepDirty = false;
    state.cauteryActive = false;
    dissect.end();
    const dragged = retract.active >= 0;
    if (dragged) act.slot = retract.release(); // T840: the grip stays on (−1 if spring-back let go)
    syncJaw();
    if (!dragged) return;
    if (m4.target === FIN.lobe && finish.fissureFires > 0 && !finish.undersideConfirmed) {
      const r = F.confirmUnderside(finish, state.retract_fissure);
      if (r.ok) dispatch(r);
    }
  }

  function onDivide(): void {
    const r = fire.result;
    // T841: a split segment divides into its two stumps (proximal on the tree, distal cap on the specimen side, which
    // keeps its branches with the lobe); the stumps carry the staples from now on.
    const split = r.target !== FIN.lobe && getStumps()?.divide(r.target, 'staple') === true;
    if (r.target !== FIN.lobe) {
      // Fissure fires cap only: clipping the lobe mesh would cut the lobe itself away.
      if (r.hide || split) setShown(r.target, false);
      else
        for (const m of meshesOf(r.target)) {
          const planes = getDivisionPlanes(m);
          if (planes) setDivisionPlane(planes, r.point, r.normal, 0);
        }
      // Unsplit: the whole manifest division group goes (trunk + branches, same divideStep). Split: its branches go
      // as logical (pick) nodes; their pieces ride on with the specimen until the lobe is out (stumps.ts `carried`).
      for (const n of divisionGroup(r.target))
        if (n !== r.target && (!split || getStumps()?.isBranchOf(n, r.target) !== false)) setShown(n, false);
      const tissue = ANATOMY.structures[r.target]?.tissue;
      if (tissue === 'vein' || tissue === 'artery') F.noteDivided(finish, tissue);
    }
    if (!guideLine(r.target)) {
      if (!lineOn) beginLine();
      if (split) staples.clearLine();
      else staples.reveal(1);
    }
    lineOn = false;
    eng.done = true; // the jaws open off the stumps, then let go
    m4.flags.add(`divided:${r.target}`);
    // T840: instruments left on what was just divided come out (a clamp on it opens).
    if (r.target === FIN.lobe) return;
    const gone = divisionGroup(r.target);
    for (const h of userHeld) {
      const i =
        h.ref && h.target !== null && (h.target === r.target || gone.includes(h.target))
          ? occupancy.holds.indexOf(h.ref)
          : -1;
      if (i >= 0) occupancy.holds.splice(i, 1);
    }
    if (m4.tool === 'clamp' && clamped !== null && (clamped === r.target || gone.includes(clamped)))
      unclamp();
    syncHeld();
  }

  // ── T841 jaws across a structure, progressive staple line, clip pairs ──
  /** Engage `tool`'s jaws on `tid`: at its planned cut (stump split, live) or the local axis at the contact point;
   *  `offsetM` slides along the axis (+ = proximal). Action time. */
  function engage(tool: JawTool, tid: string, offsetM = 0): void {
    const r = getStumps()?.cutAt(tid, eng.centre, eng.axis) ?? 0;
    eng.split = r > 0;
    eng.radius = r > 0 ? r : ENG.fallbackRadiusM;
    const mesh = meshesOf(tid)[0];
    if (!eng.split && !(mesh && localAxis(mesh, point, STUMPS.pcaRadiusM, eng.centre, eng.axis))) {
      eng.centre.copy(point);
      eng.axis.set(...(TARGET_BY_ID.get(tid)?.axis ?? [0, 1, 0])).normalize();
    }
    eng.centre.addScaledVector(eng.axis, offsetM);
    eng.offset = offsetM;
    eng.done = false;
    eng.tool = tool;
    eng.target = tid;
  }
  /** Snap: a stapler / clip applier on a vessel or bronchus seats open around it, the stapler on a fissure-guide
   *  segment lies along it; anything else frees the jaws. */
  function seat(tool: ToolId, tid: string, seg: Segment | null = null): void {
    if (seg && control.port) {
      // jawPose lays the jaws along the shaft projected ⟂ eng.axis: the shaft's component ⟂ the segment keeps them
      // along it (as far as the articulation allows).
      eng.axis.subVectors(seg.mid, control.port.pleura).normalize();
      eng.axis.addScaledVector(seg.dir, -eng.axis.dot(seg.dir)).normalize();
      eng.centre.copy(seg.mid);
      eng.split = false;
      eng.radius = ENG.fallbackRadiusM;
      eng.offset = 0;
      eng.done = false;
      eng.tool = 'stapler';
      eng.target = tid;
    } else if ((tool === 'stapler' || tool === 'clip') && needsEncircle(tid))
      engage(tool, tid, tool === 'clip' ? clipOffset(tid) : 0);
    else disengage();
  }
  /** First clip on the proximal side of the planned cut, the second on the distal side (then it divides). */
  const clipOffset = (tid: string): number =>
    getStumps()?.split(tid) ? (((clipsOn.get(tid) ?? 0) % 2 ? -1 : 1) * ENG.clipGapM) / 2 : 0;
  function disengage(): void {
    eng.tool = null;
    eng.done = false;
    inst.setArticulation(instrumentGeom.stapler.articulation);
  }
  /** T853: a fissure fire's staple line is the guide's (its segment), not M4's. */
  const guideLine = (target: string): boolean => target === FIN.lobe && m4.fissure !== null;
  /** Staple line at the fire's cut: both sides of the knife, along the jaws (heel → tip); formed by reveal(). */
  function beginLine(): void {
    const r = fire.result;
    if (eng.tool !== 'stapler') jawDir.set(0, 0, 1).applyQuaternion(inst.tools.stapler.quaternion);
    staples.beginLine(
      r.point,
      r.normal,
      jawDir,
      eng.tool ? Math.PI * eng.radius : STAPLES_CONFIG.lineWidth,
      2,
    );
    lineOn = true;
  }
  /** The applier's clip is crimped on the structure and stays (the instrument's own clip hides until it reopens). */
  function onClip(): void {
    const tid = eng.target;
    staples.addClip(eng.centre, eng.axis, jawDir);
    inst.setClipLoaded((clipLoaded = false));
    const n = (clipsOn.get(tid) ?? 0) + 1;
    clipsOn.set(tid, n);
    m4.flags.add(`clipped:${tid}`);
    if (eng.split && n % 2 === 0) divideIn = ENG.divideDelayMs; // two clips: divide between them
  }
  function divideClipped(tid: string): void {
    if (!getStumps()?.divide(tid, 'clip')) return;
    eng.done = true;
    setShown(tid, false);
    staples.removeClips(2); // the two stumps carry them now
    const tissue = ANATOMY.structures[tid]?.tissue;
    if (tissue === 'vein' || tissue === 'artery') F.noteDivided(finish, tissue);
    m4.flags.add(`divided:${tid}`);
    toast(`${labelFor(tid).name}: divided between the clips`);
  }

  /** T860c: the tip goes back onto layer `tid` where it is NOW. A snap made while a morph tween ran (the pick BVHs
   *  re-bake only when the pose settles) can leave the tip on whatever the moving layer uncovered (e.g. the vein
   *  under the reflected pleura): contact would never be the layer and its dissection could never progress.
   *  Press time only; nearest current (morphed) vertex of the layer, no BVH, within contact.reseatMaxM. */
  function reseat(tid: string): void {
    if (m3.picker.nearest(control.tipPos, CAUTERY.contact.distM, true)?.nodeName === tid) return;
    let best = Infinity;
    for (const m of meshesOf(tid)) {
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const d = m.getVertexPosition(i, tT).applyMatrix4(m.matrixWorld).distanceToSquared(control.tipPos);
        if (d < best) {
          best = d;
          tB.copy(tT);
        }
      }
    }
    if (best > CAUTERY.contact.reseatMaxM ** 2) return; // free space (T880): no snap onto tissue
    control.aimAt(tB);
    point.copy(tB);
    anchorAt(tB, true, tid);
    constrain();
  }

  // ── T822 energised cautery: contact gating, sweep, openings / sear line (sampled at CAUTERY.contact.sampleHz) ──
  let sampleAcc = 0;
  let sweepDirty = false;
  let sweepX = 0;
  let sweepY = 0;
  let contactName = '';
  const contactPoint = new Vector3();
  function lift(): void {
    cuts.lift();
    fx.contact(null);
    m4.contact = false;
  }
  /** `energised` = cautery (openings / sear marks); the peanut only needs to know what it touches. */
  function sampleContact(dt: number, energised: boolean): void {
    if (sweepDirty) {
      // Raw pick: the hook rides the layer it is opening, not the structure seen through the opening.
      sweepDirty = false;
      const h = m3.picker.pick(sweepX, sweepY, camera, true);
      if (h) {
        control.aimAt(h.point);
        anchorAt(h.point, true);
      }
    }
    // Mid-stroke the hook rides the layer it is opening (raw); a fresh contact inside an opening looks through it
    // to the structure beneath, as hover / pick do.
    const hit = m3.picker.nearest(control.tipPos, CAUTERY.contact.distM, cuts.stroking);
    if (!hit) return lift();
    contactName = hit.nodeName;
    contactPoint.copy(hit.point);
    if (!energised) {
      // T852 peanut: a blunt sweep opens a dissectable layer (wider, soft torn edge; no smoke, no char).
      if (DISSECTABLE.test(hit.nodeName)) cuts.touch(hit.nodeName, hit.point, dt, true);
      else {
        cuts.lift();
        if (m4.tool === 'peanut') cuts.touchNear(hit.point); // T875: the fascia round a vessel tears open (tunnel)
      }
      return void (m4.contact = true);
    }
    tN.subVectors(camera.position, hit.point).normalize(); // mark faces the scope side of the surface
    if (hit.normal.dot(tN) < 0) hit.normal.negate();
    const open = DISSECTABLE.test(hit.nodeName);
    if (open) cuts.touch(hit.nodeName, hit.point, dt);
    else cuts.lift();
    fx.contact(hit.point, hit.normal, !open);
    m4.contact = true;
  }

  /** Completed dissection: a manifest layer is gated (practice order) here; a refusal means dissect it again. */
  function onDissected(id: string): void {
    if (dissect.isLayer(id) && !allowed('dissect', dissect.lastTool ?? 'peanut', id, occupancy.activePort))
      return dissect.cancel(id);
    toast(`${labelFor(id).name}: dissected`);
  }

  /** Grasp time only: the vertex of `tid` nearest world `at`, morph-aware (`rest` = against the un-morphed mesh). */
  function track(h: Held, tid: string, at: Vector3, rest = false): void {
    let best = Infinity;
    h.mesh = null;
    h.target = tid;
    for (const m of meshesOf(tid)) {
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        if (rest) tT.fromBufferAttribute(pos, i);
        else m.getVertexPosition(i, tT);
        const d = tT.applyMatrix4(m.matrixWorld).distanceToSquared(at);
        if (d < best) {
          best = d;
          h.mesh = m;
          h.vi = i;
        }
      }
    }
  }

  /** Tip on the tracked vertex, shaft through the port fulcrum (roll from the port frame, as the controller). */
  function aim(obj: Object3D, port: Port, h: Held): void {
    if (!h.mesh) return;
    h.mesh.getVertexPosition(h.vi, tT).applyMatrix4(h.mesh.matrixWorld);
    if (h.out > 0) tT.lerp(tA.copy(port.pleura).addScaledVector(port.axis, IC.depthM.min), h.out);
    obj.position.copy(tT);
    tN.subVectors(tT, port.pleura).normalize();
    tQ.setFromUnitVectors(Z, port.axis);
    tQ2.setFromUnitVectors(port.axis, tN);
    obj.quaternion.multiplyQuaternions(tQ2, tQ);
  }

  function hide(h: Held): void {
    if (h.obj) h.obj.visible = false;
    h.obj = null;
    h.target = null;
    h.mesh = null;
  }

  // ── T840: instruments stay in their ports (event time) ──
  /** Tool switch / G: an instrument placed on a structure stays in its port (still holding, retracting, clamped);
   *  one that is only parked, or whose structure is gone, comes out. A node in the jaws comes out with it. */
  function leaveActive(): void {
    const tool = m4.tool;
    const port = control.port;
    if (!tool) return;
    if (retract.active >= 0) act.slot = retract.release(true);
    abort();
    takeOutNode();
    // T850: a parked instrument stays where it is even off any structure (hold target PARKED + n).
    const tid = m4.target ?? (stayPut ? `${PARKED}${++parkSeq}` : null);
    const h = userHeld.find((x) => x.tool === null);
    const placed =
      control.phase === 'placed' || control.phase === 'manual' || (stayPut && control.phase === 'parked');
    if (
      !tid ||
      !port ||
      !h ||
      !placed ||
      occupancy.activePort !== port.id ||
      overrides.get(tid) === false ||
      !occupancy.hold(tid)
    ) {
      freeHand();
      occupancy.withdraw();
      return;
    }
    h.ref = occupancy.holds[occupancy.holds.length - 1] ?? null;
    h.tool = tool;
    h.sub = sub;
    h.port = port;
    h.slot = act.slot;
    h.parked = stayPut;
    if (act.mesh && act.target === tid) {
      h.target = tid;
      h.mesh = act.mesh;
      h.vi = act.vi;
    } else if (tid.startsWith(PARKED)) {
      h.target = tid; // no vertex to ride: the clone keeps the hand's pose
      h.mesh = null;
    } else track(h, tid, control.tipPos);
    // The clone takes the hand's pose, jaw opening and sub-option parts.
    const obj = h.clones[tool] as Object3D;
    const src = srcNodes[tool] ?? NONE;
    const dst = h.nodes[tool] ?? NONE;
    for (let i = 0; i < dst.length; i++) {
      const a = src[i];
      const b = dst[i];
      if (!a || !b) continue;
      b.visible = a.visible;
      b.quaternion.copy(a.quaternion);
    }
    obj.position.copy(inst.tools[tool].position);
    obj.quaternion.copy(inst.tools[tool].quaternion);
    obj.visible = true;
    h.obj = obj;
    act.slot = -1;
    act.target = null;
    act.mesh = null;
    m4.target = null;
    syncHeld();
  }

  /** Drop left instruments whose occupancy entry is gone (released, transferred, withdrawn). */
  function syncHeld(): void {
    for (const h of userHeld) if (h.ref && !occupancy.holds.includes(h.ref)) drop(h);
    refreshPorts();
  }

  /** A left instrument comes out: its grip eases back, the clamp opens. */
  function drop(h: Held): void {
    if (h.slot >= 0) retract.letGo(h.slot);
    if (h.tool === 'clamp' && clamped !== null) unclamp();
    free(h);
  }

  function free(h: Held): void {
    hide(h);
    h.tool = null;
    h.sub = null;
    h.ref = null;
    h.slot = -1;
    h.parked = false;
    h.out = 0;
    h.port = null;
  }

  /** Most recent instrument of inventory kind `kind` left in a port (`parked`: only one left parked). */
  function latestLeft(kind: string, parked = false): Held | undefined {
    for (let i = occupancy.holds.length - 1; i >= 0; i--) {
      const o = occupancy.holds[i] as Hold;
      const h = invKind(o.tool, o.sub) === kind ? userHeld.find((x) => x.ref === o) : undefined;
      if (h && (!parked || h.parked)) return h;
    }
    return undefined;
  }

  /** Take a left instrument back into the hand where it is (its grip / clamp stay on). */
  function pickUp(h: Held, subIdx: number): void {
    const port = h.port;
    const i = h.ref ? occupancy.holds.indexOf(h.ref) : -1;
    if (!port || !occupancy.pickUp(i)) return;
    tT.copy(h.obj ? h.obj.position : port.pleura);
    inst.show(m4.tool, subIdx);
    control.park(port);
    control.snapTo(port, tT, null, true);
    m4.target = h.target?.startsWith(PARKED) ? null : h.target;
    point.copy(tT);
    act.slot = h.slot;
    act.target = h.target;
    act.mesh = h.mesh;
    act.vi = h.vi;
    free(h);
    lastPort = port.id;
    syncJaw();
  }

  /** The hand's instrument lets go of everything (moved / withdrawn): grip eases back, clamp opens, node comes out. */
  function freeHand(): void {
    takeOutNode();
    if (act.slot >= 0) retract.letGo(act.slot);
    act.slot = -1;
    act.target = null;
    act.mesh = null;
    if (m4.tool === 'clamp' && clamped !== null) unclamp();
    syncJaw();
  }

  function withdrawActive(): string {
    if (!m4.tool) return 'hands';
    stayPut = false;
    abort();
    freeHand();
    control.withdraw();
    occupancy.withdraw();
    m4.target = null;
    refreshPorts();
    return 'ok';
  }

  function withdrawPort(id: string): string {
    if (occupancy.activePort === id) return withdrawActive();
    const r = occupancy.releasePort(id);
    if (!r) return toast(`Nothing to withdraw from the ${portLabel(id).toLowerCase()}`);
    syncHeld();
    toast(`${kindName(r.tool, r.sub)} withdrawn from the ${portLabel(id).toLowerCase()}`);
    return 'ok';
  }

  // ── T840 clamp: closes on the vessel / bronchus and stays until clicked again (or Shift+G) ──
  function clampPress(tid: string, port: string | null): string {
    if (clamped !== null) {
      unclamp();
      toast('Clamp opened');
      return 'ok';
    }
    if (!allowed('encircle', 'clamp', tid, port)) return 'gated';
    enc.pass(tid, 'clamp'); // closed around it: the passage exists
    clamped = tid;
    track(act, tid, point);
    control.stopFollow();
    squeezeOn(tid);
    // T841: the jaws cross it at its planned cut and close along the shaft (bend-plane opening), squeezing it there.
    engage('clamp', tid);
    eng.closed = closedJawFor('clamp', eng.radius);
    squeeze.p.copy(eng.centre);
    if (control.port) squeeze.n.subVectors(eng.centre, control.port.pleura).normalize();
    syncJaw();
    const name = labelFor(tid).name.toLowerCase();
    if (tid !== BRONCHUS) toast(`Clamp closed on the ${name}: click it again (or Shift+G) to open`);
    else {
      const r = F.clampBronchus(finish); // flags it for the ventilation test
      if (!r.ok) toast(`Clamp closed on the ${name}. ${r.reason}`);
      else if (dispatch(r))
        toast(`Clamp closed on the ${name}: test ventilation (A); click it again to open`);
    }
    return 'ok';
  }

  function unclamp(): void {
    if (clamped === null) return;
    const stapled = fire.result.target === BRONCHUS && (fire.phase === 'closed' || fire.phase === 'closing');
    if (clamped === BRONCHUS && !stapled) F.unclampBronchus(finish);
    clamped = null;
    squeeze.to = 0;
    if (m4.tool === 'clamp') {
      act.target = null;
      act.mesh = null;
    }
    syncJaw();
  }

  /** Squeeze target: the clamped node flattens across the jaws (normal ⟂ shaft and the structure's axis). */
  function squeezeOn(tid: string): void {
    const obj = model.getObjectByName(tid);
    if (!obj) return;
    if (squeeze.obj !== obj) {
      restoreSqueeze();
      squeeze.obj = obj;
      squeeze.auto = obj.matrixAutoUpdate;
      obj.updateMatrix();
      squeeze.m0.copy(obj.matrix);
      obj.matrixAutoUpdate = false;
    }
    squeeze.p.copy(point);
    const ax = TARGET_BY_ID.get(tid)?.axis;
    squeeze.n.crossVectors(control.shaftDir, ax ? tA.set(...ax) : control.viewUp);
    if (squeeze.n.lengthSq() < 1e-8) squeeze.n.copy(control.viewRight);
    squeeze.n.normalize();
    squeeze.to = 1;
  }

  function restoreSqueeze(): void {
    const o = squeeze.obj;
    if (!o) return;
    o.matrix.copy(squeeze.m0);
    o.matrixAutoUpdate = squeeze.auto;
    o.matrixWorldNeedsUpdate = true;
    squeeze.obj = null;
    squeeze.k = 0;
  }

  /** Frame loop: ease the squeeze; the node matrix is written only while it changes. */
  function updateSqueeze(dt: number): void {
    const o = squeeze.obj;
    if (!o || squeeze.k === squeeze.to) return;
    const step = (I.clamp.perS * dt) / 1000;
    squeeze.k =
      squeeze.to > squeeze.k
        ? Math.min(squeeze.to, squeeze.k + step)
        : Math.max(squeeze.to, squeeze.k - step);
    if (squeeze.k === 0) return restoreSqueeze();
    // World flattening across the jaws about the clamp point: S = I − a·nnᵀ, t = a·n(n·p); local = P⁻¹·S·P·M0.
    const a = I.clamp.squeeze * squeeze.k;
    const { x, y, z } = squeeze.n;
    const t = a * squeeze.n.dot(squeeze.p);
    tM.set(
      1 - a * x * x,
      -a * x * y,
      -a * x * z,
      t * x,
      -a * x * y,
      1 - a * y * y,
      -a * y * z,
      t * y,
      -a * x * z,
      -a * y * z,
      1 - a * z * z,
      t * z,
      0,
      0,
      0,
      1,
    );
    const parent = o.parent;
    if (parent) tM.premultiply(tM2.copy(parent.matrixWorld).invert()).multiply(parent.matrixWorld);
    o.matrix.multiplyMatrices(tM, squeeze.m0);
    o.matrixWorldNeedsUpdate = true;
  }

  // ── T840 lymph node removal: grasped (lung grasper / ring forceps), follows the tip, out on withdrawal ──
  function grabNode(tid: string): string {
    const obj = model.getObjectByName(tid);
    if (!obj) return toast(REASONS['no-target'] as string);
    grab.name = tid;
    grab.obj = obj;
    grab.meshes = meshesOf(tid);
    grab.p0.copy(obj.position);
    obj.getWorldPosition(grab.w0);
    grab.at.copy(control.tipPos);
    syncJaw();
    strip.setSample(station(tid));
    toast(
      `${labelFor(tid).name} grasped: pull it free, then withdraw it (Esc) or record the sample (${keyCap(K.recordSample.code)})`,
    );
    return 'ok';
  }

  /** Back in its bed (position restored), no removal. */
  function dropNode(): string | null {
    const name = grab.name;
    if (grab.obj) {
      grab.obj.position.copy(grab.p0);
      grab.obj.updateMatrix();
      grab.obj.matrixWorldNeedsUpdate = true;
    }
    grab.name = null;
    grab.obj = null;
    grab.meshes = NONE;
    syncJaw();
    strip.setSample(null);
    return name;
  }

  /** The grasped node leaves with the instrument: removed (hidden, specimen tray, onNodeRemoved) or, if finish.ts
   *  refuses (port, order), back in its bed. */
  function takeOutNode(): void {
    const name = dropNode();
    if (name === null) return;
    if (!dispatch(F.removeNode(finish, name, occupancy.activePort ?? ''))) return;
    m4.samples.push(station(name)); // T850: every removal is a labelled sample (debrief)
    toast(`Sample recorded: station ${station(name)}`);
    for (const fn of m4.onNodeRemoved) fn(name, grab.at);
  }
  /** T850 "Record sample" (button / S): the grasped node comes out of the jaws as a sample (hidden). */
  function recordSample(): string {
    if (grab.name === null) return toast('Grasp a lymph node first (lung grasper or ring forceps)');
    const n = m4.samples.length;
    takeOutNode();
    return m4.samples.length > n ? 'ok' : m4.lastToast;
  }

  /** T850: the hand's tip vs tissue (event time + ≤ follow.hz): its limit along the shaft and the lung press. A
   *  grip / clamp / engaged jaws ride their structure by design (no limit there). */
  function constrain(): void {
    const port = control.port;
    if (!port || !m4.tool || act.slot >= 0 || clamped !== null || eng.tool !== null) coll.clear();
    else
      coll.check(
        port.pleura,
        control.shaftDir,
        control.depth,
        anchorM,
        anchorOn,
        anchorLayer && I.collide.lungYieldsFor.includes(m4.tool),
      );
    control.setLimit(coll.limit);
  }

  function hold(): string {
    const tool = m4.tool;
    const tid = m4.target;
    const port = control.port;
    if (
      !tool ||
      !tid ||
      !port ||
      !R.holdable.includes(tool) ||
      sub === 'ring' ||
      control.phase === 'inserting'
    )
      return toast('Nothing to hold: place a grasper (2), sponge-stick (3) or peanut (4) on a lobe first');
    m3.hotbar.select(0); // leaveActive: it stays in its port, the hand is free for the next instrument
    if (occupancy.holds.at(-1)?.target !== tid) return toast('Could not leave it there: withdraw it (Esc)');
    return toast(
      `${toolName(tool)} held via the ${port.label.toLowerCase()}: pick another tool (Shift+G releases)`,
    );
  }

  function releaseHold(): string {
    if (m4.tool === 'clamp' && clamped !== null) {
      unclamp();
      return toast('Clamp opened');
    }
    if (act.slot >= 0) {
      retract.letGo(act.slot);
      act.slot = -1;
      act.target = null;
      act.mesh = null;
      syncJaw();
      return toast(`${toolName(m4.tool)} let go: the lung falls back`);
    }
    const r = occupancy.release();
    if (!r) return toast('Nothing is held');
    syncHeld();
    const back = R.holdable.includes(r.tool) && r.sub !== 'ring' ? ': the lung falls back' : '';
    return toast(`${kindName(r.tool, r.sub)} released from the ${portLabel(r.port).toLowerCase()}${back}`);
  }

  // ── T860 walkthrough: instant case reset + end-state pieces (seek rebuilds steps 1…N-1 in place, no reload) ──
  function resetCase(): void {
    stayPut = false;
    fire.phase = 'idle'; // a fire in flight never lands on the fresh case
    clipFire.phase = 'idle';
    abort();
    dropNode();
    restoreSqueeze();
    if (m3.hotbar.slot !== 0) asEngine(() => m3.hotbar.select(0)); // hand empty (a placed tool is left, then freed)
    if (m4.tool) withdrawActive();
    occupancy.releaseAll();
    for (const h of userHeld) free(h);
    retract.reset();
    clamped = null;
    squeeze.to = 0;
    act.slot = -1;
    act.target = null;
    act.mesh = null;
    disengage();
    divideIn = 0;
    clipsOn.clear();
    enc.reset();
    dissect.reset();
    clearCautery();
    for (const p of pending) p.at = -1;
    for (const n of overrides.keys()) {
      const o = model.getObjectByName(n);
      if (o) o.visible = true;
    }
    overrides.clear();
    staples.reset();
    lineOn = false;
    getStumps()?.reset();
    for (const t of TARGETS)
      for (const m of meshesOf(t.id)) {
        const planes = getDivisionPlanes(m);
        if (planes) parkDivisionPlanes(planes);
      }
    m4.fissure?.reset();
    Object.assign(finish, F.createFinishState());
    m4.flags.clear();
    m4.errors.length = 0;
    m4.samples.length = 0;
    state.rmlDivided = false;
    applyVisibility(ctx.vis, state);
    m3.reapplyLayers();
    syncJaw();
    refreshPorts();
  }
  /** As onDivide after a stapler fire, without the fire (staples ride the stumps). */
  function dividedNow(name: string): void {
    const split = getStumps()?.divide(name, 'staple') === true;
    setShown(name, false);
    for (const n of divisionGroup(name))
      if (n !== name && (!split || getStumps()?.isBranchOf(n, name) !== false)) setShown(n, false);
    const tissue = ANATOMY.structures[name]?.tissue;
    if (tissue === 'vein' || tissue === 'artery') F.noteDivided(finish, tissue);
    m4.flags.add(`divided:${name}`);
  }
  function removedNow(name: string): void {
    setShown(name, false);
    if (isNode(name) && !m4.samples.includes(station(name))) m4.samples.push(station(name));
  }
  function holdNow(tool: ToolId, s: string | null, portId: string, target: string, at: Vector3): boolean {
    const port = ports.find((p) => p.id === portId);
    const h = userHeld.find((x) => x.tool === null);
    if (!port || !h || !occupancy.hasRoom(portId)) return false;
    occupancy.holds.push({ tool, sub: s, port: portId, target });
    h.ref = occupancy.holds[occupancy.holds.length - 1] ?? null;
    h.tool = tool;
    h.sub = s;
    h.port = port;
    h.slot = -1;
    h.parked = false;
    model.updateMatrixWorld();
    track(h, target, at);
    // The clone takes the sub-option's parts with the jaws closed (copied from the hand's instrument).
    inst.show(tool, Math.max(0, SUB_IDS[tool]?.indexOf(s ?? '') ?? 0));
    inst.setJaw(0);
    const src = srcNodes[tool] ?? NONE;
    const dst = h.nodes[tool] ?? NONE;
    for (let i = 0; i < dst.length; i++) {
      const a = src[i];
      const b = dst[i];
      if (!a || !b) continue;
      b.visible = a.visible;
      b.quaternion.copy(a.quaternion);
    }
    inst.show(m4.tool, m3.hotbar.subOption());
    const obj = h.clones[tool] as Object3D;
    obj.visible = true;
    h.obj = obj;
    aim(obj, port, h);
    syncHeld();
    return true;
  }

  // ── T842 irrigation (final step) + node-bed ooze coagulation ──
  const LAST_STEP = STEPS[STEPS.length - 1]?.step ?? 0;
  const atLastStep = (): boolean => getMode() !== 'practice' && guided.current === LAST_STEP;
  const irrigable = (): boolean => atLastStep() || finish.lobeRemoved;
  function irrigateNow(): string {
    if (!allowed('irrigate', 'sucker', FIN.stump, occupancy.activePort)) return 'gated';
    return dispatch(irrigateField(finish, atLastStep()))
      ? toast('Saline in: ventilate (A) for the leak test, then suction')
      : m4.lastToast;
  }
  const irrigateBtn = mountIrrigateButton(ctx.shell.ports, () => void (inputLocked() || irrigateNow()));
  irrigateBtn.setShown(irrigable()); // stepchange / mode change refresh it (clearCautery)
  /** A bleed to coagulate here: complications' (wireM5) or a node-bed ooze. */
  const bleedAt = (p: Vector3): boolean => m4.bleedNear?.(p) === true || fx.oozeNear(p);

  // T822: openings and marks belong to the case in progress: a new step / mode / run starts clean.
  let steelSoil: number = SOIL.steel.amount;
  let gauzeSoak: number = SOIL.gauze.amount;
  const clearCautery = (): void => {
    if (pressing) release(); // energy off: glow, smoke, ECG interference (state.cauteryActive)
    cuts.reset();
    fx.char.clear();
    fx.fog.clear(); // T842 smoke, saline: the new step / mode starts with a clear, dry field
    fx.suction();
    water.reset();
    irrigateBtn.setShown(irrigable());
    inst.setSoil('steel', (steelSoil = SOIL.steel.amount));
    inst.setSoil('gauze', (gauzeSoak = SOIL.gauze.amount));
  };
  guided.on('stepchange', clearCautery);
  onModeChange((m) => {
    clearCautery();
    dropNode();
    // A new mode drops every left instrument and grip; outside Guided (which applies its own step state) the lung
    // eases back.
    if (m4.tool === 'clamp') unclamp();
    occupancy.releaseAll();
    for (const h of userHeld) if (h.ref) drop(h);
    act.slot = -1;
    act.target = null;
    act.mesh = null;
    if (m === 'guided') retract.reset();
    else retract.letGoAll();
    syncJaw();
    refreshPorts();
  });
  // T850 "Insert via" picker (beside the port chips, instrument in hand), keys from K.insertVia1–3.
  const via = I.insertOrder.flatMap((id, i) => {
    const p = ports.find((q) => q.id === id);
    const k = INSERT_KEYS[i];
    return p && k ? [{ id, label: p.label, key: keyCap(k.code), code: k.code }] : [];
  });
  const picker = mountPortPicker(ctx.shell.ports, via, (id) => void (inputLocked() || insertVia(id)));
  function refreshPicker(): void {
    const tool = m4.tool;
    picker.setShown(tool !== null);
    if (!tool) return;
    const rec = recommendedPort(tool, sub);
    for (const v of via) picker.set(v.id, insertWhy(v.id), occupancy.activePort === v.id, v.id === rec);
  }
  guided.on('stepchange', refreshPicker); // the recommended port follows the step
  const strip = mountRetractionStrip(
    ctx.shell.ports,
    {
      hold: () => void (inputLocked() || hold()),
      release: () => void (inputLocked() || releaseHold()),
      sample: () => void (inputLocked() || recordSample()),
    },
    keyCap(K.recordSample.code),
  );

  // ── Keys: Esc withdraw, P instrument port, G hold, A / B / T context actions, I PiP ──
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target instanceof Element && e.target.closest(SKIP_TARGETS)) return;
    const c = e.code;
    const tool = m4.tool;
    if (pip.handleKey(e)) {
      if (!pip.shown) toast(pip.enabled ? "Surgeon's view shows in the scope view" : "Surgeon's view off");
    } else if (inputLocked())
      return; // T860: the walkthrough's instruments
    else if (tool && matchesKey(K.instrumentWithdraw, c)) withdrawActive();
    else if (tool && !e.shiftKey && matchesKey(K.nextPort, c))
      nextToolPort(); // Shift+P: scope (M3)
    else if (tool && !e.shiftKey && via.some((v) => v.code === c))
      insertVia(via.find((v) => v.code === c)?.id ?? '');
    else if (grab.name !== null && !e.shiftKey && matchesKey(K.recordSample, c)) recordSample();
    else if (c === CONTEXT_KEYS.hold) {
      if (e.shiftKey) releaseHold();
      else hold();
    } else if (c === CONTEXT_KEYS.ventilate) {
      if (allowed('ventilate', 'ventilate', finish.fluidFilled ? FIN.stump : BRONCHUS, null))
        dispatch(F.ventilate(finish));
    } else if (c === CONTEXT_KEYS.bag) {
      if (allowed('bag', 'bag', FIN.lobe, FIN.accessPort)) dispatch(F.bagExtract(finish, FIN.accessPort));
    } else if (c === waterConfig.key) {
      if (irrigable()) irrigateNow();
    } else if (c === CONTEXT_KEYS.chestTube) {
      if (allowed('chest-tube', 'chestTube', null, FIN.chestTubePort))
        dispatch(F.placeChestTube(finish, FIN.chestTubePort, m3.scope.port.id));
    } else return;
    e.preventDefault();
  });

  // ── Pointer (tool slots only; Hands belongs to M3; quiz identify clicks belong to m3.onPick) ──
  let lastX = 0;
  let lastY = 0;
  // T840 cursor-driven tip: the latest pointer position (NDC), picked at ≤ follow.hz in update().
  let followDirty = false;
  let followX = 0;
  let followY = 0;
  let followAcc = 0;
  const canFollow = (): boolean =>
    m4.tool !== null &&
    occupancy.activePort !== null &&
    !stayPut &&
    act.slot < 0 &&
    olvGrasp === null &&
    !(m4.tool === 'clamp' && clamped !== null) &&
    fire.phase === 'idle' &&
    !(pressing && (m4.tool === 'cautery' || dissect.tool === 'peanut'));
  const busy = (): boolean => !m4.tool || m3.onPick !== null || inputLocked();
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (busy()) return;
    lastX = e.clientX;
    lastY = e.clientY;
    if (e.button === 2) return void parkHere(); // T850 (replaces the right-drag steer)
    if (e.button !== 0) return;
    if (stayPut) return void toast(`${kindName(m4.tool, sub)} is parked: select it again to move it`);
    const hit = m3.picker.pick(
      (e.clientX / canvas.clientWidth) * 2 - 1,
      -(e.clientY / canvas.clientHeight) * 2 + 1,
      camera,
    );
    if (m4.tool === 'sucker' && sub !== 'irrigation') {
      // T852: suction acts at the cursor-driven tip, no target needed
      if (hit) {
        control.follow(hit.point);
        anchorAt(hit.point, false);
      }
      return void press(true);
    }
    if (!hit) return void toast(REASONS.place as string);
    // T840: a click acts where the cursor-driven tip is (a closed stapler fires, a closed clamp opens in place).
    const same = hit.nodeName === m4.target && control.phase !== 'parked';
    if (same && (fire.phase !== 'idle' || (m4.tool === 'clamp' && clamped !== null))) press(true);
    else if (snapTo(hit.nodeName, hit.point, true) === 'ok' && control.phase === 'placed') press(true);
  });
  canvas.addEventListener('pointermove', (e) => {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (busy() || stayPut) return; // T850: a parked instrument ignores the cursor
    if (pressing && retract.active >= 0) retract.drag(dx, dy);
    else if (pressing && (m4.tool === 'cautery' || dissect.tool === 'peanut')) {
      sweepX = (e.clientX / canvas.clientWidth) * 2 - 1;
      sweepY = -(e.clientY / canvas.clientHeight) * 2 + 1;
      sweepDirty = true;
    } else {
      followX = (e.clientX / canvas.clientWidth) * 2 - 1;
      followY = -(e.clientY / canvas.clientHeight) * 2 + 1;
      followDirty = true;
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button === 0 && pressing && !inputLocked()) release();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (busy() || stayPut) return;
      e.preventDefault();
      control.insert(-e.deltaY * IC.wheelMetersPerPx);
    },
    { passive: false },
  );

  // ── Hands + PiP ──
  const scopeObj = new Object3D(); // scope shaft frame for the scope hand: lens at the origin, +Z into the chest
  hands.setTarget('scope', scopeObj);
  const pip = createPip(renderer, scene, {
    code: K.togglePip.code,
    parent: app,
    before: () => hands.setView('pip'),
    after: () => hands.setView(rig.mode),
  });
  // Surgeon's eye: out from the ports' mean skin point against the mean port axis, raised, looking at the pleura.
  const P = config.hands.pip;
  const skin = new Vector3();
  const axis = new Vector3();
  const pleura = new Vector3();
  for (const p of ports) {
    skin.add(p.skin);
    axis.add(p.axis);
    pleura.add(p.pleura);
  }
  skin.divideScalar(ports.length);
  pleura.divideScalar(ports.length);
  pip.camera.position.copy(skin).addScaledVector(axis.normalize(), -P.backM);
  pip.camera.position.y += P.upM;
  pip.camera.lookAt(pleura);
  // ADR-008: the inset renders the scene into its own target → warm it up with everything visible during loading.
  registerWarmupHook(() => withAllVisible(scene, async () => pip.warmup()));

  let last = 0;
  let mode = rig.mode;
  hands.setView(mode);
  pip.setScopeMode(mode === 'scope');
  const m4: M4 & { tool: ToolId | null; target: string | null; lastToast: string; contact: boolean } = {
    occupancy,
    control,
    finish,
    staples,
    pip,
    tool: null,
    target: null,
    flags: new Set(),
    errors: [],
    lastToast: '',
    gate: null,
    snapTo,
    press,
    nextToolPort,
    insertVia,
    park: parkHere,
    get parked() {
      return stayPut;
    },
    samples: [],
    recordSample,
    collision: coll,
    push: pushUniforms,
    hold,
    releaseHold,
    withdraw: withdrawActive,
    withdrawPort,
    get clamped() {
      return clamped;
    },
    get grasped() {
      return grab.name;
    },
    fissure: null,
    onNodeRemoved: [],
    heldShown: () => userHeld.filter((h) => h.obj?.visible).length,
    update(now) {
      // T860: the walkthrough's pause / timeScale run m4's own animations too (1 outside the walkthrough).
      const realDt = (last ? now - last : 0) * walkRate.value;
      const dt = Math.min(realDt, A.maxDtMs * walkRate.value);
      last = now;
      occupancy.scopePort = m3.scope.port.id;
      if (occupancy.scopePort !== pickerScope) {
        pickerScope = occupancy.scopePort; // T850: the scope moved (chips / Shift+P): port fullness changed
        refreshPicker();
      }
      // View basis for mirrored steering and view-space pulls.
      tA.set(1, 0, 0).applyQuaternion(camera.quaternion);
      control.viewRight.copy(tA);
      retract.viewRight.copy(tA);
      tA.set(0, 1, 0).applyQuaternion(camera.quaternion);
      control.viewUp.copy(tA);
      retract.viewUp.copy(tA);

      // T840 cursor-driven tip: one pick of the latest pointer position at ≤ follow.hz.
      followAcc = Math.min(followAcc + dt, FOLLOW_MS);
      if (followDirty && followAcc >= FOLLOW_MS) {
        followAcc = 0;
        followDirty = false;
        const h = canFollow() ? m3.picker.pick(followX, followY, camera) : null;
        if (h) {
          control.follow(h.point);
          anchorAt(h.point, false, h.nodeName);
        }
      }
      control.update(dt);
      // T850 tissue-aware tip: shaft ray at ≤ follow.hz; the lung indent follows the press (uniform writes on change).
      collAcc = Math.min(collAcc + dt, FOLLOW_MS);
      if (collAcc >= FOLLOW_MS) {
        collAcc = 0;
        constrain();
      }
      if (coll.ease(dt, Math.min(control.depth, control.limit))) {
        pushUniforms.uPushPoint.value.copy(coll.point);
        pushUniforms.uPushDir.value.copy(coll.dir).multiplyScalar(coll.push);
      }
      const tool = m4.tool;
      if (olvGrasp !== null && pressing && retract.grasp(olvGrasp, point) === 'ok') {
        act.slot = retract.active;
        track(act, olvGrasp, point);
        olvGrasp = null;
        control.stopFollow();
        syncJaw();
      }
      // A gripping / clamped tip rides its vertex (retraction, pulse); the shaft keeps through the fulcrum.
      if (tool && act.mesh && act.target === m4.target && (act.slot >= 0 || clamped === act.target)) {
        act.mesh.getVertexPosition(act.vi, tT).applyMatrix4(act.mesh.matrixWorld);
        control.aimAt(tT);
      }
      if (tool) control.writeTransform(inst.tools[tool].position, inst.tools[tool].quaternion);
      // T841: engaged jaws sit across the structure (live cut ring), shaft through the fulcrum, stapler articulated.
      if (eng.tool !== null && (eng.tool !== tool || (tool === 'clamp' && clamped === null))) disengage();
      if (eng.tool !== null && control.port) {
        if (eng.split) {
          getStumps()?.cutAt(eng.target, eng.centre, eng.axis);
          eng.centre.addScaledVector(eng.axis, eng.offset);
        }
        const t = inst.tools[eng.tool];
        const art = jawPose(
          eng.tool,
          control.port.pleura,
          eng.centre,
          eng.axis,
          eng.radius,
          t.position,
          t.quaternion,
          jawDir,
        );
        if (eng.tool === 'stapler') inst.setArticulation(art);
      }
      setStumpHeartbeat(state.heartbeat);
      // T840: a node in the jaws follows the tip; the clamp's squeeze eases (matrix writes only while moving).
      if (grab.obj) {
        tA.copy(grab.w0).add(control.tipPos).sub(grab.at);
        grab.obj.parent?.worldToLocal(tA);
        grab.obj.position.copy(tA);
        grab.obj.updateMatrix();
        grab.obj.matrixWorldNeedsUpdate = true;
      }
      updateSqueeze(dt);
      for (let i = 0; i < userHeld.length; i++) {
        const h = userHeld[i] as Held;
        if (h.obj && h.port) aim(h.obj, h.port, h);
      }
      if (fire.update(dt)) onDivide();
      // T841: staples form heel → tip after the compression pause, then the knife runs.
      if (fire.phase === 'firing' && fire.form > 0 && !guideLine(fire.result.target)) {
        if (!lineOn) beginLine();
        staples.reveal(fire.form);
      }
      inst.setKnife(fire.phase === 'firing' ? fire.knife : 0);
      if (clipFire.update(dt)) onClip();
      if (clipFire.phase === 'idle' && !clipLoaded) {
        inst.setClipLoaded((clipLoaded = true)); // reloaded: re-seat for the next clip
        if (eng.tool === 'clip' && divideIn <= 0 && !eng.done)
          engage('clip', eng.target, clipOffset(eng.target));
      }
      if (divideIn > 0 && (divideIn -= dt) <= 0) divideClipped(eng.target);
      if (eng.done && fire.phase === 'idle' && clipFire.phase === 'idle' && divideIn <= 0) disengage();
      inst.setJaw(
        tool === 'stapler' && fire.phase !== 'idle'
          ? fire.jaw
          : tool === 'clip' && clipFire.phase !== 'idle'
            ? clipFire.jaw
            : tool === 'clamp' && eng.tool === 'clamp'
              ? Math.max(eng.closed, 1 - control.jaw)
              : 1 - control.jaw,
      );
      retract.update(realDt); // T860: a let-go grasp eases back over real time (slow frames must not stretch it)
      const peanut = dissect.tool === 'peanut';
      if ((fx.energised || peanut) && (sampleAcc += dt) >= SAMPLE_MS) {
        sampleContact(sampleAcc / 1000, fx.energised);
        sampleAcc = 0;
      }
      // Dissection progresses only while the tip touches the target (T822: no mid-air dissection).
      const done = m4.contact && contactName === dissect.target ? dissect.update(dt) : null;
      if (done !== null) onDissected(done);
      // T825b: tips pick up blood/tissue while energised on tissue or grasping; swabs soak on an active bleed.
      if (pressing) {
        const r = SOIL.rise;
        if (steelSoil < r.steelMax && ((fx.energised && m4.contact) || retract.active >= 0))
          inst.setSoil('steel', (steelSoil = Math.min(r.steelMax, steelSoil + (r.steelPerS * dt) / 1000)));
        if (gauzeSoak < r.gauzeMax && (tool === 'sponge' || tool === 'peanut') && m4.bleedNear?.(point))
          inst.setSoil('gauze', (gauzeSoak = Math.min(r.gauzeMax, gauzeSoak + (r.gauzePerS * dt) / 1000)));
      }
      fx.update(dt / 1000);
      water.update(dt / 1000, fx.bubbles, fx.sucking ? control.tipPos : null);
      ctx.fog.value = fx.fog.value;
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        if (p && p.at >= 0 && now >= p.at) {
          tweenTo(state, p.key, p.to, p.ms);
          p.at = -1;
        }
      }

      // T847b: an instrument brought up to the lens (or the lens to it) backs the scope off (lens exclusion).
      lensAcc = Math.min(lensAcc + dt, FOLLOW_MS);
      if (lensAcc >= FOLLOW_MS && rig.mode === 'scope' && !rig.transitioning) {
        lensAcc = 0;
        const sc = m3.scope;
        sc.writePose(lD, tQ, fovRef);
        lD.sub(sc.port.pleura).normalize();
        if (toolLimit(sc.port.pleura, lD, Infinity) < sc.depth && sc.settle()) {
          m3.syncScope();
          rig.easeScope();
        }
      }

      if (rig.mode !== mode) {
        mode = rig.mode;
        hands.setView(mode);
        pip.setScopeMode(mode === 'scope');
      }
      if (mode === 'scope' && !pip.shown) return;
      m3.scope.writePose(tA, tQ, fovRef);
      scopeObj.position.copy(tA);
      scopeObj.quaternion.setFromUnitVectors(Z, tB.subVectors(tA, m3.scope.port.pleura).normalize());
      scopeObj.updateMatrix();
      hands.update();
    },
    afterRender: () => pip.render(),
    fx,
    cuts,
    water,
    irrigate: irrigateNow,
    startOoze: (p) => fx.startOoze(p, tN.subVectors(camera.position, p).normalize()), // decal faces the scope
    contact: false,
    contactPoint,
    bleedNear: null,
    toast,
    walk: {
      reset: resetCase,
      divided: dividedNow,
      removed: removedNow,
      hold: holdNow,
      // T879: the walkthrough re-collapses on its own clock (step 5 'olv' beat); the practice re-collapse is timed on
      // the wall clock, which made the clamp-test pose depend on pauses and load. Drop it here.
      ventilate: () => {
        if (!dispatch(F.ventilate(finish))) return m4.lastToast;
        for (const p of pending) p.at = -1;
        return 'ok';
      },
      bag: () => (dispatch(F.bagExtract(finish, FIN.accessPort)) ? 'ok' : m4.lastToast),
      busy: () => fire.phase !== 'idle' || clipFire.phase !== 'idle',
      heldOut(port, target) {
        const h = userHeld.find((x) => x.ref && x.port?.id === port && x.target === target);
        if (!h) return null;
        return (f) => {
          if (!h.ref) return;
          h.out = Math.min(1, Math.max(0, f));
          if (h.out < 1) return;
          const i = occupancy.holds.indexOf(h.ref);
          if (i >= 0) occupancy.holds.splice(i, 1);
          syncHeld(); // drop: its grip lets go, the clone hides
        };
      },
      heldTip(port, out) {
        const h = userHeld.find(
          (x) => x.tool === 'grasper' && x.obj?.visible && (!port || x.port?.id === port),
        );
        if (!h?.obj) return false;
        out.copy(h.obj.position); // aim(): the clone's root sits on its tip, in world space (instruments root)
        return true;
      },
    },
  };
  m4.onNodeRemoved.push((_name, p) => m4.startOoze(p)); // T842 node-bed ooze, sealed by cautery contact
  // T860: Guided = the walkthrough (it starts on "ready"); window.__sim.walkthrough is its test / UI hook.
  // Narration starts with the scope view: the app opens on the theatre and the first Next takes the scope in.
  const voice = navigator.webdriver ? null : createVoice();
  if (voice && ctx.shell.root.dataset.view !== 'scope') {
    voice.gate(false);
    const seen = new MutationObserver(() => {
      if (ctx.shell.root.dataset.view !== 'scope') return;
      seen.disconnect();
      voice.gate(true);
    });
    seen.observe(ctx.shell.root, { attributes: true, attributeFilter: ['data-view'] });
  }
  window.__sim.walkthrough = createWalkthrough({
    guided,
    state,
    camera,
    picker: m3.picker,
    meshesOf,
    onNodeRemoved: m4.onNodeRemoved,
    gain: ctx.gain ?? null,
    dock: ctx.shell.caption, // T876 Beat.inset docks here (R5 side dock)
    voice, // narration; null under automation (e2e / perf runs stay silent and unpaced)
  });
  // T890 (critic r2 C10): Guided-hidden nodes in config.scope.guidedFramedShow (the phrenic) show while the current
  // beat's camera frames them (the step-1 phrenic beat), via the action overrides; event time only.
  const walk = window.__sim.walkthrough;
  walk.on('state', () => {
    const cam = walk.currentBeat()?.cam;
    const sub = cam && cam.k !== 'step' ? cam.subject : null;
    let changed = false;
    for (const n of config.scope.guidedFramedShow) {
      const on = sub === n || (Array.isArray(sub) && sub.includes(n));
      if (on === (overrides.get(n) === true)) continue;
      if (on) overrides.set(n, true);
      else overrides.delete(n);
      changed = true;
    }
    if (!changed) return;
    applyVisibility(ctx.vis, state);
    m3.reapplyLayers(); // re-applies the overrides too
  });
  return m4;
}
