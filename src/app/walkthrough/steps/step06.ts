// Step 6 — Middle lobe arteries A4/A5 (owner: author D). Video 3:41–5:06: retraction swapped to the access incision,
// tunnel behind the arteries, vascular stapler (silicone leader) from the low port.
// T867b (R9 port chain): step 5 leaves the scope in the low camera port and the retractor held through the access
// incision with the lobe in the hilum + fissure pose, which uncovers the trunk and A5 (the lower lobe hides the
// arteries from the posterior port: unoccluded 0). Peanut and stapler come through the access incision, square to
// the artery (≈15° off perpendicular vs ≈32° low port; video: low port, occupied by the scope here). A4 stays
// partly under the lobe, so the framing subject is the trunk + A5 and the glow shows all three.
import type { Beat, Subject, WalkStep } from '../types';
import { ART, BR, CAM, RML, UTIL } from './ports';

const BRANCHES: Subject = [ART, 'middle_lobe_artery_A5'];
const GLOW: Subject = [ART, 'middle_lobe_artery_A4', 'middle_lobe_artery_A5'];
/** T885b: the Y split framed with its context, the divided bronchus in front (also keeps the holding jaws in view). */
const frame = { k: 'frame', subject: [...GLOW, BR] } as const;

const beats: Beat[] = [
  // T867b: no camera move on the first beat. Framing searched in the seek frame reads the rest-pose samples
  // (morphs not yet written) and misses the arteries (coverage 0); one short beat lets the pose settle.
  {
    id: 'held',
    kind: 'transition',
    ms: 800,
    glow: null,
    say: 'The lobe stays held up through the access incision; the scope looks from the low port.',
  },
  {
    id: 'arteries',
    kind: 'result',
    cam: frame,
    glow: GLOW,
    say: 'Only the artery still feeds the lobe: behind the divided bronchus it splits into its A4 and A5 branches.',
  },
  {
    id: 'peanut-in',
    kind: 'insert',
    act: { k: 'insert', tool: 'peanut', port: UTIL, target: BRANCHES },
    say: 'A peanut dissector comes in through the access incision.',
  },
  {
    id: 'tunnel',
    kind: 'working',
    act: { k: 'sweep' },
    cam: frame,
    glow: GLOW,
    say: 'Small sweeps lift the fascia off the arteries and open a tunnel behind both branches.',
  },
  {
    id: 'peanut-out',
    kind: 'withdraw',
    act: { k: 'withdraw' },
    say: 'The tunnel is ready; the peanut comes out.',
  },
  {
    id: 'stapler-in',
    kind: 'insert',
    act: { k: 'insert', tool: 'stapler', sub: 'vascular-leader', port: UTIL, target: BRANCHES },
    say: 'The vascular stapler follows a soft leader through the tunnel from the access incision.',
  },
  {
    id: 'fire',
    kind: 'working',
    act: { k: 'fire', target: ART },
    cam: frame,
    glow: GLOW,
    say: 'The head turns square across both branches; the jaws close and fire, sealing and cutting the artery.',
  },
  {
    id: 'stapler-out',
    kind: 'withdraw',
    act: { k: 'withdraw' },
    say: 'Stapler out: now only the fissures still hold the middle lobe.',
  },
];

export const step06: WalkStep = {
  step: 6,
  scopePort: CAM,
  beats,
  end: {
    finish: { arteryDivided: true },
    state: { retract_hilum: 1, retract_fissure: 1 },
    divided: [ART],
    holds: [{ port: UTIL, target: RML, key: 'retract_fissure' }],
    scopePort: CAM,
  },
};
