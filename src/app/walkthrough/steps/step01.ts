// Step 1 — Inspect (owner: author A). Parts advance on Next (pause beats). FEEDBACK_GUIDED_v1 §2.5, R7 outcome:
// full collapse; parts the scope cannot see are shown through ghosted occluding lobes (Beat.ghost) with the glow on the
// part. T864 (R1 conflict, in PROGRESS): from the low camera port alone no part frames whole, so the scope moves between
// the camera port and the access incision; it ends in the access incision, where step 2 picks it up.
// T877: the upper lobe and the oblique fissure stay hidden from every port even through ghosts (R7 outcome), so those
// parts glow in the outside-view inset (Beat.inset) while the scope keeps its best inside view, the middle-lobe view
// from the camera port (the lower lobe's edge on its left is the oblique fissure margin); captions say so.
// T885a (critic r1): the horizontal fissure follows the same inset pattern (band glow, no ghost wash); the lower lobe
// glows in the middle-lobe view (from every port its own framing is lens-on-lobe); the phrenic nerve has no ghost.
import type { WalkStep } from '../types';
import { CAM, PHRENIC, RLL, RML, RUL, UTIL } from './ports';

const H = { fissure: 'horizontal' } as const;
const O = { fissure: 'oblique' } as const;

export const step01: WalkStep = {
  step: 1,
  scopePort: CAM,
  beats: [
    {
      id: 'rul',
      kind: 'working',
      pause: true,
      cam: { k: 'scopePort', port: CAM, subject: RML },
      glow: RUL,
      inset: 'lungs',
      say: "Upper lobe, seen from outside (inset). Collapsed, it lies behind the middle lobe (pale, in front) and the lower lobe, out of the scope's sight.",
    },
    {
      id: 'rml',
      kind: 'working',
      pause: true,
      cam: { k: 'scopePort', port: CAM, subject: RML },
      say: 'The middle lobe, the small wedge in front: this is the lobe the operation removes.',
    },
    {
      id: 'rll',
      kind: 'working',
      pause: true,
      cam: { k: 'scopePort', port: CAM, subject: RML },
      glow: RLL,
      say: 'The lower lobe, the largest, now fills the view (a faint glow along its edge); it rests back on the diaphragm.',
    },
    {
      id: 'horizontal',
      kind: 'working',
      pause: true,
      cam: { k: 'scopePort', port: CAM, subject: RML },
      glow: H,
      inset: 'lungs',
      say: 'Horizontal fissure, seen from outside (inset): the cleft between the upper and the middle lobe. Inside, it lies hidden behind the middle lobe.',
    },
    {
      id: 'oblique',
      kind: 'working',
      pause: true,
      cam: { k: 'scopePort', port: CAM, subject: RML },
      glow: O,
      inset: 'lungs',
      say: 'Oblique fissure, seen from outside (inset): it runs down and back between the middle and lower lobes. Inside, only its edge shows.',
    },
    {
      id: 'phrenic',
      kind: 'working',
      pause: true,
      cam: { k: 'scopePort', port: UTIL, subject: PHRENIC },
      say: 'The phrenic nerve runs down over the pericardium in front of the hilum. It is kept safe throughout.',
    },
  ],
  end: { finish: {}, state: {}, scopePort: UTIL },
};
