// Step 2 — Expose the hilum (owner: author A). Video 0:46–1:13: the scope moves to the posterior port, a retractor
// takes the lung through the former camera port, the mediastinal pleura is opened from the access incision (R1, R4).
// T864 (R1 conflict, flagged in PROGRESS): on this model the posterior-port lens rests on the collapsed lower lobe
// (hilum and middle lobe unoccluded 0 % from there, before and after the reflection), and the hilum is in clear view
// only from the low camera port. So the scope comes back to the camera port and the retractor works from the access
// incision, which also carries the hook (R1: a held retractor plus one working instrument) — the same set-up step 3
// works in.
import type { WalkStep } from '../types';
import { ART, BR, CAM, PLEURA, RML, UTIL, VEIN } from './ports';

const HILUM = [VEIN, ART, BR] as const;

export const step02: WalkStep = {
  step: 2,
  scopePort: UTIL,
  beats: [
    {
      id: 'scope-move',
      kind: 'transition',
      cam: { k: 'scopePort', port: CAM, subject: RML },
      say: 'The scope goes back to the low camera port. The middle lobe still lies across the front of the hilum.',
    },
    {
      id: 'grasper-in',
      kind: 'insert',
      act: { k: 'insert', tool: 'grasper', sub: 'retractor', port: UTIL, target: RML },
      say: 'A lung grasper comes in through the access incision and reaches over the middle lobe.',
    },
    {
      id: 'rml',
      kind: 'working',
      cam: { k: 'frame', subject: RML },
      say: 'Its jaws reach over the far edge of the middle lobe, just out of sight behind it.',
    },
    {
      id: 'grasp',
      kind: 'working',
      cam: { k: 'frame', subject: HILUM },
      act: { k: 'grasp', key: 'retract_hilum', to: 1, hold: true },
      glow: RML,
      ms: 2500,
      say: 'It takes hold of the middle lobe and draws the lung back, opening a window onto the hilum.',
    },
    {
      id: 'hilum',
      kind: 'result',
      cam: { k: 'frame', subject: HILUM },
      say: 'The hilum is in view: purple veins in front, the pale ringed bronchus between them, all still under the pleura. The grasper keeps the lung back from here on.',
    },
    {
      id: 'cautery-in',
      kind: 'insert',
      act: { k: 'insert', tool: 'cautery', port: UTIL, target: PLEURA },
      say: 'The hook cautery comes in through the same incision as the grasper.',
    },
    {
      id: 'pleura',
      kind: 'working',
      act: { k: 'sweep' },
      cam: { k: 'frame', subject: HILUM },
      glow: PLEURA,
      say: 'Short, light strokes open the mediastinal pleura over the hilum.',
    },
    { id: 'cautery-out', kind: 'withdraw', act: { k: 'withdraw' }, say: 'Pleura open: the hook comes out.' },
  ],
  end: {
    finish: {},
    state: { retract_hilum: 1 },
    holds: [{ port: UTIL, target: RML, key: 'retract_hilum' }],
    scopePort: CAM,
  },
};
