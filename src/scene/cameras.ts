// Camera rig (CONTEXT §6.2 basics, §7.5): one rendered "viewCamera" whose pose/fov follows either a glTF step
// camera (scope view) or an OrbitControls camera (outside view), with an eased transition between any two poses.
// The scope headlight is a child of viewCamera, so it follows every pose. Per frame: no allocations.
import { Box3, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Camera, IUniform, Object3D } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { config } from '../core/config';
import { ease } from '../sim/state';
import { setAmbientForView } from './lights';

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
  /** Scope view follows `live` (the fulcrum scope rig writes it) instead of the glTF step poses. */
  followScope(live: Pose): void;
  /** Ease from the current pose to the scope target (after a jump of the live pose: port switch, reset, snap). */
  easeScope(): void;
  setView(mode: ViewMode, instant?: boolean): void;
  update(now: number): void;
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
  const radius = box.getSize(new Vector3()).length() / 2;
  const dist = (radius * config.viewer.frameMargin) / Math.sin((C.fovDeg * Math.PI) / 360);
  orbitCam.position.copy(center).addScaledVector(new Vector3(...config.viewer.viewDir).normalize(), dist);
  const controls = new OrbitControls(orbitCam, dom);
  controls.target.copy(center);
  controls.minDistance = C.orbitMinDistance;
  controls.maxDistance = C.orbitMaxDistance;
  controls.update();

  const scopePoses = new Map<string, Pose>();
  const look = new Matrix4();
  for (const c of gltfCameras) {
    if (!(c as PerspectiveCamera).isPerspectiveCamera) continue;
    const pose = worldPose(c as PerspectiveCamera, makePose());
    const fix = S.poseFix.find((f) => f.camera === c.name);
    if (fix) {
      pose.position.set(...fix.position);
      look.lookAt(pose.position, new Vector3(...fix.target), c.up);
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
