// 3D structure labels (§6.5): click-to-label (one pinned card: name + one-line description) and toggle-all name
// tags at each structure's load-time anchor. One DOM node per structure, created once; positions update at most
// config.viewing.labelHz times a second and only write the DOM when a label moves/shows/hides.
import { Box3, Vector3 } from 'three';
import type { Camera, Object3D } from 'three';
import { labelFor } from '../content/labels';
import { config } from '../core/config';
import { STEP_FOCUS } from '../scene/materials.config';
import { getMode } from '../sim/modes';
import './viewing.css';

const _v = new Vector3();
const _p = new Vector3();
const _box = new Box3();
const _px = { x: 0, y: 0 };
const M = config.postfx;

/**
 * World point → CSS pixels in a w×h viewport. False when behind the camera, off-screen, or (masked) outside the
 * 5:4 scope mask (same letterboxed fit as the post-FX pass; lens distortion ignored).
 */
export function projectLabel(
  world: Vector3,
  camera: Camera,
  w: number,
  h: number,
  masked: boolean,
  out: { x: number; y: number },
): boolean {
  _v.copy(world).applyMatrix4(camera.matrixWorldInverse);
  if (_v.z >= 0) return false; // camera looks down −Z
  _v.applyMatrix4(camera.projectionMatrix);
  if (Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1) return false;
  out.x = (_v.x + 1) * 0.5 * w;
  out.y = (1 - _v.y) * 0.5 * h;
  if (!masked) return true;
  const mh = M.maskFill * Math.min(h, w / M.maskAspect);
  return Math.abs(out.x - w / 2) <= 0.5 * mh * M.maskAspect && Math.abs(out.y - h / 2) <= 0.5 * mh;
}

/** Screen-space declutter inputs for pickNearest (allocated once by the caller). */
export interface Declutter {
  x: Float64Array; // tag centres, px
  y: Float64Array; // in: anchor centre; out: placed (possibly nudged) centre
  w: Float64Array; // tag sizes, px
  h: Float64Array;
  placed: Float64Array; // scratch, ≥ 4·(fixed + k): cx, cy, half-w, half-h of each placed tag
  fixed: number; // rects pre-placed at the start of `placed` (UI panels tags must avoid)
  gap: number; // px kept between tags
  nudges: number; // rows tried above and below the anchor before a tag is skipped
  maxY: number; // tags stay above this (the dock)
}

/** Place tag i in the first free row (0, −1, +1, −2, …) that overlaps no placed tag; false when none fits. */
function fit(d: Declutter, i: number, count: number): boolean {
  const hw = (d.w[i] ?? 0) / 2 + d.gap / 2;
  const hh = (d.h[i] ?? 0) / 2 + d.gap / 2;
  const x = d.x[i] ?? 0;
  const y0 = d.y[i] ?? 0;
  // Rows 0, −1, +1, … ±nudges around the anchor, then just above / below each fixed UI rect (caption, top bar).
  for (let t = 0; t <= 2 * (d.nudges + d.fixed); t++) {
    const f = 4 * ((t - 2 * d.nudges - 1) >> 1); // fixed rect for t > 2·nudges
    const y =
      t <= 2 * d.nudges
        ? y0 + (t % 2 ? -1 : 1) * Math.ceil(t / 2) * 2 * hh
        : (d.placed[f + 1] ?? 0) + (t % 2 ? -1 : 1) * ((d.placed[f + 3] ?? 0) + hh);
    if (y - hh < 0 || y + hh > d.maxY) continue;
    // Only the rect over the anchor itself pushes the tag to its edge.
    if (
      t > 2 * d.nudges &&
      (Math.abs(x - (d.placed[f] ?? 0)) >= hw + (d.placed[f + 2] ?? 0) ||
        Math.abs(y0 - (d.placed[f + 1] ?? 0)) >= hh + (d.placed[f + 3] ?? 0))
    )
      continue;
    let free = true;
    for (let j = 0; j < (d.fixed + count) * 4 && free; j += 4)
      free =
        Math.abs(x - (d.placed[j] ?? 0)) >= hw + (d.placed[j + 2] ?? 0) ||
        Math.abs(y - (d.placed[j + 1] ?? 0)) >= hh + (d.placed[j + 3] ?? 0);
    if (!free) continue;
    d.y[i] = y;
    const j = (d.fixed + count) * 4;
    d.placed[j] = x;
    d.placed[j + 1] = y;
    d.placed[j + 2] = hw;
    d.placed[j + 3] = hh;
    return true;
  }
  return false;
}

/**
 * Marks up to `k` of the lowest finite scores in `chosen` (1 = show), greedily in score order; ties keep the lower
 * index. With `d`, a tag that overlaps an already-placed one is nudged a row up/down, or (anchor under a fixed UI
 * rect) moved just above/below that rect, or skipped. O(n²), no allocation.
 * Score = squared distance from the view centre, plus a constant larger than any distance for non-focus labels.
 */
export function pickNearest(scores: Float64Array, k: number, chosen: Uint8Array, d?: Declutter): void {
  chosen.fill(0);
  let count = 0;
  while (count < k) {
    let best = -1;
    let min = Infinity;
    for (let i = 0; i < scores.length; i++) {
      const v = scores[i] ?? Infinity;
      if (!chosen[i] && v < min) {
        min = v;
        best = i;
      }
    }
    if (best < 0) break;
    chosen[best] = 2; // tried
    if (d && !fit(d, best, count)) continue;
    chosen[best] = 1;
    count++;
  }
  for (let i = 0; i < chosen.length; i++) if (chosen[i] === 2) chosen[i] = 0;
}

const NO_FOCUS: readonly string[] = [];
/** Structures procedure step `step` is about (STEP_FOCUS, T807; labels + highlight); [] for unknown steps. */
export const stepFocus = (step: number): readonly string[] => STEP_FOCUS[step] ?? NO_FOCUS;

export type GetWorldPos = (name: string, out: Vector3) => boolean;

/**
 * Load time: world bbox centre per node (unmorphed pose; fine for the lobes). The getter returns false for unknown
 * or hidden nodes, so tags follow step + layer visibility.
 */
export function createAnchors(
  lookup: (name: string) => Object3D | undefined,
  names: readonly string[],
): GetWorldPos {
  const anchors = new Map<string, { obj: Object3D; at: Vector3 }>();
  for (const name of names) {
    const obj = lookup(name);
    if (obj) anchors.set(name, { obj, at: _box.setFromObject(obj).getCenter(new Vector3()) });
  }
  return (name, out) => {
    const a = anchors.get(name);
    if (!a?.obj.visible) return false;
    out.copy(a.at);
    return true;
  };
}

export interface Labels3D {
  /** Pin the click-to-label card at a picked world point (copied). */
  pin: (name: string, point: Vector3) => void;
  dismiss: () => void;
  /** Toggle name tags; in config.viewing.focusLabelModes (Guided) only the step-focus structures get tags. */
  toggleAll: () => void;
  /** Structures the current step is about; their tags win the labelMaxCount budget. */
  setFocus: (names: readonly string[]) => void;
  /** Call from the frame loop; self-throttles to labelHz. */
  update: (now: number) => void;
  dispose: () => void;
}

interface Slot {
  el: HTMLElement;
  shown: boolean;
  x: number;
  y: number;
}

function place(s: Slot, ok: boolean, x: number, y: number): void {
  if (!ok) {
    if (s.shown) s.el.hidden = true;
    s.shown = false;
    return;
  }
  x = Math.round(x);
  y = Math.round(y);
  if (!s.shown) s.el.hidden = false;
  s.shown = true;
  if (x === s.x && y === s.y) return;
  s.x = x;
  s.y = y;
  // ponytail: one style string per moved label (DOM needs a string); ≤ labelHz × labels.
  s.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
}

const slot = (className: string): Slot => {
  const el = document.createElement('div');
  el.className = className;
  el.hidden = true;
  return { el, shown: false, x: NaN, y: NaN };
};

export function createLabels3D(
  host: HTMLElement,
  camera: Camera,
  getWorldPos: GetWorldPos,
  opts: { names: readonly string[]; masked?: () => boolean },
): Labels3D {
  const layer = document.createElement('div');
  layer.className = 'labels3d';
  layer.setAttribute('aria-live', 'polite');
  const tags = opts.names.map((name) => {
    const s = slot('label3d-tag');
    s.el.textContent = labelFor(name).name;
    layer.append(s.el);
    return s;
  });
  const card = slot('label3d-pin');
  const cardName = document.createElement('strong');
  const cardDesc = document.createElement('span');
  card.el.append(cardName, cardDesc);
  layer.append(card.el);
  host.append(layer);

  // Toggle-all budget (config.viewing.labelMaxCount) + declutter: per-tag scratch, allocated once.
  const n = opts.names.length;
  const V = config.viewing;
  const dc: Declutter = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    w: new Float64Array(n),
    h: new Float64Array(n),
    placed: new Float64Array(4 * (V.labelAvoidMax + V.labelMaxCount)),
    fixed: 0,
    gap: V.labelGapPx,
    nudges: V.labelNudges,
    maxY: 0,
  };
  const score = new Float64Array(n);
  const chosen = new Uint8Array(n);
  const focus = new Uint8Array(n);

  let tagsOn = false;
  let focusOnly = false;
  let pinned = false;
  const pinAt = new Vector3();
  let last = -Infinity;
  let w = host.clientWidth;
  let h = host.clientHeight;
  let maxY = layer.clientHeight || h; // the layer stops above the dock (viewing.css)
  const measure = (): void => {
    w = host.clientWidth;
    h = host.clientHeight;
    maxY = layer.clientHeight || h;
    // Visible UI panels over the image (top bar, guided caption) → fixed declutter rects, in layer coordinates.
    const origin = layer.getBoundingClientRect();
    let k = 0;
    host.querySelectorAll(V.labelAvoid).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || k >= V.labelAvoidMax) return; // hidden (display: none)
      const j = 4 * k++;
      dc.placed[j] = r.left + r.width / 2 - origin.left;
      dc.placed[j + 1] = r.top + r.height / 2 - origin.top;
      dc.placed[j + 2] = r.width / 2;
      dc.placed[j + 3] = r.height / 2;
    });
    dc.fixed = k;
  };

  const dismiss = (): void => {
    pinned = false;
    place(card, false, 0, 0);
  };
  const toggleAll = (): void => {
    tagsOn = !tagsOn;
    focusOnly = V.focusLabelModes.includes(getMode());
    if (!tagsOn) for (const t of tags) place(t, false, 0, 0);
    else
      // Tag sizes for the declutter: one forced layout per toggle (user action, not per frame).
      tags.forEach((t, i) => {
        t.el.hidden = false;
        dc.w[i] = t.el.offsetWidth;
        dc.h[i] = t.el.offsetHeight;
        t.el.hidden = !t.shown;
      });
    measure(); // the caption may have moved / changed size since the last resize
    last = -Infinity; // show on the next frame
  };
  window.addEventListener('resize', measure);

  const periodMs = 1000 / config.viewing.labelHz;
  return {
    pin(name, point) {
      const l = labelFor(name);
      cardName.textContent = l.name;
      cardDesc.textContent = l.description;
      pinAt.copy(point);
      pinned = true;
      last = -Infinity;
    },
    dismiss,
    toggleAll,
    setFocus(names) {
      for (let i = 0; i < n; i++) focus[i] = names.includes(opts.names[i] as string) ? 1 : 0;
      last = -Infinity;
    },
    update(now) {
      if ((!tagsOn && !pinned) || now - last < periodMs) return;
      last = now;
      const masked = opts.masked?.() ?? false;
      if (tagsOn) {
        const far = w * w + h * h; // > any on-screen squared distance from the centre
        for (let i = 0; i < n; i++) {
          const ok =
            getWorldPos(opts.names[i] as string, _p) &&
            projectLabel(_p, camera, w, h, masked, _px) &&
            _px.y <= maxY;
          dc.x[i] = _px.x;
          dc.y[i] = _px.y;
          const dx = _px.x - w / 2;
          const dy = _px.y - h / 2;
          score[i] = ok && (focus[i] || !focusOnly) ? dx * dx + dy * dy + (focus[i] ? 0 : far) : Infinity;
        }
        dc.maxY = maxY;
        pickNearest(score, V.labelMaxCount, chosen, dc);
        for (let i = 0; i < n; i++) place(tags[i] as Slot, chosen[i] === 1, dc.x[i] ?? 0, dc.y[i] ?? 0);
      }
      if (pinned) place(card, projectLabel(pinAt, camera, w, h, masked, _px) && _px.y <= maxY, _px.x, _px.y);
    },
    dispose() {
      window.removeEventListener('resize', measure);
      layer.remove();
    },
  };
}
