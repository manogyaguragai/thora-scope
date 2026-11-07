// T863: warm-up cameras at every walkthrough beat's key pose (scope port → the beat's subject), rendered in loading
// stage 5 (registerWarmupView) so no step's first frame is a first draw. Load time only (allocates freely).
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { Subject, WalkStep } from '../app/walkthrough/types';
import { config } from '../core/config';
import type { Port } from '../sim/ports';

const names = (s: Subject): readonly string[] =>
  typeof s === 'string' ? [s] : Array.isArray(s) ? (s as readonly string[]) : [];

/** One camera per distinct (scope port, node-name subject) of the steps' cam beats: lens `depthM.default` past
 *  the pleura along the port axis, looking at the subject's bbox centre. Unknown ports / nodes are skipped. */
export function beatWarmupViews(
  steps: readonly WalkStep[],
  ports: readonly Port[],
  model: Object3D,
  base: PerspectiveCamera,
): PerspectiveCamera[] {
  const seen = new Set<string>();
  const out: PerspectiveCamera[] = [];
  const box = new Box3();
  const part = new Box3();
  model.updateMatrixWorld(true);
  for (const step of steps) {
    let portId: string = step.scopePort;
    for (const beat of step.beats) {
      const cam = beat.cam;
      if (!cam) continue;
      if (cam.k === 'scopePort') portId = cam.port;
      if (cam.k === 'step') continue; // the authored glTF step cameras are warmed up already
      const subj = names(cam.subject);
      const key = `${portId}|${subj.join(',')}`;
      const port = ports.find((p) => p.id === portId);
      if (!port || subj.length === 0 || seen.has(key)) continue;
      seen.add(key);
      box.makeEmpty();
      for (const n of subj) {
        const o = model.getObjectByName(n);
        if (o) box.union(part.setFromObject(o));
      }
      if (box.isEmpty()) continue;
      const c = new PerspectiveCamera().copy(base, false); // not its headlight child
      c.position.copy(port.pleura).addScaledVector(port.axis, config.scopeRig.depthM.default);
      c.lookAt(box.getCenter(new Vector3()));
      c.updateMatrixWorld(true);
      out.push(c);
    }
  }
  return out;
}
