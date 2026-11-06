// M5 glue (T505): practice mode. Lazy chunk (main.ts imports it on the first switch to Practice). Each entry starts
// one run: the PracticeEngine is the single authority on order (m4.gate for every M4 action, plus Hands inspect
// clicks and scope port moves fed here); complications (stapler / cautery on a structure it doesn't belong to,
// pulling while the artery is encircled) spawn blood from the M4 pools and redden the view through the existing
// grade uniform (uGain: no new program); completion or "End run" scores the run and opens the lazy debrief with
// rendering held (T703). No scene objects are created here.
import { Box3, Vector3 } from 'three';
import type { IUniform, Object3D, PerspectiveCamera } from 'three';
import { config } from '../core/config';
import { holdRendering, releaseRendering, requestRender } from '../core/renderer';
import {
  COMPLICATION_KIND,
  COMPLICATION_TEXT,
  PRACTICE_ERROR_TEXT,
  PRACTICE_STEP_TEXT,
  PRACTICE_UI,
} from '../content/practiceText';
import { GUIDED_STEPS } from '../content/steps';
import { SUB_IDS, TARGET_BY_ID } from '../content/targets';
import type { ViewMode } from '../scene/cameras';
import { ComplicationController } from '../sim/complications';
import type { ComplicationInput, ComplicationRequest, VitalsKey } from '../sim/complications';
import { getMode, onModeChange } from '../sim/modes';
import { PracticeEngine } from '../sim/practice';
import type { PracticeAttempt, PracticeEvent } from '../sim/practice';
import type { ActionKind } from '../sim/practiceActions';
import { scoreRun } from '../sim/scoring';
import type { ComplicationRecord, ScoreBreakdown } from '../sim/scoring';
import { tweenTo } from '../sim/state';
import type { AppState, TweenKey } from '../sim/state';
import type { Shell } from '../ui/shell';
import type { M3 } from './wireM3';
import type { M4 } from './wireM4';

export interface M5Context {
  app: HTMLElement;
  shell: Shell;
  canvas: HTMLElement;
  model: Object3D;
  camera: PerspectiveCamera;
  state: AppState;
  m3: M3;
  m4: M4;
  /** Post-FX grade gain (view reddening scales its channels toward config.practice.redden*). */
  gain: IUniform<Vector3>;
  setStep: (n: number, instant?: boolean) => void;
  setView: (mode: ViewMode, instant?: boolean) => void;
}

export interface M5 {
  /** Live run (null outside practice mode). */
  readonly engine: PracticeEngine | null;
  readonly complications: ComplicationController | null;
  /** Same as a Hands click on structure `name` (inspect); the engine verdict, or why it was not sent. */
  inspect: (name: string) => string;
  /** Same as a stapler / cautery click on `name` (injurious hits only; M4 refuses the snap there). */
  strike: (name: string, point?: Vector3) => string;
  /** Score the run and open the debrief. */
  endRun: () => Promise<ScoreBreakdown | null>;
  /** Frame loop, after M4. Allocation-free (strings only when the shown second / vitals change). */
  update: (now: number) => void;
}

const P = config.practice;
const HOLD = 'debrief';
const UNDERSIDE = 'stump_above_stapler_confirmed'; // underside-check flag: M4's final fissure fire needs it (finish.ts)
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Module temps (no per-frame allocation).
const bleedAt = new Vector3();
const tN = new Vector3();
const tNdc = new Vector3();
const box = new Box3();

export function wireM5(ctx: M5Context): M5 {
  const { app, shell, canvas, model, camera, state, m3, m4, gain } = ctx;
  const fx = m4.fx;
  const grade = gain.value.clone(); // ungraded gain; reddening scales it per channel
  let engine: PracticeEngine | null = null;
  let comp: ComplicationController | null = null;
  const input: ComplicationInput = { suction: false, pressure: false, retract: 0, coagAt: null };
  let coagulated = 0;
  let refusedShown = false;
  let swaps0 = 0;
  let scopePort = '';
  let last = 0;
  let redden = 0;
  let vitals: VitalsKey | null = null;
  let shownSec = -1;
  let debriefTimer = 0;
  let suctionWas = false;

  // Practice bar.
  const bar = document.createElement('div');
  bar.className = 'practice-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Practice');
  bar.hidden = true; // styles: .practice-bar in panels.css
  const status = document.createElement('p');
  status.className = 'panel-status practice-status';
  const msg = document.createElement('p');
  msg.className = 'practice-msg';
  msg.setAttribute('aria-live', 'polite');
  const stepEl = document.createElement('p'); // T844: the step's instruction (what, which instrument, where)
  stepEl.className = 'practice-step';
  const vitalsEl = document.createElement('p');
  vitalsEl.className = 'practice-vitals';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:var(--space-1);align-items:center;flex-wrap:wrap';
  const button = (text: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'panel-button';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  };
  row.append(
    button('Hint', () => hint()),
    button('End run', () => void m5.endRun()),
  );
  bar.append(status, stepEl, msg, vitalsEl, row);
  shell.ports.prepend(bar); // bottom-left, above the port chips: keeps the scope centre (the bleed) clear

  const say = (text: string): void => {
    msg.textContent = text;
    m4.toast(text);
  };
  const showStatus = (): void => {
    if (!engine) return;
    const title = GUIDED_STEPS.find((s) => s.step === engine?.step)?.title ?? '';
    status.textContent = `Practice · step ${engine.step}/${GUIDED_STEPS.length} ${title} · ${mmss(shownSec)}`;
  };
  const showStep = (): void => {
    stepEl.textContent = engine ? (PRACTICE_STEP_TEXT[engine.step] ?? '') : '';
  };
  /** Feed a wiring-observed action (cautery seal, suction) only while the plan asks for it: never an error. */
  const observe = (kind: ActionKind, tool: 'cautery' | 'sucker', subOption: string | null): void => {
    if (engine && !engine.finished && engine.available().some((a) => a.action === kind))
      engine.attempt({ tool, subOption, target: null, port: m4.occupancy.activePort, kind });
  };

  function hint(): void {
    if (!engine) return;
    const h = engine.hint()[0];
    say(h ? PRACTICE_UI.hintPrefix + h.text : PRACTICE_UI.noHint);
  }

  // ── Engine events: table results the M4 actions don't already produce ──
  function onEvent(e: PracticeEvent): void {
    if (e.type === 'action') {
      const r = e.result;
      if (r.state)
        for (const [k, v] of Object.entries(r.state)) tweenTo(state, k as TweenKey, v, P.resultTweenMs);
      for (const f of r.flags ?? []) m4.flags.add(f);
      // Hands inspect of the stump from below is the underside check the final fissure fire needs.
      if (r.flags?.includes(UNDERSIDE)) m4.finish.undersideConfirmed = true;
    } else if (e.type === 'step') {
      showStatus();
      showStep();
    } else if (e.type === 'error') say(PRACTICE_ERROR_TEXT[e.error]);
    else if (e.type === 'finish') {
      say(PRACTICE_UI.done);
      debriefTimer = window.setTimeout(() => void m5.endRun(), P.debriefDelayMs);
    }
    // 'transient' (test breath), hide/show (dissection windows, bag) and specimens: M4's finish / dissect apply them.
  }

  /** Decal orientation: the surface normal under `at` as seen from the scope (BVH re-pick, action time only),
   *  turned toward the camera; facing the camera when the point isn't the visible surface. */
  function surfaceNormal(at: Vector3, out: Vector3): Vector3 {
    out.subVectors(camera.position, at).normalize();
    tNdc.copy(at).project(camera);
    const hit = m3.picker.pick(tNdc.x, tNdc.y, camera);
    const tol = config.effects.decal.normalPickTolM;
    if (!hit || hit.normal.lengthSq() === 0 || hit.point.distanceToSquared(at) > tol * tol) return out;
    return hit.normal.dot(out) < 0 ? out.copy(hit.normal).negate() : out.copy(hit.normal);
  }

  function apply(reqs: readonly ComplicationRequest[]): void {
    for (const r of reqs) {
      if (r.type === 'toast') {
        say(COMPLICATION_TEXT[r.key]);
        continue;
      }
      if (r.point) bleedAt.set(r.point.x, r.point.y, r.point.z);
      // T807c: radius ∝ camera distance, so a close scope doesn't get a frame-filling blob.
      const radius = config.effects.decal.radiusPerCameraM * camera.position.distanceTo(bleedAt);
      const slot = fx.blood.spawn(bleedAt, surfaceNormal(bleedAt, tN), radius);
      comp?.bindSlot(r.bleed, slot);
    }
  }

  // ── Gate: every M4 action in practice mode ──
  const gate = (attempt: PracticeAttempt): boolean => {
    // T842 "Irrigate the field" (button / W) reports whatever sucker setting is in hand: irrigating is irrigation.
    const a = attempt.kind === 'irrigate' ? { ...attempt, subOption: 'irrigation' } : attempt;
    if (!engine || !comp || engine.finished) return true; // run over: free actions
    // Sponge stick on a bleed = pressure (update reads control.active), not a retraction attempt.
    if (a.tool === 'sponge' && comp.activeBleeds > 0) return false;
    // A retraction doesn't end a clamp passage: pulling during it is the over-traction hazard.
    if (a.kind !== 'retract') apply(comp.onAction(a));
    return engine.attempt(a).type !== 'error';
  };

  let inspectable: ReadonlySet<string> = new Set();
  let scopeMoves = false;
  function inspect(name: string): string {
    if (!engine || engine.finished) return 'no run';
    const target = name;
    // Labels on anything else stay free: only structures the plan asks you to look at are scored.
    if (!inspectable.has(target)) return 'not inspectable';
    // T844: once looked at (or not asked for yet), naming a structure again is free, not an error.
    if (!engine.available().some((a) => a.action === 'inspect' && a.targets.includes(target)))
      return 'not asked now';
    return engine.attempt({ tool: 'hands', subOption: null, target, port: m3.scope.port.id, kind: 'inspect' })
      .type;
  }
  const pin = m3.labels.pin;
  m3.labels.pin = (name, point) => {
    pin(name, point);
    inspect(name);
  };

  function strike(name: string, point?: Vector3): string {
    const tool = m4.tool;
    if (!engine || !comp || engine.finished) return 'no run';
    if (tool !== 'stapler' && tool !== 'cautery') return 'not stapler or cautery';
    const target = name;
    if (TARGET_BY_ID.get(target)?.tools[tool] !== undefined) return 'valid target'; // M4 handles it
    if (tool === 'cautery' && point && comp.bleedNear(point)) return 'coagulate'; // T822: M4 places it there
    if (point) bleedAt.copy(point);
    else {
      const o = model.getObjectByName(name);
      if (o) box.setFromObject(o).getCenter(bleedAt);
    }
    const sub = SUB_IDS[tool]?.[m3.hotbar.subOption()] ?? null;
    const kind: ActionKind = tool === 'stapler' ? 'fire' : 'dissect';
    const at = bleedAt.clone(); // click-time copy: the attempt is kept in the engine log
    const a = { tool, subOption: sub, target, port: m4.occupancy.activePort, kind, point: at };
    engine.attempt(a); // logged as an error for the debrief
    const reqs = comp.onAction(a);
    apply(reqs);
    return reqs.length ? 'complication' : 'none';
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!engine || e.button !== 0 || m3.onPick) return;
    if (m4.tool !== 'stapler' && m4.tool !== 'cautery') return;
    const hit = m3.picker.pick(
      (e.clientX / canvas.clientWidth) * 2 - 1,
      -(e.clientY / canvas.clientHeight) * 2 + 1,
      camera,
    );
    if (hit) strike(hit.nodeName, hit.point);
  });

  const records = (): ComplicationRecord[] =>
    (comp?.log ?? []).flatMap((e): ComplicationRecord[] => {
      if (e.type === 'bleed' && e.cause === 'node-bed') return []; // expected ooze, not a complication
      if (e.type === 'bleed') {
        const kind = e.cause === 'over-traction' ? COMPLICATION_KIND.tear : COMPLICATION_KIND.bleed;
        return [{ kind, severity: e.severity, t: e.t, structure: e.target }];
      }
      if (e.type === 'danger-hit')
        return [{ kind: COMPLICATION_KIND.danger, severity: e.severity, t: e.t, structure: e.target }];
      if (e.type === 'injury')
        return [{ kind: COMPLICATION_KIND.injury, severity: 'minor', t: e.t, structure: e.target }];
      return [];
    });

  // M4 has no scene reset: a fresh case (retry, or re-entry after actions) reloads straight into practice.
  const restart = (): void => {
    const u = new URL(location.href);
    u.searchParams.set('mode', 'practice');
    location.assign(u);
  };

  function start(): void {
    if (m4.staples.lineCount > 0 || m4.flags.size > 0 || m4.finish.specimens.length > 0) return restart();
    ctx.setStep(1, true);
    ctx.setView('scope', true);
    m3.scope.reset();
    m3.syncScope();
    m4.errors.length = 0;
    swaps0 = m4.occupancy.swaps;
    scopePort = m3.scope.port.id;
    last = 0;
    shownSec = 0;
    engine = new PracticeEngine(m4.occupancy, undefined, undefined, onEvent);
    comp = new ComplicationController(
      () => engine?.elapsed() ?? 0,
      (slot) => slot >= 0 && fx.blood.stop(slot),
    );
    inspectable = new Set(engine.actions.filter((a) => a.action === 'inspect').flatMap((a) => a.targets));
    // A table without scope moves leaves the scope free (moving it for a better view is not an error).
    scopeMoves = engine.actions.some((a) => a.action === 'move-scope');
    m4.gate = gate;
    m4.bleedNear = (p) => comp?.bleedNear(p) ?? false;
    coagulated = 0;
    msg.textContent = '';
    vitalsEl.textContent = '';
    vitals = null;
    suctionWas = false;
    showStatus();
    showStep();
    bar.hidden = false;
  }

  function stop(): void {
    window.clearTimeout(debriefTimer);
    m4.gate = null;
    m4.bleedNear = null;
    engine = null;
    comp = null;
    redden = 0;
    gain.value.copy(grade);
    bar.hidden = true;
  }

  // T844: the node-bed ooze (T840 hook; T842 m4.startOoze draws it) is tracked here so the cautery seal counts as
  // the step-4 action. No decal from here: the M4 ooze is the visual.
  m4.onNodeRemoved.push((name, point) => {
    if (engine && comp && !engine.finished) comp.startOoze(name, point.clone());
  });

  onModeChange((m) => (m === 'practice' ? start() : stop()));
  window.addEventListener('resize', requestRender); // setSize clears a held canvas (debrief backdrop)

  const m5: M5 = {
    get engine() {
      return engine;
    },
    get complications() {
      return comp;
    },
    inspect,
    strike,
    async endRun() {
      if (!engine) return null;
      window.clearTimeout(debriefTimer);
      const breakdown = scoreRun({
        log: engine.log,
        actions: engine.actions,
        swaps: m4.occupancy.swaps - swaps0,
        elapsedSec: engine.elapsed(),
        complications: records(),
      });
      const d = await import('../ui/debrief');
      holdRendering(HOLD);
      d.openDebrief(app, breakdown, { onRetry: restart, onClose: () => releaseRendering(HOLD) });
      return breakdown;
    },
    update(now) {
      if (!engine || !comp) return;
      const dt = last ? Math.min(now - last, config.actions.maxDtMs) : 0;
      last = now;
      // Scope moved to another port (Hands + P, probe, reset): one move-scope attempt per change.
      const port = m3.scope.port.id;
      if (port !== scopePort) {
        scopePort = port;
        if (!engine.finished && scopeMoves)
          engine.attempt({ tool: 'hands', subOption: null, target: null, port, kind: 'move-scope' });
      }
      const tool = m4.tool;
      const on = m4.control.active;
      input.suction = on && tool === 'sucker' && m3.hotbar.subOption() === 0; // sub 0 = suction
      input.pressure = on && tool === 'sponge' && m4.control.tipPos.distanceTo(bleedAt) <= P.pressureRadiusM;
      input.retract =
        on && (tool === 'grasper' || tool === 'sponge')
          ? Math.max(state.retract_hilum, state.retract_RML_lateral, state.retract_fissure)
          : 0;
      input.coagAt = on && tool === 'cautery' && m4.contact ? m4.contactPoint : null;
      if (input.suction && !suctionWas) observe('suction', 'sucker', 'suction');
      suctionWas = input.suction;
      const torn = comp.update(dt / 1000, input);
      if (torn) apply(torn);
      // T822: cautery seals small bleeds; on a major vessel injury it says what works instead (once per contact).
      if (comp.coagulated !== coagulated) {
        coagulated = comp.coagulated;
        say(COMPLICATION_TEXT['complication.coagulated']);
        observe('coagulate', 'cautery', null);
      }
      // The major-vessel hint shows once per contact: re-armed only after the tip lifts off (and isn't refused).
      const refused = comp.coagRefused;
      const touching = input.coagAt !== null;
      if (refused && !refusedShown) say(COMPLICATION_TEXT['complication.coagMajor']);
      refusedShown = refused || (refusedShown && touching);
      if (comp.redden !== redden) {
        redden = comp.redden;
        gain.value.set(
          grade.x * (1 + (P.reddenR - 1) * redden),
          grade.y * (1 + (P.reddenG - 1) * redden),
          grade.z * (1 + (P.reddenB - 1) * redden),
        );
      }
      if (comp.vitalsKey !== vitals) {
        vitals = comp.vitalsKey;
        vitalsEl.textContent = vitals ? COMPLICATION_TEXT[vitals] : '';
      }
      const sec = Math.floor(engine.elapsed());
      if (sec !== shownSec) {
        shownSec = sec;
        showStatus();
      }
    },
  };

  if (getMode() === 'practice') start();
  return m5;
}
