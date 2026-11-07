// Step 9 — Irrigate, leak test, suction (owner: author E). Video 6:45–end. T844: the leak test is watched from above,
// through the saline surface, so the scope holds the authored step-9 view (lens ~11 mm into the camera port, ≥ 5 mm
// above the full saline line) while saline is in; the camera port sits above the water, the posterior port (the
// video's scope port at 6:46) below it. The sucker's push-in keeps the lens shallow (framing hint 's09:sucker-in').
import { waterConfig } from '../../../scene/water.config';
import type { WalkStep } from '../types';
import { ART, BR, CAM, RLL, UTIL, VEIN } from './ports';

const STUMPS = [VEIN, BR, ART] as const;
/** T892b: step 8's see-through lower lobe stays while saline is in, so the stumps under it read from this view. */
const GHOST = [RLL];
/** Long enough for the saline to fill from empty / drain from full (water.config rates, level units per second). */
const FILL_MS = Math.ceil(1000 / waterConfig.fillPerSec);
const DRAIN_MS = Math.ceil(1000 / waterConfig.drainPerSec);

export const step09: WalkStep = {
  step: 9,
  scopePort: CAM,
  beats: [
    {
      id: 'above',
      kind: 'transition',
      cam: { k: 'step' },
      ghost: GHOST,
      say: 'The scope settles high in the camera port, where the saline will not reach the lens.',
    },
    {
      id: 'irrigate',
      kind: 'working',
      act: { k: 'irrigate' },
      ms: FILL_MS,
      glow: STUMPS,
      ghost: GHOST,
      say: 'Warm saline fills the chest until the stumps are under water.',
    },
    {
      id: 'leak-test',
      kind: 'result',
      act: { k: 'ventilate', mode: 'two' },
      ms: 5000, // T893b: as the step-5 clamp test, long enough to see the lobes fill in the inset
      glow: BR,
      inset: 'lungs',
      msg: 'Leak test at ~20 cmH₂O: no bubbles',
      ghost: GHOST,
      say: 'Both lungs ventilated under saline (inset: the remaining lobes fill): no bubbles from the stumps, so no air leak.',
    },
    {
      id: 'olv',
      kind: 'transition',
      act: { k: 'ventilate', mode: 'one' },
      msg: 'One-lung ventilation resumed', // T892b: the newest message moves on from the leak-test result
      ghost: GHOST,
      say: 'Back to one-lung ventilation.',
    },
    {
      id: 'sucker-in',
      kind: 'insert',
      act: { k: 'insert', tool: 'sucker', sub: 'suction', port: UTIL, target: 'bronchial_tree' },
      ghost: GHOST,
      say: 'The sucker comes in through the access incision.',
    },
    {
      id: 'suction',
      kind: 'working',
      act: { k: 'suction' },
      cam: { k: 'step' },
      ms: DRAIN_MS,
      ghost: GHOST,
      say: 'Suction clears the saline from the field.',
    },
    {
      id: 'sucker-out',
      kind: 'withdraw',
      act: { k: 'withdraw' },
      cam: { k: 'step' }, // T893b: back to the readable saline view once the sucker is out
      ghost: GHOST,
      say: 'Sucker out: the field is dry and the case is complete.',
    },
  ],
  end: { finish: { fluidFilled: false, caseComplete: true }, state: {}, scopePort: CAM },
};
