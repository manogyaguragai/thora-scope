// T860 guided walkthrough engine (FEEDBACK_GUIDED_v1 §2.1, R1, R3): plays WALK_STEPS (steps/*.ts) as a film. Guided
// mode IS the walkthrough: entering a step (rail / Next / Prev / ?step=N) seeks it — an instant, in-place rebuild of
// the case (reset, then the end-states of steps 1…N-1: divisions with stumps, nodes out, bed sealed, the holding
// grasper in its port, scope port; no page reload) — then auto-plays its beats and holds the final pose. Step 1's
// pause beats advance on Next. One engine clock (× timeScale) drives every engine wait and move; it is ticked from the
// guided controller's frame update (guided.walk.tick) and allocates nothing per frame (fixed slots; promises and
// callbacks are created per move, at event time). Hook: window.__sim.walkthrough (types.ts WalkthroughHook).
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import type { IUniform, Mesh, Object3D, PerspectiveCamera, ShaderMaterial } from 'three';
import { config } from '../../core/config';
import { TARGET_BY_ID } from '../../content/targets';
import type { Picker } from '../../scene/picking';
import { fissureGuideConfig } from '../../scene/fissureGuide.config';
import type { FinishState } from '../../sim/actions/finish';
import type { Guided } from '../../sim/guided';
import { getMode, onModeChange } from '../../sim/modes';
import { walkRate } from '../../sim/walkLock';
import type { AppState, TweenKey } from '../../sim/state';
import { ease, TWEEN_KEYS, tweenTo } from '../../sim/state';
import type { RetrievalBag } from '../../scene/retrievalBag';
import { setFade } from '../../scene/materials';
import { updateMorphs } from '../../scene/morphs';
import { setAmbientForView } from '../../scene/lights';
import type { PipInset } from '../../ui/pip';
import {
  aimRig,
  Framer,
  levelRig,
  loadRig,
  newFraming,
  newSnap,
  saveRig,
  scopeInside,
  searchPose,
  setHorizon,
  subjectKey,
} from './framing';
import { act, cam, measureNow, placeHold } from './shots';
import type { Clock, ShotCtx } from './shots';
import { WALK_STEPS } from './steps';
import type {
  Act,
  BedFxApi,
  Beat,
  HighlightApi,
  Subject,
  WalkEvent,
  WalkState,
  WalkStatus,
  WalkStep,
  WalkthroughHook,
} from './types';
import { walkthroughConfig as W } from './walkthrough.config';

export interface WalkDeps {
  guided: Guided;
  state: AppState;
  camera: PerspectiveCamera;
  picker: Picker;
  meshesOf: (name: string) => readonly Mesh[];
  /** m4.onNodeRemoved: the engine keeps the last node bed (subject { bed: true }). */
  onNodeRemoved: ((name: string, point: Vector3) => void)[];
  /** Step timelines (tests); default WALK_STEPS. */
  steps?: readonly WalkStep[];
  /** Post-FX grade gain (uGain): reduced-motion dips; null = no dips (tests). */
  gain?: IUniform<Vector3> | null;
  /** T876: side dock the Beat.inset frame goes in (null = no inset). */
  dock?: HTMLElement | null;
}

const RML = fissureGuideConfig.lobe;
/** Lobe collapse morph prefix (src/scene/morphs.ts: collapse_<lobe> ← deflate_<lobe>). */
const COLLAPSE = 'collapse_';
const DRIFT = fissureGuideConfig.drift;
const F_BED = W.framing.bedRadiusM;
const FISSURES = fissureGuideConfig.fissures;
const RETRACT: readonly TweenKey[] = ['retract_hilum', 'retract_RML_lateral', 'retract_fissure'];
/** Acts that move the camera themselves: a beat's cam runs after them, not alongside. */
const CAMERA_ACTS: ReadonlySet<Act['k']> = new Set(['insert', 'withdraw', 'handoff', 'segment']);
/** T871: acts that move the subject (reflection, retraction, a test breath inflating the lobes): the beat's cam
 *  searches once the pose has settled. */
const movesSubject = (a: Act): boolean =>
  (a.k === 'grasp' && a.key !== undefined) || a.k === 'pose' || a.k === 'ventilate';
const BED_DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

const cameraSubject = (b: Beat): Subject | null =>
  b.cam && b.cam.k !== 'step' ? b.cam.subject : b.act?.k === 'insert' ? b.act.target : null;
const glowOf = (b: Beat): Subject | null =>
  b.glow !== undefined ? b.glow : b.kind === 'working' || b.kind === 'result' ? cameraSubject(b) : null;
/** Part of beat `b` in a step with pause beats (0-based) and the first beat of part `p`. */
const partOf = (s: WalkStep, b: number): number => s.beats.slice(0, b).filter((x) => x.pause).length;
function partStart(s: WalkStep, p: number): number {
  if (p <= 0) return 0;
  let n = 0;
  for (let i = 0; i < s.beats.length; i++) if (s.beats[i]?.pause && ++n === p) return i + 1;
  return 0;
}

// Fixed scheduler slots: waits / eased moves / predicates on the engine clock.
const FREE = 0;
const WAIT = 1;
const MOVE = 2;
const UNTIL = 3;
interface Slot {
  kind: number;
  t0: number;
  ms: number;
  fn: ((e: number) => void) | null;
  ok: (() => boolean) | null;
  deadline: number;
  res: ((v: boolean) => void) | null;
}
const NSLOTS = 6;

export function createWalkthrough(deps: WalkDeps): WalkthroughHook {
  const { guided, state } = deps;
  const STEPS = deps.steps ?? WALK_STEPS;
  const sim = (): Window['__sim'] => window.__sim;
  const slots: Slot[] = Array.from({ length: NSLOTS }, () => ({
    kind: FREE,
    t0: 0,
    ms: 0,
    fn: null,
    ok: null,
    deadline: 0,
    res: null,
  }));
  let clock = 0;
  const gainBase = new Vector3();
  let dipping = false;
  let last = 0;
  let token = 0;
  let ff = false;
  let scale = 1;
  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reduced = motion?.matches ?? false;
  motion?.addEventListener('change', (e) => (reduced = e.matches));

  let status: WalkStatus = 'idle';
  let resume: WalkStatus = 'playing';
  let si = 0;
  let beat = 0;
  let done = 0;
  let error: string | null = null;
  let started = false;
  let selfNav = false;
  let nextRes: ((v: boolean) => void) | null = null;
  const listeners: Record<WalkEvent, ((s: WalkState, text: string) => void)[]> = {
    caption: [],
    msg: [],
    state: [],
  };

  function settle(s: Slot, v: boolean): void {
    const r = s.res;
    s.kind = FREE;
    s.fn = s.ok = s.res = null;
    r?.(v);
  }
  /** Event time: one free slot per wait / move / predicate (false at once if all are taken). */
  function slot(
    kind: number,
    ms: number,
    fn: Slot['fn'] = null,
    ok: Slot['ok'] = null,
    realMs = 0,
  ): Promise<boolean> {
    const s = slots.find((x) => x.kind === FREE);
    if (!s) return Promise.resolve(false);
    s.kind = kind;
    s.t0 = clock;
    s.ms = ms;
    s.fn = fn;
    s.ok = ok;
    s.deadline = performance.now() + realMs;
    return new Promise<boolean>((res) => (s.res = res));
  }
  const k: Clock = {
    wait: (ms) => (ms <= 0 ? Promise.resolve(true) : slot(WAIT, ms)),
    move: (ms, fn) => slot(MOVE, ms, fn),
    until: (ok, realMs = W.waitMs) => (ok() ? Promise.resolve(true) : slot(UNTIL, 0, null, ok, realMs)),
    dur: (ms) => (reduced ? Math.min(ms, W.reducedMs) : ms),
    alive: () => true,
    reduced: () => reduced,
    dip(f) {
      const g = deps.gain;
      if (!g) return;
      if (f >= 1) {
        if (dipping) g.value.copy(gainBase);
        dipping = false;
        return;
      }
      if (!dipping) gainBase.copy(g.value);
      dipping = true;
      g.value.copy(gainBase).multiplyScalar(f);
    },
  };

  function cancel(): void {
    token++;
    for (const s of slots) if (s.kind !== FREE) settle(s, false);
    const r = nextRes;
    nextRes = null;
    r?.(false);
    hl()?.hide(0);
    ghostOff(true);
    insetShow(false);
    k.dip(1);
  }

  function tick(now: number): void {
    const real = last ? now - last : 0;
    const dt = Math.min(real, W.maxDtMs);
    last = now;
    if (!started && window.__perf?.ready) {
      started = true;
      const want = new URLSearchParams(location.search).get('mode');
      if (getMode() === 'guided' && (want === null || want === 'guided')) void seek(state.step);
    }
    const walking = started && getMode() === 'guided' && status !== 'idle';
    const step = status !== 'paused' ? dt * (ff ? W.fastForward : scale) : 0;
    clock += step;
    // m4's own animations follow: frozen while paused, × timeScale (capped) while the walkthrough runs.
    walkRate.value = !walking ? 1 : status === 'paused' ? 0 : Math.min(W.maxRate, ff ? W.fastForward : scale);
    // T871: state tweens (reflection, test breath, OLV, the fissure drift) run on the engine clock: their start
    // shifts by the real time minus the engine time of this frame (frozen while paused, × timeScale).
    if (walking && real !== step)
      for (let i = 0; i < TWEEN_KEYS.length; i++) {
        const tw = state.tweens[TWEEN_KEYS[i] as TweenKey];
        if (tw.active && tw.start >= 0) tw.start += real - step;
      }
    let moved = false;
    for (let i = 0; i < NSLOTS; i++) {
      const s = slots[i] as Slot;
      if (s.kind === WAIT) {
        if (clock >= s.t0 + s.ms) settle(s, true);
      } else if (s.kind === MOVE) {
        moved = true;
        const p = s.ms <= 0 ? 1 : Math.min(1, (clock - s.t0) / s.ms);
        s.fn?.(ease(p));
        if (p >= 1) settle(s, true);
      } else if (s.kind === UNTIL) {
        if (s.ok?.()) settle(s, true);
        else if (now > s.deadline) settle(s, false);
      }
    }
    // T874: ghost fade (real time, as the glow's), fade writes only while it moves.
    if (ghostK !== ghostTo) {
      ghostK =
        ghostTo > ghostK
          ? Math.min(ghostTo, ghostK + dt / W.reducedMs)
          : Math.max(ghostTo, ghostK - dt / W.reducedMs);
      applyGhost();
    }
    // T871: the rendered camera takes this frame's rig pose now (the rig ran before this tick; same `now`, so the
    // second update only copies the pose): a paused / settled beat is what the pixels show.
    if (moved) sim().rig?.update(now);
  }
  /** No state tween running (allocation-free: checked per frame by k.until). */
  const settled = (): boolean => {
    for (let i = 0; i < TWEEN_KEYS.length; i++)
      if (state.tweens[TWEEN_KEYS[i] as TweenKey].active) return false;
    return true;
  };

  // T874 Beat.ghost: occluders on the pre-compiled transparent variant (materials.setFade, uniform/opacity only).
  let ghosted: Mesh[] = [];
  let ghostK = 0;
  let ghostTo = 0;
  function applyGhost(): void {
    const f = 1 - (1 - W.ghostOpacity) * ghostK;
    for (const m of ghosted) setFade(m, f);
    if (ghostK === 0 && ghostTo === 0) ghosted = [];
  }
  /** Event time: ghost `names` (fading in); meshes ghosted before and not in `names` are back at once. */
  function ghostOn(names: readonly string[]): void {
    const next = names.flatMap((n) => [...deps.meshesOf(n)]);
    for (const m of ghosted) if (!next.includes(m)) setFade(m, 1);
    ghosted = next;
    framer.ghost.clear();
    for (const m of next) framer.ghost.add(m.name);
    ghostTo = 1;
  }
  /** Fade back (`now`: at once, e.g. seek); framing sees the ghosted structures again from here. */
  function ghostOff(now = false): void {
    framer.ghost.clear();
    ghostTo = 0;
    if (now) {
      ghostK = 0;
      applyGhost();
    }
  }

  /** T874 (seek, event time): the frame loop writes morphs, matrices and the pick bake only on later frames; a seek
   *  frames its first beat (and places its holds) at once, so it brings them to the rebuilt state now. The first
   *  seek after load read the unreflected lobe (step 3 hold: offset 0.52 / 1.28). */
  let morphMeshes: Mesh[] | null = null;
  function settleGeometry(): void {
    const S = sim();
    const picker = S.m3?.picker;
    const first = picker?.meshes[0];
    if (!picker || !first) return;
    let root: Object3D = first;
    while (root.parent) root = root.parent;
    root.updateMatrixWorld(true);
    if (S.morphs) updateMorphs(S.morphs, state);
    morphMeshes ??= picker.meshes.filter((m) => m.morphTargetDictionary !== undefined);
    picker.refreshMorphs(morphMeshes);
  }

  // T876 Beat.inset 'lungs': the PiP inset from a fixed outside camera; everything but W.inset.keep (and the glow
  // overlays) hidden around the inset's own render only (visibility only: meshes, never lights), outside ambient.
  // T877: framed tight on the lobes from the side of the glow subject, the glow stronger in the inset only (uniform
  // writes around its render, restored after; no program change).
  let insetHide: Object3D[] | null = null;
  let insetVis: Uint8Array = new Uint8Array(0);
  let insetOn = false;
  let hlMesh: Mesh[] = [];
  /** Per overlay: kind (0 rim, 1 outline, 2 band) + its own uShape xyz and uLift (restored after the inset). */
  let hlKind = new Uint8Array(0);
  let hlSave = new Float32Array(0);
  const hlColor = new Vector3();
  const G = W.inset.glow;
  function glowBoost(on: boolean): void {
    for (let i = 0; i < hlMesh.length; i++) {
      const o = hlMesh[i] as Mesh;
      if (!o.visible) continue;
      const u = (o.material as ShaderMaterial).uniforms;
      const sh = (u.uShape as IUniform<Vector3>).value;
      const lift = u.uLift as IUniform<number>;
      const k = hlKind[i] as number;
      if (on && k === 0) sh.set(G.rim[0], G.rim[1], G.rim[2]);
      else if (on && k === 1) {
        sh.set(G.outline[0], G.outline[1], 0);
        lift.value = G.outline[2];
      } else if (on)
        sh.set(0, G.band, sh.z); // T888: the full baked band width (highlight insetBandM)
      else {
        sh.set(hlSave[4 * i] as number, hlSave[4 * i + 1] as number, hlSave[4 * i + 2] as number);
        lift.value = hlSave[4 * i + 3] as number;
      }
    }
    const first = hlMesh[0]?.material as ShaderMaterial | undefined;
    const col = first?.uniforms.uColor as IUniform<Vector3> | undefined;
    if (!col) return;
    if (on) {
      hlColor.copy(col.value);
      col.value.multiplyScalar(G.color);
    } else col.value.copy(hlColor);
  }
  const insetCfg: PipInset | null = deps.dock
    ? {
        host: deps.dock,
        label: W.inset.label,
        gain: W.inset.gain,
        before() {
          const list = insetHide as Object3D[];
          for (let i = 0; i < list.length; i++) {
            const o = list[i] as Object3D;
            insetVis[i] = o.visible ? 1 : 0;
            o.visible = false;
          }
          setAmbientForView(false);
          glowBoost(true);
          for (const m of ghosted) setFade(m, 1); // the outside view shows the lobes as they are (pre-compiled variant)
        },
        after() {
          applyGhost();
          glowBoost(false);
          const list = insetHide as Object3D[];
          for (let i = 0; i < list.length; i++) (list[i] as Object3D).visible = insetVis[i] === 1;
          setAmbientForView(sim().rig?.mode === 'scope');
        },
      }
    : null;
  /** Event time. `subject` = the beat's glow subject (the view tilts toward it); `grow` = also fit the lobes'
   *  inflated shape (a test breath during the inset). On while already on: re-aims. */
  function insetShow(on: boolean, subject: Subject | null = null, grow = false): void {
    const pip = sim().m4?.pip;
    if (!pip || !insetCfg) return;
    if (!on) {
      if (insetOn) pip.inset(null);
      insetOn = false;
      return;
    }
    if (!insetHide) {
      let root: Object3D = deps.camera;
      while (root.parent) root = root.parent;
      const keep = new Set(W.inset.keep);
      const kept = (o: Object3D | null): boolean => {
        for (; o; o = o.parent) if (keep.has(o.name) || o.name === 'highlight') return true;
        return false;
      };
      insetHide = [];
      root.traverse((o) => {
        if ('material' in o && !kept(o)) insetHide?.push(o);
      });
      insetVis = new Uint8Array(insetHide.length);
      const hg = root.getObjectByName('highlight');
      hlMesh = (hg?.children ?? []).filter(
        (o): o is Mesh =>
          (o as Mesh).isMesh === true && 'uShape' in ((o as Mesh).material as ShaderMaterial).uniforms,
      );
      hlKind = new Uint8Array(hlMesh.length);
      hlSave = new Float32Array(4 * hlMesh.length);
      hlMesh.forEach((o, i) => {
        const m = o.material as ShaderMaterial;
        hlKind[i] = m.name.endsWith('rim') ? 0 : m.name.endsWith('outline') ? 1 : 2;
        (m.uniforms.uShape?.value as Vector3).toArray(hlSave, 4 * i);
        hlSave[4 * i + 3] = m.uniforms.uLift?.value as number;
      });
    }
    insetOn = true;
    pip.inset(insetCfg);
    aimInset(pip.camera, subject, grow);
  }
  const iC = new Vector3();
  const iX = new Vector3();
  const iY = new Vector3();
  const iZ = new Vector3();
  const iP = new Vector3();
  const iM = new Matrix4();
  const iBox = new Box3();
  let iPts = new Float32Array(0);
  /** Event time: the lobes' vertices (every W.inset.stride-th) as posed into iPts (sized once); with `grow` also with
   *  their collapse morphs at 0 (inflated by the test breath, the other morphs, e.g. retraction, kept). Returns n. */
  function sampleLobes(grow: boolean): number {
    const meshes = W.inset.lobes.flatMap((n) => [...deps.meshesOf(n)]);
    let cap = 0;
    for (const m of meshes) cap += 2 * Math.ceil(m.geometry.getAttribute('position').count / W.inset.stride);
    if (iPts.length < 3 * cap) iPts = new Float32Array(3 * cap);
    let n = 0;
    for (const m of meshes) {
      const count = m.geometry.getAttribute('position').count;
      const inf = m.morphTargetInfluences;
      const dict = m.morphTargetDictionary ?? {};
      const collapse = grow && inf ? Object.keys(dict).filter((k) => k.startsWith(COLLAPSE)) : [];
      const saved = collapse.map((k) => inf?.[dict[k] as number] ?? 0);
      for (let pass = 0; pass < (collapse.length ? 2 : 1); pass++) {
        if (pass === 1) for (const k of collapse) (inf as number[])[dict[k] as number] = 0;
        for (let v = 0; v < count; v += W.inset.stride)
          m.getVertexPosition(v, iP)
            .applyMatrix4(m.matrixWorld)
            .toArray(iPts, 3 * n++);
        if (pass === 1)
          collapse.forEach((k, i) => ((inf as number[])[dict[k] as number] = saved[i] as number));
      }
    }
    return n;
  }
  function aimInset(cam: PerspectiveCamera, subject: Subject | null, grow: boolean): void {
    const n = sampleLobes(grow);
    iBox.makeEmpty();
    for (let i = 0; i < n; i++) iBox.expandByPoint(iP.fromArray(iPts, 3 * i));
    iBox.getCenter(iC);
    const fixed = subject ? W.inset.views[subjectKey(subject)] : undefined;
    iZ.fromArray(fixed ?? W.inset.from).normalize(); // camera → +Z side of the lobes, looking back along -Z
    if (subject && !fixed) {
      const set = framer.set(subject);
      framer.refresh(set);
      framer.centre(set, iP).sub(iC);
      if (iP.lengthSq() > 1e-10) iZ.addScaledVector(iP.normalize(), W.inset.tilt).normalize();
    }
    iY.fromArray(W.inset.up);
    iX.crossVectors(iY, iZ);
    if (iX.lengthSq() < 1e-6) iX.set(0, 0, 1).cross(iZ); // up along the view: any perpendicular
    iX.normalize();
    iY.crossVectors(iZ, iX);
    // Projected extents round the centre → aim at their middle, then back off until every point fits.
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      iP.fromArray(iPts, 3 * i).sub(iC);
      x0 = Math.min(x0, iP.dot(iX));
      x1 = Math.max(x1, iP.dot(iX));
      y0 = Math.min(y0, iP.dot(iY));
      y1 = Math.max(y1, iP.dot(iY));
    }
    iC.addScaledVector(iX, (x0 + x1) / 2).addScaledVector(iY, (y0 + y1) / 2);
    const ty = Math.tan(((cam.fov / 2) * Math.PI) / 180) * W.inset.fit;
    const tx = ty * cam.aspect;
    let d = 0;
    for (let i = 0; i < n; i++) {
      iP.fromArray(iPts, 3 * i).sub(iC);
      d = Math.max(d, iP.dot(iZ) + Math.max(Math.abs(iP.dot(iX)) / tx, Math.abs(iP.dot(iY)) / ty));
    }
    cam.position.copy(iC).addScaledVector(iZ, d);
    cam.quaternion.setFromRotationMatrix(iM.makeBasis(iX, iY, iZ));
    cam.updateMatrixWorld();
  }

  // R6: nodes hidden for the whole walkthrough (visibility only), restored on leaving Guided.
  const hidden = W.hidden.flatMap((n) => [...deps.meshesOf(n)]);
  let shown: boolean[] | null = null;
  function hideForWalk(on: boolean): void {
    if (on) {
      shown ??= hidden.map((m) => m.visible);
      for (const m of hidden) m.visible = false;
    } else if (shown) {
      hidden.forEach((m, i) => (m.visible = shown?.[i] ?? true));
      shown = null;
    }
  }

  const hl = (): HighlightApi | undefined => (sim() as { highlight?: HighlightApi }).highlight;
  const bedFx = (): BedFxApi | undefined => (sim().m4?.fx as { bed?: BedFxApi } | undefined)?.bed;

  // ── Framing samples (node subjects cached now, at load; special subjects per use) ──
  const bed = new Vector3();
  const framer = new Framer(
    {
      picker: deps.picker,
      meshesOf: deps.meshesOf,
      points(s) {
        if ('fissure' in s) {
          const fg = sim().fissure;
          const fi = s.fissure === 'horizontal' ? 0 : 1;
          const first = FISSURES.slice(0, fi).reduce((n, f) => n + f.segments, 0);
          return (
            fg?.segments.slice(first, first + (FISSURES[fi]?.segments ?? 0)).flatMap((g) => g.points) ?? null
          );
        }
        if ('segment' in s) return sim().fissure?.nextSegment()?.points ?? null;
        // T871: round the bed point recorded at the removal (the carried-out node's matrixWorld is stale).
        return [
          bed.clone(),
          ...BED_DIRS.map((d) => bed.clone().add(new Vector3(...d).multiplyScalar(F_BED))),
        ];
      },
      held(tip, fulcrum) {
        const S = sim();
        const h = S.m4?.occupancy.holds.find((x) => x.tool === 'grasper');
        const p = h && S.m3?.scope.ports.find((x) => x.id === h.port);
        if (!p || !S.m4?.walk.heldTip(p.id, tip)) return false;
        fulcrum.copy(p.pleura);
        return true;
      },
      bigRadius() {
        const m4 = sim().m4;
        return m4?.tool ? (W.framing.big.radiusM[m4.tool] ?? 0) : 0;
      },
      tip() {
        const m4 = sim().m4;
        return m4?.tool ? m4.control.tipPos : null;
      },
      waterY() {
        const w = sim().m4?.water;
        return w && w.level > 0 ? w.surfaceY : -Infinity;
      },
      jaws(tip, heel) {
        const m4 = sim().m4;
        const len = m4?.tool ? (W.framing.big.jawsM[m4.tool] ?? 0) : 0;
        const port = m4?.control.port;
        if (!len || !port) return 0;
        heel.subVectors(port.pleura, tip).normalize().multiplyScalar(len).add(tip);
        return len;
      },
      names(s) {
        if ('fissure' in s) return [RML, FISSURES[s.fissure === 'horizontal' ? 0 : 1]?.neighbour ?? ''];
        if ('segment' in s) return [RML, ...FISSURES.map((f) => f.neighbour)];
        // The bed: the surface it lies on counts as the subject.
        return [deps.picker.nearest(bed, 2 * F_BED)?.nodeName ?? ''];
      },
    },
    deps.camera,
  );
  for (const st of STEPS)
    for (const b of st.beats) {
      const s = cameraSubject(b);
      if (typeof s === 'string' || Array.isArray(s)) framer.set(s);
    }
  const c: ShotCtx = {
    k,
    sim,
    framer,
    bed,
    bedNode: null,
    framing: newFraming(),
    framed: null,
    beatKey: '',
    area: null,
  };
  deps.onNodeRemoved.push((name, p) => {
    bed.copy(p);
    c.bedNode = name;
  });
  // Shots see a cancelled run as stopped: alive() follows the token of the run that called them.
  let runToken = 0;
  k.alive = () => runToken === token;

  const emit = (ev: WalkEvent, text = ''): void => {
    const s = hook.state();
    for (const fn of listeners[ev]) fn(s, text);
  };
  function setStatus(s: WalkStatus): void {
    status = s;
    emit('state');
  }
  function fail(r: string): void {
    error = r;
    setStatus('error');
  }

  // T891 G1: the step horizon = the image up of the world-up-locked aim at the step's first subject from its port;
  // every aim in the step keeps it (the follow-cams no longer spin when the view looks near straight down).
  const hSnap = newSnap();
  const hAt = new Vector3();
  const hUp = new Vector3();
  const hFwd = new Vector3();
  const hQ = new Quaternion();
  const hFov = { fov: 0 };
  function stepHorizon(n: number): void {
    const m3 = sim().m3;
    if (!m3) return;
    const s = m3.scope;
    const st = STEPS[n] as WalkStep;
    const first = st.beats.map(cameraSubject).find((x) => x !== null);
    const set = first ? framer.set(first) : null;
    if (set) framer.refresh(set);
    if (set) framer.centre(set, hAt);
    else hAt.fromArray(TARGET_BY_ID.get(RML)?.point ?? [0, 0, 0]);
    setHorizon(null);
    saveRig(s, hSnap);
    const ok = aimRig(s, st.scopePort, hAt, config.scopeRig.depthM.default);
    if (ok) s.writePose(hAt, hQ, hFov);
    loadRig(s, hSnap);
    if (!ok) return;
    setHorizon(hUp.set(0, 1, 0).applyQuaternion(hQ), hFwd.set(0, 0, -1).applyQuaternion(hQ));
    levelRig(s);
    m3.syncScope();
  }

  // ── Deterministic cumulative state (§2.1-8) ──
  function rebuild(n: number): void {
    const S = sim();
    const m3 = S.m3;
    const m4 = S.m4;
    if (!m3 || !m4) return;
    m4.walk.reset();
    (m4.fx as { bag?: RetrievalBag | null }).bag?.stop();
    bedFx()?.set('none');
    const fin: Partial<FinishState> = {};
    const specimens: string[] = [];
    const keys: Partial<Record<TweenKey, number>> = {};
    const divided: string[] = [];
    let sealed = false;
    for (let i = 0; i < n; i++) {
      const e = (STEPS[i] as WalkStep).end;
      Object.assign(fin, e.finish);
      for (const x of e.finish.specimens ?? []) if (!specimens.includes(x)) specimens.push(x);
      Object.assign(keys, e.state);
      divided.push(...(e.divided ?? []));
      for (const x of e.removed ?? []) if (!specimens.includes(x)) specimens.push(x);
      sealed ||= e.bedSealed === true;
      if (e.fissureFires !== undefined) fin.fissureFires = e.fissureFires;
    }
    Object.assign(m4.finish, fin, { specimens: [...specimens] });
    for (const d of divided) m4.walk.divided(d);
    for (const x of specimens) m4.walk.removed(x);
    if (fin.bronchusDivided) state.rmlDivided = true;
    for (const key of RETRACT) tweenTo(state, key, keys[key] ?? 0, 0);
    for (const [key, v] of Object.entries(keys)) tweenTo(state, key as TweenKey, v, 0);
    // T871: the fissure guide drifts the freed lobe when its last segment fires (played step 7); a seek past it
    // restores that pose, else the held lobe sits ~1 cm off its staple rows.
    if (fin.lobeFree && !fin.lobeRemoved && keys[DRIFT.key] === undefined)
      tweenTo(state, DRIFT.key, DRIFT.to, 0);
    hideForWalk(true);
    settleGeometry(); // T874: the holds, the scope aim and the first beat's framing read the rebuilt pose
    const node = [...specimens].reverse().find((x) => TARGET_BY_ID.get(x) && x.startsWith('LN_'));
    c.bedNode = node ?? null;
    bed.fromArray(TARGET_BY_ID.get(node ?? '')?.point ?? [0, 0, 0]);
    if (sealed && node) bedFx()?.set('coagulated', bed);
    // Scope in the step's port (aimed at its first subject), then the holds left by the previous step.
    const st = STEPS[n] as WalkStep;
    const s = m3.scope;
    if (s.port.id !== st.scopePort) {
      const first = st.beats.map(cameraSubject).find((x) => x !== null);
      const set = first ? framer.set(first) : null;
      if (set) framer.refresh(set);
      const at = set
        ? framer.centre(set, new Vector3())
        : new Vector3().fromArray(TARGET_BY_ID.get(RML)?.point ?? [0, 0, 0]);
      aimRig(s, st.scopePort, at, s.depth);
    }
    m4.occupancy.scopePort = s.port.id;
    for (const h of n > 0 ? ((STEPS[n - 1] as WalkStep).end.holds ?? []) : []) placeHold(S, h.port, h.target);
    m3.syncScope();
  }

  const glowAt = new Vector3();
  async function run(me0: number, n: number, from: number): Promise<void> {
    const st = STEPS[n] as WalkStep;
    for (let b = 0; b < st.beats.length; b++) {
      if (me0 !== token) return;
      const bt = st.beats[b] as Beat;
      ff = b < from;
      c.beatKey = `s${String(st.step).padStart(2, '0')}:${bt.id}`;
      c.area = cameraSubject(bt);
      beat = b;
      // T883 E1: working / result frames keep the holding grasper's jaws in the aperture.
      // T888: a beat override may drop it (framing.beatOverrides); a 'wide' overview never asks for it.
      framer.beat = W.framing.beatOverrides[c.beatKey];
      framer.wantHeld =
        (bt.kind === 'working' || bt.kind === 'result') &&
        bt.cam?.k !== 'wide' &&
        framer.beat?.held !== false;
      // T891 G8: a `toward` hint aims part-way at the beat's glow subject.
      const gs = W.framing.hints[c.beatKey]?.toward !== undefined ? glowOf(bt) : null;
      framer.glowAt = null;
      if (gs) {
        const set = framer.set(gs);
        framer.refresh(set);
        framer.glowAt = framer.centre(set, glowAt);
      }
      emit('state');
      if (!ff) emit('caption', bt.say);
      if (bt.msg && !ff) emit('msg', bt.msg); // T883 E8: §2.1-2, shown when the beat starts
      const g = ff ? null : glowOf(bt);
      if (bt.ghost && !ff) ghostOn(bt.ghost);
      if (bt.inset && !ff) insetShow(true, g, bt.act?.k === 'ventilate'); // T877: fit the test breath
      if (g && typeof g === 'object' && !Array.isArray(g) && 'fissure' in g)
        hl()?.show(g, k.dur(W.reducedMs));
      else if (typeof g === 'string' || Array.isArray(g))
        hl()?.show(typeof g === 'string' ? [g] : (g as readonly string[]), k.dur(W.reducedMs));
      const t0 = clock;
      const ms = bt.ms ?? 0;
      let r: string;
      if (bt.cam && bt.act && (CAMERA_ACTS.has(bt.act.k) || movesSubject(bt.act))) {
        r = await act(c, bt.act, ms);
        // T871: the subject moved: frame it where it ended (tweens done, picking re-baked the same frame).
        if (r === 'ok' && movesSubject(bt.act)) await k.until(settled);
        if (r === 'ok' && k.alive()) r = await cam(c, bt.cam, ms || undefined);
      } else {
        const [cr, ar] = await Promise.all([
          bt.cam ? cam(c, bt.cam, ms || undefined) : 'ok',
          bt.act ? act(c, bt.act, ms) : 'ok',
        ]);
        r = ar !== 'ok' ? ar : cr;
      }
      if (me0 !== token) return;
      if (r !== 'ok') {
        ff = false;
        hl()?.hide(0);
        return fail(`step ${st.step} beat ${bt.id}: ${r}`);
      }
      if (!(await k.wait((bt.ms ?? W.beatMs) - (clock - t0)))) return;
      const subject = cameraSubject(bt);
      if (subject && bt.kind !== 'insert' && bt.kind !== 'withdraw') measureNow(c, subject);
      // T871: a pause beat keeps its glow until Next (the last part: until the next step's seek clears it).
      const keep = bt.pause === true && !ff;
      if (g && !keep) hl()?.hide(k.dur(W.reducedMs));
      // T893b: the step's last beat keeps its ghost into the held end pose (the next seek clears it).
      if (bt.ghost && !keep && b < st.beats.length - 1) ghostOff();
      if (bt.inset && !keep && !st.beats[b + 1]?.inset) insetShow(false); // next inset beat: re-aims
      done++;
      emit('state');
      if (keep && b < st.beats.length - 1) {
        setStatus('waiting');
        if (!(await new Promise<boolean>((res) => (nextRes = res)))) return;
        if (me0 !== token) return;
        if (g) hl()?.hide(k.dur(W.reducedMs));
        if (bt.ghost) ghostOff();
        if (bt.inset) insetShow(false);
      }
    }
    ff = false;
    setStatus('holding');
  }

  async function seek(step: number, b = 0): Promise<void> {
    const n = STEPS.findIndex((s) => s.step === step);
    if (n < 0 || !sim().m4) return;
    cancel();
    runToken = token;
    const me0 = token;
    si = n;
    beat = Math.max(0, Math.min(b, (STEPS[n] as WalkStep).beats.length - 1));
    done = 0;
    error = null;
    status = 'playing';
    selfNav = true;
    guided.goTo(step, true);
    selfNav = false;
    setHorizon(null);
    rebuild(n);
    stepHorizon(n);
    emit('state');
    void run(me0, n, beat).catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
  }

  /** Next: the next part of a step with pause beats, else the next step (via the guided controller). */
  function nextPart(): boolean {
    if (getMode() !== 'guided' || status !== 'waiting' || !nextRes) return false;
    const r = nextRes;
    nextRes = null;
    setStatus('playing'); // now, so a second Next before the beat starts goes nowhere else
    r(true);
    return true;
  }
  function prevPart(): boolean {
    if (getMode() !== 'guided') return false;
    const st = STEPS[si] as WalkStep;
    if (!st.beats.some((x) => x.pause)) return false;
    const p = partOf(st, beat);
    if (p === 0) return false;
    void seek(st.step, partStart(st, p - 1));
    return true;
  }
  guided.walk = { tick, next: nextPart, prev: prevPart };
  guided.on('stepchange', (n) => {
    if (!selfNav && started && getMode() === 'guided') void seek(n);
  });
  onModeChange((m) => {
    if (m !== 'guided') {
      cancel();
      ff = false;
      hideForWalk(false);
      setHorizon(null); // practice: the rig's own world-up horizon lock
      const sc = sim().m3?.scope;
      if (sc) sc.horizonLock = true;
      setStatus('idle');
    } else if (started) void seek(state.step);
  });

  const hook: WalkthroughHook = {
    seek,
    get timeScale() {
      return scale;
    },
    set timeScale(v: number) {
      scale = Math.max(1e-3, v);
    },
    state(): WalkState {
      const S = sim();
      const m4 = S.m4;
      const s = S.m3?.scope;
      const st = STEPS[si] as WalkStep;
      const pauses = st.beats.filter((x) => x.pause).length;
      const keys = Object.keys(st.end.state).filter((x) => x.startsWith('retract_')) as TweenKey[];
      let refl = state.retract_hilum;
      for (const key of keys) refl = Math.max(refl, state[key]);
      const subject = cameraSubject(st.beats[beat] as Beat);
      return {
        status,
        step: st.step,
        beat,
        error,
        tool: m4?.tool ?? null,
        toolPort: m4?.occupancy.activePort ?? null,
        scopePort: s?.port.id ?? '',
        holds: (m4?.occupancy.holds ?? []).map((h) => ({ port: h.port, target: h.target })),
        reflected: refl >= W.reflectedMin,
        scopeInside: s ? scopeInside(s) : false,
        framing:
          subject !== null && c.framed === subject
            ? { ...c.framing, offset: [c.framing.offset[0], c.framing.offset[1]] }
            : null,
        done,
        sub: pauses > 0 ? { at: Math.min(pauses, partOf(st, beat) + 1), of: pauses } : null,
      };
    },
    currentBeat() {
      const st = STEPS[si];
      const b = st?.beats[beat];
      return st && b ? { ...b, step: st.step, index: beat } : null;
    },
    play() {
      if (status === 'paused') setStatus(resume);
      else if (status === 'idle' || status === 'error') void seek((STEPS[si] as WalkStep).step);
    },
    pause() {
      if (status !== 'playing' && status !== 'waiting') return;
      resume = status;
      setStatus('paused');
    },
    replay: () => void seek((STEPS[si] as WalkStep).step),
    next() {
      if (!nextPart()) guided.next();
    },
    prev() {
      if (!prevPart()) {
        if (si > 0) guided.prev();
        else hook.replay();
      }
    },
    settle(what = 'beat') {
      const d0 = done;
      const t0 = token;
      const ok = (): boolean =>
        status === 'error' ||
        status === 'idle' ||
        status === 'holding' ||
        (what === 'step' ? status === 'waiting' : done > d0 || token !== t0);
      if (what === 'step' && ok()) return Promise.resolve(hook.state());
      return new Promise((res) => {
        const off = hook.on('state', (s) => {
          if (!ok()) return;
          off();
          res(s);
        });
      });
    },
    probeFraming(subject, port) {
      const sc = sim().m3?.scope;
      const out = newFraming();
      if (!sc) return out;
      const snap = saveRig(sc);
      searchPose(framer, sc, port, framer.set(subject), null, out, '');
      loadRig(sc, snap);
      return { ...out, offset: [out.offset[0], out.offset[1]] };
    },
    inset: (on) => insetShow(on),
    ghost(names) {
      if (names) ghostOn(names);
      else ghostOff();
    },
    on(ev, cb) {
      listeners[ev].push(cb);
      return () => {
        const i = listeners[ev].indexOf(cb);
        if (i >= 0) listeners[ev].splice(i, 1);
      };
    },
  };
  return hook;
}
