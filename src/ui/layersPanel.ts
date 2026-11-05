// Viewing aids: layers panel (§6.5). Per-group/per-structure show/hide + opacity, X-ray, movable cut-away plane.
// Opacity/X-ray only swap the pre-compiled material variants (materials.ts); the cut-away only mutates plane values,
// so nothing here can compile a program (§6.10). Event-driven DOM, no per-frame work.
// Visibility combine rule: node.visible = stepVisible(name) && userVisible(name). The panel applies it on user
// toggles; the step helper must AND `isUserVisible` when it re-applies a step (wiring pass).
import { Mesh, Vector3 } from 'three';
import type { Box3, Object3D } from 'three';
import procedure from '../content/procedure_steps.json';
import { labelFor } from '../content/labels';
import { config } from '../core/config';
import * as realMaterials from '../scene/materials';
import './panels.css';
import './viewing.css';

export const LAYER_GROUPS: Readonly<Record<string, readonly string[]>> = procedure.layer_groups;

/** Display names for the layer_groups ids; unknown ids fall back to the id with spaces. */
const GROUP_LABELS: Readonly<Record<string, string>> = {
  ChestWall: 'Chest wall',
  Hilar_vessels_airway: 'Hilar vessels & airway',
  Lymph_nodes: 'Lymph nodes',
  Pulmonary_arteries: 'Pulmonary arteries',
  Pulmonary_veins_LA: 'Pulmonary veins & left atrium',
  RML_hilum: 'Middle lobe hilum',
  Soft_tissue: 'Soft tissue',
};
export const groupLabel = (id: string): string => GROUP_LABELS[id] ?? id.replace(/_/g, ' ');

/** Model axes (§7.1): +X head, +Y patient right, +Z anterior. */
export const CUT_AXES = ['X head–foot', 'Y right–left', 'Z ant–post'] as const;
export type CutAxis = 0 | 1 | 2;

export const combineVisible = (stepVisible: boolean, userVisible: boolean): boolean =>
  stepVisible && userVisible;

/**
 * Cut-away plane for an axis-aligned cut at `pos` metres. Default keeps the side below `pos` (clips head / right /
 * anterior of it); flip keeps the other side. Writes the normal, returns the constant (clipped: n·p + c < 0).
 */
export function cutawayPlane(axis: CutAxis, pos: number, flip: boolean, outNormal: Vector3): number {
  outNormal.set(0, 0, 0).setComponent(axis, flip ? 1 : -1);
  return flip ? -pos : pos;
}

export type ViewingMaterials = Pick<
  typeof realMaterials,
  'setXray' | 'setOpacity' | 'setCutawayPlane' | 'parkCutaway'
>;

export interface LayersDeps {
  lookup: (name: string) => Object3D | undefined;
  /** Current step/scope visibility of a node (the step hidden sets). */
  stepVisible: (name: string) => boolean;
  /** Scene bounds (load time) for the cut-away slider range. */
  bounds: Box3;
  materials?: ViewingMaterials; // tests inject fakes
}

export interface Layers {
  /** Group → node names present in the scene. */
  groups: ReadonlyMap<string, readonly string[]>;
  isUserVisible: (name: string) => boolean;
  setVisible: (name: string, on: boolean) => void;
  setOpacity: (name: string, a: number) => void;
  setXray: (on: boolean) => void;
  setCutaway: (enabled: boolean, axis: CutAxis, pos: number, flip: boolean) => void;
}

const _n = new Vector3();

/** DOM-free controller. Resolves nodes and their meshes once. */
export function createLayers(deps: LayersDeps): Layers {
  const mat = deps.materials ?? realMaterials;
  const nodes = new Map<string, { obj: Object3D; meshes: Mesh[] }>();
  const groups = new Map<string, string[]>();
  const hidden = new Set<string>();
  for (const [group, names] of Object.entries(LAYER_GROUPS)) {
    const present: string[] = [];
    for (const name of names) {
      const obj = deps.lookup(name);
      if (!obj) continue;
      const meshes: Mesh[] = [];
      obj.traverse((o) => {
        if ((o as Mesh).isMesh) meshes.push(o as Mesh);
      });
      nodes.set(name, { obj, meshes });
      present.push(name);
    }
    if (present.length) groups.set(group, present);
  }
  return {
    groups,
    isUserVisible: (name) => !hidden.has(name),
    setVisible(name, on) {
      if (on) hidden.delete(name);
      else hidden.add(name);
      const e = nodes.get(name);
      if (e) e.obj.visible = combineVisible(deps.stepVisible(name), on);
    },
    setOpacity(name, a) {
      for (const m of nodes.get(name)?.meshes ?? []) mat.setOpacity(m, a);
    },
    setXray: (on) => mat.setXray(on),
    setCutaway(enabled, axis, pos, flip) {
      if (!enabled) return mat.parkCutaway();
      const c = cutawayPlane(axis, pos, flip, _n);
      mat.setCutawayPlane(_n, c);
    },
  };
}

let uid = 0;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function checkbox(label: string, on: boolean, set: (v: boolean) => void): [HTMLElement, HTMLInputElement] {
  const input = h('input', { type: 'checkbox', checked: on, className: 'panel-switch' });
  input.addEventListener('change', () => set(input.checked));
  return [h('label', { className: 'panel-toggle' }, input, label), input];
}

function slider(
  label: string,
  range: { min: number; max: number; step: number; value: number },
  set: (v: number) => void,
): [HTMLElement, HTMLInputElement] {
  const id = `layers-${uid++}`;
  const input = h('input', {
    id,
    type: 'range',
    min: String(range.min),
    max: String(range.max),
    step: String(range.step),
    value: String(range.value),
  });
  input.addEventListener('input', () => set(Number(input.value)));
  return [h('div', { className: 'panel-field' }, h('label', { htmlFor: id }, label), input), input];
}

const OPACITY = { min: 0, max: 1, step: config.viewing.opacityStep, value: 1 };

/** Mounts the layers panel into `host`; returns the controller (wiring uses isUserVisible) and a dispose. */
export function mountLayersPanel(
  host: HTMLElement,
  deps: LayersDeps,
): { layers: Layers; dispose: () => void } {
  const layers = createLayers(deps);
  // Collapsed by default (native <details>) so it never covers the scope image until asked for.
  const root = h(
    'details',
    { className: 'viewing-body' },
    h('summary', { className: 'panel-title' }, 'Layers'),
  );
  const panel = h('section', { className: 'panel viewing-panel' }, root);
  panel.setAttribute('aria-label', 'Layers and viewing aids');

  const [xray] = checkbox('X-ray', false, layers.setXray);
  root.append(h('div', { className: 'panel-group' }, xray));

  // Cut-away plane
  let enabled = false;
  let axis: CutAxis = 0;
  let flip = false;
  const apply = (): void => layers.setCutaway(enabled, axis, Number(pos.value), flip);
  const rangeFor = (a: CutAxis): { min: number; max: number } => ({
    min: deps.bounds.min.getComponent(a),
    max: deps.bounds.max.getComponent(a),
  });
  const r0 = rangeFor(0);
  const [cutToggle] = checkbox('Cut-away plane', false, (v) => {
    enabled = v;
    apply();
  });
  const axisId = `layers-${uid++}`;
  const axisSelect = h(
    'select',
    { id: axisId },
    ...CUT_AXES.map((label, i) => h('option', { value: String(i), textContent: label })),
  );
  const [posRow, pos] = slider(
    'Cut-away position',
    { ...r0, step: config.viewing.cutawayStepM, value: (r0.min + r0.max) / 2 },
    apply,
  );
  axisSelect.addEventListener('change', () => {
    axis = Number(axisSelect.value) as CutAxis;
    const r = rangeFor(axis);
    pos.min = String(r.min);
    pos.max = String(r.max);
    pos.value = String((r.min + r.max) / 2);
    apply();
  });
  const [flipToggle] = checkbox('Flip cut-away', false, (v) => {
    flip = v;
    apply();
  });
  root.append(
    h(
      'div',
      { className: 'panel-group' },
      cutToggle,
      h('div', { className: 'panel-field' }, h('label', { htmlFor: axisId }, 'Cut-away axis'), axisSelect),
      posRow,
      flipToggle,
    ),
  );

  // Groups: native <details> (keyboard + aria-expanded for free); group controls drive their rows.
  for (const [group, names] of layers.groups) {
    const title = groupLabel(group);
    const rows = names.map((name) => {
      const label = labelFor(name).name;
      const [show, showInput] = checkbox(label, true, (v) => layers.setVisible(name, v));
      showInput.setAttribute('aria-label', `Show ${label}`);
      const [op, opInput] = slider(`${label} opacity`, OPACITY, (v) => layers.setOpacity(name, v));
      const row = h('div', { className: 'viewing-row' }, show, op);
      row.dataset.node = name;
      return { name, row, showInput, opInput };
    });
    const [groupShow] = checkbox(`Show ${title}`, true, (v) => {
      for (const r of rows) {
        r.showInput.checked = v;
        layers.setVisible(r.name, v);
      }
    });
    const [groupOp] = slider(`${title} opacity`, OPACITY, (v) => {
      for (const r of rows) {
        r.opInput.value = String(v);
        layers.setOpacity(r.name, v);
      }
    });
    const details = h(
      'details',
      { className: 'panel-group viewing-group' },
      h('summary', {}, title),
      h('div', { className: 'viewing-group-controls' }, groupShow, groupOp),
      ...rows.map((r) => r.row),
    );
    details.dataset.group = group;
    root.append(details);
  }

  host.append(panel);
  return { layers, dispose: () => panel.remove() };
}
