// Step 5 — Bronchus + clamp test (owner: author C). Video 3:09–3:41: blunt clamp passage (R4), bronchial stapler,
// test ventilation before firing.
// T866 (R9 port chain): scope in the low port, lobe held through the access incision; the posterior port is the only
// one square to the bronchus (10° vs 44–59°), so the bronchial stapler comes through it (video: access incision).
// The blunt clamp uses the access incision as in the video. From the low port no lobe frames whole (probeFraming:
// RML off-axis, RUL hidden, RLL spills; the horizontal cleft flips the horizon), so the clamp test eases back from
// the closed stapler (same pose before and during the test breath, so the lobes can be seen swelling).
import type { WalkStep } from '../types';
import { ART, BR, CAM, POST, RML, UTIL, VEIN } from './ports';

/** T885b: the clamp-test overview eases this far back out of the closed-stapler view (cam 'wide'). */
const WIDE_BACK_M = 0.015;
/** T885b: framing subject: the bronchus with the vein stump in front and the artery behind it (the glow stays on the
 *  bronchus). From the low port the bronchus alone cannot be framed with the holding jaws in view (31° apart). */
const HILUM = [VEIN, BR, ART] as const;

export const step05: WalkStep = {
  step: 5,
  scopePort: CAM,
  beats: [
    {
      id: 'bronchus',
      kind: 'result',
      cam: { k: 'frame', subject: HILUM },
      glow: BR,
      say: 'With the nodes gone, the middle lobe bronchus is bare.',
    },
    {
      id: 'clamp-in',
      kind: 'insert',
      act: { k: 'insert', tool: 'clamp', port: UTIL, target: BR },
      say: 'A blunt curved clamp comes in through the access incision.',
    },
    {
      id: 'passage',
      kind: 'working',
      act: { k: 'sweep' },
      cam: { k: 'frame', subject: HILUM },
      glow: BR,
      say: 'Its jaws open and close behind the bronchus to make room for the stapler.',
    },
    {
      id: 'clamp-out',
      kind: 'withdraw',
      act: { k: 'withdraw' },
      say: 'The passage is open; the clamp comes out.',
    },
    {
      id: 'stapler-in',
      kind: 'insert',
      act: { k: 'insert', tool: 'stapler', sub: 'bronchial', port: POST, target: BR },
      say: 'A stapler with a thick-tissue bronchial reload follows the passage from the posterior port.',
    },
    {
      id: 'close',
      kind: 'working',
      act: { k: 'close' },
      cam: { k: 'frame', subject: HILUM },
      glow: BR,
      say: 'The jaws close across the bronchus. Nothing is cut yet.',
    },
    {
      id: 'overview',
      kind: 'result',
      cam: { k: 'wide', subject: HILUM, back: WIDE_BACK_M },
      glow: RML,
      inset: 'lungs',
      say: 'The scope eases back from the closed stapler. Inset: the middle lobe, from outside.',
    },
    {
      id: 'tlv',
      kind: 'result',
      act: { k: 'ventilate', mode: 'two' },
      cam: { k: 'wide', subject: HILUM, back: 0 }, // T885b: holds the overview's pulled-back pose during the breath
      glow: RML,
      inset: 'lungs',
      msg: 'Two-lung ventilation ON — clamp test',
      ms: 5000,
      say: 'Test breath: in the inset the upper and lower lobes fill; the middle lobe stays flat.',
    },
    {
      id: 'confirm',
      kind: 'transition',
      msg: 'Clamp test passed: the stapler holds the middle lobe bronchus only',
      ms: 1500,
      say: 'That proves the jaws hold the right airway.',
    },
    {
      id: 'olv',
      kind: 'transition',
      act: { k: 'ventilate', mode: 'one' },
      msg: 'One-lung ventilation resumed',
      say: 'Back to one-lung ventilation before firing.',
    },
    {
      id: 'fire',
      kind: 'working',
      act: { k: 'fire', target: BR },
      cam: { k: 'frame', subject: HILUM },
      glow: BR,
      say: 'Fire: staple lines seal both ends and the knife divides the bronchus between them.',
    },
    {
      id: 'stapler-out',
      kind: 'withdraw',
      act: { k: 'withdraw' },
      say: 'The stapler comes out.',
    },
    {
      id: 'stumps',
      kind: 'result',
      cam: { k: 'frame', subject: HILUM },
      glow: BR,
      say: 'Two stapled stumps: the airway side stays, the lobe side goes out with the specimen.',
    },
  ],
  end: {
    finish: { bronchusClamped: true, bronchusTestPassed: true, bronchusDivided: true },
    state: { retract_hilum: 1, retract_fissure: 1 },
    divided: [BR],
    holds: [{ port: UTIL, target: RML, key: 'retract_fissure' }],
    scopePort: CAM,
  },
};
