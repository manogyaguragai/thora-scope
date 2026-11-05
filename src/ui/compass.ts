// Scope orientation compass (T816): where the patient's head / feet / anterior / posterior lie in the current
// scope image. Patient axes are thorax_root-local (CONTEXT §7.1: +X head, +Z anterior), rotated into camera space;
// each label sits on the rim at its in-plane angle. DOM writes ≤ config.viewing.compassHz; update is allocation-free.
import { Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import { config } from '../core/config';

const HEAD = new Vector3(1, 0, 0);
const ANTERIOR = new Vector3(0, 0, 1);
const tC = new Quaternion();
const tV = new Vector3();

/** out ← unit screen directions (x right, y up) of head [0,1] and anterior [2,3]; feet/posterior are the negatives.
 *  An axis along the view axis keeps its last direction. */
export function projectAxes(root: Quaternion, cam: Quaternion, out: Float32Array): void {
  tC.copy(cam).invert().multiply(root);
  for (let i = 0; i < 2; i++) {
    tV.copy(i === 0 ? HEAD : ANTERIOR).applyQuaternion(tC);
    const len = Math.hypot(tV.x, tV.y);
    if (len < 1e-6) continue;
    out[2 * i] = tV.x / len;
    out[2 * i + 1] = tV.y / len;
  }
}

const MARKS = [
  ['head', 'Head'],
  ['feet', 'Feet'],
  ['anterior', 'Ant'],
  ['posterior', 'Post'],
] as const;

export interface Compass {
  el: HTMLElement;
  /** Frame loop: show in the scope view only, re-aim ≤ compassHz. */
  update(now: number, show: boolean, root: Object3D, camera: Object3D): void;
}

export function mountCompass(host: HTMLElement, resetKey: string): Compass {
  const el = document.createElement('div');
  el.className = 'scope-compass';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Patient orientation in the scope view: head, feet, anterior, posterior');
  el.hidden = true;
  const dial = document.createElement('div');
  dial.className = 'scope-compass-dial';
  const marks = MARKS.map(([axis, text]) => {
    const m = document.createElement('span');
    m.className = 'scope-compass-mark';
    m.dataset.axis = axis;
    m.textContent = text;
    dial.append(m);
    return m;
  });
  const hint = document.createElement('span');
  hint.className = 'scope-compass-hint';
  hint.textContent = `${resetKey}: reset view`;
  el.append(dial, hint);
  host.append(el);

  const dirs = new Float32Array([0, 1, 1, 0]);
  const rootQ = new Quaternion();
  const camQ = new Quaternion();
  const periodMs = 1000 / config.viewing.compassHz;
  let last = -Infinity;
  return {
    el,
    update(now, show, root, camera) {
      if (el.hidden === show) el.hidden = !show;
      if (!show || now - last < periodMs) return;
      last = now;
      projectAxes(root.getWorldQuaternion(rootQ), camera.getWorldQuaternion(camQ), dirs);
      for (let i = 0; i < 4; i++) {
        const s = i % 2 === 0 ? 1 : -1; // Feet / Posterior = −Head / −Anterior
        const k = i < 2 ? 0 : 2;
        const m = marks[i] as HTMLElement;
        m.style.setProperty('--x', (s * (dirs[k] ?? 0)).toFixed(3));
        m.style.setProperty('--y', (-s * (dirs[k + 1] ?? 0)).toFixed(3)); // CSS y grows down
      }
    },
  };
}
