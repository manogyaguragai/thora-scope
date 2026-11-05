// Procedural instruments (CONTEXT §6.4, §8 Instruments): every tool is built ONCE at load from a handful of shared
// unit geometries + materials and only shown/hidden afterwards (§6.10). Jaws animate by pivot rotation only.
// Materials are plain MeshStandardMaterial without clipping planes (instruments are never cut away), so the whole set
// compiles to 2 programs (opaque + the translucent leader). Local frame: tip at origin, +Z toward the tip.
import {
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  QuadraticBezierCurve3,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
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

function std(
  p: { color: string; roughness: number; metalness: number; envMapIntensity?: number },
  name: string,
): MeshStandardMaterial {
  const { color, roughness, metalness, envMapIntensity = 1 } = p;
  return new MeshStandardMaterial({ name, color, roughness, metalness, envMapIntensity });
}

export function buildInstruments(): InstrumentSet {
  const seg = G.radialSegments;
  // Shared unit geometries: box/cylinder span z ∈ [0, 1] (centred in x/y) so parts are placed by scale + position.
  const box = new BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  const cyl = new CylinderGeometry(1, 1, 1, seg).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const sphere = new SphereGeometry(1, seg, seg / 2);
  const ring = new TorusGeometry(1, G.ringClamp.ringTube, seg / 2, seg).rotateX(Math.PI / 2); // flat in XZ
  const r = G.retractor;
  const blade = new TubeGeometry(
    new QuadraticBezierCurve3(
      new Vector3(0, -r.rise, -r.length),
      new Vector3(0, -r.rise, -r.length / 2),
      new Vector3(),
    ),
    r.segments,
    r.thick / 2,
    seg / 2,
  );
  const ld = G.stapler.leader;
  const leaderGeo = new TubeGeometry(
    new CatmullRomCurve3(G.stapler.leaderCurve.map(([x, y, z]) => new Vector3(x, y, z))),
    ld.tubularSegments,
    ld.radius,
    ld.radialSegments,
  );

  const shaftMat = std(L.shaft, 'instrument:shaft');
  const steel = std(L.steel, 'instrument:steel');
  const cauteryShaft = std(L.cauteryShaft, 'instrument:cautery-shaft'); // same program as the others (uniforms only)
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

  const part = (
    geo: BufferGeometry,
    mat: Material,
    parent: Object3D,
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
  ): Mesh => {
    const m = new Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  /** Steel hinge ending at z = zH plus the 5 mm shaft behind it (steel unless `mat` says otherwise). */
  const stem = (parent: Object3D, zH: number, y = 0, mat: Material = steel): void => {
    const h = G.hinge;
    const s = G.shaft;
    part(cyl, steel, parent, h.radius, h.radius, h.length, 0, y, zH - h.length);
    part(cyl, mat, parent, s.radius, s.radius, s.length, 0, y, zH - h.length - s.length);
  };
  /** Two jaw pivots at (0, y, zH): axis 'x' opens in ±Y, axis 'y' opens in ±X. Each holds a steel jaw box. */
  const jawPair = (
    tool: Tool,
    zH: number,
    y: number,
    len: number,
    w: number,
    t: number,
    open: number,
    axis: 'x' | 'y',
  ): [Group, Group] => {
    const out: Group[] = [];
    for (const s of [1, -1]) {
      const pivot = new Group();
      pivot.position.set(0, y, zH);
      tool.group.add(pivot);
      if (axis === 'x') part(box, steel, pivot, w, t, len, 0, (s * t) / 2, 0);
      else part(box, steel, pivot, w, t, len, (s * w) / 2, 0, 0);
      // 'x': rotation.x < 0 lifts +Z toward +Y; 'y': rotation.y > 0 swings +Z toward +X.
      tool.jaws.push({ pivot, axis, angle: ((axis === 'x' ? -s : s) * open) / 2 });
      out.push(pivot);
    }
    return out as [Group, Group];
  };
  const newTool = (id: ToolId): Tool => {
    const group = new Group();
    group.name = `instrument_${id}`;
    group.visible = false;
    return { group, jaws: [] };
  };

  // 2 · grasper: lung retractor blade (sub 0) or ring clamp (sub 1)
  const grasper = newTool('grasper');
  const retractor = new Group();
  const ringHead = new Group();
  grasper.group.add(retractor, ringHead);
  part(blade, steel, retractor, r.width / r.thick, 1, 1, 0, 0, 0);
  stem(retractor, -r.length, -r.rise);
  {
    const c = G.ringClamp;
    const head: Tool = { group: ringHead, jaws: grasper.jaws };
    const len = c.jawLength - 2 * c.ringRadius;
    for (const p of jawPair(head, -c.jawLength, 0, len, c.jawWidth, c.jawThick, c.open, 'x')) {
      part(ring, steel, p, c.ringRadius, c.ringRadius, c.ringRadius, 0, 0, c.jawLength - c.ringRadius);
    }
    stem(ringHead, -c.jawLength);
  }
  grasper.sub = (i) => {
    retractor.visible = i === 0;
    ringHead.visible = i === 1;
  };

  // 3 · sponge-stick: gauze ball
  const sponge = newTool('sponge');
  part(sphere, gauze, sponge.group, G.gauze.radius, G.gauze.radius, G.gauze.radius, 0, 0, -G.gauze.radius);
  stem(sponge.group, -2 * G.gauze.radius);

  // 4 · peanut: elongated gauze swab on a fixed clamp tip
  const peanut = newTool('peanut');
  {
    const p = G.peanut;
    const half = p.radius * p.elongation;
    part(sphere, gauze, peanut.group, p.radius, p.radius, half, 0, 0, -half);
    part(box, steel, peanut.group, p.jawWidth, p.jawThick, p.jawLength - half, 0, 0, -p.jawLength);
    stem(peanut.group, -p.jawLength);
  }

  // 5 · cautery: flat blade + hook, emissive glow while active
  const cauteryTool = newTool('cautery');
  {
    const c = G.cautery;
    part(box, cautery, cauteryTool.group, c.tipWidth, c.tipThick, c.tipLength, 0, 0, -c.tipLength);
    part(box, cautery, cauteryTool.group, c.tipWidth, c.hook, c.tipThick, 0, c.hook / 2, -c.tipThick);
    stem(cauteryTool.group, -c.tipLength, 0, cauteryShaft);
  }

  // 6 · right-angle clamp: straight jaws, 90° bend up to the tip, open sideways
  const clamp = newTool('clamp');
  {
    const c = G.rightAngle;
    const straight = c.jawLength - c.bendLength;
    const pivots = jawPair(clamp, -straight, -c.bendLength, straight, c.jawWidth, c.jawThick, c.open, 'y');
    pivots.forEach((p, i) => {
      const x = ((i === 0 ? 1 : -1) * c.jawWidth) / 2;
      part(box, steel, p, c.jawWidth, c.bendLength, c.jawThick, x, c.bendLength / 2, straight - c.jawThick);
    });
    stem(clamp.group, -straight, -c.bendLength);
  }

  // 7 · stapler: steel 12 mm shaft, joint, cartridge jaw + coloured insert, opening anvil, curved tip / leader
  const stapler = newTool('stapler');
  {
    const s = G.stapler;
    const head = new Group();
    head.position.z = -s.headLength;
    head.rotation.y = s.articulation;
    stapler.group.add(head);
    part(
      cyl,
      shaftMat,
      stapler.group,
      s.shaftRadius,
      s.shaftRadius,
      s.jointLength,
      0,
      0,
      -s.headLength - s.jointLength,
    );
    const zShaft = -s.headLength - s.jointLength - s.shaftLength;
    part(cyl, steel, stapler.group, s.shaftRadius, s.shaftRadius, s.shaftLength, 0, 0, zShaft);
    part(box, steel, head, s.jawWidth, s.cartridgeThick, s.headLength, 0, -s.cartridgeThick / 2, 0);
    const insertW = s.jawWidth - 2 * s.insertInset;
    part(box, cartridge, head, insertW, s.insertInset, s.headLength - s.insertInset, 0, 0, 0);
    const anvil = new Group();
    head.add(anvil);
    const yA = s.insertInset / 2 + s.anvilThick / 2;
    part(box, steel, anvil, s.jawWidth, s.anvilThick, s.headLength, 0, yA, 0);
    const tip = part(box, steel, anvil, s.jawWidth, s.anvilThick, s.curvedTipLength, 0, yA, s.headLength);
    tip.rotation.x = s.curvedTipAngle; // bends down past the cartridge
    const leader = part(leaderGeo, silicone, anvil, 1, 1, 1, 0, yA, s.headLength);
    stapler.jaws.push({ pivot: anvil, axis: 'x', angle: -s.open });
    stapler.sub = (i) => {
      tip.visible = i === 0;
      leader.visible = i === 1;
      cartridge.color.copy(cartridgeColors[i] ?? (cartridgeColors[0] as Color));
    };
  }

  // 8 · clip applier: jaws holding the two legs of a titanium clip
  const clip = newTool('clip');
  {
    const c = G.clip;
    for (const p of jawPair(clip, -c.jawLength, 0, c.jawLength, c.jawWidth, c.jawThick, c.open, 'x')) {
      part(box, steel, p, c.clipWidth, c.clipThick, c.clipLength, 0, 0, c.jawLength - c.clipLength);
    }
    stem(clip.group, -c.jawLength, 0, shaftMat);
  }

  // 9 · sucker: steel tube, narrow tip, side holes
  const sucker = newTool('sucker');
  {
    const c = G.sucker;
    part(cyl, steel, sucker.group, c.tipRadius, c.tipRadius, c.tipLength, 0, 0, -c.tipLength);
    part(cyl, steel, sucker.group, c.radius, c.radius, G.shaft.length, 0, 0, -c.tipLength - G.shaft.length);
    for (let i = 1; i <= c.holes; i++) {
      part(
        sphere,
        shaftMat,
        sucker.group,
        c.holeRadius,
        c.holeRadius,
        c.holeRadius,
        0,
        c.radius,
        -c.tipLength - i * c.holeSpacing,
      );
    }
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
