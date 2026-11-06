// Camera rig (CONTEXT §6.2 basics, §7.5): one rendered "viewCamera" whose pose/fov follows either a glTF step
// camera (scope view) or an OrbitControls camera (outside view), with an eased transition between any two poses.
// The scope headlight is a child of viewCamera, so it follows every pose. Per frame: no allocations.
import { Box3, DoubleSide, Matrix4, PerspectiveCamera, Quaternion, Ray, Raycaster, Vector3 } from 'three';
import type { Camera, IUniform, Mesh, Object3D } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshBVH } from 'three-mesh-bvh';
import { ANATOMY } from '../content/anatomy';
import { config } from '../core/config';
import type { Port } from '../sim/ports';
import { aimPose, SCOPE_RIG_CONFIG } from '../sim/scopeRig';
import { createState, ease, TWEEN_KEYS } from '../sim/state';
import { STEPS } from '../sim/steps';
import { setAmbientForView } from './lights';
import { buildMorphBindings, collectMorphMeshes, updateMorphs } from './morphs';

export type ViewMode = 'scope' | 'outside';

export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
  fov: number; // vertical, degrees
}

export const makePose = (): Pose => ({ position: new Vector3(), quaternion: new Quaternion(), fov: 0 });

/** out = a→b at t (lerp position/fov, slerp rotation). out may alias neither a nor b. */
export function lerpPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  out.position.lerpVectors(a.position, b.position, t);
  out.quaternion.slerpQuaternions(a.quaternion, b.quaternion, t);
  out.fov = a.fov + (b.fov - a.fov) * t;
  return out;
}

export function copyPose(out: Pose, src: Pose): Pose {
  out.position.copy(src.position);
  out.quaternion.copy(src.quaternion);
  out.fov = src.fov;
  return out;
}

const tmpScale = new Vector3();
/** World pose of a (static) camera. Load time. */
function worldPose(cam: PerspectiveCamera, out: Pose): Pose {
  cam.updateWorldMatrix(true, false);
  cam.matrixWorld.decompose(out.position, out.quaternion, tmpScale);
  out.fov = cam.fov;
  return out;
}

export interface CameraRig {
  /** Render this one. */
  camera: PerspectiveCamera;
  /** Mode in effect (switches at the transition midpoint). */
  mode: ViewMode;
  /** Mode being transitioned to (= mode when idle). */
  target: ViewMode;
  transitioning: boolean;
  /** Scope view looks through this glTF camera (smooth unless instant). */
  setScopeCamera(name: string, instant?: boolean): void;
  /** World pose of a glTF step camera (throws if unknown). */
  scopePoseOf(name: string): Readonly<Pose>;
  /** Replace (or add) the scope pose of a step camera name. Load time (aimStepPoses). */
  setScopePose(name: string, pose: Readonly<Pose>): void;
  /** Scope view follows `live` (the fulcrum scope rig writes it) instead of the glTF step poses. */
  followScope(live: Pose): void;
  /** Ease from the current pose to the scope target (after a jump of the live pose: port switch, reset, snap). */
  easeScope(): void;
  setView(mode: ViewMode, instant?: boolean): void;
  /** T843: the outside orbit camera stays outside these meshes (BVH on their geometry, built at load). */
  guardOrbit(body: readonly Mesh[]): void;
  update(now: number): void;
}

const gRay = new Ray();
const gInv = new Matrix4();
const gDir = new Vector3();
const gP = new Vector3();

/**
 * T843: the orbit camera may not sit inside the body: cast from `target` (inside `box`, the body bounds) toward
 * `cam` against every `body` layer; the farthest crossing is where that line finally leaves the body (a skin
 * window or port hole is covered by the deeper layers). A camera short of it + `margin` is moved out to it.
 * ponytail: a target panned outside `box` is unguarded (pan radius ≈ body size); per-ray check if that matters.
 * Rays only on orbit changes. True if moved.
 */
export function keepOutside(
  cam: Vector3,
  target: Vector3,
  body: readonly Mesh[],
  box: Box3,
  margin: number,
): boolean {
  if (!box.containsPoint(target)) return false;
  gDir.subVectors(cam, target);
  const dist = gDir.length();
  if (dist < 1e-9) return false;
  gDir.divideScalar(dist);
  let far = -1;
  for (const m of body) {
    const bvh = m.geometry.boundsTree as MeshBVH | undefined; // picking's MeshBVH (buildPickBVH)
    if (!bvh) continue;
    gInv.copy(m.matrixWorld).invert();
    gRay.origin.copy(target).applyMatrix4(gInv);
    gRay.direction.copy(gDir).transformDirection(gInv);
    // ponytail: raycast() allocates its hit list; fine at user-orbit rate (never per frame).
    for (const h of bvh.raycast(gRay, DoubleSide))
      far = Math.max(far, gP.copy(h.point).applyMatrix4(m.matrixWorld).distanceTo(target));
  }
  if (far < 0 || dist >= far + margin) return false;
  cam.copy(target).addScaledVector(gDir, far + margin);
  return true;
}

/**
 * `onMode` fires when the mode in effect changes (midpoint of a transition, or immediately when instant):
 * the caller swaps visibility sets there. uScopeMode (post-FX) is switched at the same moment.
 */
export function createCameraRig(
  camera: PerspectiveCamera,
  dom: HTMLElement,
  root: Object3D,
  gltfCameras: readonly Camera[],
  uScopeMode: IUniform<number>,
  onMode: (mode: ViewMode) => void,
): CameraRig {
  const C = config.camera;
  const S = config.scope;
  camera.name = 'viewCamera';

  // Outside view: OrbitControls drive a non-rendered camera; viewCamera follows it.
  const orbitCam = new PerspectiveCamera(C.fovDeg, camera.aspect, C.near, C.far);
  const box = new Box3().setFromObject(root);
  const center = box.getCenter(new Vector3());
  const dir = new Vector3(...config.viewer.viewDir).normalize();
  orbitCam.position.copy(center).addScaledVector(dir, config.viewer.distance);
  const controls = new OrbitControls(orbitCam, dom);
  controls.target.copy(center);
  controls.cursor.copy(center); // pan stays within maxTargetRadius of the thorax (inside the OT room)
  controls.maxTargetRadius = C.orbitMaxTargetRadius;
  controls.minDistance = C.orbitMinDistance;
  controls.maxDistance = C.orbitMaxDistance;
  controls.minPolarAngle = C.orbitMinPolarRad;
  controls.maxPolarAngle = C.orbitMaxPolarRad;
  controls.update();
  let body: readonly Mesh[] = [];
  const bodyBox = new Box3();
  controls.addEventListener('change', () => {
    if (body.length) keepOutside(orbitCam.position, controls.target, body, bodyBox, C.orbitGuard.marginM);
  });

  const scopePoses = new Map<string, Pose>();
  const look = new Matrix4();
  for (const c of gltfCameras) {
    if (!(c as PerspectiveCamera).isPerspectiveCamera) continue;
    const pose = worldPose(c as PerspectiveCamera, makePose());
    const fix = S.poseFix.find((f) => f.camera === c.name);
    if (fix) {
      pose.position.fromArray(fix.position);
      look.lookAt(pose.position, new Vector3().fromArray(fix.target), c.up);
      pose.quaternion.setFromRotationMatrix(look);
    }
    scopePoses.set(c.name, pose);
  }
  let scopePose = scopePoses.values().next().value ?? makePose();
  let scopeLive: Pose | null = null;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const from = makePose();
  const to = makePose();
  const cur = makePose();
  let start = -1; // -1 = start on the next update

  function targetPose(): Pose {
    if (rig.target === 'scope') return scopeLive ?? scopePose;
    to.position.copy(orbitCam.position);
    to.quaternion.copy(orbitCam.quaternion);
    to.fov = orbitCam.fov;
    return to;
  }

  function switchMode(mode: ViewMode): void {
    if (rig.mode === mode) return;
    rig.mode = mode;
    uScopeMode.value = mode === 'scope' ? 1 : 0;
    setAmbientForView(mode === 'scope');
    onMode(mode);
  }

  function begin(instant: boolean): void {
    controls.enabled = rig.target === 'outside';
    copyPose(from, cur);
    if (instant || reducedMotion || S.transitionMs <= 0) {
      rig.transitioning = false;
      switchMode(rig.target);
    } else {
      rig.transitioning = true;
      start = -1;
    }
  }

  const rig: CameraRig = {
    camera,
    mode: 'outside',
    target: 'outside',
    transitioning: false,
    setScopeCamera(name, instant = false) {
      scopePose = rig.scopePoseOf(name) as Pose;
      if (rig.target === 'scope') begin(instant);
    },
    scopePoseOf(name) {
      const pose = scopePoses.get(name);
      if (!pose) throw new Error(`Unknown step camera "${name}"`);
      return pose;
    },
    setScopePose(name, pose) {
      const p = scopePoses.get(name);
      if (p) copyPose(p, pose);
      else scopePoses.set(name, copyPose(makePose(), pose));
    },
    followScope(live) {
      scopeLive = live;
    },
    easeScope() {
      if (rig.target === 'scope') begin(false);
    },
    setView(mode, instant = false) {
      if (mode === rig.target && !instant) return;
      rig.target = mode;
      begin(instant);
    },
    guardOrbit(meshes) {
      body = meshes;
      bodyBox.makeEmpty();
      for (const m of meshes) bodyBox.expandByObject(m);
    },
    update(now) {
      const tgt = targetPose();
      if (rig.transitioning) {
        if (start < 0) start = now;
        const p = Math.min(1, (now - start) / S.transitionMs);
        if (p >= 0.5) switchMode(rig.target);
        lerpPose(cur, from, tgt, ease(p));
        if (p >= 1) rig.transitioning = false;
      } else {
        copyPose(cur, tgt);
      }
      camera.position.copy(cur.position);
      camera.quaternion.copy(cur.quaternion);
      const scope = rig.mode === 'scope';
      const near = scope ? S.near : C.near;
      const far = scope ? S.far : C.far;
      if (cur.fov !== camera.fov || near !== camera.near || far !== camera.far) {
        camera.fov = cur.fov;
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
      }
    },
  };
  copyPose(cur, targetPose());
  setAmbientForView(false); // the rig starts in the outside view
  return rig;
}

/**
 * T830 port-aimed step views (load time): for every step with `aimAtHilum`, pose the step camera at the lens of a
 * scope in the step's port aimed at the hilar target of the reference camera (config.scope.portAim): its view axis
 * raycast, in that step's morph pose, into the manifest hilum structures; image up = the reference camera's up.
 * Morph influences are restored (all zero state) afterwards; the frame loop's controller takes over from there.
 */
export function aimStepPoses(rig: CameraRig, model: Object3D, ports: readonly Port[]): void {
  const A = config.scope.portAim;
  let ref: Readonly<Pose>;
  try {
    ref = rig.scopePoseOf(A.reference);
  } catch {
    console.warn(`[cameras] reference camera "${A.reference}" missing: aimed steps keep their glTF cameras`);
    return;
  }
  const meshesOf = (names: readonly string[]): Mesh[] => {
    const out: Mesh[] = [];
    for (const n of names)
      model.getObjectByName(n)?.traverse((o) => {
        if ((o as Mesh).isMesh) out.push(o as Mesh);
      });
    return out;
  };
  model.updateMatrixWorld(true);
  const targets = meshesOf(A.targets);
  const fwd = new Vector3(0, 0, -1).applyQuaternion(ref.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(ref.quaternion);
  const ray = new Raycaster(ref.position, fwd);
  const bindings = buildMorphBindings(collectMorphMeshes(model));
  const pose = makePose();
  const target = new Vector3();
  const look = new Matrix4();
  const box = new Box3();
  const s = createState();
  const cfg = {
    ...SCOPE_RIG_CONFIG,
    aimDepthFrac: A.depthFrac,
    depthM: { ...SCOPE_RIG_CONFIG.depthM, default: A.maxDepthM },
  };
  for (const step of STEPS) {
    if (!step.aimAtHilum) continue;
    const fix = config.scope.poseFix.find((f) => f.camera === step.camera);
    if (fix) {
      // T846b: a fixed lens wins over the raycast aim; image up + fov as the other aimed steps.
      pose.position.fromArray(fix.position);
      pose.quaternion.setFromRotationMatrix(look.lookAt(pose.position, target.fromArray(fix.target), up));
      pose.fov = cfg.fovDeg;
      rig.setScopePose(step.camera, pose);
      continue;
    }
    const port = ports.find((p) => p.id === step.port);
    if (!port) {
      console.warn(`[cameras] step ${step.step}: port "${step.port}" missing`);
      continue;
    }
    for (const key of TWEEN_KEYS) s[key] = step.state[key] ?? 0;
    updateMorphs(bindings, s);
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) target.copy(hit.point);
    else target.copy(ref.position).addScaledVector(fwd, A.fallbackM);
    const tw = A.toward[step.step];
    if (tw) {
      box.makeEmpty();
      const own = Object.entries(ANATOMY.structures)
        .filter(([, x]) => x.divideStep === tw.of || x.clearStep === tw.of)
        .map(([n]) => n);
      for (const m of meshesOf(own)) box.expandByObject(m, true);
      if (!box.isEmpty()) target.lerp(box.getCenter(new Vector3()), tw.k);
    }
    if (aimPose(port, target, pose, cfg, up)) rig.setScopePose(step.camera, pose);
  }
  updateMorphs(bindings, createState());
}
