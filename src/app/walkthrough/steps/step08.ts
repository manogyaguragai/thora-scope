// Step 8 — Lobe out (owner: author E). Video 6:11–6:29: the retractor lets go and comes out (shown), a retrieval bag
// through the access incision takes the free lobe out. One-lung ventilation then carries on (the upper and lower
// lobes stay down) so the stumps can be checked and, in step 9, irrigated before the leak test. The bag beat keeps the
// framed lobe view (its subject leaves with the bag). T892b: the scope stays in the camera port (the only port above
// the saline line, step 9, T844): the lower lobe hides the stumps from there, so it is drawn see-through (ghost) from
// the stump check to the step's end (probe: camera port 0.69 unoccluded with the ghost; the access incision put the
// lens within 12 mm of tissue); the last beat eases the lens high (framing hint 's08:scope-back').
import type { WalkStep } from '../types';
import { ART, BR, CAM, RLL, RML, UTIL, VEIN } from './ports';

const STUMPS = [VEIN, BR, ART] as const;
/** The lower lobe, drawn see-through so the stumps behind it read from the camera port. */
const GHOST = [RLL];

export const step08: WalkStep = {
  step: 8,
  scopePort: CAM,
  beats: [
    {
      id: 'free',
      kind: 'transition',
      ms: 800,
      glow: RML,
      say: 'The middle lobe is free; the retractor still holds it.',
    },
    {
      id: 'lobe',
      kind: 'result',
      cam: { k: 'frame', subject: [BR, RML] },
      glow: RML,
      say: 'Ready to come out: the free middle lobe.',
    },
    {
      id: 'release',
      kind: 'withdraw',
      act: { k: 'release' },
      say: 'The retractor lets go and comes out of the access incision.',
    },
    {
      id: 'bag-in',
      kind: 'insert',
      act: { k: 'insert', tool: 'bag', port: UTIL, target: RML },
      ms: 5000, // T893b: the open bag stays in view after it comes in (the beat's middle shows it)
      say: 'A retrieval bag comes in through the access incision.',
    },
    {
      id: 'bag',
      kind: 'working',
      act: { k: 'bag' },
      glow: RML,
      say: 'The lobe goes into the bag, and the closed bag comes out through the incision.',
    },
    {
      id: 'stumps',
      kind: 'result',
      cam: { k: 'frame', subject: STUMPS },
      ghost: GHOST,
      say: 'A look at the stapled stumps left behind, through the lower lobe drawn see-through.',
    },
    {
      id: 'olv-upper',
      kind: 'transition',
      act: { k: 'pose', key: 'deflate_RUL', to: 1 },
      ghost: GHOST,
      say: 'One-lung ventilation carries on: the remaining lobes stay down for the final checks.',
    },
    {
      id: 'olv-lower',
      kind: 'transition',
      act: { k: 'pose', key: 'deflate_RLL', to: 1 },
      ghost: GHOST,
      say: 'One-lung ventilation carries on: the remaining lobes stay down for the final checks.',
    },
    {
      id: 'scope-back',
      kind: 'transition',
      cam: { k: 'frame', subject: STUMPS },
      ghost: GHOST,
      say: 'The scope eases back high in the camera port, above where the saline will settle.',
    },
  ],
  end: {
    finish: { lobeRemoved: true, specimens: ['LN_11R', 'LN_12R', RML] },
    state: { retract_hilum: 0, retract_fissure: 0, deflate_RUL: 1, deflate_RLL: 1 },
    scopePort: CAM,
  },
};
