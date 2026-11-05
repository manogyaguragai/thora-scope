// Procedural gloved hands (CONTEXT §6.4 Gloved hands, §8): two low-poly grips (scope camera head, instrument handle)
// merged at load into one geometry each, ONE shared glove material (latex/nitrile = colour change only, §6.10).
// Hands follow target objects each frame allocation-free and render only in the outside view and the PiP inset —
// never in the scope view. T819: gloves hidden everywhere (GLOVES_SHOWN); only the scope body is drawn.
// Grip frame: handle axis = +Z (toward the tip, same as instruments.ts), palm on +X.
import {
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry, Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ViewMode } from './cameras';
import { config } from '../core/config';
import { instrumentGeom } from './instruments.config';

export const HANDS_CONFIG = config.hands; // values in src/core/config.ts
/** T819: the procedural gloves read as unrealistic, so they are never drawn (scope, outside or PiP); the instrument
 *  handles (instruments.ts) and the scope body carry the outside view. Gloves still follow their targets so they can
 *  return once a convincing hand model exists. ponytail: belongs in config.hands (config.ts owned elsewhere). */
export const GLOVES_SHOWN = false;

export type GloveKind = 'latex' | 'nitrile';
export type HandId = keyof typeof HANDS_CONFIG.hands;
/** 'pip' = the PiP inset render pass (hands shown even while the main view is the scope). */
export type HandsView = ViewMode | 'pip';

export interface Hands {
  /** Add to the scene directly (identity parent) and pass to registerWarmupObject(). */
  readonly root: Group;
  readonly material: MeshPhysicalMaterial;
  readonly meshes: Readonly<Record<HandId, Mesh>>;
  /** Swap glove colour (uniform values only, no recompile). */
  setGlove(kind: GloveKind): void;
  /** Object each hand holds (tip at origin, +Z toward the tip), or null to hide that hand. */
  setTarget(id: HandId, target: Object3D | null): void;
  /** Hidden in 'scope'; shown in 'outside' and 'pip'. */
  setView(view: HandsView): void;
  /** Per frame (allocation-free): copy each target's world pose into its hand. */
  update(): void;
}

const tM = new Matrix4();
const tQ = new Quaternion();
const tS = new Vector3();
const Y = new Vector3(0, 1, 0);

/** Load time: one merged grip geometry wrapping a handle along Z. */
function buildGrip(handleRadius: number, curlDeg: number): BufferGeometry {
  const H = HANDS_CONFIG.hand;
  const S = HANDS_CONFIG.segments;
  const parts: BufferGeometry[] = [];
  const place = (geo: BufferGeometry, pos: Vector3, dir: Vector3, scale?: Vector3): void => {
    tQ.setFromUnitVectors(Y, dir);
    parts.push(geo.applyMatrix4(tM.compose(pos, tQ, scale ?? tS.set(1, 1, 1))));
  };
  // Phalanges as capsules along an arc around the handle axis (angles from +X toward +Y).
  const arc = (r: number, z: number, startDeg: number, sweepDeg: number, n: number, radius: number): void => {
    const step = MathUtils.degToRad(sweepDeg / n);
    const len = Math.max(0, 2 * (handleRadius + radius) * Math.abs(Math.sin(step / 2)) - radius);
    for (let i = 0; i < n; i++) {
      const a = MathUtils.degToRad(startDeg) + step * (i + 0.5);
      const dir = new Vector3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(Math.sign(step));
      place(
        new CapsuleGeometry(radius, len, S.cap, S.radial),
        new Vector3(r * Math.cos(a), r * Math.sin(a), z),
        dir,
      );
    }
  };
  const F = H.finger;
  F.lengths.forEach((k, j) => {
    const z = (j - (F.lengths.length - 1) / 2) * F.spacing;
    arc(handleRadius + F.radius, z, F.startDeg, curlDeg * k, F.phalanges, F.radius * (F.radii[j] ?? 1));
  });
  const T = H.thumb;
  arc(handleRadius + T.radius, T.z, T.startDeg, T.curlDeg, T.phalanges, T.radius);
  // Palm: flattened sphere beside the handle; cuff (wrist) below it.
  const px = handleRadius + H.palm.thick / 2;
  const py = -H.palm.length * H.palm.drop;
  place(
    new SphereGeometry(1, S.radial, S.radial / 2),
    new Vector3(px, py, 0),
    Y,
    new Vector3(H.palm.thick / 2, H.palm.length / 2, H.palm.width / 2),
  );
  const C = H.cuff;
  place(
    new CylinderGeometry(C.radius, C.radius, C.length, S.radial),
    new Vector3(px, py - H.palm.length / 2 - C.length / 2 + C.radius / 2, 0),
    Y,
    new Vector3(C.flatten, 1, 1),
  );
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('hands: grip merge failed');
  merged.computeBoundingSphere();
  return merged;
}

export function buildHands(glove: GloveKind = HANDS_CONFIG.glove): Hands {
  const L = HANDS_CONFIG.look;
  const material = new MeshPhysicalMaterial({ name: 'hands:glove', ...L }); // opaque; fixed at load
  // ponytail: no transmission (extra scene pass) for fingertip translucency; sheen only. Fake it if the visual pass asks.
  const colors = {} as Record<GloveKind, { color: Color; sheenColor: Color }>;
  for (const k of Object.keys(HANDS_CONFIG.gloves) as GloveKind[]) {
    const g = HANDS_CONFIG.gloves[k];
    colors[k] = { color: new Color(g.color), sheenColor: new Color(g.sheenColor) };
  }
  const grips = {
    scope: buildGrip(HANDS_CONFIG.grips.scope.handleRadius, HANDS_CONFIG.grips.scope.curlDeg),
    tool: buildGrip(HANDS_CONFIG.grips.tool.handleRadius, HANDS_CONFIG.grips.tool.curlDeg),
  };

  const root = new Group();
  root.name = 'hands';
  root.visible = false; // outside view only; warm-up forces it visible
  root.matrixAutoUpdate = false;
  const slot = (id: HandId): { id: HandId; mesh: Mesh; offset: Matrix4; target: Object3D | null } => {
    const c = HANDS_CONFIG.hands[id];
    const mesh = new Mesh(grips[c.grip], material);
    mesh.name = `hands:${id}`;
    mesh.matrixAutoUpdate = false; // matrix = target.matrixWorld × offset (root stays identity)
    mesh.visible = false;
    root.add(mesh);
    const r = c.rotDeg.map((d) => MathUtils.degToRad(d));
    const offset = new Matrix4().compose(
      new Vector3(...c.position),
      new Quaternion().setFromEuler(new Euler(r[0], r[1], r[2])),
      new Vector3(c.mirror ? -1 : 1, 1, 1), // negative determinant: three.js flips the winding for us
    );
    return { id, mesh, offset, target: null };
  };
  const scope = slot('scope');
  const tool = slot('tool');
  // Scope body (shaft + camera head) in the scope target's frame; plain standard material = the instruments' program.
  const B = HANDS_CONFIG.scopeBody;
  const zHead = HANDS_CONFIG.hands.scope.position[2];
  const seg = instrumentGeom.radialSegments; // T819: round like the instrument shafts (glove count read faceted)
  const bodyGeo = mergeGeometries([
    new CylinderGeometry(B.shaftRadius, B.shaftRadius, -zHead, seg)
      .rotateX(Math.PI / 2)
      .translate(0, 0, zHead / 2),
    new CylinderGeometry(B.headRadius, B.headRadius, B.headLength, seg)
      .rotateX(Math.PI / 2)
      .translate(0, 0, zHead),
  ]);
  if (!bodyGeo) throw new Error('hands: scope body merge failed');
  const body = new Mesh(bodyGeo, new MeshStandardMaterial({ name: 'hands:scope-body', ...B.look }));
  body.name = 'hands:scope-body';
  body.matrixAutoUpdate = false;
  body.visible = false;
  root.add(body);
  const slots = [scope, tool];
  const meshes = { scope: scope.mesh, tool: tool.mesh };

  const hands: Hands = {
    root,
    material,
    meshes,
    setGlove(kind) {
      material.color.copy(colors[kind].color);
      material.sheenColor.copy(colors[kind].sheenColor);
    },
    setTarget(id, target) {
      for (const s of slots) if (s.id === id) s.target = target;
    },
    setView(view) {
      root.visible = view !== 'scope';
    },
    update() {
      for (const s of slots) {
        const t = s.target;
        s.mesh.visible = GLOVES_SHOWN && t !== null && t.visible;
        if (!t || !t.visible) continue;
        t.updateWorldMatrix(true, false);
        s.mesh.matrix.multiplyMatrices(t.matrixWorld, s.offset);
        s.mesh.matrixWorldNeedsUpdate = true;
      }
      body.visible = scope.target !== null && scope.target.visible;
      if (body.visible) {
        body.matrix.copy((scope.target as Object3D).matrixWorld);
        body.matrixWorldNeedsUpdate = true;
      }
    },
  };
  hands.setGlove(glove);
  return hands;
}
