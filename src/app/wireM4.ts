// M4 glue (T409): instruments + port occupancy, snap / steer / activate control, grasp-retract, dissect, encircle,
// staple-divide (division planes + staple-line caps), clips, the finish sequence (bronchus test, nodes, fissure,
// bag, chest tube, irrigation + water test), effect pools, gloved hands + the PiP inset. Called once from the
// loader's place() callback right after wireM3, so every object below is in the scene before the compile and
// warm-up stages (§6.10: 0 new programs after ready). Input is event-driven; update(now) is allocation-free.
// Practice mode: `gate` (T505 sets it to the PracticeEngine) is the single authority on action order; while it is
// null actions just apply. finish.ts keeps only its physical prerequisites (no bag before the lobe is free, …).
import { Object3D, Quaternion, Vector3 } from 'three';
import type { IUniform, Mesh, Scene, WebGLRenderer } from 'three';
import { config } from '../core/config';
import { CONTEXT_KEYS, keybindings as K, matchesKey } from '../core/keybindings';
import type { QualityPreset } from '../core/quality';
import { labelFor } from '../content/labels';
import { SUB_IDS, TARGET_BY_ID, TARGETS } from '../content/targets';
import { createEffects } from '../scene/effects';
import { IrrigationFluid } from '../scene/fluid';
import { buildHands } from '../scene/hands';
import { buildInstruments, TOOL_IDS } from '../scene/instruments';
import type { ToolId } from '../scene/instruments';
import { registerWarmupHook, withAllVisible } from '../scene/loadingStages';
import { getDivisionPlanes, graspUniforms, setFade } from '../scene/materials';
import { setDivisionPlane, Staples } from '../scene/staples';
import { Dissect } from '../sim/actions/dissect';
import * as F from '../sim/actions/finish';
import { Retract } from '../sim/actions/retract';
import type { RetractKey } from '../sim/actions/retract';
import { Encircle, StapleFire } from '../sim/actions/staple';
import { SLOTS } from '../sim/hotbar';
import { InstrumentController } from '../sim/instrumentControl';
import { getMode, onModeChange } from '../sim/modes';
import { PortOccupancy } from '../sim/portOccupancy';
import type { Port } from '../sim/ports';
import type { PracticeAttempt } from '../sim/practice';
import type { ActionKind, PracticeTool } from '../sim/practiceActions';
import { retractionConfig as R } from '../sim/retraction.config';
import { startOLV, tweenTo } from '../sim/state';
import type { TweenKey } from '../sim/state';
import { mountRetractionStrip } from '../ui/hotbar';
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
  /** T820, same as G / the Hold button: lock the placed grasper / sponge-stick (and its retraction) in its port. */
  hold: () => string;
  /** Same as Shift+G / the Release button: let go of the most recent hold; the lung eases back. */
  releaseHold: () => string;
  /** Held instruments drawn right now (user holds + the guided step's static grasper). */
  heldShown: () => number;
  /** Frame loop, after M3. Allocation-free. */
  update: (now: number) => void;
  /** After the post-FX pass drew the canvas (PiP inset). */
  afterRender: () => void;
  /** Effect pools (T505: complication blood decals + ooze). */
  fx: ReturnType<typeof createEffects>;
  /** Show the action toast (T505: practice feedback); returns `msg`. */
  toast: (msg: string) => string;
}

const A = config.actions;
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
const tNdc = new Vector3();
const tT = new Vector3();
const tQ2 = new Quaternion();

/** A held instrument's look + where its tip sits: a lobe vertex, read morph-aware so the tip rides the retraction. */
interface Held {
  target: string | null;
  key: RetractKey;
  port: Port | null;
  obj: Object3D | null;
  mesh: Mesh | null;
  vi: number;
  /** Per holdable tool: a clone of the hand's instrument (shared geometry + materials → no new programs). */
  clones: Record<string, Object3D>;
}
const fovRef = { fov: 0 };

export function wireM4(ctx: M4Context): M4 {
  const { app, canvas, model, camera, rig, guided, state, m3, scene, renderer, preset } = ctx;
  const ports = m3.scope.ports;
  const portLabel = (id: string | null): string => ports.find((p) => p.id === id)?.label ?? '—';
  const toolName = (id: string | null): string => SLOTS.find((s) => s.id === id)?.name ?? 'Hands';

  // Built once, in the scene before compile / warm-up.
  const inst = buildInstruments();
  const fx = createEffects(preset);
  const staples = new Staples();
  const fluid = new IrrigationFluid();
  const hands = buildHands();
  scene.add(inst.root, fx.group, staples.group, fluid.mesh, hands.root);
  const stump = new Vector3(...(TARGET_BY_ID.get(FIN.stump)?.point ?? [0, 0, 0]));
  fluid.placeAt(tA.copy(stump).setY(stump.y - config.fluid.belowStumpM));

  const control = new InstrumentController();
  const occupancy = new PortOccupancy(ports);
  const enc = new Encircle();
  const fire = new StapleFire();
  const finish = F.createFinishState();
  const retract = new Retract(state, graspUniforms);

  // Node → meshes, filled at load for every target / window so per-frame fades never allocate.
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
  for (const w of Object.values(config.dissect.windows)) meshesOf(w);

  // Action visibility (dissection windows, removed nodes / lobe) survives step + view visibility passes.
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
    setFade: (n, f) => {
      const ms = meshesOf(n);
      for (let i = 0; i < ms.length; i++) setFade(ms[i] as Mesh, f);
    },
    swapToWindow: (n, w) => {
      overrides.set(n, false);
      setShown(w, true);
    },
    clearView: () => {
      fx.suction();
      fx.fog.clear();
    },
  });

  // Toast (reasons + results), one element reused.
  const toastEl = document.createElement('div');
  toastEl.id = 'action-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.style.cssText =
    'position:fixed;left:50%;top:var(--space-6);transform:translateX(-50%);max-width:60ch;padding:var(--space-1) var(--space-2);background:var(--color-surface-overlay);color:var(--color-text);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-sm);pointer-events:none;z-index:6;visibility:hidden';
  app.append(toastEl);
  let toastTimer = 0;
  const toast = (msg: string): string => {
    toastEl.textContent = msg;
    toastEl.style.visibility = 'visible';
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.style.visibility = 'hidden'), A.toastMs);
    m4.lastToast = msg;
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
      else if (q.kind === 'fluid') fluid.setLevel(q.level);
      else if (q.kind === 'bubbles') fx.bubbleBurst(stump);
      // 'divide': the stapler fire already cut its target (onDivide); 'advance': step progression is T505's.
    }
    return true;
  }

  const allowed = (
    kind: ActionKind,
    tool: PracticeTool,
    target: string | null,
    port: string | null,
  ): boolean => !m4.gate || m4.gate({ tool, subOption: sub, target, port, kind, point });

  const refreshPorts = (): void => m3.syncScope();
  // T808: why the scope may not enter a port (toast text), '' = it may.
  m3.portHooks.refusal = (id) =>
    occupancy.hasRoom(id)
      ? ''
      : occupancy.heldIn(id) > 0
        ? `${portLabel(id)} holds a retraction: transfer it via another port (G) or release it (Shift+G) first`
        : occupancy.activePort === id
          ? `${portLabel(id)} is occupied by the ${toolName(occupancy.activeTool).toLowerCase()}: withdraw it (Esc) or move it (P)`
          : `${portLabel(id)} is full`;
  m3.portHooks.toast = toast;
  m3.portHooks.occupant = (id) => {
    const a = occupancy.activePort === id ? toolName(occupancy.activeTool) : '';
    const held = occupancy.holds.filter((x) => x.port === id).map((x) => toolName(x.tool));
    const h = held.length ? `Held: ${held.join(', ')}` : '';
    return a && h ? `${a} + ${h}` : a || h;
  };

  // ── Tool selection ──
  let sub: string | null = null;
  let pressing = false;
  const point = new Vector3(); // live target point (pick hit)
  let lastPort: string = config.ports.toolDefault;

  // ── Held instruments (T820): user holds + the guided step's static grasper; clones built once, here ──
  const newHeld = (): Held => {
    const clones: Record<string, Object3D> = {};
    for (const id of R.holdable) {
      const c = inst.tools[id as ToolId].clone();
      c.visible = false;
      inst.root.add(c);
      clones[id] = c;
    }
    return { target: null, key: 'retract_posterior', port: null, obj: null, mesh: null, vi: 0, clones };
  };
  const userHeld = Array.from({ length: R.maxHeld }, newHeld);
  const guidedHeld = newHeld();
  const allHeld = [...userHeld, guidedHeld];
  /** The hand's grasp (vertex the active tip rides while dragging). */
  const act: Held = {
    target: null,
    key: 'retract_posterior',
    port: null,
    obj: null,
    mesh: null,
    vi: 0,
    clones: {},
  };
  let olvGrasp: string | null = null;

  function abort(): void {
    if (pressing) release();
    if (fire.phase === 'closing' || fire.phase === 'closed') {
      fire.release();
      if (fire.result.target === BRONCHUS) F.unclampBronchus(finish);
    }
  }

  function park(port: Port): void {
    abort();
    m4.target = null;
    control.park(port);
    occupancy.insert(m4.tool as ToolId, port.id);
    lastPort = port.id;
    refreshPorts();
  }

  function select(slot: number, subIdx: number): void {
    const id = SLOTS[slot]?.id ?? 'hands';
    const next = (TOOL_IDS as readonly string[]).includes(id) ? (id as ToolId) : null;
    sub = next ? (SUB_IDS[next]?.[subIdx] ?? null) : null;
    abort();
    inst.show(next, subIdx);
    if (next === m4.tool) return; // sub-option change only
    occupancy.withdraw();
    m4.tool = next;
    m4.target = null;
    hands.setTarget('tool', next ? inst.tools[next] : null);
    if (next) {
      const p =
        ports.find((q) => q.id === lastPort && occupancy.hasRoom(q.id)) ??
        ports.find((q) => occupancy.hasRoom(q.id));
      if (p) park(p);
      else toast('No free port for an instrument');
    }
    refreshPorts();
  }
  m3.hotbar.on('change', (e) => select(e.slot, e.subOption));

  function nextToolPort(): string {
    const cur = ports.findIndex((p) => p.id === occupancy.activePort);
    for (let k = 1; k <= ports.length; k++) {
      const p = ports[(cur + k + ports.length) % ports.length] as Port;
      if (p.id === occupancy.activePort || !occupancy.hasRoom(p.id)) continue;
      park(p);
      toast(`${toolName(m4.tool)}: ${p.label}`);
      return 'ok';
    }
    return toast('No other free port');
  }

  // ── Snap (left-click a structure) ──
  function snapTo(name: string, at: Vector3): string {
    const tool = m4.tool;
    if (!tool) return 'hands';
    const tid = name.endsWith(config.dissect.windowSuffix)
      ? name.slice(0, -config.dissect.windowSuffix.length)
      : name;
    const t = TARGET_BY_ID.get(tid);
    if (!t || t.tools[tool] === undefined)
      return toast(`${toolName(tool)}: no action on the ${labelFor(name).name.toLowerCase()}`);
    const port = ports.find((p) => p.id === occupancy.activePort);
    if (!port) return toast(REASONS['no-port'] as string);
    let c: string = occupancy.canFire(tool, tid, port.id, sub, at);
    if (c === 'wrong-tool' && tool === 'stapler') c = 'wrong-cartridge';
    if (c !== 'ok') return toast(REASONS[c] ?? c);
    abort();
    const r = control.snapTo(port, at);
    if (!r.ok) return toast(`${r.reason}: try another port (P)`);
    m4.target = tid;
    act.target = null;
    point.copy(at);
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
    const tid = m4.target;
    if (!tid || control.phase === 'inserting' || control.phase === 'withdrawing')
      return toast(REASONS.place as string);
    const port = occupancy.activePort;
    pressing = true;
    control.activate(true);
    if (tool === 'grasper' && sub === 'ring') {
      if (!allowed('remove-node', tool, tid, port)) return 'gated';
      return dispatch(F.removeNode(finish, tid, port ?? '')) ? 'ok' : m4.lastToast;
    }
    if (tool === 'grasper' || tool === 'sponge') {
      if (!allowed('retract', tool, tid, port)) return 'gated';
      const g = retract.grasp(tid, point);
      if (g === 'ok') track(act, tid, point);
      if (g !== 'not-collapsed') return g === 'ok' ? g : toast(REASONS[g] ?? g);
      // §7.3: retraction morphs exist for the collapsed lung only → collapse it, grasp once it is down (update).
      startOLV(state);
      olvGrasp = tid;
      return toast('One-lung ventilation started');
    }
    if (tool === 'peanut' || tool === 'cautery') {
      if (!allowed('dissect', tool, tid, port)) return 'gated';
      dissect.begin(tid, tool);
      if (tool === 'cautery') {
        // T817: smoke plume at the tip, char mark at the contact point, ECG diathermy interference (vitals).
        inst.setGlow(1);
        state.cauteryActive = true;
        fx.cautery(control.tipPos, point, contactNormal(point, tN));
      }
      return 'ok';
    }
    if (tool === 'clamp') {
      if (!allowed('encircle', tool, tid, port)) return 'gated';
      return toast(
        enc.pass(tid, 'clamp')
          ? `Passage made behind the ${labelFor(tid).name.toLowerCase()}`
          : 'The clamp cannot pass behind this',
      );
    }
    if (tool === 'clip') {
      if (!allowed('fire', tool, tid, port)) return 'gated';
      const ax = TARGET_BY_ID.get(tid)?.axis ?? [0, 1, 0];
      staples.addClip(point, tA.set(...ax), tB.set(1, 0, 0).applyQuaternion(inst.tools.clip.quaternion));
      return 'ok';
    }
    if (tool === 'sucker') {
      if (sub !== 'irrigation') {
        dissect.suction();
        return 'ok';
      }
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
    const s = fire.close(tid, sub, enc, point);
    if (s !== 'ok') return toast(REASONS[s] ?? s);
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
    control.activate(false);
    inst.setGlow(0);
    fx.cautery(null);
    state.cauteryActive = false;
    dissect.end();
    if (retract.key === null) return;
    retract.release(false);
    if (m4.target === FIN.lobe && finish.fissureFires > 0 && !finish.undersideConfirmed) {
      const r = F.confirmUnderside(finish, state.retract_fissure);
      if (r.ok) dispatch(r);
    }
  }

  function onDivide(): void {
    const r = fire.result;
    if (r.target !== FIN.lobe) {
      // Fissure fires cap only: clipping the lobe mesh would cut the lobe itself away.
      if (r.hide) setShown(r.target, false);
      else
        for (const m of meshesOf(r.target)) {
          const planes = getDivisionPlanes(m);
          if (planes) setDivisionPlane(planes, r.point, r.normal, 0);
        }
      if (r.target.startsWith('V')) F.noteDivided(finish, 'vein');
      else if (r.target.startsWith('A')) F.noteDivided(finish, 'artery');
    }
    staples.addLine(r.point, r.normal, tB.set(1, 0, 0).applyQuaternion(inst.tools.stapler.quaternion));
    m4.flags.add(`divided:${r.target}`);
  }

  /** Char decal orientation: the surface normal under `at` seen from the scope (BVH re-pick, press time only),
   *  turned toward the camera; facing the camera when the point isn't the visible surface (as wireM5's bleeds). */
  function contactNormal(at: Vector3, out: Vector3): Vector3 {
    out.subVectors(camera.position, at).normalize();
    tNdc.copy(at).project(camera);
    const hit = m3.picker.pick(tNdc.x, tNdc.y, camera);
    const tol = config.effects.decal.normalPickTolM;
    if (!hit || hit.normal.lengthSq() === 0 || hit.point.distanceToSquared(at) > tol * tol) return out;
    return hit.normal.dot(out) < 0 ? out.copy(hit.normal).negate() : out.copy(hit.normal);
  }

  const onDissected = (id: string): void => void toast(`${labelFor(id).name}: dissected`);

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
      return toast('Nothing to hold: place the grasper (2) or sponge-stick (3) on a lobe first');
    if (occupancy.holdFull(tid))
      return toast(`${R.maxHeld} instruments already hold the lung: release one first (Shift+G)`);
    const key = retract.key ?? config.retract.morphFor[tid] ?? 'retract_posterior';
    if (retract.key !== null) retract.release(true);
    pressing = false;
    olvGrasp = null;
    control.activate(false);
    occupancy.hold(tid);
    const h = (userHeld.find((x) => x.target === tid) ?? userHeld.find((x) => x.target === null)) as Held;
    hide(h);
    if (act.target === tid && act.mesh) {
      h.mesh = act.mesh;
      h.vi = act.vi;
    } else track(h, tid, control.tipPos);
    Object.assign(h, { target: tid, key, port, obj: h.clones[tool] ?? null });
    if (h.obj) h.obj.visible = true;
    act.target = null;
    m3.hotbar.select(0); // the hand is free: pick the next instrument
    refreshPorts();
    strip.setHeld(occupancy.holds.length);
    return toast(
      `${toolName(tool)} held via the ${port.label.toLowerCase()}: pick another tool (Shift+G releases)`,
    );
  }

  function releaseHold(): string {
    const r = occupancy.release();
    if (!r) return toast('Nothing is held');
    const h = userHeld.find((x) => x.target === r.target);
    if (h) {
      hide(h);
      if (retract.key !== h.key && !userHeld.some((x) => x.target !== null && x.key === h.key))
        tweenTo(state, h.key, R.releaseTo, R.releaseMs);
    }
    refreshPorts();
    strip.setHeld(occupancy.holds.length);
    return toast(`${toolName(r.tool)} released: the lung falls back`);
  }

  /** Guided steps 2–6: the authored static grasper (event time; the tip rides the authored lobe vertex). */
  function showGuided(): void {
    const a = getMode() === 'guided' ? R.guided[guided.current] : undefined;
    const port = a && ports.find((p) => p.id === a.port);
    if (!a || !port) return hide(guidedHeld);
    if (guidedHeld.target !== a.target || guidedHeld.port !== port) {
      model.updateMatrixWorld();
      track(guidedHeld, a.target, tB.set(...a.at), true);
    }
    guidedHeld.port = port;
    guidedHeld.obj = guidedHeld.clones.grasper ?? null;
    if (guidedHeld.obj) guidedHeld.obj.visible = true;
  }
  guided.on('stepchange', showGuided);
  onModeChange(() => {
    // A new mode starts from its own state: drop user holds without a spring-back tween.
    occupancy.releaseAll();
    for (const h of userHeld) hide(h);
    strip.setHeld(0);
    refreshPorts();
    showGuided();
  });
  const strip = mountRetractionStrip(ctx.shell.ports, {
    hold: () => void hold(),
    release: () => void releaseHold(),
  });
  showGuided();

  // ── Keys: Esc withdraw, P instrument port, G hold, A / B / T context actions, I PiP ──
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target instanceof Element && e.target.closest(SKIP_TARGETS)) return;
    const c = e.code;
    const tool = m4.tool;
    if (pip.handleKey(e)) {
      if (!pip.shown) toast(pip.enabled ? "Surgeon's view shows in the scope view" : "Surgeon's view off");
    } else if (tool && matchesKey(K.instrumentWithdraw, c)) {
      abort();
      control.withdraw();
      occupancy.withdraw();
      m4.target = null;
      refreshPorts();
    } else if (tool && !e.shiftKey && matchesKey(K.nextPort, c))
      nextToolPort(); // Shift+P: scope (M3)
    else if (c === CONTEXT_KEYS.hold) {
      if (e.shiftKey) releaseHold();
      else hold();
    } else if (c === CONTEXT_KEYS.ventilate) {
      if (allowed('ventilate', 'ventilate', finish.fluidFilled ? FIN.stump : BRONCHUS, null))
        dispatch(F.ventilate(finish));
    } else if (c === CONTEXT_KEYS.bag) {
      if (allowed('bag', 'bag', FIN.lobe, FIN.accessPort)) dispatch(F.bagExtract(finish, FIN.accessPort));
    } else if (c === CONTEXT_KEYS.chestTube) {
      if (allowed('chest-tube', 'chestTube', null, FIN.chestTubePort))
        dispatch(F.placeChestTube(finish, FIN.chestTubePort, m3.scope.port.id));
    } else return;
    e.preventDefault();
  });

  // ── Pointer (tool slots only; Hands belongs to M3; quiz identify clicks belong to m3.onPick) ──
  let lastX = 0;
  let lastY = 0;
  let steering = false;
  const busy = (): boolean => !m4.tool || m3.onPick !== null;
  canvas.addEventListener('contextmenu', (e) => m4.tool && e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (busy()) return;
    lastX = e.clientX;
    lastY = e.clientY;
    if (e.button === 2) {
      steering = true;
      return;
    }
    if (e.button !== 0) return;
    const hit = m3.picker.pick(
      (e.clientX / canvas.clientWidth) * 2 - 1,
      -(e.clientY / canvas.clientHeight) * 2 + 1,
      camera,
    );
    const tid = hit?.nodeName.replace(config.dissect.windowSuffix, '');
    if (hit && tid === m4.target && control.phase !== 'parked') press(true);
    else if (hit) snapTo(hit.nodeName, hit.point);
    else toast(REASONS.place as string);
  });
  canvas.addEventListener('pointermove', (e) => {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (busy()) return;
    if (steering) control.steer(dx, dy);
    else if (pressing && retract.key !== null) retract.drag(dx, dy);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button === 2) steering = false;
    else if (e.button === 0 && pressing) release();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (busy()) return;
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
  const m4: M4 & { tool: ToolId | null; target: string | null; lastToast: string } = {
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
    hold,
    releaseHold,
    heldShown: () => allHeld.filter((h) => h.obj?.visible).length,
    update(now) {
      const dt = last ? Math.min(now - last, A.maxDtMs) : 0;
      last = now;
      occupancy.scopePort = m3.scope.port.id;
      // View basis for mirrored steering and view-space pulls.
      tA.set(1, 0, 0).applyQuaternion(camera.quaternion);
      control.viewRight.copy(tA);
      retract.viewRight.copy(tA);
      tA.set(0, 1, 0).applyQuaternion(camera.quaternion);
      control.viewUp.copy(tA);
      retract.viewUp.copy(tA);

      control.update(dt);
      const tool = m4.tool;
      if (tool) control.writeTransform(inst.tools[tool].position, inst.tools[tool].quaternion);
      if (olvGrasp !== null && pressing && retract.grasp(olvGrasp, point) === 'ok') {
        track(act, olvGrasp, point);
        olvGrasp = null;
      }
      // The grasped tip rides the lobe while it is pulled (and after, until the tool moves).
      if (tool && act.mesh && act.target === m4.target && control.phase === 'placed' && control.port)
        aim(inst.tools[tool], control.port, act);
      for (let i = 0; i < allHeld.length; i++) {
        const h = allHeld[i] as Held;
        if (h.obj && h.port) aim(h.obj, h.port, h);
      }
      if (fire.update(dt)) onDivide();
      inst.setJaw(tool === 'stapler' && fire.phase !== 'idle' ? fire.jaw : 1 - control.jaw);
      retract.update(dt);
      const done = dissect.update(dt);
      if (done !== null) onDissected(done);
      fx.update(dt / 1000);
      fluid.update(dt / 1000);
      ctx.fog.value = fx.fog.value;
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        if (p && p.at >= 0 && now >= p.at) {
          tweenTo(state, p.key, p.to, p.ms);
          p.at = -1;
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
    toast,
  };
  return m4;
}
