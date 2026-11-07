// Step 7 — Fissures (owner: author E). Video 5:14–6:11: scope in the low camera port (step 6 brought it back, R1), the
// retractor in the access incision lifts the lobe to open the fissures; content as today (dotted guide, 4 segments: 2
// horizontal, then 2 oblique after the underside check). On this model the guide segments lie 86–91° off the camera
// port's axis (outside its pivot cone), so each fire is framed on the lobe (horizontal, traced on its camera-facing
// hilar edge, R8) or on the lobe with the bronchial stump below it (oblique: [BR, RML]).
// T892b LIMIT (probe at seg-1): the stapler shaft meets the guide segments at 70°/72° (horizontal) and 65°/74°
// (oblique) from the posterior port, so with the head's 45° articulation the jaws sit ~20–29° off the line. The access
// incision lines up with the oblique segments (49°/15°) but fails the stapler approach rule on the middle lobe
// (targets.ts axis = horizontal-fissure normal: 50°/63° > 45°, "Poor stapler angle"); the camera port holds the scope
// and the segments lie 90° off its axis. Captions say the head turns as far as it can.
import type { WalkStep } from '../types';
import { BR, CAM, POST, RLL, RML, UTIL } from './ports';

const H = { fissure: 'horizontal' } as const;
const O = { fissure: 'oblique' } as const;
const VIEW = [BR, RML] as const;

export const step07: WalkStep = {
  step: 7,
  scopePort: CAM,
  beats: [
    {
      id: 'lift',
      kind: 'transition',
      act: { k: 'pose', key: 'retract_hilum', to: 0 },
      cam: { k: 'frame', subject: RML }, // T885b: framed once the lift has settled, so the lifted lobe is seen
      glow: RML,
      say: 'The retractor in the access incision lifts the middle lobe off the hilum, opening the fissures.',
    },
    {
      id: 'guide',
      kind: 'result',
      cam: { k: 'frame', subject: RML },
      glow: H,
      say: 'The dotted line marks the fissures still to divide; its left part is the horizontal fissure, where the middle lobe meets the upper lobe.',
    },
    {
      id: 'stapler-in',
      kind: 'insert',
      act: { k: 'insert', tool: 'stapler', sub: 'parenchyma', port: POST, target: RML },
      say: 'A powered lung-tissue stapler comes in through the posterior port.',
    },
    {
      id: 'seg-1',
      kind: 'working',
      act: { k: 'segment', port: POST },
      cam: { k: 'frame', subject: H },
      glow: H,
      say: 'The head turns as far as it can toward the dotted line; the jaws close on its first stretch and fire.',
    },
    {
      id: 'seg-2',
      kind: 'working',
      act: { k: 'segment', port: POST },
      cam: { k: 'frame', subject: H },
      glow: H,
      say: 'A second fire completes the horizontal fissure.',
    },
    {
      // T892b: the lens backs out first (the lower lobe still solid), so the move under the see-through lobe stays
      // shallow (a ghosted lobe does not block the framing path, and the lens ended up inside it).
      id: 'look-under',
      kind: 'transition',
      cam: { k: 'frame', subject: VIEW },
      say: 'The scope backs off to look under the lobe.',
    },
    {
      id: 'underside',
      kind: 'result',
      act: { k: 'set', finish: { undersideConfirmed: true } },
      cam: { k: 'frame', subject: BR },
      glow: BR,
      ghost: [RLL], // T892b probe: the lower lobe hides the stump from the camera port (0 → 0.78 unoccluded)
      say: 'A look under the middle lobe, through the lower lobe drawn see-through: the bronchial stump lies clear of the stapler jaws.',
    },
    {
      id: 'oblique',
      kind: 'result',
      cam: { k: 'frame', subject: VIEW }, // the band alone is outside the camera port's pivot cone
      glow: O,
      say: 'Now the oblique fissure, between the middle and lower lobes.',
    },
    {
      id: 'seg-3',
      kind: 'working',
      act: { k: 'segment', port: POST },
      cam: { k: 'frame', subject: VIEW },
      glow: O,
      say: 'Fire along the oblique fissure.',
    },
    {
      id: 'seg-4',
      kind: 'working',
      act: { k: 'segment', port: POST },
      cam: { k: 'frame', subject: VIEW },
      glow: O,
      say: 'The last fire: the middle lobe is free.',
    },
    {
      id: 'stapler-out',
      kind: 'withdraw',
      act: { k: 'withdraw' },
      say: 'Stapler out; the free lobe stays in the retractor.',
    },
  ],
  end: {
    finish: { fissureFires: 4, undersideConfirmed: true, lobeFree: true },
    state: { retract_hilum: 0, retract_fissure: 1 },
    fissureFires: 4,
    holds: [{ port: UTIL, target: RML, key: 'retract_fissure' }],
    scopePort: CAM,
  },
};
