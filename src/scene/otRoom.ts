// Static thoracic operating theatre (T813): built once at load around the UNMOVED patient (left lateral decubitus,
// right chest up, §6/§7.1), before the compile stage so its two programs exist at "ready". Everything except the
// monitor screen is one merged, vertex-coloured MeshBasicMaterial mesh with lighting baked in at load (lamp faces
// and panels are HDR colours: no new lights). Not pickable (the pick BVH is built from the model only); shown in the
// outside view only by toggling the group's `visible`.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Box3, Scene } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { config } from '../core/config';
import { isRenderingHeld, requestRender } from '../core/renderer';
import { OT_ROOM as R } from './otRoom.config';

export interface OtRoom {
  readonly group: Group;
  /** The anaesthesia monitor screen's texture source (the vitals monitor mirrors into it). */
  readonly screenCanvas: HTMLCanvasElement;
  readonly visible: boolean;
  setVisible(on: boolean): void;
  /** The canvas was redrawn: re-upload it (deferred while the room is hidden) and draw a frame. */
  markScreenDirty(): void;
}

const UP = new Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const _c = new Color();
const _p = new Vector3();
const _n = new Vector3();
const _l = new Vector3();
const _q = new Quaternion();

type Station = readonly (readonly [number, number, number])[];
/** Linear [height scale, depth scale] at offset d along a drape's station list (clamped at both ends). */
function station(list: Station, d: number): [number, number] {
  let i = 0;
  while (i < list.length - 2 && d > (list[i + 1]?.[0] ?? d)) i++;
  const [d0, h0, w0] = list[i] ?? [0, 1, 1];
  const [d1, h1, w1] = list[i + 1] ?? [1, 1, 1];
  const t = Math.min(1, Math.max(0, (d - d0) / (d1 - d0)));
  return [h0 + (h1 - h0) * t, w0 + (w1 - w0) * t];
}

/** `skin` = the patient's skin world bounds (the room is fitted around it; the model is never moved). */
export function buildOtRoom(scene: Scene, skin: Box3): OtRoom {
  const T = R.table;
  const D = R.drape;
  const B = R.bake;
  const c = skin.getCenter(new Vector3());
  const yT = skin.min.y + T.sink; // mattress top
  const yF = yT - T.height; // floor
  const yC = yF + R.room.height; // ceiling
  const xh = skin.max.x + T.headExt; // table head end
  const xf = skin.min.x - T.footExt; // table foot end
  const zB = c.z - T.halfWidth - D.thickness; // drape over the posterior / anterior table edge
  const zA = c.z + T.halfWidth + D.thickness;
  const w = (skin.max.z - skin.min.z) / 2;
  const h = skin.max.y - yT;
  const [ldx, ldz, lh] = R.lamps.heads[0];
  const key = new Vector3(c.x + ldx, yT + lh, c.z + ldz);
  const parts: BufferGeometry[] = [];

  /** Bake colour × (ambient + key lamp) into a world-space geometry (glow > 0: unlit HDR colour) and keep it. */
  function add(geo: BufferGeometry, hex: string, glow = 0): void {
    geo.deleteAttribute('uv');
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const col = new Float32Array(pos.count * 3);
    _c.set(hex);
    for (let i = 0; i < pos.count; i++) {
      let k = glow;
      if (!glow) {
        _l.subVectors(key, _p.fromBufferAttribute(pos, i));
        const d = _l.length() || 1;
        const lambert = Math.abs(_n.fromBufferAttribute(nor, i).dot(_l) / d);
        k = B.ambient + (B.key * lambert) / (1 + (d / B.falloffM) ** 2);
      }
      col.set([_c.r * k, _c.g * k, _c.b * k], i * 3);
    }
    geo.setAttribute('color', new BufferAttribute(col, 3));
    parts.push(geo);
  }
  const box = (s: readonly number[], x: number, y: number, z: number, hex: string, glow = 0): void =>
    add(new BoxGeometry(s[0], s[1], s[2]).translate(x, y, z), hex, glow);
  function rod(a: Vector3, b: Vector3, r: number, hex: string): void {
    const g = new CylinderGeometry(r, r, a.distanceTo(b), 10, 1, true);
    g.applyQuaternion(_q.setFromUnitVectors(UP, _l.subVectors(b, a).normalize()));
    add(g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), hex);
  }

  // ── Room shell ──
  const { halfX, halfZ, height, segments: n } = R.room;
  const plane = (sx: number, sy: number): PlaneGeometry => new PlaneGeometry(sx, sy, n, n);
  add(
    plane(2 * halfX, 2 * halfZ)
      .rotateX(-Math.PI / 2)
      .translate(c.x, yF, c.z),
    R.room.floor,
  );
  add(
    plane(2 * halfX, 2 * halfZ)
      .rotateX(Math.PI / 2)
      .translate(c.x, yC, c.z),
    R.room.ceiling,
  );
  for (const s of [-1, 1]) {
    add(plane(2 * halfX, height).translate(c.x, yF + height / 2, c.z + s * halfZ), R.room.wall);
    add(
      plane(2 * halfZ, height)
        .rotateY(Math.PI / 2)
        .translate(c.x + s * halfX, yF + height / 2, c.z),
      R.room.wall,
    );
  }
  const P = R.room.panel;
  add(
    new PlaneGeometry(P.size[0], P.size[1]).rotateX(Math.PI / 2).translate(c.x, yC - 0.01, c.z),
    P.color,
    P.glow,
  );
  const back = c.z - halfZ;
  const cb = R.room.cabinet.box;
  box(cb, c.x + cb[3], yF + cb[4] + cb[1] / 2, back + cb[2] / 2, R.room.cabinet.color);
  const vb = R.room.viewer.box;
  box(vb, c.x + vb[3], yF + vb[4] + vb[1] / 2, back + vb[2] / 2, R.room.viewer.color, R.room.viewer.glow);

  // ── Operating table: gel mattress, frame, pedestal, base ──
  const xm = (xh + xf) / 2;
  const len = xh - xf;
  box([len, T.mattressT, 2 * T.halfWidth], xm, yT - T.mattressT / 2, c.z, T.mattress);
  const yFrame = yT - T.mattressT - T.frameT / 2;
  box([len, T.frameT, 2 * T.halfWidth - 0.02], xm, yFrame, c.z, T.steel); // inset: never pokes through the drape
  const colH = yFrame - yF - T.base[1];
  box([T.column[0], colH, T.column[1]], xm, yF + T.base[1] + colH / 2, c.z, T.steel);
  box(T.base, xm, yF + T.base[1] / 2, c.z, T.steel);

  // ── Drapes: cloth swept along X over a superellipse body envelope, falling over the table edges ──
  const F = D.folds;
  const a = w * D.tent[0];
  const envelope = (z: number, sh: number, sw: number): number => {
    const s = Math.abs(z - c.z) / (a * sw);
    return s < 1 ? h * D.tent[1] * sh * (1 - s ** D.power) ** (1 / D.power) : 0;
  };
  /** Cross-section at x: optional back hang, top from z0 to z1, optional front hang → (z, y) pairs. */
  function cloth(
    x: number,
    sh: number,
    sw: number,
    z0: number,
    z1: number,
    hang0: boolean,
    hang1: boolean,
  ): number[] {
    const out: number[] = [];
    const hang = (z: number, f: number, dir: number): void => {
      const fold = F.hangAmp * (1 - f) * (0.5 + 0.5 * Math.sin((TAU * x) / F.hangWave + 3 * dir));
      out.push(z + dir * fold, yT + D.thickness - D.hang * (1 - f));
    };
    if (hang0) for (let i = 0; i < D.hangCols; i++) hang(z0, i / D.hangCols, -1);
    const cols = hang0 && hang1 ? D.topCols : D.topCols / 2;
    for (let j = 0; j < cols; j++) {
      const z = z0 + ((z1 - z0) * j) / (cols - 1);
      const ripple = F.topAmp * Math.sin((TAU * x) / F.topWave + 9 * z) * Math.sin(17 * z + 2 * x);
      out.push(z, yT + D.thickness + envelope(z, sh, sw) + ripple);
    }
    if (hang1) for (let i = D.hangCols - 1; i >= 0; i--) hang(z1, i / D.hangCols, 1);
    return out;
  }
  /** Indexed grid swept from x0 to x1; profile(x) returns the same number of (z, y) pairs for every x. */
  function sweep(x0: number, x1: number, profile: (x: number) => number[]): BufferGeometry {
    const rows = Math.max(2, Math.ceil(Math.abs(x1 - x0) * D.rowsPerM) + 1);
    const pos: number[] = [];
    let cols = 0;
    for (let r = 0; r < rows; r++) {
      const x = x0 + ((x1 - x0) * r) / (rows - 1);
      const zy = profile(x);
      cols = zy.length / 2;
      for (let j = 0; j < cols; j++) pos.push(x, zy[2 * j + 1] ?? 0, zy[2 * j] ?? 0);
    }
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++)
      for (let j = 0; j < cols - 1; j++) {
        const i = r * cols + j;
        idx.push(i, i + cols, i + 1, i + 1, i + cols, i + cols + 1);
      }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  const headX = skin.max.x;
  const footX = skin.min.x;
  const headStart = headX - D.overlapHead;
  const footStart = footX + D.overlapFoot;
  add(
    sweep(headStart, xh, (x) => cloth(x, ...station(D.headStations, x - headX), zB, zA, true, true)),
    D.color,
  );
  add(
    sweep(footStart, xf, (x) => cloth(x, ...station(D.footStations, footX - x), zB, zA, true, true)),
    D.color,
  );
  // Operative window: side strips cover the flanks only, leaving the right lateral chest (port sites) exposed.
  const cut = a * (1 - D.windowFrac ** D.power) ** (1 / D.power);
  add(
    sweep(footStart, headStart, (x) => cloth(x, 1, 1, zB, c.z - cut, true, false)),
    D.color,
  );
  add(
    sweep(footStart, headStart, (x) => cloth(x, 1, 1, c.z + cut, zA, false, true)),
    D.color,
  );
  // Anaesthesia screen: drape hung from a bar across the neck, folds deepening toward the hem.
  const S = D.screen;
  const xs = headX + S.gap;
  const sw = zA - zB + 2 * S.overhang;
  const sh = S.height + D.hang;
  const scr = new PlaneGeometry(sw, sh, S.cols, S.rows)
    .rotateY(Math.PI / 2)
    .translate(xs, yT - D.hang + sh / 2, c.z);
  const sp = scr.getAttribute('position');
  for (let i = 0; i < sp.count; i++) {
    const down = (yT + S.height - sp.getY(i)) / sh;
    sp.setX(i, xs + S.foldAmp * down * Math.sin((TAU * sp.getZ(i)) / S.foldWave));
  }
  scr.computeVertexNormals();
  add(scr, D.color);
  const barY = yT + S.height;
  rod(
    new Vector3(xs, barY, zB - S.overhang),
    new Vector3(xs, barY, zA + S.overhang),
    R.lamps.armRadius,
    T.steel,
  );
  for (const z of [zB - S.overhang, zA + S.overhang])
    rod(new Vector3(xs, barY, z), new Vector3(xs, yFrame, z), R.lamps.armRadius, T.steel);

  // ── Overhead surgical lamps: housing + emissive face, arms from one ceiling mount ──
  const L = R.lamps;
  const mount = new Vector3(c.x + L.mount[0], yC, c.z + L.mount[1]);
  const elbow = mount.clone().setY(yC - 0.5);
  rod(mount, elbow, L.armRadius * 1.6, L.housing);
  for (const [dx, dz, hy, r] of L.heads) {
    const p = new Vector3(c.x + dx, yT + hy, c.z + dz);
    add(new CylinderGeometry(r * 0.7, r, L.depth, 24).translate(p.x, p.y + L.depth / 2, p.z), L.housing);
    add(
      new CircleGeometry(r * 0.86, 24).rotateX(Math.PI / 2).translate(p.x, p.y - 0.002, p.z),
      L.face,
      L.glow,
    );
    rod(elbow, p.clone().setY(p.y + L.depth), L.armRadius, L.housing);
  }

  // ── Anaesthesia machine + vitals monitor (screen faces the default outside camera) ──
  const A = R.anaesthesia;
  const ax = xh + A.gap + A.box[0] / 2;
  const az = c.z + A.dz;
  box(A.box, ax, yF + A.box[1] / 2, az, A.color);
  box([A.box[0] * 0.8, A.box[1] * 0.35, 0.01], ax, yF + A.box[1] * 0.7, az + A.box[2] / 2 + 0.005, A.panel);
  const M = R.monitor;
  const my = yT + M.heightAboveMattress;
  rod(new Vector3(ax, yF + A.box[1], az), new Vector3(ax, my, az), M.poleRadius, T.steel);
  const cam = _p
    .set(...config.viewer.viewDir)
    .normalize()
    .multiplyScalar(config.viewer.distance)
    .add(c);
  const yaw = Math.atan2(cam.x - ax, cam.z - az);
  add(new BoxGeometry(...M.size).rotateY(yaw).translate(ax, my, az), M.bezel);

  // ── Mayo instrument tray on the anterior side ──
  const Y = R.mayo;
  const mx = c.x + Y.at[0];
  const mz = zA + Y.at[1];
  const my2 = yT + Y.heightAboveMattress;
  box(Y.tray, mx, my2, mz, D.color);
  for (let k = 0; k < 4; k++) box([0.22, 0.006, 0.012], mx, my2 + 0.018, mz - 0.1 + k * 0.06, T.steel);
  rod(new Vector3(mx - 0.2, my2, mz), new Vector3(mx - 0.2, yF, mz), M.poleRadius, T.steel);
  box([0.4, 0.04, 0.4], mx - 0.2, yF + 0.02, mz, T.steel);

  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error('OT room: geometry merge failed');
  const roomMesh = new Mesh(merged, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
  roomMesh.name = 'ot_room';

  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = M.canvas;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Placeholder until the vitals monitor mirrors into it: dark screen with a flat trace.
    ctx.fillStyle = M.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = M.trace;
    ctx.fillRect(0, canvas.height / 3, canvas.width, 2);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const screenGeo = new PlaneGeometry(...M.screen)
    .translate(0, 0, M.size[2] / 2 + 0.002)
    .rotateY(yaw)
    .translate(ax, my, az);
  const screen = new Mesh(screenGeo, new MeshBasicMaterial({ map: tex }));
  screen.name = 'ot_room_monitor_screen';

  const group = new Group();
  group.name = 'ot_room_group';
  group.add(roomMesh, screen);
  group.traverse((o) => {
    o.matrixAutoUpdate = false; // geometry is baked in world space: identity transforms
    o.updateMatrix();
  });
  scene.add(group);

  let stale = false;
  return {
    group,
    screenCanvas: canvas,
    get visible() {
      return group.visible;
    },
    setVisible(on) {
      if (group.visible === on) return;
      group.visible = on;
      if (on && stale) {
        stale = false;
        tex.needsUpdate = true;
      }
    },
    markScreenDirty() {
      if (!group.visible) {
        stale = true;
        return;
      }
      tex.needsUpdate = true;
      if (!isRenderingHeld()) requestRender(); // a held static screen must stay held (T703)
    },
  };
}
