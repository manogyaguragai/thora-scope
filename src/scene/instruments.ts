// Procedural instruments (CONTEXT §6.4, §8 Instruments): every tool is built ONCE at load and only shown/hidden
// afterwards (§6.10). T819: real VATS proportions — lathed ferrules, bevelled extruded jaws (toothed ring rims,
// serrated Maryland jaws, stapler channel/insert/anvil), tube-swept hooks and blades, crumpled gauze, handles for the
// outside view. Parts are merged at load into one geometry per tool part × material (few draw calls). Jaws animate by
// pivot rotation only. T841: powered stapler (steel shaft, coloured reload, white pistol), fine right-angle clamp
// opening in its bend plane, clip applier with a loaded clip; articulation / knife / clip via transforms only.
// T825: every opaque material binds the same three texture slots (instrumentTextures.ts, built
// at load) + one shared soil hook (uniforms only) → one opaque program + the translucent leader. No clipping planes.
// Local frame: tip at origin, +Z toward the tip.
import {
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  CurvePath,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LineCurve3,
  Mesh,
  MeshStandardMaterial,
  QuadraticBezierCurve3,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { BufferGeometry, Curve, Material, Object3D, WebGLProgramParametersWithUniforms } from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { instrumentGeom as G, instrumentLook as L, instrumentTex as T } from './instruments.config';
import { buildInstrumentTextures } from './instrumentTextures';
import type { TexSet } from './instrumentTextures';
import { getInstrumentEnv } from './lights';

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
  /** T825: blood/tissue soil on the steel tips or soak of the gauze swabs, 0 … 1 (uniform only). */
  setSoil(kind: 'steel' | 'gauze', amount: number): void;
  /** T841: stapler head articulation about the knuckle (rad, + swings the jaws toward +X). */
  setArticulation(rad: number): void;
  /** T841: stapler knife travel heel → tip, 0 … 1 (hidden outside (0, 1)). */
  setKnife(k: number): void;
  /** T841: the clip applier carries a clip (false once crimped on a vessel; reload = true). */
  setClipLoaded(on: boolean): void;
  /** T872: the load-built materials other procedural tools reuse (same programs, no new variants). */
  readonly materials: {
    readonly shaft: Material;
    readonly steel: Material;
    readonly silicone: MeshStandardMaterial;
  };
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
const UV = T.uvPerMetre;
const TAU = 2 * Math.PI;
const seg = G.radialSegments;
const tV = new Vector3(); // load-time temps
const tC = new Vector3();
const tQ = new Quaternion();
const UP = new Vector3(0, 1, 0);

// ── Load-time geometry helpers ──
const scaleUv = (g: Geo, ku: number = UV, kv: number = ku): Geo => {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ku, uv.getY(i) * kv);
  return g;
};
/** Surface of revolution about +Z from [radius, z] pairs ordered by z (normals point outward). */
/** UVs in metres × UV: u round the circumference, v along the profile (texture streaks run along the part). */
const lathe = (pts: Pts, n: number = seg): Geo => {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1] ?? [0, 0], pts[i] ?? [0, 0]];
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const g = new LatheGeometry(
    pts.map(([r, z]) => new Vector2(r, z)),
    n,
  );
  return scaleUv(g, TAU * Math.max(...pts.map(([r]) => r)) * UV, len * UV).rotateX(HALF_PI);
};
/** Cylinder along +Z, z ∈ [z0, z0 + len]. */
const cylZ = (r: number, len: number, z0: number, open = false): Geo =>
  scaleUv(new CylinderGeometry(r, r, len, seg, 1, open), TAU * r * UV, len * UV)
    .rotateX(HALF_PI)
    .translate(0, 0, z0 + len / 2);
/** Round rod from a to b. */
const rod = (a: Vector3, b: Vector3, r: number): Geo => {
  const len = tV.subVectors(b, a).length();
  tQ.setFromUnitVectors(UP, tV.normalize());
  tC.addVectors(a, b).multiplyScalar(0.5);
  return scaleUv(new CylinderGeometry(r, r, len, seg / 2), TAU * r * UV, len * UV)
    .applyQuaternion(tQ)
    .translate(tC.x, tC.y, tC.z);
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
  closed = false,
): Geo => {
  const g = new TubeGeometry(c, n, r, radial, closed);
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
  return scaleUv(g, TAU * r * UV, UV * c.getLength());
};
const taper = (k: number) => (t: number, off: Vector3) => off.multiplyScalar(1 - (1 - k) * t);
const UV_A = new Vector3(1, -1, 0).normalize(); // gauze planar UV axes (⊥ the (1,1,1) diagonal: no seam)
const UV_B = new Vector3(1, 1, -2).normalize();
/** Folded gauze swab (unit size): welded sphere, position-hashed lumps + |sin| fold creases (seam-free normals),
 *  diagonal planar UVs in metres for a swab of radius `r`. */
const gauzeBall = (amp: number, folds: number, r: number): Geo => {
  const base = new SphereGeometry(1, G.gauze.segments, G.gauze.segments * 0.75);
  base.deleteAttribute('uv');
  base.deleteAttribute('normal');
  const g = mergeVertices(base);
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    tV.fromBufferAttribute(pos, i);
    uv[2 * i] = tV.dot(UV_A) * r * UV;
    uv[2 * i + 1] = tV.dot(UV_B) * r * UV;
    const n =
      Math.sin(7 * tV.x + 1.3) * Math.sin(5 * tV.y + 0.7) * Math.sin(6 * tV.z + 2.1) +
      0.35 * Math.sin(19 * tV.x + 17 * tV.y - 15 * tV.z); // soft lumps + fine wrinkles
    const crease =
      Math.abs(Math.sin(4 * tV.x - 3 * tV.y + 0.4)) + Math.abs(Math.sin(3 * tV.z + 2 * tV.y + 1.9)) - 1.2;
    tV.multiplyScalar(1 + amp * n + folds * crease); // |sin| valleys = sharp fold lines
    pos.setXYZ(i, tV.x, tV.y, tV.z);
  }
  g.computeVertexNormals();
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
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

// T825 soil: blood/tissue mixed in over the map's alpha mask as `soilAmount` rises; soiled texels turn wet dielectric.
// One hook source for every opaque material (customProgramCacheKey = its text) → same program, per-material uniforms.
const SE = L.soil.edge.toFixed(3);
const SOIL_DECL = '#include <common>\nuniform float soilAmount;\nuniform vec3 soilColor;\nfloat soil = 0.0;';
const SOIL_MAP = `#include <map_fragment>
soil = smoothstep(sampledDiffuseColor.a, sampledDiffuseColor.a + ${SE}, soilAmount * (1.0 + ${SE}));
diffuseColor.rgb = mix(diffuseColor.rgb, soilColor, soil);`;
const SOIL_PBR = `#include <metalnessmap_fragment>
metalnessFactor *= 1.0 - soil;
roughnessFactor = mix(roughnessFactor, ${L.soil.roughness.toFixed(3)}, soil);`;
interface Soil {
  amount: { value: number };
  color: { value: Color };
}
const soilHook =
  (u: Soil) =>
  (p: WebGLProgramParametersWithUniforms): void => {
    p.uniforms.soilAmount = u.amount;
    p.uniforms.soilColor = u.color;
    p.fragmentShader = p.fragmentShader
      .replace('#include <common>', SOIL_DECL)
      .replace('#include <map_fragment>', SOIL_MAP)
      .replace('#include <metalnessmap_fragment>', SOIL_PBR);
  };

export function buildInstruments(): InstrumentSet {
  const tex = buildInstrumentTextures();
  const envMap = getInstrumentEnv();
  const soils = new Map<string, Soil>();
  const std = (
    p: { color: string; roughness: number; metalness: number; envMapIntensity?: number },
    name: string,
    set: TexSet,
    soil: { color: string; amount: number } = { color: L.soil.steel.color, amount: 0 },
  ): MeshStandardMaterial => {
    const { color, roughness, metalness, envMapIntensity = 1 } = p;
    const m = new MeshStandardMaterial({
      name,
      color,
      roughness,
      metalness,
      envMapIntensity,
      envMap, // T821: neutral env (lights.ts), so envMapIntensity applies
      ...set, // T825: map + roughnessMap + normalMap on every opaque material (fixed from load)
    });
    const u: Soil = { amount: { value: soil.amount }, color: { value: new Color(soil.color) } };
    soils.set(name, u);
    m.onBeforeCompile = soilHook(u);
    return m;
  };
  const shaftMat = std(L.shaft, 'instrument:shaft', tex.shaft);
  const steel = std(L.steel, 'instrument:steel', tex.steel, L.soil.steel);
  const white = std(L.white, 'instrument:white', tex.shaft); // same program as the others (uniforms only)
  const gauze = std(L.gauze, 'instrument:gauze', tex.gauze, L.soil.gauze);
  const cartridge = std({ ...L.accent, color: L.cartridge[0] }, 'instrument:cartridge', tex.cartridge);
  const cautery = std(
    { ...L.cauteryWire, color: L.cauteryTip },
    'instrument:cautery',
    tex.steel,
    L.soil.steel,
  );
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
    // T893a: dark insulated blade (the shaft's look), not bare steel
    put(bag, shaftMat, tube(curve, r.segments, r.thick / 2).scale(sx, 1, 1));
    put(bag, shaftMat, new SphereGeometry(r.thick / 2, seg, seg / 2).scale(sx, 1, 1)); // rounded blade end
    stem(bag, -r.length, -r.rise, { handle: 'scissor' });
    flush(bag, retractor);
  }
  {
    const c = G.ringClamp;
    const rx = c.ringRadius * c.ringAspect;
    const zc = c.jawLength - c.ringRadius;
    const n = 2 * c.teeth;
    const loop = new CatmullRomCurve3(
      Array.from({ length: n }, (_, k) => {
        const a = (k / n) * TAU - HALF_PI; // start at the shank end
        return new Vector3((rx - c.rim / 2) * Math.cos(a), 0, zc + (c.ringRadius - c.rim / 2) * Math.sin(a));
      }),
      true,
    );
    const flat = c.jawThick / c.rim;
    const bite = 1 - (2 * c.toothDepth) / c.jawThick;
    jawPair(grasper, ringHead, -c.jawLength, 0, c.open, 'x', (s) => {
      const shank = shape([
        [-c.jawWidth / 2, 0],
        [c.jawWidth / 2, 0],
        [c.jawWidth / 2, zc - c.ringRadius + c.rim / 2],
        [-c.jawWidth / 2, zc - c.ringRadius + c.rim / 2],
      ]);
      // Smooth oval loop of flattened round wire; every other ring pulled back on the clamping face (−s·Y only).
      const ring = tube(
        loop,
        n,
        c.rim / 2,
        c.radial,
        (t, off) => {
          off.y *= flat;
          if (off.y * s < 0 && Math.round(t * n) % 2) off.y *= bite;
        },
        true,
      );
      const y = (s * c.jawThick) / 2;
      return [plate(shank, c.jawThick).translate(0, y, 0), ring.translate(0, y, 0)];
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
    const g = G.gauze;
    const R = g.radius;
    const [sx, sy, sz] = g.shape;
    const Rz = R * sz;
    put(
      bag,
      gauze,
      gauzeBall(g.crumple, g.folds, R)
        .scale(R * sx, R * sy, Rz)
        .translate(0, 0, -Rz),
    );
    for (const s of [1, -1])
      put(
        bag,
        steel,
        rod(new Vector3(0, 0, -2 * Rz - 0.004), new Vector3(0, s * R * sy * 0.35, -Rz), G.hinge.pin * 1.6),
      );
    stem(bag, -2 * Rz, 0, { shaft: steel, handle: 'scissor', bands: false });
    flush(bag, sponge.group);
  }

  // 4 · peanut: elongated gauze swab gripped by a fixed clamp tip
  const peanut = newTool('peanut');
  {
    const p = G.peanut;
    const half = p.radius * p.elongation;
    put(
      bag,
      gauze,
      gauzeBall(p.crumple, G.gauze.folds, p.radius).scale(p.radius, p.radius, half).translate(0, 0, -half),
    );
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
    // T890 (critic r2 C4): only the bend + hook glow (cautery material); the straight shank is plain steel.
    put(
      bag,
      steel,
      tube(
        new LineCurve3(new Vector3(0, 0, -c.tipLength - c.collar * 0.3), new Vector3(0, 0, -c.bend)),
        8,
        c.wire,
        seg / 2,
      ),
    );
    const path = new CurvePath<Vector3>();
    path.add(new QuadraticBezierCurve3(new Vector3(0, 0, -c.bend), new Vector3(), new Vector3(0, c.bend, 0)));
    path.add(new LineCurve3(new Vector3(0, c.bend, 0), new Vector3(0, c.hook, 0)));
    put(
      bag,
      cautery,
      tube(path, 16, c.wire, seg / 2),
      new SphereGeometry(c.wire * 1.15, seg / 2, seg / 4).translate(0, c.hook, 0), // polished ball end
    );
    put(bag, white, cylZ(c.sheath, c.sheathLength, -c.tipLength)); // insulating sheath: a step down from the collar
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

  // 6 · right-angle vascular / bronchial clamp (T841): two fine nested jaws run along the shaft, bend 90° up (+Y) to
  //     the tip and open in the bend plane (about X at the hinge): the bent tips hook behind a vessel, close across it.
  const clamp = newTool('clamp');
  {
    const c = G.rightAngle;
    const R = c.bendRadius;
    const zH = -(c.reach + R);
    const yH = -(R + c.bendLength);
    const r = c.jawWidth / 2;
    const sy = c.jawThick / c.jawWidth;
    const tan = new Vector3();
    const nrm = new Vector3();
    jawPair(clamp, clamp.group, zH, yH, c.open, 'x', (s) => {
      const h = (s * c.jawThick) / 2; // + = inner jaw (inside of the bend)
      const path = new CurvePath<Vector3>();
      path.add(new LineCurve3(new Vector3(0, h, 0), new Vector3(0, h, c.reach)));
      path.add(
        new QuadraticBezierCurve3(
          new Vector3(0, h, c.reach),
          new Vector3(0, h, c.reach + R - h),
          new Vector3(0, R, c.reach + R - h),
        ),
      );
      path.add(
        new LineCurve3(new Vector3(0, R, c.reach + R - h), new Vector3(0, R + c.bendLength, c.reach + R - h)),
      );
      const g = tube(path, c.segments, r, seg / 2 + 2, (t, off) => {
        let k = 1 - (1 - c.taper) * t;
        // In-plane normal (tangent turned +90° about X): flatten the jaw to jawThick there; the face toward the
        // other jaw (−s side) is serrated.
        path.getTangentAt(t, tan);
        nrm.set(0, tan.z, -tan.y);
        const on = off.dot(nrm);
        off.addScaledVector(nrm, on * (sy - 1));
        if (-s * on > 0)
          k *= 1 - (c.serrationDepth * Math.abs(Math.sin(t * c.serrations * Math.PI)) * -s * on) / r;
        off.multiplyScalar(k);
      });
      const end = path.getPoint(1);
      const cap = new SphereGeometry(r * c.taper, seg / 2, seg / 4)
        .scale(1, sy, sy)
        .translate(end.x, end.y, end.z);
      return [g, cap];
    });
    put(bag, steel, pin(zH, yH, 'x'));
    stem(bag, zH, yH, { handle: 'scissor' });
    flush(bag, clamp.group);
  }

  // 7 · powered stapler (T841, user's reference photos): brushed-steel 12 mm shaft, dark ridged articulation knuckle,
  //     long jaws (steel anvil with a curved tapered tip / silicone leader, over a steel channel holding the coloured
  //     reload: staple-pocket deck + printed depth marks), a knife on the sled, white pistol handle + rotation knob.
  const stapler = newTool('stapler');
  const head = new Group();
  head.name = 'stapler_head';
  const S7 = G.stapler;
  const insertTop = S7.insertInset / 2;
  const knife = new Mesh(new BoxGeometry(S7.knife.thick, S7.knife.height, S7.knife.length), steel);
  knife.name = 'stapler_knife';
  {
    const s = S7;
    const r = s.shaftRadius;
    head.position.z = -s.headLength;
    head.rotation.y = s.articulation;
    stapler.group.add(head);
    const zJ = -s.headLength - s.jointLength;
    const zShaft = zJ - s.shaftLength;
    const kp: [number, number][] = [[r, zJ]];
    const step = s.jointLength / s.knuckleRidges;
    for (let i = 0; i < s.knuckleRidges; i++)
      kp.push(
        [r * 0.86, zJ + step * (i + 0.2)],
        [r * 0.98, zJ + step * (i + 0.5)],
        [r * 0.86, zJ + step * (i + 0.8)],
      );
    kp.push([r * 0.8, -s.headLength]);
    put(bag, steel, lathe(kp)); // T875: steel knuckle (the shaft's near-black read as a hole filling the view)
    put(bag, steel, cylZ(r, s.shaftLength, zShaft, true)); // brushed-steel shaft
    const P = G.handle.pistol;
    const K = P.knob;
    const zB = zShaft - K.length;
    put(
      bag,
      white,
      lathe(
        [
          [K.radius * 0.9, zB],
          [K.radius, zB + K.length * 0.2],
          [K.radius, zB + K.length * 0.75],
          [r * 1.1, zShaft],
        ],
        K.flutes,
      ),
      cylZ(P.bodyRadius, P.bodyLength, zB - P.bodyLength),
      new SphereGeometry(P.bodyRadius, seg, seg / 2).scale(1, 1, 0.6).translate(0, 0, zB - P.bodyLength),
    );
    for (const o of [P.grip, P.trigger]) {
      const g = plate(shape(o.map(([yy, z]) => [yy, zB + z] as const)), P.thick * (o === P.grip ? 1 : 0.4));
      put(bag, white, g.rotateZ(HALF_PI));
    }
    const g0 = P.grip[0] ?? [0, 0];
    put(
      bag,
      shaftMat,
      new SphereGeometry(P.button, seg / 2, seg / 4).translate(0, g0[0] - P.button, zB + g0[1]),
    );
    flush(bag, stapler.group);
    // Head (articulated): hinge drum, steel channel, coloured reload (plain body + nose, pocket deck, depth marks).
    const top = insertTop + s.jawGap + s.anvilThick; // anvil top above the deck mid-plane
    const hinge = new CylinderGeometry(r * 0.7, r * 0.7, s.cartridgeThick + top, seg);
    put(bag, steel, hinge.translate(0, (top - s.cartridgeThick) / 2, 0));
    const yBody = insertTop - s.cartridgeThick; // reload bottom
    const deckDrop = s.insertInset * 0.25; // the pocket deck stands this proud of the reload body
    put(
      bag,
      steel,
      extrudeZ(roundRect(s.jawWidth * 1.04, s.channelThick, s.corner / 2, 0, yBody), s.headLength),
    );
    const flatUv = (g: Geo): Geo => {
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, 0, 0); // a pocket-free texel: plain coloured plastic
      return g;
    };
    const bodyH = s.cartridgeThick - deckDrop;
    put(
      bag,
      cartridge,
      flatUv(extrudeZ(roundRect(s.jawWidth, bodyH, s.corner, 0, yBody + bodyH / 2), s.headLength)),
      flatUv(
        new SphereGeometry(1, seg, seg / 2)
          .scale(s.jawWidth / 2, bodyH / 2, s.nose)
          .translate(0, yBody + bodyH / 2, s.headLength),
      ),
    );
    const insertW = s.jawWidth - 2 * s.insertInset;
    const strip = (insertW - s.knifeSlot) / 2;
    for (const k of [1, -1]) {
      const xc = (k * (s.knifeSlot + strip)) / 2;
      const g = extrudeZ(
        roundRect(strip, s.insertInset, s.insertInset * 0.3, xc, 0),
        s.headLength - s.insertInset,
      );
      const [pos, uv] = [g.getAttribute('position'), g.getAttribute('uv')];
      for (let i = 0; i < uv.count; i++)
        // pocket texture: u across the strip, v = staple pitches along it
        uv.setXY(i, (pos.getX(i) - xc) / strip + 0.5, pos.getZ(i) / T.cartridge.pitch);
      put(bag, cartridge, g);
    }
    const M = s.marks;
    for (let k = 1; k * M.pitch < s.headLength; k++) {
      const len = k % M.longEvery ? M.short : M.long;
      for (const x of [1, -1]) {
        const tick = new BoxGeometry(M.lift * 2, len, M.width);
        put(
          bag,
          shaftMat,
          tick.translate(x * (s.jawWidth / 2 + M.lift), insertTop - deckDrop - len / 2, k * M.pitch),
        );
      }
    }
    flush(bag, head);
    knife.position.set(0, insertTop + s.jawGap - s.knife.height / 2, 0);
    knife.visible = false;
    head.add(knife);
    const anvil = new Group();
    head.add(anvil);
    const yA = insertTop + s.jawGap + s.anvilThick / 2;
    const aw = s.jawWidth * s.anvilWidth;
    put(bag, steel, extrudeZ(roundRect(aw, s.anvilThick, s.corner, 0, yA), s.headLength));
    flush(bag, anvil);
    const tl = s.curvedTipLength;
    const tipCurve = new QuadraticBezierCurve3(
      new Vector3(0, yA, s.headLength - tl * 0.3),
      new Vector3(0, yA, s.headLength + tl * 0.5),
      new Vector3(0, yA - tl * Math.sin(s.curvedTipAngle), s.headLength + tl * Math.cos(s.curvedTipAngle)),
    );
    const end = tipCurve.getPoint(1);
    const sx = aw / s.anvilThick;
    const tipGeo = [
      tube(tipCurve, 12, s.anvilThick / 2, seg, taper(0.45)),
      new SphereGeometry(s.anvilThick / 4.4, seg, seg / 2).translate(end.x, end.y, end.z),
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

  // 8 · clip applier: slim tapered jaws, each with a groove holding one leg of the loaded titanium clip
  const clip = newTool('clip');
  const clipLegs: Mesh[] = [];
  {
    const c = G.clip;
    const pivots = jawPair(clip, clip.group, -c.jawLength, 0, c.open, 'x', (s) => {
      const jaw = shape([
        [-c.jawWidth / 2, 0],
        [c.jawWidth / 2, 0],
        [c.jawWidth * 0.3, c.jawLength],
        [-c.jawWidth * 0.3, c.jawLength],
      ]);
      // Groove lips either side of the clip leg on the inner face.
      const lip = roundRect(
        c.jawWidth * 0.18,
        c.clipLength,
        c.jawWidth * 0.05,
        0,
        c.jawLength - c.clipLength / 2,
      );
      const y = (s * c.jawThick) / 2;
      const ly = -s * (c.groove / 2);
      const off = (c.clipWidth + c.jawWidth * 0.18) / 2;
      return [
        plate(jaw, c.jawThick).translate(0, y, 0),
        plate(lip, c.groove).translate(off, ly, 0),
        plate(lip, c.groove).translate(-off, ly, 0),
      ];
    });
    pivots.forEach((pv, k) => {
      const s = k === 0 ? 1 : -1;
      const leg = roundRect(c.clipWidth, c.clipLength, c.clipWidth / 3, 0, c.jawLength - c.clipLength / 2);
      const m = new Mesh(plate(leg, c.clipThick).translate(0, (-s * c.clipThick) / 2, 0), steel);
      m.name = 'clip_loaded';
      pv.add(m);
      clipLegs.push(m);
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
    materials: { shaft: shaftMat, steel, silicone },
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
    setArticulation(rad) {
      if (head.rotation.y !== rad) head.rotation.y = rad;
    },
    setKnife(k) {
      const on = k > 0 && k < 1;
      knife.visible = on;
      if (!on) return;
      const K = S7.knife;
      knife.position.z = K.length + k * (S7.headLength - 2 * K.length);
      knife.updateMatrix();
    },
    setClipLoaded(on) {
      for (const m of clipLegs) m.visible = on;
    },
    setSoil(kind, amount) {
      const v = Math.min(1, Math.max(0, amount));
      for (const name of kind === 'gauze'
        ? ['instrument:gauze']
        : ['instrument:steel', 'instrument:cautery']) {
        const u = soils.get(name);
        if (u) u.amount.value = v;
      }
    },
  };
}
