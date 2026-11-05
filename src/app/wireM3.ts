// M3 glue (T307): fulcrum scope rig, BVH picking, hotbar + port chips, viewing aids (layers, X-ray, cut-away, 3D
// labels) and the lazy help overlay. Called once from the loader's place() callback (decode stage), after the
// camera rig, guided controller and shell exist. Input is event-driven (rig pose written on input, not per frame);
// update(now) does throttled hover, label positions and the morph re-bake when a state tween ends.
import { Box3, Vector2, Vector3 } from 'three';
import type { Object3D, PerspectiveCamera } from 'three';
import { TARGET_BY_ID, TARGETS } from '../content/targets';
import { config } from '../core/config';
import { HOTBAR_KEYS, keybindings as K, matchesKey } from '../core/keybindings';
import { makePose } from '../scene/cameras';
import type { CameraRig, ViewMode } from '../scene/cameras';
import { collectMorphMeshes } from '../scene/morphs';
import { buildPickBVH } from '../scene/picking';
import type { Picker } from '../scene/picking';
import type { Guided } from '../sim/guided';
import { CONTEXT_ACTIONS, createHotbar, SLOTS } from '../sim/hotbar';
import type { Hotbar } from '../sim/hotbar';
import { getMode } from '../sim/modes';
import { readPorts } from '../sim/ports';
import { ScopeRig } from '../sim/scopeRig';
import { TWEEN_KEYS } from '../sim/state';
import type { AppState } from '../sim/state';
import { stepHidden } from '../sim/steps';
import type { StepVisibility } from '../sim/steps';
import { mountHotbar, mountPortChips } from '../ui/hotbar';
import { createAnchors, createLabels3D, stepFocus } from '../ui/labels3d';
import type { Labels3D } from '../ui/labels3d';
import { LAYER_GROUPS, mountLayersPanel } from '../ui/layersPanel';
import type { Layers } from '../ui/layersPanel';
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
  portHooks: { occupant: (id: string) => string; refusal: (id: string) => string; toast: (msg: string) => void };
  /** Move the scope to port `id` (chip click / P): eases to a default view of the step's focus; false + toast if
   *  refused. */
  moveScope: (id: string) => boolean;
  /** Frame loop, after morphs. Allocation-free. */
  update: (now: number) => void;
}

const HANDS = 0; // hotbar slot driving the scope (§6.3 slot 1)
const R = config.scopeRig;
const SKIP_TARGETS = 'input, select, textarea, [contenteditable], dialog';
const PORT_HINT = 'Click a port chip or press P to view from another port';

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
  const live = makePose();
  const hotbar = createHotbar();
  mountHotbar(shell.hotbar, hotbar);
  const portHooks: M3['portHooks'] = { occupant: () => '', refusal: () => '', toast: () => {} };
  const occupant = (id: string): string => {
    const s = id === scope.port.id ? (scope.horizonLock ? 'Scope · level' : 'Scope') : '';
    const x = portHooks.occupant(id);
    return s && x ? `${s} + ${x}` : s || x || '—';
  };
  const chips = mountPortChips(shell.ports, scope.ports, occupant, (id) => void moveScope(id));
  const syncScope = (): void => {
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
  const snapStep = (): void => scope.snapTo(rig.scopePoseOf(state.camera), state.port);

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

  const hands = (): boolean => hotbar.slot === HANDS;
  const portIds = scope.ports.map((p) => p.id);

  // One key handler for M3 (help, hotbar, view, labels, scope). Context-action keys belong to M4.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest(SKIP_TARGETS)) return;
    const c = e.code;
    if (e.key === '?' || matchesKey(K.help, c)) {
      if (!e.repeat) toggleHelp();
    } else if (hotbar.handleKey(c)) {
      /* consumed */
    } else if (matchesKey(K.toggleView, c)) {
      if (!e.repeat) ctx.setView(rig.target === 'scope' ? 'outside' : 'scope');
    } else if (matchesKey(K.toggleLabels, c)) {
      if (!e.repeat) labels.toggleAll();
    } else if (matchesKey(K.dismissLabel, c)) labels.dismiss();
    else if (matchesKey(K.nextPort, c) && (hands() || e.shiftKey)) {
      if (!e.repeat) nextPort(); // P with a tool moves the instrument (M4); Shift+P moves the scope from any tool
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
    update(now) {
      let tweening = false;
      for (let i = 0; i < TWEEN_KEYS.length && !tweening; i++)
        tweening = state.tweens[TWEEN_KEYS[i] ?? 'deflate_RUL'].active;
      if (wasTweening && !tweening) picker.refreshMorphs(morphMeshes);
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
    },
  };
  return m3;
}
