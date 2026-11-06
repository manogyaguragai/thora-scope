// T851 guided "Show me" demonstrations: timings and motion sizes (src/app/guidedDemo.ts). Pending visual tuning.
import { config } from '../core/config';

const S = config.staple;

export const guidedDemoConfig = {
  /** Instrument slide-in from its parked tip (just inside the port) to the target, along the shaft. */
  insertMs: 1500,
  /** Small tug toward the port after grasping a node, before it is withdrawn. */
  tugM: 0.012,
  tugMs: 700,
  /** Cautery / peanut sweep: back and forth over the target's surface, `spanM` long, through the placed point. */
  sweep: { spanM: 0.014, radiusM: 0.012, points: 16, passes: 2 },
  /** Stapler: close + fire + open, plus a margin before the jaws move on. */
  fireMs: S.closeMs + S.fireMs + S.openMs + 600,
  /** Longest wait for an instrument to land / a division to happen before the demo gives up. */
  timeoutMs: 8000,
  /** Beat duration when a script line gives none: one eased camera move plus a moment to look. */
  beatMs: config.scope.transitionMs + 700,
  /** Reach point on a target: up to `tries` of its vertices (the `topFrac` nearest in angle to the port → centre
   *  line) whose straight line from the port meets the target first (ray up to `beyondM` past the vertex). */
  reach: { tries: 48, topFrac: 0.5, beyondM: 0.002 },
  /** Camera aims: blend factors toward the step view's line of sight tried until the lens stays in the chest. */
  aimBlend: [0, 0.35, 0.7] as readonly number[],
  /** Lens start for the step-1 insertion: this far past the camera port's pleura. */
  scopeEntryM: config.scopeRig.depthM.min,
} as const;
