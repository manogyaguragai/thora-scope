// M3 glue (T307): fulcrum scope rig, BVH picking, hotbar + port chips, viewing aids (layers, X-ray, cut-away, 3D
// labels) and the lazy help overlay. Called once from the loader's place() callback (decode stage), after the
// camera rig, guided controller and shell exist. Input is event-driven (rig pose written on input, not per frame);
// update(now) does throttled hover, label positions and the morph re-bake when a state tween ends.
import { Box3, Vector2, Vector3 } from 'three';
import type { Mesh, Object3D, PerspectiveCamera } from 'three';
import { TARGET_BY_ID, TARGETS } from '../content/targets';
import { config } from '../core/config';
import { HOTBAR_KEYS, keybindings as K, matchesKey } from '../core/keybindings';
import { makePose } from '../scene/cameras';
import type { CameraRig, ViewMode } from '../scene/cameras';
import { collectMorphMeshes } from '../scene/morphs';
import { buildPickBVH } from '../scene/picking';
import type { Picker, PickHit } from '../scene/picking';
import type { Guided } from '../sim/guided';
import { CONTEXT_ACTIONS, createHotbar, SLOTS } from '../sim/hotbar';
import type { Hotbar } from '../sim/hotbar';
import { getMode } from '../sim/modes';
import { readPorts } from '../sim/ports';
import { ScopeRig } from '../sim/scopeRig';
import { startOLV, tweenTo, TWEEN_KEYS } from '../sim/state';
import type { AppState, TweenKey } from '../sim/state';
import { stepHidden } from '../sim/steps';
import type { StepVisibility } from '../sim/steps';
import { mountHotbar, mountPortChips } from '../ui/hotbar';
import { createAnchors, createLabels3D, stepFocus } from '../ui/labels3d';
import type { Labels3D } from '../ui/labels3d';
import { mountCompass } from '../ui/compass';
import { LAYER_GROUPS, mountLayersPanel } from '../ui/layersPanel';
import type { Layers } from '../ui/layersPanel';
import { SHELL_VENTS, SHELL_VIEWS } from '../ui/shell';
import type { Shell } from '../ui/shell';

export interface M3Context {
  app: HTMLElement;
  canvas: HTMLElement;
  model: Object3D;
  camera: PerspectiveCamera;
  rig: CameraRig;
  guided: Guided;
  state: AppState;
  vis: StepVisibility;
  shell: Shell;
  setView: (mode: ViewMode) => void;
  /** Hover name changes (debug overlay). */
  onHover?: (name: string | null) => void;
}

export interface M3 {
  scope: ScopeRig;
  hotbar: Hotbar;
  picker: Picker;
  layers: Layers;
  labels: Labels3D;
  /** Node under the pointer (≤ hoverHz), null over nothing. */
  hover: string | null;
  /** Full pick at NDC (e2e / debug). */
  pickAt: (ndcX: number, ndcY: number) => string | null;
  /** While set (quiz identify), a canvas click hands the picked node here instead of pinning a label. */
  onPick: ((nodeName: string) => void) | null;
  /** Re-write the rig pose + port chips after mutating `scope` directly (probe). */
  syncScope: () => void;
  /** Re-hide layer-panel-hidden nodes after a step/scope visibility pass. */
  reapplyLayers: () => void;
  /** M4 hooks (wireM4 sets them): extra port-chip text, why the scope may not move into a port ('' = it may), and
   *  the shared toast. */
  portHooks: {
    occupant: (id: string) => string;
    refusal: (id: string) => string;
    toast: (msg: string) => void;
    /** T840: the port-chip withdraw button (shown while `canWithdraw`). */
    canWithdraw: (id: string) => boolean;
    withdraw: (id: string) => void;
  };
  /** Move the scope to port `id` (chip click / P): eases to a default view of the step's focus; false + toast if
   *  refused. */
  moveScope: (id: string) => boolean;
  /** T843: two-lung ventilation selected (the right lung re-inflating / inflated): M4 should refuse retraction. */
  twoLung: () => boolean;
  /** The user explicitly chose two-lung ventilation (topbar switch); cleared by One-lung or a step change. */
  twoLungChosen: () => boolean;
  /** Frame loop, after morphs. Allocation-free. */
  update: (now: number) => void;
}

const HANDS = 0; // hotbar slot driving the scope (§6.3 slot 1)
const R = config.scopeRig;
const SKIP_TARGETS = 'input, select, textarea, [contenteditable], dialog';
const PORT_HINT = 'Click a port chip or press Shift+P to view from another port';
const V = config.physiology.ventilation;
const VENT_TOAST = {
  one: 'One-lung ventilation: the right lung collapses away from the hilum',
  two: 'Two-lung ventilation: the right lung re-inflates and fills the field; switch back to one-lung to retract',
} as const;
const LOBE_KEYS = ['deflate_RUL', 'deflate_RML', 'deflate_RLL'] as const;

// Port-switch aim (T808): mean rest point of the step's focus targets, else of every target (the operative field).
const aim = new Vector3();
const FIELD = new Vector3();
for (const t of TARGETS) FIELD.add(aim.fromArray(t.point));
FIELD.divideScalar(Math.max(1, TARGETS.length));
function focusPoint(names: readonly string[]): Vector3 {
  let n = 0;
  aim.set(0, 0, 0);
  for (const id of names) {
    const t = TARGET_BY_ID.get(id);
    if (!t) continue;
    aim.x += t.point[0];
    aim.y += t.point[1];
    aim.z += t.point[2];
    n++;
  }
  return n ? aim.divideScalar(n) : aim.copy(FIELD);
}

export function wireM3(ctx: M3Context): M3 {
  const { app, canvas, model, camera, rig, guided, state, vis, shell } = ctx;
  const lookup = (name: string): Object3D | undefined => model.getObjectByName(name);

  // Picking: BVH built now (loading decode stage); morph meshes cached for the re-bake.
  const picker = buildPickBVH(model);
  const morphMeshes = collectMorphMeshes(model);

  // Scope rig drives the rig's scope pose through `live`.
  const scope = new ScopeRig(readPorts(model));
  // T843: the lens stops short of the first surface along the shaft (picking BVHs, current morph bake).
  const COL = R.collision;
  // T847a: + clearance from surfaces beside the shaft (the oblique view looks at them; near-plane clipping).
  const lensAt = new Vector3();
  const colHit: PickHit = { nodeName: '', point: new Vector3(), normal: new Vector3(), distance: 0 };
  scope.limit = (origin, dir) => {
    const h = picker.ray(origin, dir, COL.nearM, R.depthM.max + COL.marginM, colHit);
    let d = Math.min(h ? h.distance - COL.marginM : Infinity, R.depthM.max);
    // ponytail: fixed-step back-off march (≤ depth range / clearStepM nearest() calls; usually the first is clear).
    for (; d > R.depthM.min; d -= COL.clearStepM)
      if (!picker.nearest(lensAt.copy(origin).addScaledVector(dir, d), COL.clearM, false, colHit)) return d;
    return R.depthM.min;
  };
  // T843: the outside orbit camera stays out of the body.
  const body: Mesh[] = [];
  for (const n of config.camera.orbitGuard.meshes)
    lookup(n)?.traverse((o) => {
      if ((o as Mesh).isMesh) body.push(o as Mesh);
    });
  rig.guardOrbit(body);
  const live = makePose();
  const hotbar = createHotbar();
  mountHotbar(shell.hotbar, hotbar);
  const portHooks: M3['portHooks'] = {
    occupant: () => '',
    refusal: () => '',
    toast: () => {},
    canWithdraw: () => false,
    withdraw: () => {},
  };
  const occupant = (id: string): string => {
    const s = id === scope.port.id ? (scope.horizonLock ? 'Scope · level' : 'Scope') : '';
    const x = portHooks.occupant(id);
    return s && x ? `${s} + ${x}` : s || x || '—';
  };
  const chips = mountPortChips(shell.ports, scope.ports, occupant, (id) => void moveScope(id), {
    can: (id) => portHooks.canWithdraw(id),
    run: (id) => portHooks.withdraw(id),
  });
  // Morph pose the picking BVHs were last baked at (update re-bakes when it settles).
  const poseKey = (): number => {
    let k = 0;
    for (let i = 0; i < TWEEN_KEYS.length; i++) k += state[TWEEN_KEYS[i] ?? 'deflate_RUL'] * (i + 1);
    return k;
  };
  let bakedPose = NaN;
  const syncScope = (): void => {
    // T847a: step snaps / port moves / reset / probe poses never leave the lens in tissue either (BVH current only;
    // otherwise the re-bake in update settles it).
    if (poseKey() === bakedPose) scope.settle();
    scope.writePose(live.position, live.quaternion, live);
    for (const p of scope.ports) chips.setOccupant(p.id, occupant(p.id));
    chips.setCurrent(scope.port.id);
  };
  /** Any mode / tool: move the scope if occupancy allows, aimed at the step's focus (not along the port axis). */
  function moveScope(id: string): boolean {
    if (id === scope.port.id) return true;
    const why = portHooks.refusal(id);
    if (why) {
      portHooks.toast(why);
      return false;
    }
    scope.aimFrom(id, focusPoint(stepFocus(state.step)));
    syncScope();
    rig.easeScope();
    return true;
  }
  const snapStep = (): void => {
    scope.snapTo(rig.scopePoseOf(state.camera), state.port);
    if (R.levelOnStepSnap) scope.setHorizonLock(true); // T816: level by default; H brings back the authored roll
  };

  // Viewing aids.
  const { layers } = mountLayersPanel(shell.inspector, {
    lookup,
    stepVisible: (n) => !stepHidden(vis, state, n),
    bounds: new Box3().setFromObject(model),
  });
  const reapplyLayers = (): void => {
    for (const names of layers.groups.values())
      for (const n of names) if (!layers.isUserVisible(n)) layers.setVisible(n, false);
  };
  const names = [...new Set(Object.values(LAYER_GROUPS).flat())];
  const labels = createLabels3D(app, camera, createAnchors(lookup, names), {
    names,
    masked: () => rig.mode === 'scope',
  });
  app.append(shell.root); // keep the shell panels above the label layer

  snapStep();
  syncScope();
  rig.followScope(live);
  labels.setFocus(stepFocus(state.step));
  layers.setFocus(stepFocus(state.step)); // T807 step-focus highlight, fades over the guided window
  guided.on('stepchange', () => layers.setFocus(stepFocus(state.step)));
  // Guided re-snaps to the step's authored port + view (teaching intent); Explore / Practice keep the user's port.
  let hinted = false;
  guided.on('stepchange', () => {
    const mode = getMode();
    if (mode !== 'explore' && mode !== 'practice') {
      snapStep();
      if (mode === 'guided' && !hinted) {
        hinted = true;
        portHooks.toast(PORT_HINT);
      }
    }
    syncScope();
    reapplyLayers();
    labels.setFocus(stepFocus(state.step));
  });
  // T847a: the user entering a guided step (Next / Prev / rail click / PageDown / PageUp / Show me) goes Inside —
  // the app opens on the theatre; a later Outside click holds until the next such input. User input only: scripted
  // setStep calls (probe, tests, mode switches) keep the view. Capture: Show me relabels itself to Stop in its handler.
  const enterScope = (): void => {
    if (rig.target !== 'scope' && shell.root.dataset.mode === 'guided') ctx.setView('scope');
  };
  const ENTER_SCOPE = '.guided-step, .guided-nav, .guided-demo[aria-label="Show me this step"]';
  for (const host of [shell.rail, shell.caption])
    host.addEventListener(
      'click',
      (e) => {
        if (e.target instanceof Element && e.target.closest(ENTER_SCOPE)) enterScope();
      },
      true,
    );

  const toggleHelp = (): void =>
    void import('../ui/helpOverlay').then((h) =>
      h.isHelpOpen()
        ? h.closeHelp()
        : h.openHelp(document.body, {
            keybindings: K,
            hotbarKeys: HOTBAR_KEYS,
            toolNames: SLOTS.map((s) => s.name),
            contextActions: CONTEXT_ACTIONS,
          }),
    );
  shell.help.addEventListener('click', toggleHelp);

  // T816: Inside / Outside view switch (same as O) + the scope orientation compass.
  for (const { view } of SHELL_VIEWS)
    shell.viewButtons[view].addEventListener('click', () => ctx.setView(view));
  let shownTarget: ViewMode | null = null;
  const compass = mountCompass(shell.root, K.resetScope.code.replace(/^Key/, ''));

  // T843: One-lung / Two-lung switch (any mode with the topbar switch; guided steps re-apply their OLV state).
  const ventTarget = (k: TweenKey): number => (state.tweens[k].active ? state.tweens[k].to : state[k]);
  const twoLung = (): boolean =>
    ventTarget('deflate_RUL') < V.twoLungBelow && ventTarget('deflate_RLL') < V.twoLungBelow;
  let chosenTwo = false;
  guided.on('stepchange', () => (chosenTwo = false)); // guided steps re-apply their own OLV state
  const ventilate = (two: boolean): void => {
    chosenTwo = two;
    if (two === twoLung()) return;
    if (!two) startOLV(state);
    else
      for (const k of LOBE_KEYS)
        if (k !== 'deflate_RML' || !state.rmlDivided) tweenTo(state, k, 0, V.reinflateMs);
    portHooks.toast(two ? VENT_TOAST.two : VENT_TOAST.one);
  };
  shell.ventButtons.one.addEventListener('click', () => ventilate(false));
  shell.ventButtons.two.addEventListener('click', () => ventilate(true));
  let shownTwo: boolean | null = null;

  // T816: held arrows pivot the scope (screen terms) in the scope view, any tool; applied per frame in update.
  const ARROWS = [K.scopeUp, K.scopeDown, K.scopeLeft, K.scopeRight] as const;
  const ARROW_DIR = [0, 1, 0, -1, -1, 0, 1, 0] as const; // [right, up] per arrow
  const held = [false, false, false, false];
  const arrowIndex = (c: string): number => ARROWS.findIndex((b) => matchesKey(b, c));
  let lastFrame = -1;
  window.addEventListener('keyup', (e) => {
    const i = arrowIndex(e.code);
    if (i >= 0) held[i] = false;
  });
  window.addEventListener('blur', () => held.fill(false));

  const hands = (): boolean => hotbar.slot === HANDS;
  const portIds = scope.ports.map((p) => p.id);

  // One key handler for M3 (help, hotbar, view, labels, scope). Context-action keys belong to M4.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest(SKIP_TARGETS)) return;
    const c = e.code;
    if (!e.shiftKey && (matchesKey(K.guidedNext, c) || matchesKey(K.guidedPrev, c))) enterScope(); // guidedPanel steps
    if (e.key === '?' || matchesKey(K.help, c)) {
      if (!e.repeat) toggleHelp();
    } else if (hotbar.handleKey(c)) {
      /* consumed */
    } else if (matchesKey(K.toggleView, c)) {
      if (!e.repeat) ctx.setView(rig.target === 'scope' ? 'outside' : 'scope');
    } else if (matchesKey(K.toggleLabels, c)) {
      if (!e.repeat) labels.toggleAll();
    } else if (matchesKey(K.dismissLabel, c)) labels.dismiss();
    else if (arrowIndex(c) >= 0 && rig.target === 'scope') held[arrowIndex(c)] = true;
    else if (matchesKey(K.nextPort, c) && e.shiftKey) {
      if (!e.repeat) nextPort(); // Only Shift+P moves the scope (user choice 2026-11-05); plain P moves the instrument (M4)
    } else if (hands() && scopeKey(c, e.repeat)) syncScope();
    else return;
    e.preventDefault();
  });

  /** Next port the scope may enter (M4: occupancy / capacity); stays put + toasts the first refusal if none. */
  function nextPort(): void {
    const i = portIds.indexOf(scope.port.id);
    let why = '';
    for (let k = 1; k < portIds.length; k++) {
      const id = portIds[(i + k) % portIds.length] as string;
      const r = portHooks.refusal(id);
      if (!r) {
        moveScope(id);
        return;
      }
      why ||= r;
    }
    if (why) portHooks.toast(why);
  }

  /** Scope keys (§6.2); true if handled. Snap / reset ease to the new pose. */
  function scopeKey(c: string, repeat: boolean): boolean {
    if (matchesKey(K.opticLeft, c)) scope.rotateOptic(-R.opticStepDeg);
    else if (matchesKey(K.opticRight, c)) scope.rotateOptic(R.opticStepDeg);
    else if (matchesKey(K.zoomIn, c)) scope.zoomBy(R.zoomStep);
    else if (matchesKey(K.zoomOut, c)) scope.zoomBy(1 / R.zoomStep);
    else if (matchesKey(K.rollHeadLeft, c)) scope.rollHead(-config.actions.headRollStepDeg);
    else if (matchesKey(K.rollHeadRight, c)) scope.rollHead(config.actions.headRollStepDeg);
    else if (repeat) return false;
    else if (matchesKey(K.horizonLock, c)) scope.setHorizonLock(!scope.horizonLock);
    else if (matchesKey(K.snapToStep, c)) {
      snapStep();
      rig.easeScope();
    } else if (matchesKey(K.resetScope, c)) {
      scope.reset();
      rig.easeScope();
    } else return false;
    return true;
  }

  // Pointer: left-drag pivots the scope (Hands, scope view); a click (< clickSlopPx travel) labels a structure.
  const ndc = new Vector2();
  const setNdc = (e: PointerEvent): void => {
    ndc.set((e.clientX / canvas.clientWidth) * 2 - 1, -(e.clientY / canvas.clientHeight) * 2 + 1);
  };
  let down = false;
  let lastX = 0;
  let lastY = 0;
  let travel = 0;
  let pointerDirty = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = true;
    lastX = e.clientX;
    lastY = e.clientY;
    travel = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    setNdc(e);
    pointerDirty = true;
    if (!down) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    travel += Math.abs(dx) + Math.abs(dy);
    if (travel >= config.pick.clickSlopPx && hands() && rig.target === 'scope') {
      scope.drag(dx, dy);
      syncScope();
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || e.button !== 0) return;
    down = false;
    if (travel >= config.pick.clickSlopPx || (!hands() && !m3.onPick)) return;
    setNdc(e);
    const hit = picker.pick(ndc.x, ndc.y, camera);
    if (m3.onPick) {
      if (hit) m3.onPick(hit.nodeName);
    } else if (hit) labels.pin(hit.nodeName, hit.point);
    else labels.dismiss();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!hands() || rig.target !== 'scope') return;
      e.preventDefault();
      scope.insert(-e.deltaY * R.wheelMetersPerPx);
      syncScope();
    },
    { passive: false },
  );

  const hoverMs = 1000 / config.pick.hoverHz;
  let lastHover = -Infinity;
  let lastPose = NaN;
  let baked = false;
  let wasTweening = true; // first frame writes the initial step's morphs → bake them
  const m3: M3 = {
    scope,
    hotbar,
    picker,
    layers,
    labels,
    hover: null,
    pickAt: (x, y) => picker.pick(x, y, camera)?.nodeName ?? null,
    onPick: null,
    syncScope,
    reapplyLayers,
    portHooks,
    moveScope,
    twoLung,
    twoLungChosen: () => chosenTwo,
    update(now) {
      const dtMs = lastFrame < 0 ? 0 : Math.min(now - lastFrame, R.arrowMaxDtMs);
      lastFrame = now;
      if (rig.target !== 'scope') held.fill(false);
      let right = 0;
      let up = 0;
      for (let i = 0; i < 4; i++)
        if (held[i]) {
          right += ARROW_DIR[2 * i] ?? 0;
          up += ARROW_DIR[2 * i + 1] ?? 0;
        }
      if (right !== 0 || up !== 0) {
        const k = (R.arrowRadPerS * dtMs) / 1000;
        scope.pivot(right * k, up * k);
        scope.writePose(live.position, live.quaternion, live); // chips unchanged by a pivot
      }
      if (rig.target !== shownTarget) {
        shownTarget = rig.target;
        shell.root.dataset.view = shownTarget; // CSS: compact vitals strip in the scope view (T821)
        for (const { view } of SHELL_VIEWS)
          shell.viewButtons[view].setAttribute('aria-pressed', String(view === shownTarget));
      }
      compass.update(now, rig.mode === 'scope', camera);
      const two = twoLung();
      if (two !== shownTwo) {
        shownTwo = two;
        for (const { vent } of SHELL_VENTS)
          shell.ventButtons[vent].setAttribute('aria-pressed', String((vent === 'two') === two));
      }
      let tweening = false;
      for (let i = 0; i < TWEEN_KEYS.length && !tweening; i++)
        tweening = state.tweens[TWEEN_KEYS[i] ?? 'deflate_RUL'].active;
      // Re-bake picking when the morph pose settles: after a tween, and after instant step jumps / grasper drags
      // (pose unchanged for one frame and different from the last bake). Allocation-free.
      const pose = poseKey();
      if (!tweening && ((wasTweening && !tweening) || (pose === lastPose && pose !== bakedPose))) {
        picker.refreshMorphs(morphMeshes);
        bakedPose = pose;
        if (scope.settle()) {
          // T843: tissue moved onto the lens (re-inflation, retraction released): back off to its surface. T847a: the
          // load-time bake corrects the opening view instantly.
          syncScope();
          if (baked) rig.easeScope();
        }
        baked = true;
      }
      lastPose = pose;
      wasTweening = tweening;
      if (pointerDirty && now - lastHover >= hoverMs) {
        pointerDirty = false;
        lastHover = now;
        const name = picker.hover(ndc.x, ndc.y, camera, now);
        if (name !== m3.hover) {
          m3.hover = name;
          ctx.onHover?.(name);
        }
      }
      labels.update(now);
      layers.update(now);
    },
  };
  return m3;
}
