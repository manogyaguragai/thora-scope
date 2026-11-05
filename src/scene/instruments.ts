// Procedural instruments (CONTEXT §6.4, §8 Instruments): every tool is built ONCE at load and only shown/hidden
// afterwards (§6.10). T819: real VATS proportions — lathed ferrules, bevelled extruded jaws (toothed ring rims,
// serrated Maryland jaws, stapler channel/insert/anvil), tube-swept hooks and blades, crumpled gauze, handles for the
// outside view. Parts are merged at load into one geometry per tool part × material (few draw calls). Jaws animate by
// pivot rotation only. All opaque materials share one brushed roughness map (built at load) → one opaque program +
// the translucent leader, as before. No clipping planes (instruments are never cut away).
// Local frame: tip at origin, +Z toward the tip.
import {
  CatmullRomCurve3,
  Color,
  CurvePath,
  CylinderGeometry,
  DataTexture,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LineCurve3,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  Path,
  QuadraticBezierCurve3,
  Quaternion,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { BufferGeometry, Curve, Material, Object3D } from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { instrumentGeom as G, instrumentLook as L } from './instruments.config';

/** Hotbar slot ids (src/sim/hotbar.ts) that carry an instrument; 'hands' has none. */
export const TOOL_IDS = [
  'grasper',
  'sponge',
  'peanut',
  'cautery',
  'clamp',
  'stapler',
  'clip',
  'sucker',
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface InstrumentSet {
  /** Add to the scene once and pass to registerWarmupObject(); all tools start hidden. */
  readonly root: Group;
  /** Tool roots: the controller writes position (= tip) + quaternion (+Z = shaft direction) here. */
  readonly tools: Readonly<Record<ToolId, Group>>;
  readonly active: ToolId | null;
  /** Show the tool for a hotbar slot id + sub-option; unknown ids (e.g. 'hands') or null hide all. */
  show(id: string | null, subOption?: number): void;
  /** Active tool's jaw opening, 0 = closed … 1 = fully open. */
  setJaw(open: number): void;
  /** Cautery glow, 0 … 1 (emissive uniform only). */
  setGlow(glow: number): void;
}

interface Jaw {
  pivot: Group;
  axis: 'x' | 'y';
  angle: number; // rotation at open = 1
}
interface Tool {
  group: Group;
  jaws: Jaw[];
  sub?: (i: number) => void;
}
type Geo = BufferGeometry;
type Pts = readonly (readonly [number, number])[];
/** Parts awaiting merge, per material (one mesh per material at flush). */
type Bag = Map<Material, Geo[]>;

const HALF_PI = Math.PI / 2;
const UV = L.brushed.uvPerMetre;
const seg = G.radialSegments;
const tV = new Vector3(); // load-time temps
const tC = new Vector3();
const tQ = new Quaternion();
const UP = new Vector3(0, 1, 0);

// ── Load-time geometry helpers ──
const scaleUv = (g: Geo, k: number = UV): Geo => {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  return g;
};
/** Surface of revolution about +Z from [radius, z] pairs ordered by z (normals point outward). */
const lathe = (pts: Pts, n: number = seg): Geo =>
  new LatheGeometry(
    pts.map(([r, z]) => new Vector2(r, z)),
    n,
  ).rotateX(HALF_PI);
/** Cylinder along +Z, z ∈ [z0, z0 + len]. */
const cylZ = (r: number, len: number, z0: number, open = false): Geo =>
  new CylinderGeometry(r, r, len, seg, 1, open).rotateX(HALF_PI).translate(0, 0, z0 + len / 2);
/** Round rod from a to b. */
const rod = (a: Vector3, b: Vector3, r: number): Geo => {
  const len = tV.subVectors(b, a).length();
  tQ.setFromUnitVectors(UP, tV.normalize());
  tC.addVectors(a, b).multiplyScalar(0.5);
  return new CylinderGeometry(r, r, len, seg / 2).applyQuaternion(tQ).translate(tC.x, tC.y, tC.z);
};
const shape = (pts: Pts): Shape => new Shape(pts.map(([x, y]) => new Vector2(x, y)));
const roundRect = (w: number, h: number, r: number, cx = 0, cy = 0): Shape => {
  const [x0, x1, y0, y1] = [cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2];
  const s = new Shape().moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0)
    .quadraticCurveTo(x1, y0, x1, y0 + r)
    .lineTo(x1, y1 - r)
    .quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1)
    .quadraticCurveTo(x0, y1, x0, y1 - r)
    .lineTo(x0, y0 + r)
    .quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
};
/** Bevelled extrusion of an XY outline along +Z, z ∈ [0, depth]; the side walls keep the authored outline. */
const extrudeZ = (s: Shape, depth: number, b: number = G.bevel, curveSegments = 6): Geo =>
  scaleUv(
    new ExtrudeGeometry(s, {
      depth: depth - 2 * b,
      bevelEnabled: true,
      bevelThickness: b,
      bevelSize: b,
      bevelOffset: -b,
      bevelSegments: 2,
      curveSegments,
    }).translate(0, 0, b),
  );
/** Bevelled plate: outline authored in (x, z), thickness `t` centred on y = 0. */
const plate = (s: Shape, t: number, curveSegments = 6): Geo =>
  extrudeZ(s, t, Math.min(G.bevel, t / 4), curveSegments)
    .translate(0, 0, -t / 2)
    .rotateX(HALF_PI);
/** Tube along a curve; `warp(t, offset)` may rescale each ring's radial offsets (taper, serrations). */
const tube = (
  c: Curve<Vector3>,
  n: number,
  r: number,
  radial: number = seg,
  warp?: (t: number, off: Vector3) => void,
): Geo => {
  const g = new TubeGeometry(c, n, r, radial, false);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i <= n; i++) {
    c.getPointAt(i / n, tC);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      if (warp) {
        tV.fromBufferAttribute(pos, k).sub(tC);
        warp(i / n, tV);
        pos.setXYZ(k, tC.x + tV.x, tC.y + tV.y, tC.z + tV.z);
      }
      uv.setXY(k, uv.getY(k), uv.getX(k)); // streaks run along the tube
    }
  }
  if (warp) g.computeVertexNormals();
  return scaleUv(g, UV * c.getLength());
};
const taper = (k: number) => (t: number, off: Vector3) => off.multiplyScalar(1 - (1 - k) * t);
/** Crumpled gauze ball: welded sphere with position-hashed radial noise (seam-free normals). */
const gauzeBall = (amp: number): Geo => {
  const base = new SphereGeometry(1, G.gauze.segments, G.gauze.segments * 0.75);
  base.deleteAttribute('uv');
  base.deleteAttribute('normal');
  const g = mergeVertices(base);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    tV.fromBufferAttribute(pos, i);
    const n =
      Math.sin(7 * tV.x + 1.3) * Math.sin(5 * tV.y + 0.7) * Math.sin(6 * tV.z + 2.1) +
      0.35 * Math.sin(19 * tV.x + 17 * tV.y - 15 * tV.z); // soft folds + fine wrinkles
    tV.multiplyScalar(1 + amp * n);
    pos.setXYZ(i, tV.x, tV.y, tV.z);
  }
  g.computeVertexNormals();
  g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(pos.count * 2), 2));
  return g;
};
const merge = (list: Geo[]): Geo => {
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat);
  for (const g of new Set([...list, ...flat])) g.dispose();
  if (!merged) throw new Error('instruments: merge failed');
  merged.computeBoundingSphere();
  return merged;
};
const put = (bag: Bag, mat: Material, ...g: Geo[]): void => {
  const l = bag.get(mat);
  if (l) l.push(...g);
  else bag.set(mat, g);
};
const flush = (bag: Bag, parent: Object3D): void => {
  for (const [mat, list] of bag) parent.add(new Mesh(merge(list), mat));
  bag.clear();
};

/** Brushed-metal roughness map: smoothed per-column streak noise with faint per-row jitter (seeded). */
function brushedMap(): DataTexture {
  const B = L.brushed;
  let s = B.seed;
  const rnd = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const raw = Array.from({ length: B.columns }, rnd);
  const col = raw.map((v, i) => (v + (raw[(i + 1) % B.columns] ?? v) + (raw.at(i - 1) ?? v)) / 3);
  const data = new Uint8Array(B.columns * B.rows * 4);
  for (let y = 0; y < B.rows; y++) {
    for (let x = 0; x < B.columns; x++) {
      const v = (B.min + (1 - B.min) * (col[x] ?? 1) + (rnd() - 0.5) * B.rowJitter) * 255;
      data.fill(Math.max(0, Math.min(255, v)), (y * B.columns + x) * 4, (y * B.columns + x) * 4 + 3);
      data[(y * B.columns + x) * 4 + 3] = 255;
    }
  }
  const t = new DataTexture(data, B.columns, B.rows);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function buildInstruments(): InstrumentSet {
  const brushed = brushedMap();
  const std = (
    p: { color: string; roughness: number; metalness: number; envMapIntensity?: number },
    name: string,
  ): MeshStandardMaterial => {
    const { color, roughness, metalness, envMapIntensity = 1 } = p;
    return new MeshStandardMaterial({
      name,
      color,
      roughness,
      metalness,
      envMapIntensity,
      roughnessMap: brushed,
    });
  };
  const shaftMat = std(L.shaft, 'instrument:shaft');
  const steel = std(L.steel, 'instrument:steel');
  const white = std(L.white, 'instrument:white'); // same program as the others (uniforms only)
  const gauze = std(L.gauze, 'instrument:gauze');
  const cartridge = std({ ...L.accent, color: L.cartridge[0] }, 'instrument:cartridge');
  const cautery = std({ ...L.accent, color: L.cauteryTip }, 'instrument:cautery');
  cautery.emissive.set(L.accent.glowColor);
  cautery.emissiveIntensity = 0;
  const silicone = new MeshStandardMaterial({
    name: 'instrument:silicone',
    color: L.silicone.color,
    roughness: L.silicone.roughness,
    metalness: L.silicone.metalness,
    opacity: L.silicone.opacity,
    transparent: true, // fixed at load, never toggled
    depthWrite: false,
  });
  const cartridgeColors = L.cartridge.map((c) => new Color(c));

  // ── Handles (outside view), behind the shaft's proximal end at z = zP ──
  const H = G.handle;
  type HandleKind = 'ring' | 'scissor' | 'pencil';
  const handle = (bag: Bag, zP: number, y: number, kind: HandleKind): void => {
    const v = (x: number, yy: number, z: number): Vector3 => new Vector3(x, y + yy, zP + z);
    if (kind === 'scissor') {
      const S = H.scissor;
      put(bag, steel, cylZ(S.rod * 1.6, S.rod * 4, zP - S.rod * 4).translate(0, y, 0)); // box lock
      for (const s of [1, -1]) {
        const end = v(s * S.spread, 0, -S.length);
        put(bag, steel, rod(v(0, 0, -S.rod * 2), end, S.rod / 2));
        const ring = new TorusGeometry(S.ring, S.tube, seg / 2, seg * 1.5).rotateX(HALF_PI);
        put(bag, steel, ring.translate(end.x + s * S.ring * 0.8, end.y, end.z - S.ring * 0.6));
      }
      return;
    }
    if (kind === 'pencil') {
      const P = H.pencil;
      const r = P.radius;
      const lp: Pts = [
        [r * 0.3, zP - P.length],
        [r * 0.85, zP - P.length + 0.005],
        [r, zP - P.length * 0.6],
        [r * 1.08, zP - 0.03],
        [G.shaft.radius, zP],
      ];
      put(bag, shaftMat, lathe(lp).translate(0, y, 0));
      for (const b of P.buttons) {
        const g = new SphereGeometry(P.button, seg / 2, seg / 4).scale(1, 0.6, 1.8);
        put(bag, white, g.translate(0, y + r, zP - b));
      }
      return;
    }
    const K = H.knob;
    const B = H.body;
    const R = H.ring;
    const zK = zP - K.length;
    const kp: Pts = [
      [K.radius * 0.85, zK],
      [K.radius, zK + K.length * 0.2],
      [K.radius, zP - K.length * 0.3],
      [G.shaft.radius, zP],
    ];
    put(
      bag,
      shaftMat,
      lathe(kp, K.flutes).translate(0, y, 0),
      cylZ(B.radius, B.length, zK - B.length).translate(0, y, 0),
    );
    const zF = zK - B.length * 0.25;
    for (const [z0, dz] of [
      [zF, -R.rake],
      [zK - B.length * 0.9, -R.rake - R.spread],
    ] as const) {
      const a = v(0, 0, z0 - zP);
      const b = v(0, -R.drop, z0 - zP + dz);
      put(bag, shaftMat, rod(a, b, R.rod / 2));
      const ring = new TorusGeometry(R.radius, R.tube, seg / 2, seg * 1.5).rotateY(HALF_PI);
      put(bag, shaftMat, ring.translate(0, b.y - R.radius * 0.9, b.z));
    }
  };
  /** Laser-etched depth bands behind the shaft's distal end z1. */
  const bands = (bag: Bag, r: number, z1: number, y: number): void => {
    for (const [d, w] of G.bands)
      put(bag, white, cylZ(r + G.bandLift, w, z1 - d - w / 2, true).translate(0, y, 0));
  };
  interface StemOpt {
    shaft?: Material;
    ferrule?: Material;
    handle: HandleKind;
    bands?: boolean;
    nose?: number;
    length?: number;
  }
  /** Ferrule ending at the hinge z = zH (tapering to its nose), the 5 mm shaft behind it, bands, then the handle. */
  const stem = (bag: Bag, zH: number, y: number, o: StemOpt): void => {
    const h = G.hinge;
    const s = G.shaft;
    const len = o.length ?? h.length;
    const z1 = zH - len;
    const fp: Pts = [
      [s.radius, z1],
      [s.radius, z1 + len * 0.35],
      [o.nose ?? h.nose, zH],
    ];
    put(bag, o.ferrule ?? steel, lathe(fp).translate(0, y, 0));
    put(bag, o.shaft ?? shaftMat, cylZ(s.radius, s.length, z1 - s.length, true).translate(0, y, 0));
    if (o.bands ?? true) bands(bag, s.radius, z1, y);
    handle(bag, z1 - s.length, y, o.handle);
  };
  /** Hinge pin across the ferrule nose (axis 'x' jaws pivot about X, axis 'y' about Y). */
  const pin = (zH: number, y: number, axis: 'x' | 'y'): Geo => {
    const g = new CylinderGeometry(G.hinge.pin, G.hinge.pin, G.hinge.nose * 2.2, seg / 2);
    return (axis === 'x' ? g.rotateZ(HALF_PI) : g).translate(0, y, zH - G.hinge.pin);
  };
  /** Two jaw pivots at (0, y, zH): axis 'x' opens in ±Y, axis 'y' opens in ±X. `jaw(s)` returns side s's parts. */
  const jawPair = (
    tool: Tool,
    parent: Object3D,
    zH: number,
    y: number,
    open: number,
    axis: 'x' | 'y',
    jaw: (s: 1 | -1) => Geo[],
  ): Group[] =>
    ([1, -1] as const).map((s) => {
      const pivot = new Group();
      pivot.position.set(0, y, zH);
      parent.add(pivot);
      flush(new Map([[steel, jaw(s)]]), pivot);
      // 'x': rotation.x < 0 lifts +Z toward +Y; 'y': rotation.y > 0 swings +Z toward +X.
      tool.jaws.push({ pivot, axis, angle: ((axis === 'x' ? -s : s) * open) / 2 });
      return pivot;
    });
  const newTool = (id: ToolId): Tool => {
    const group = new Group();
    group.name = `instrument_${id}`;
    group.visible = false;
    return { group, jaws: [] };
  };
  const bag: Bag = new Map();

  // 2 · grasper: curved lung retractor blade (sub 0) or fenestrated ring clamp (sub 1, 02:36). Like the clamp, a long
  //     ring-handled forceps through the access incision (03:52 inset); the laparoscopic ring handle is the clip's.
  const grasper = newTool('grasper');
  const retractor = new Group();
  const ringHead = new Group();
  grasper.group.add(retractor, ringHead);
  {
    const r = G.retractor;
    const curve = new QuadraticBezierCurve3(
      new Vector3(0, -r.rise, -r.length),
      new Vector3(0, -r.rise, -r.length / 2),
      new Vector3(),
    );
    const sx = r.width / r.thick;
    put(bag, steel, tube(curve, r.segments, r.thick / 2).scale(sx, 1, 1));
    put(bag, steel, new SphereGeometry(r.thick / 2, seg, seg / 2).scale(sx, 1, 1)); // rounded blade end
    stem(bag, -r.length, -r.rise, { handle: 'scissor' });
    flush(bag, retractor);
  }
  {
    const c = G.ringClamp;
    const rx = c.ringRadius * c.ringAspect;
    const zc = c.jawLength - c.ringRadius;
    jawPair(grasper, ringHead, -c.jawLength, 0, c.open, 'x', (s) => {
      const shank = shape([
        [-c.jawWidth / 2, 0],
        [c.jawWidth / 2, 0],
        [c.jawWidth / 2, zc - c.ringRadius + c.rim],
        [-c.jawWidth / 2, zc - c.ringRadius + c.rim],
      ]);
      const ring = new Shape().absellipse(0, zc, rx, c.ringRadius, 0, 2 * Math.PI, false, 0);
      const n = 2 * c.teeth;
      const hole: Vector2[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 2 * Math.PI;
        const d = k % 2 ? c.toothDepth : 0; // toothed inner rim
        hole.push(new Vector2((rx - c.rim - d) * Math.cos(a), zc + (c.ringRadius - c.rim - d) * Math.sin(a)));
      }
      ring.holes.push(new Path(hole));
      const y = (s * c.jawThick) / 2;
      return [plate(shank, c.jawThick).translate(0, y, 0), plate(ring, c.jawThick, 12).translate(0, y, 0)];
    });
    put(bag, steel, pin(-c.jawLength, 0, 'x'));
    stem(bag, -c.jawLength, 0, { handle: 'scissor' });
    flush(bag, ringHead);
  }
  grasper.sub = (i) => {
    retractor.visible = i === 0;
    ringHead.visible = i === 1;
  };

  // 3 · sponge-stick: crumpled gauze ball in steel ring forceps
  const sponge = newTool('sponge');
  {
    const R = G.gauze.radius;
    put(bag, gauze, gauzeBall(G.gauze.crumple).scale(R, R, R).translate(0, 0, -R));
    for (const s of [1, -1])
      put(
        bag,
        steel,
        rod(new Vector3(0, 0, -2 * R - 0.004), new Vector3(0, s * R * 0.35, -R), G.hinge.pin * 1.6),
      );
    stem(bag, -2 * R, 0, { shaft: steel, handle: 'scissor', bands: false });
    flush(bag, sponge.group);
  }

  // 4 · peanut: elongated gauze swab gripped by a fixed clamp tip
  const peanut = newTool('peanut');
  {
    const p = G.peanut;
    const half = p.radius * p.elongation;
    put(bag, gauze, gauzeBall(p.crumple).scale(p.radius, p.radius, half).translate(0, 0, -half));
    for (const s of [1, -1]) {
      const jaw = shape([
        [-p.jawWidth / 2, 0],
        [p.jawWidth / 2, 0],
        [p.jawWidth / 3, p.jawLength - half],
        [-p.jawWidth / 3, p.jawLength - half],
      ]);
      put(bag, steel, plate(jaw, p.jawThick).translate(0, (s * p.jawThick) / 2, -p.jawLength));
    }
    stem(bag, -p.jawLength, 0, { shaft: steel, handle: 'scissor', bands: false });
    flush(bag, peanut.group);
  }

  // 5 · cautery (02:36): white insulated pencil shaft tapering to the L-hook wire, emissive glow while active
  const cauteryTool = newTool('cautery');
  {
    const c = G.cautery;
    const path = new CurvePath<Vector3>();
    path.add(new LineCurve3(new Vector3(0, 0, -c.tipLength - c.collar * 0.3), new Vector3(0, 0, -c.bend)));
    path.add(new QuadraticBezierCurve3(new Vector3(0, 0, -c.bend), new Vector3(), new Vector3(0, c.bend, 0)));
    path.add(new LineCurve3(new Vector3(0, c.bend, 0), new Vector3(0, c.hook, 0)));
    put(
      bag,
      cautery,
      tube(path, 24, c.wire, seg / 2),
      new SphereGeometry(c.wire, seg / 2, seg / 4).translate(0, c.hook, 0),
    );
    stem(bag, -c.tipLength, 0, {
      shaft: white,
      ferrule: white,
      bands: false,
      handle: 'pencil',
      nose: c.collarNose,
      length: c.collar,
    });
    flush(bag, cauteryTool.group);
  }

  // 6 · right-angle / Maryland clamp: tapered serrated jaws, 90° bend up to the tip, open sideways
  const clamp = newTool('clamp');
  {
    const c = G.rightAngle;
    const straight = c.jawLength - c.bendLength;
    const rb = c.bendRadius;
    const path = new CurvePath<Vector3>();
    path.add(new LineCurve3(new Vector3(), new Vector3(0, 0, straight - rb)));
    path.add(
      new QuadraticBezierCurve3(
        new Vector3(0, 0, straight - rb),
        new Vector3(0, 0, straight),
        new Vector3(0, rb, straight),
      ),
    );
    path.add(new LineCurve3(new Vector3(0, rb, straight), new Vector3(0, c.bendLength, straight)));
    const r = c.jawThick / 2;
    const sx = c.jawWidth / c.jawThick;
    jawPair(clamp, clamp.group, -straight, -c.bendLength, c.open, 'y', (s) => {
      const g = tube(path, 32, r, seg / 2 + 2, (t, off) => {
        let k = 1 - (1 - c.taper) * t;
        if (off.x * s < 0)
          k *= 1 - (c.serrationDepth * Math.abs(Math.sin(t * c.serrations * Math.PI)) * (-off.x * s)) / r;
        off.multiplyScalar(k);
      });
      const cap = new SphereGeometry(r * c.taper, seg / 2, seg / 4).translate(0, c.bendLength, straight);
      return [g, cap].map((p) => p.scale(sx, 1, 1).translate((s * c.jawWidth) / 2, 0, 0));
    });
    put(bag, steel, pin(-straight, -c.bendLength, 'y'));
    stem(bag, -straight, -c.bendLength, { handle: 'scissor' });
    flush(bag, clamp.group);
  }

  // 7 · stapler (03:36): black 12 mm shaft, articulating knuckle, steel channel + coloured split insert, opening
  //     anvil, curved tip (sub 0) / silicone leader (sub 1), pistol handle
  const stapler = newTool('stapler');
  {
    const s = G.stapler;
    const r = s.shaftRadius;
    const head = new Group();
    head.position.z = -s.headLength;
    head.rotation.y = s.articulation;
    stapler.group.add(head);
    const zJ = -s.headLength - s.jointLength;
    const zShaft = zJ - s.shaftLength;
    const kp: Pts = [
      [r, zJ],
      [r * 0.82, zJ + s.jointLength * 0.3],
      [r * 0.9, zJ + s.jointLength * 0.5],
      [r * 0.82, zJ + s.jointLength * 0.7],
      [r * 0.7, -s.headLength],
    ];
    put(bag, steel, lathe(kp));
    put(bag, shaftMat, cylZ(r, s.shaftLength, zShaft, true));
    bands(bag, r, zJ, 0);
    const P = G.handle.pistol;
    put(
      bag,
      shaftMat,
      cylZ(P.bodyRadius, P.bodyLength, zShaft - P.bodyLength),
      lathe([
        [P.bodyRadius, zShaft - 0.004],
        [r, zShaft],
      ]),
    );
    for (const o of [P.grip, P.trigger]) {
      const g = plate(
        shape(o.map(([yy, z]) => [yy, zShaft + z] as const)),
        P.thick * (o === P.grip ? 1 : 0.4),
      );
      put(bag, shaftMat, g.rotateZ(HALF_PI));
    }
    flush(bag, stapler.group);
    // Head (articulated): hinge drum, cartridge channel + insert.
    const hinge = new CylinderGeometry(r * 0.7, r * 0.7, s.cartridgeThick + s.anvilThick, seg);
    put(bag, steel, hinge.translate(0, (s.anvilThick - s.cartridgeThick) / 2, 0));
    put(
      bag,
      steel,
      extrudeZ(roundRect(s.jawWidth, s.cartridgeThick, s.corner, 0, -s.cartridgeThick / 2), s.headLength),
    );
    const insertW = s.jawWidth - 2 * s.insertInset;
    const strip = (insertW - s.knifeSlot) / 2;
    for (const k of [1, -1]) {
      const rr = roundRect(strip, s.insertInset, s.insertInset * 0.3, (k * (s.knifeSlot + strip)) / 2, 0);
      put(bag, cartridge, extrudeZ(rr, s.headLength - s.insertInset));
    }
    flush(bag, head);
    const anvil = new Group();
    head.add(anvil);
    const yA = s.insertInset / 2 + s.anvilThick / 2;
    put(bag, steel, extrudeZ(roundRect(s.jawWidth, s.anvilThick, s.corner, 0, yA), s.headLength));
    flush(bag, anvil);
    const tl = s.curvedTipLength;
    const tipCurve = new QuadraticBezierCurve3(
      new Vector3(0, yA, s.headLength - tl * 0.3),
      new Vector3(0, yA, s.headLength + tl * 0.5),
      new Vector3(0, yA - tl * Math.sin(s.curvedTipAngle), s.headLength + tl * Math.cos(s.curvedTipAngle)),
    );
    const end = tipCurve.getPoint(1);
    const sx = s.jawWidth / s.anvilThick;
    const tipGeo = [
      tube(tipCurve, 12, s.anvilThick / 2, seg, taper(0.5)),
      new SphereGeometry(s.anvilThick / 4, seg, seg / 2).translate(end.x, end.y, end.z),
    ].map((g) => g.scale(sx, 1, 1));
    const tip = new Mesh(merge(tipGeo), steel);
    const ld = s.leader;
    const leaderCurve = new CatmullRomCurve3(s.leaderCurve.map(([x, y, z]) => new Vector3(x, y, z)));
    const leader = new Mesh(
      new TubeGeometry(leaderCurve, ld.tubularSegments, ld.radius, ld.radialSegments),
      silicone,
    );
    leader.position.set(0, yA, s.headLength);
    anvil.add(tip, leader);
    stapler.jaws.push({ pivot: anvil, axis: 'x', angle: -s.open });
    stapler.sub = (i) => {
      tip.visible = i === 0;
      leader.visible = i === 1;
      cartridge.color.copy(cartridgeColors[i] ?? (cartridgeColors[0] as Color));
    };
  }

  // 8 · clip applier: tapered jaws holding the two legs of a titanium clip
  const clip = newTool('clip');
  {
    const c = G.clip;
    jawPair(clip, clip.group, -c.jawLength, 0, c.open, 'x', (s) => {
      const jaw = shape([
        [-c.jawWidth / 2, 0],
        [c.jawWidth / 2, 0],
        [c.jawWidth * 0.35, c.jawLength],
        [-c.jawWidth * 0.35, c.jawLength],
      ]);
      const leg = roundRect(c.clipWidth, c.clipLength, c.clipWidth / 3, 0, c.jawLength - c.clipLength / 2);
      return [
        plate(jaw, c.jawThick).translate(0, (s * c.jawThick) / 2, 0),
        plate(leg, c.clipThick).translate(0, (-s * c.clipThick) / 2, 0),
      ];
    });
    put(bag, steel, pin(-c.jawLength, 0, 'x'));
    stem(bag, -c.jawLength, 0, { handle: 'ring' });
    flush(bag, clip.group);
  }

  // 9 · sucker: steel cannula, tapered tip with an open lumen, side holes, pencil handle
  const sucker = newTool('sucker');
  {
    const c = G.sucker;
    const tr = c.tipRadius;
    const lu = tr * c.lumen;
    const tp: Pts = [
      [c.radius, -c.tipLength],
      [tr, -0.0012],
      [tr * 0.97, -0.0003],
      [tr * 0.85, 0],
      [lu * 1.05, -0.0001],
      [lu, -0.0008],
      [lu, -c.tipLength],
    ];
    put(bag, steel, lathe(tp), cylZ(c.radius, G.shaft.length, -c.tipLength - G.shaft.length, true));
    for (let i = 1; i <= c.holes; i++) {
      const hole = new CylinderGeometry(c.holeRadius, c.holeRadius, c.holeRadius / 2, seg / 2);
      put(bag, shaftMat, hole.translate(0, c.radius, -c.tipLength - i * c.holeSpacing));
    }
    handle(bag, -c.tipLength - G.shaft.length, 0, 'pencil');
    flush(bag, sucker.group);
  }

  const byId: Record<ToolId, Tool> = {
    grasper,
    sponge,
    peanut,
    cautery: cauteryTool,
    clamp,
    stapler,
    clip,
    sucker,
  };
  const root = new Group();
  root.name = 'instruments';
  const tools = {} as Record<ToolId, Group>;
  for (const id of TOOL_IDS) {
    tools[id] = byId[id].group;
    root.add(byId[id].group);
    byId[id].sub?.(0);
  }
  // Parts never move relative to their parent: bake matrices once. Tool roots and jaw pivots keep auto-update.
  root.traverse((o) => {
    if ((o as Mesh).isMesh) {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    }
  });

  let active: Tool | null = null;
  let activeId: ToolId | null = null;
  let jaw = 0;
  let glow = 0;
  const writeJaws = (t: Tool): void => {
    for (const j of t.jaws) j.pivot.rotation[j.axis] = j.angle * jaw;
  };

  return {
    root,
    tools,
    get active() {
      return activeId;
    },
    show(id, subOption = 0) {
      const t = (TOOL_IDS as readonly (string | null)[]).includes(id) ? byId[id as ToolId] : null;
      if (active && active !== t) active.group.visible = false;
      active = t;
      activeId = t ? (id as ToolId) : null;
      if (!t) return;
      t.group.visible = true;
      t.sub?.(subOption);
      writeJaws(t);
    },
    setJaw(open) {
      const v = Math.min(1, Math.max(0, open));
      if (v === jaw) return;
      jaw = v;
      if (active) writeJaws(active);
    },
    setGlow(g) {
      const v = Math.min(1, Math.max(0, g));
      if (v === glow) return;
      glow = v;
      cautery.emissiveIntensity = L.cauteryGlow * v;
    },
  };
}
