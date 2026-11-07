// Guided walkthrough hover labels (FEEDBACK_GUIDED_v1 R2): the hovered structure's display name in a small tooltip
// by the cursor, no click. Fed by wireM3's BVH hover tick (≤ config.pick.hoverHz); hidden over instruments, when the
// pointer leaves the canvas and outside Guided walkthrough mode (Practice / Explore keep click-to-label). Touch:
// a long press shows the name until the finger lifts. DOM writes only on pointer events / hover ticks.
import { Raycaster, Vector2 } from 'three';
import type { Camera, Intersection, Mesh, Object3D } from 'three';
import { labelFor } from '../content/labels';
import { config } from '../core/config';
import { getMode } from '../sim/modes';
import './viewing.css';

const V = config.viewing;
const INSTRUMENTS = 'instruments'; // src/scene/instruments.ts root (every tool + the left-in-port clones)
const ray = new Raycaster();
const hits: Intersection[] = [];
const at = new Vector2();

/** True if the ray hits a visible mesh under `o` (allocates an Intersection only on a hit). */
function hitVisible(o: Object3D): boolean {
  if (!o.visible) return false;
  if ((o as Mesh).isMesh) {
    o.raycast(ray, hits);
    if (hits.length) {
      hits.length = 0;
      return true;
    }
  }
  const c = o.children;
  for (let i = 0; i < c.length; i++) if (hitVisible(c[i] as Object3D)) return true;
  return false;
}

export interface HoverLabel {
  /** wireM3 hover tick: node under the pointer at NDC (null = none). */
  tick(name: string | null, ndcX: number, ndcY: number): void;
}

export function mountHoverLabel(
  host: HTMLElement,
  canvas: HTMLElement,
  camera: Camera,
  scene: Object3D,
  pick: (ndcX: number, ndcY: number) => string | null,
): HoverLabel {
  const el = document.createElement('div');
  el.className = 'hover-label';
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  host.append(el);
  let x = 0;
  let y = 0;
  let inside = false;
  let shown = '';
  let tools: Object3D | null = null;

  const hide = (): void => {
    el.hidden = true;
  };
  const place = (): void => {
    el.style.transform = `translate(${x + V.hoverTipOffsetPx}px, ${y + V.hoverTipOffsetPx}px)`;
  };
  const overTool = (ndcX: number, ndcY: number): boolean => {
    tools ??= scene.getObjectByName(INSTRUMENTS) ?? null;
    if (!tools) return false;
    ray.setFromCamera(at.set(ndcX, ndcY), camera);
    return hitVisible(tools);
  };
  const show = (name: string | null, ndcX: number, ndcY: number): void => {
    if (!name || getMode() !== 'guided' || overTool(ndcX, ndcY)) return hide();
    if (name !== shown) {
      shown = name;
      el.textContent = labelFor(name).name;
    }
    place();
    el.hidden = false;
  };
  const toNdc = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    x = e.clientX;
    y = e.clientY;
    at.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  };

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    inside = true;
    x = e.clientX;
    y = e.clientY;
    if (!el.hidden) place();
  });
  canvas.addEventListener('pointerleave', () => {
    inside = false;
    hide();
  });

  // Touch fallback: hold still for longPressMs → full pick at the finger; shown until the finger lifts.
  let timer = 0;
  let downX = 0;
  let downY = 0;
  const cancel = (): void => {
    window.clearTimeout(timer);
    hide();
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    downX = e.clientX;
    downY = e.clientY;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      toNdc(e);
      show(pick(at.x, at.y), at.x, at.y);
    }, V.longPressMs);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (
      e.pointerType === 'touch' &&
      Math.hypot(e.clientX - downX, e.clientY - downY) >= config.pick.clickSlopPx
    )
      cancel();
  });
  canvas.addEventListener('pointerup', (e) => e.pointerType === 'touch' && cancel());
  canvas.addEventListener('pointercancel', cancel);

  return {
    tick(name, ndcX, ndcY) {
      if (inside) show(name, ndcX, ndcY);
    },
  };
}
