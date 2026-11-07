// Step 4 — Lymph nodes 11R/12R (owner: author C). Video 2:17–3:04: ring clamp via the access incision; bed ooze +
// cautery coagulation (FEEDBACK §2.5 step 4).
// T866 (R9 port chain): scope in the low camera port, the lobe held through the access incision (both from step 3);
// the lower lobe hides the nodes from the posterior port (unoccluded 0). The holding grasper tilts the lobe into the
// fissure pose (as step 6), which opens the angle of the bronchus. 11R stays under the lower lobe edge from every
// port (unoccluded ≤ 0.15 from the low port), so it is seen as it comes out; the nodes are framed with the bronchus
// they sit on and the glow marks the node being taken. The bed is framed on the bronchus (the bed-point framing
// zooms the drop into a ball with no context).
import type { Subject, WalkStep } from '../types';
import { BR, CAM, RLL, RML, UTIL } from './ports';

const NODES: Subject = ['LN_11R', 'LN_12R'];
/** Framing: the nodes with the bronchus they sit on (11R alone is mostly under the lower lobe). */
const ANGLE: Subject = ['LN_11R', 'LN_12R', BR];
const NODE12: Subject = ['LN_12R', BR];
const BED: Subject = { bed: true };

export const step04: WalkStep = {
  step: 4,
  scopePort: CAM,
  beats: [
    {
      id: 'tension',
      kind: 'transition',
      act: { k: 'pose', key: 'retract_fissure', to: 1 },
      say: 'The grasper in the access incision tilts the lobe up and out, opening the angle beside the middle lobe bronchus.',
    },
    {
      id: 'nodes',
      kind: 'result',
      cam: { k: 'frame', subject: ANGLE },
      glow: NODES,
      say: 'Nodes 11R and 12R sit where the middle lobe bronchus branches off.',
    },
    {
      id: 'ring-in',
      kind: 'insert',
      act: { k: 'insert', tool: 'grasper', sub: 'ring', port: UTIL, target: ANGLE },
      say: 'Ring forceps come in through the access incision.',
    },
    {
      id: 'grasp-11r',
      kind: 'working',
      cam: { k: 'frame', subject: ANGLE },
      glow: 'LN_11R',
      ghost: [RLL], // T885a: 11R lies under the lower lobe edge: see it through the lobe while it is taken
      say: 'Node 11R hides under the edge of the lower lobe: the rings reach in beside the bronchus and close on it.',
    },
    {
      id: 'out-11r',
      kind: 'withdraw',
      act: { k: 'node', id: 'LN_11R' },
      ghost: [RLL],
      msg: 'Lymph node 11R sent for pathology',
      say: 'A gentle pull brings 11R out from under the lobe, and the forceps carry it out through the incision.',
    },
    {
      id: 'ring-in-2',
      kind: 'insert',
      act: { k: 'insert', tool: 'grasper', sub: 'ring', port: UTIL, target: NODE12 },
      say: 'The forceps go back in for node 12R.',
    },
    {
      id: 'grasp-12r',
      kind: 'working',
      cam: { k: 'frame', subject: NODE12 },
      glow: 'LN_12R',
      say: 'Node 12R lies on the bronchus wall; the rings close around it.',
    },
    {
      id: 'out-12r',
      kind: 'withdraw',
      act: { k: 'node', id: 'LN_12R' },
      // T892a: the scope eases back (wide) meanwhile, so the carry heads up toward the incision, clear of the side
      // dock (the close view sent it out under the dock's edge).
      cam: { k: 'wide', subject: NODE12, back: 0.03 },
      msg: 'Lymph node 12R sent for pathology',
      say: 'Teased off the bronchus, it is carried up and out through the access incision.',
    },
    {
      id: 'ooze',
      kind: 'result',
      act: { k: 'ooze' },
      cam: { k: 'frame', subject: BR, ms: 2000 },
      glow: null,
      ms: 6000,
      say: 'Small bronchial arteries fed the node: its bed now oozes dark blood.',
    },
    {
      id: 'cautery-in',
      kind: 'insert',
      act: { k: 'insert', tool: 'cautery', port: UTIL, target: BED }, // the bed (cautery is not a bronchus tool)
      say: 'The cautery hook goes straight to the bleeding point.',
    },
    {
      id: 'coagulate',
      kind: 'working',
      act: { k: 'coagulate' },
      cam: { k: 'frame', subject: BR },
      glow: null,
      say: 'A brief touch of energy, kept off the bronchus wall, stops the ooze.',
    },
    {
      id: 'cautery-out',
      kind: 'withdraw',
      act: { k: 'withdraw' },
      say: 'The bed is dry and the bronchus lies clear.',
    },
  ],
  end: {
    finish: { specimens: ['LN_11R', 'LN_12R'] },
    state: { retract_hilum: 1, retract_fissure: 1 },
    removed: ['LN_11R', 'LN_12R'],
    bedSealed: true,
    holds: [{ port: UTIL, target: RML, key: 'retract_fissure' }],
    scopePort: CAM,
  },
};
