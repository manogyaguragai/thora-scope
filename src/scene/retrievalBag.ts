// T872 retrieval bag (step 8, ref 06:23): built ONCE at load from the instruments' materials (shaft, steel hoop and a
// milky pouch on the translucent silicone program), so it adds no program. `play(lobe, port, t)` is a pure function of
// t once a run is captured: the bag comes in through the port and its hoop opens, the lobe shrinks into the pouch, the
// mouth cinches and bag + lobe slide out through the port. Runtime = transform writes; nothing is allocated.
import {
  Box3,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { BufferGeometry, Camera, Material, MeshStandardMaterial, Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { retrievalBag as C } from './instruments.config';

export interface BagPort {
  /** Pivot: the shaft passes through it. */
  readonly pleura: Vector3;
}

export interface RetrievalBag {
  /** In the scene from load (compiled with it: wireM4 adds it to the effects group); hidden until played. */
  readonly group: Group;
  /** A run is captured (the lobe is the bag's until stop()). */
  readonly playing: boolean;
  /** Pose for progress t (0 → 1) of the bag run of `lobe` (node name) through `port` (port id): shaft in + hoop opens
   *  → lobe in → mouth closes → out through the port. The first call captures the lobe's transform. Per frame,
   *  allocation-free; false if the lobe or port is unknown. */
  play(lobe: string, port: string, t: number): boolean;
  /** Bag hidden, lobe transform restored (call after the bag action hid the lobe, on seek / reset). */
  stop(): void;
}

const smooth = (a: number, b: number, t: number): number => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** Load time: a closed surface seen from both sides on a front-side program (back copy, flipped winding + normals). */
function twoSided(g: BufferGeometry): BufferGeometry {
  const back = g.clone();
  const idx = back.getIndex();
  if (idx)
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
  const n = back.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  const out = mergeGeometries([g, back]);
  g.dispose();
  back.dispose();
  if (!out) throw new Error('retrievalBag: merge failed');
  return out;
}

const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _v = new Vector3();
const _c = new Vector3();
const _m = new Matrix4();
const _box = new Box3();
const _d = new Matrix4();
const _p = new Matrix4();

const CARRIES = 'carries';
/** Load time: the identity carrier group under `parent` for things that sit on lobe `lobe` and leave with it (distal
 *  stump pieces, the lobe side of the fissure staple rows); the bag moves it rigidly with the lobe. */
export function specimenCarrier(parent: Object3D, lobe: string): Group {
  const found = parent.children.find((c) => c.userData[CARRIES] === lobe);
  if (found) return found as Group;
  const g = new Group();
  g.name = `carrier_${lobe}`;
  g.userData[CARRIES] = lobe;
  g.matrixAutoUpdate = false;
  parent.add(g);
  return g;
}

/** Load time. `mats` = InstrumentSet.materials; `camera` orients the open mouth toward the lens. */
export function buildRetrievalBag(
  mats: { readonly shaft: Material; readonly steel: Material; readonly silicone: MeshStandardMaterial },
  camera: Camera,
  findNode: (name: string) => Object3D | null,
  findPort: (id: string) => BagPort | null,
): RetrievalBag {
  const R = C.hoop.radius;
  const D = C.pouch.depth;
  // Local frame (as the instruments): tip at the origin, +Z along the shaft toward the tip; the hoop opens in the XZ
  // plane in front of the tip and the pouch hangs toward −Y (the lens sits on +Y: it looks into the mouth).
  const hoop = new Mesh(
    new TorusGeometry(R, C.hoop.tube, C.segments.tube, C.segments.hoop)
      .rotateX(Math.PI / 2)
      .translate(0, 0, R),
    mats.steel,
  );
  const profile: Vector2[] = [];
  for (let i = C.pouch.rings; i >= 0; i--) {
    const a = (i / C.pouch.rings) * (Math.PI / 2); // quarter ellipse from the mouth (i = rings) to the closed bottom
    profile.push(new Vector2(R * Math.sin(a), -D * Math.cos(a)));
  }
  const pouchMat = mats.silicone.clone(); // same parameters → same program; colour / opacity are uniforms
  pouchMat.name = 'instrument:bag';
  pouchMat.color.set(C.look.color);
  pouchMat.opacity = C.look.opacity;
  pouchMat.roughness = C.look.roughness;
  const pouch = new Mesh(twoSided(new LatheGeometry(profile, C.segments.round).translate(0, 0, R)), pouchMat);
  // T890 (critic r2 C7): white plastic introducer like the pouch (06:20); brushed steel read as a ribbed tube.
  // (T884: the matte-black shaft material read as an unlit black slab.)
  const shaft = new Mesh(
    new CylinderGeometry(C.shaft.radius, C.shaft.radius, C.shaft.length, C.segments.round, 1, true)
      .rotateX(Math.PI / 2)
      .translate(0, 0, -C.shaft.length / 2),
    pouchMat,
  );
  pouch.renderOrder = 1; // after the lobe inside it
  const head = new Group();
  head.add(hoop, pouch);
  const group = new Group();
  group.name = 'retrieval_bag';
  group.add(shaft, head);
  group.visible = false;

  // Captured run.
  let lobe: Object3D | null = null;
  const p0 = new Vector3();
  const q0 = new Quaternion();
  const s0 = new Vector3();
  const centreL = new Vector3(); // lobe centre in its own frame
  const parentInv = new Matrix4();
  const entry = new Vector3(); // tip at the pleura
  const work = new Vector3(); // tip with the bag open beside the lobe
  const exit = new Vector3(); // tip outside the port
  const from = new Vector3(); // lobe centre (world) at capture
  const basis = new Quaternion();
  let fitScale = 1;
  const l0Inv = new Matrix4(); // lobe world matrix at capture, inverted
  const riders: Object3D[] = []; // its specimen carriers

  /** Carriers follow the lobe: C = P⁻¹ · Δ · P with Δ = L_now · L₀⁻¹ (world), P = the carrier's parent. */
  const carry = (node: Object3D, reset: boolean): void => {
    if (!reset) _d.multiplyMatrices(node.parent?.matrixWorld ?? _p.identity(), node.matrix).multiply(l0Inv);
    for (const r of riders) {
      if (reset) r.matrix.identity();
      else {
        _p.copy(r.parent?.matrixWorld ?? _m.identity());
        r.matrix.copy(_p).invert().multiply(_d).multiply(_p);
      }
      r.matrixWorldNeedsUpdate = true;
    }
  };

  /** Basis for a shaft along `dir` (normalised in place into _z): Y toward the lens (⊥ Z), X = Y × Z. */
  const aim = (pivot: Vector3, dir: Vector3): void => {
    _z.copy(dir).normalize();
    camera.getWorldPosition(_y).sub(pivot);
    _y.addScaledVector(_z, -_y.dot(_z));
    if (_y.lengthSq() < 1e-10) _y.set(0, 1, 0).addScaledVector(_z, -_z.y);
    _y.normalize();
    _x.crossVectors(_y, _z);
  };

  const capture = (name: string, portId: string): boolean => {
    const node = findNode(name);
    const port = findPort(portId);
    if (!node || !port) return false;
    lobe = node;
    p0.copy(node.position);
    q0.copy(node.quaternion);
    s0.copy(node.scale);
    node.updateWorldMatrix(true, true);
    l0Inv.copy(node.matrixWorld).invert();
    riders.length = 0;
    let top: Object3D = node;
    while (top.parent) top = top.parent;
    top.traverse((o) => {
      if (o.userData[CARRIES] === name) riders.push(o);
    });
    _box.setFromObject(node, true).getCenter(from); // morphed (collapsed) pose
    centreL.copy(from);
    node.worldToLocal(centreL);
    parentInv.copy(node.parent?.matrixWorld ?? _m.identity()).invert();
    fitScale = Math.min(1, (C.fit * R) / Math.max(1e-6, _box.getSize(_v).length() / 2));
    // The open pouch waits just port-side of the lobe; the shaft pivots in the port (as every instrument does).
    aim(port.pleura, _z.subVectors(from, port.pleura));
    work
      .copy(from)
      .addScaledVector(_z, -(R + C.standoffM))
      .addScaledVector(_y, D * C.lobeDepth);
    aim(port.pleura, _z.subVectors(work, port.pleura));
    entry.copy(port.pleura);
    exit.copy(port.pleura).addScaledVector(_z, -C.outM);
    basis.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    return true;
  };

  /** Lobe centre at world `at`, its scale × k (rotation kept). */
  const placeLobe = (node: Object3D, at: Vector3, k: number): void => {
    node.scale.copy(s0).multiplyScalar(k);
    _v.copy(centreL).multiply(node.scale).applyQuaternion(q0);
    node.position.copy(at).applyMatrix4(parentInv).sub(_v);
    node.updateMatrix();
    node.matrixWorldNeedsUpdate = true;
  };

  return {
    group,
    get playing() {
      return lobe !== null;
    },
    play(name, portId, t) {
      if (lobe && lobe.name !== name) this.stop();
      if (!lobe && !capture(name, portId)) return false;
      const node = lobe as Object3D;
      const P = C.phase;
      const eIn = smooth(0, P.open, t);
      const eOpen = smooth(P.open * C.openFrom, P.open, t);
      const eLobe = smooth(P.open, P.lobeIn, t);
      const eClose = smooth(P.lobeIn, P.close, t);
      const eOut = smooth(P.close, 1, t);
      group.visible = true;
      group.quaternion.copy(basis);
      if (eOut > 0) group.position.lerpVectors(work, exit, eOut);
      else group.position.lerpVectors(entry, work, eIn);
      const open = C.folded + (1 - C.folded) * eOpen;
      const mouth = 1 - (1 - C.closed) * eClose;
      head.scale.set(open * mouth, open, open * mouth);
      hoop.visible = eClose < 1;
      group.updateMatrixWorld(true);
      // Where the lobe sits in the pouch (world).
      head.localToWorld(_c.set(0, -D * C.lobeDepth, R));
      placeLobe(node, _c.lerpVectors(from, _c, eLobe), 1 + (fitScale * mouth - 1) * eLobe);
      carry(node, false);
      return true;
    },
    stop() {
      group.visible = false;
      if (!lobe) return;
      lobe.position.copy(p0);
      lobe.quaternion.copy(q0);
      lobe.scale.copy(s0);
      lobe.updateMatrix();
      lobe.matrixWorldNeedsUpdate = true;
      carry(lobe, true);
      lobe = null;
    },
  };
}
