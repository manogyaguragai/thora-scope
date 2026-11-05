// Scripted perf:probe run (scripts/perf-probe.mjs → window.__sim.probeScript): every step camera through the scope,
// the fulcrum scope rig (pivot + zoom + optic), outside view, one-lung ventilation, the RML clamp test and the
// X-ray / opacity / cut-away variant swaps.
// Lazy chunk (dynamic import from main.ts): never in the initial bundle, never runs outside the probe.
import { FloatType, HalfFloatType, Matrix4, Quaternion, Texture, Vector3 } from 'three';
import type { Material, Mesh, Scene } from 'three';
import type { Port } from './ports';
import { config } from '../core/config';
import { SUB_IDS, TARGET_BY_ID } from '../content/targets';
import { SLOTS } from './hotbar';
import { STEPS } from './steps';

export interface ProbeResult {
  /** Estimated GPU memory of material + environment textures (RGBA texels × mip chain), MB. */
  textureMB: number;
}

const nextFrame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));

/** At least settleFrames rendered frames and one __perf sample period, so sampled stats are fresh. */
async function settle(): Promise<void> {
  const end = performance.now() + 1000 / config.perf.sampleHz;
  for (let n = 0; n < config.perf.probeSettleFrames || performance.now() < end; n++) await nextFrame();
}

function textureBytes(scene: Scene): number {
  const seen = new Set<Texture>();
  if (scene.environment) seen.add(scene.environment);
  scene.traverse((o) => {
    const m = (o as Mesh).material as Material | Material[] | undefined;
    for (const mat of Array.isArray(m) ? m : m ? [m] : [])
      for (const v of Object.values(mat)) if (v instanceof Texture) seen.add(v);
  });
  let bytes = 0;
  for (const t of seen) {
    const img = t.image as { width?: number; height?: number } | null;
    const texel = t.type === FloatType ? 16 : t.type === HalfFloatType ? 8 : 4; // decoded WebP / data → RGBA8
    bytes += (img?.width ?? 0) * (img?.height ?? 0) * texel * (t.generateMipmaps ? 4 / 3 : 1);
  }
  return bytes;
}

export async function runProbeScript(
  sim: Window['__sim'],
  scene: Scene,
  phase: (name: string) => void,
): Promise<ProbeResult> {
  const quiet = (): boolean =>
    sim.rig?.transitioning !== true &&
    sim.guided?.transitioning !== true &&
    Object.values(sim.state.tweens).every((t) => !t.active);
  // Phase '' while the change applies, so the previous view's stats aren't attributed to the next phase.
  const run = async (name: string, act: () => void | Promise<void>): Promise<void> => {
    phase('');
    await act();
    while (!quiet()) await nextFrame();
    await settle();
    phase(name);
    await settle();
  };
  for (const { step } of STEPS)
    await run(`scope-step${step}`, () => {
      sim.setStep(step, true);
      sim.setView('scope', true);
    });
  const m3 = sim.m3;
  if (m3)
    await run('scope-rig', () => {
      const R = config.scopeRig;
      m3.scope.drag(config.perf.probeDragPx, config.perf.probeDragPx);
      m3.scope.zoomBy(R.zoom.max);
      m3.scope.rotateOptic(R.opticStepDeg);
      m3.syncScope();
    });
  await run('outside', () => {
    sim.setStep(config.steps.defaultStep, true);
    sim.setView('outside', true);
  });
  await run('olv', sim.cmd.startOLV);
  await run('clamp', sim.cmd.clamp);
  const look = window.__look;
  if (look) {
    await run('xray', () => look.setXray(true));
    await run('opacity-cutaway', () => {
      look.setXray(false);
      look.setOpacity('pericardium', config.perf.probeOpacity);
      look.setCutaway([0, 0, -1], 0);
    });
    look.parkCutaway();
    look.setOpacity('pericardium', 1);
  }
  if (sim.m4) await m4Phases(sim, scene, run);
  phase('');
  return { textureMB: +(textureBytes(scene) / (1024 * 1024)).toFixed(1) };
}

const waitMs = async (ms: number): Promise<void> => {
  const end = performance.now() + ms;
  while (performance.now() < end) await nextFrame();
};

/** Surface vertex of node `name` (world) closest in angle to `port`'s axis: a reachable grasp / action point. */
function nearAxisPoint(scene: Scene, name: string, port: Port, out: Vector3): Vector3 | null {
  let best = -2;
  const v = new Vector3();
  const d = new Vector3();
  scene.getObjectByName(name)?.traverse((o) => {
    const pos = (o as Mesh).isMesh ? (o as Mesh).geometry.getAttribute('position') : undefined;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const c = d.subVectors(v, port.pleura).normalize().dot(port.axis);
      if (c > best) {
        best = c;
        out.copy(v);
      }
    }
  });
  return best > -2 ? out : null;
}

/** Aim the scope (same port, upright) at the placed tip `at`: lens config.perf.probeAimM short of it, viewing at
 *  least probeAimDeg off the tool shaft (toolPleura → at) so the tip and distal shaft are seen from the side, not
 *  end-on from inside the shaft when the scope shares the tool's port. */
function aimScope(sim: Window['__sim'], at: Vector3, toolPleura: Vector3): void {
  const m3 = sim.m3;
  if (!m3) return;
  const P = config.perf;
  const shaft = new Vector3().subVectors(at, toolPleura).normalize();
  const view = new Vector3().subVectors(at, m3.scope.port.pleura).normalize();
  const minRad = (P.probeAimDeg * Math.PI) / 180;
  if (view.angleTo(shaft) < minRad) {
    // Swing the view toward the ceiling (+Y, §7.1): the cavity above the tip is clear of the collapsed lung.
    const side = new Vector3(0, 1, 0).addScaledVector(shaft, -shaft.y);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    view.copy(shaft).multiplyScalar(Math.cos(minRad)).addScaledVector(side.normalize(), Math.sin(minRad));
  }
  const position = at.clone().addScaledVector(view, -P.probeAimM);
  const m = new Matrix4().lookAt(position, at, new Vector3(0, 1, 0)); // camera convention: looks down −Z
  const quaternion = new Quaternion().setFromRotationMatrix(m);
  m3.scope.snapTo({ position, quaternion, fov: m3.scope.fovDeg }, m3.scope.port.id);
  m3.syncScope();
}

/** Select tool `id` (+ sub-option id) on the hotbar and place its tip on `target` through the first port that
 *  works (P cycles the instrument's port), or only through `port` if given. Tries the target centroid, then the
 *  target's surface point nearest the port axis. On success the scope is aimed at the placed point so the tip is
 *  in frame (e2e screenshots). Returns the last snap verdict ('ok' when placed). */
export async function placeTool(
  sim: Window['__sim'],
  scene: Scene,
  id: string,
  target: string,
  sub?: string,
  port?: string,
): Promise<string> {
  const m3 = sim.m3;
  const m4 = sim.m4;
  if (!m3 || !m4) return 'not wired';
  const slot = SLOTS.findIndex((s) => s.id === id);
  if (m3.hotbar.slot !== slot) m3.hotbar.select(slot);
  const k = sub ? (SUB_IDS[id as keyof typeof SUB_IDS]?.indexOf(sub) ?? 0) : 0;
  for (let n = 0; n < (SLOTS[slot]?.subOptions.length ?? 0) && m3.hotbar.subOption() !== k; n++)
    m3.hotbar.select(slot);
  const centroid = new Vector3(...(TARGET_BY_ID.get(target)?.point ?? [0, 0, 0]));
  const near = new Vector3();
  let r = 'no port';
  let at = centroid;
  for (let n = 0; n < m3.scope.ports.length; n++) {
    const p = m3.scope.ports.find((q) => q.id === m4.occupancy.activePort);
    if (p && (!port || p.id === port)) {
      // Surface point facing the port first (the tip and shaft stay out of the tissue, in view), then the centroid.
      const surf = nearAxisPoint(scene, target, p, near);
      r = surf ? m4.snapTo(target, (at = surf)) : 'no-target';
      if (r !== 'ok') r = m4.snapTo(target, (at = centroid));
      if (r === 'ok' || port) break;
    }
    m4.nextToolPort();
  }
  const toolPort = m3.scope.ports.find((q) => q.id === m4.occupancy.activePort);
  if (r === 'ok' && toolPort) aimScope(sim, at, toolPort.pleura);
  while (m4.control.phase === 'inserting') await nextFrame();
  return r;
}

/** M4: every instrument shown, cautery smoke + fog, a vein staple fire (division plane + staple cap), the PiP
 *  inset and the hands in the outside view. Programs must not grow (all warmed during loading). */
async function m4Phases(
  sim: Window['__sim'],
  scene: Scene,
  run: (name: string, act: () => void | Promise<void>) => Promise<void>,
): Promise<void> {
  const { m3, m4 } = sim;
  if (!m3 || !m4) return;
  await run('m4-scope', () => {
    sim.setStep(3, true);
    sim.setView('scope', true);
    m4.pip.toggle(); // PiP inset on (scope view): the scene renders into its target every Nth frame
  });
  await run('m4-tools', async () => {
    for (let i = 1; i < SLOTS.length; i++) {
      m3.hotbar.select(i);
      for (let f = 0; f < config.perf.probeSettleFrames; f++) await nextFrame();
    }
  });
  await run('m4-cautery', async () => {
    await placeTool(sim, scene, 'cautery', 'hilar_connective_tissue');
    m4.press(true);
    await waitMs(config.perf.probeHoldMs);
    m4.press(false);
  });
  // Vein: clamp passage, scope out of the camera port, stapler in through it, fire → division plane + cap.
  await run('m4-staple', async () => {
    await placeTool(sim, scene, 'clamp', 'V_RML_common');
    m4.press(true);
    m4.press(false);
    m3.scope.switchPort('port_retraction_8ICS');
    m3.syncScope();
    await placeTool(sim, scene, 'stapler', 'V_RML_common', 'vascular-curved');
    m4.press(true);
    m4.press(false);
    await waitMs(config.staple.closeMs + config.staple.fireMs + config.staple.openMs);
  });
  await run('m4-outside-hands', () => sim.setView('outside', true));
  m4.pip.toggle();
}
