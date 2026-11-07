// Step 3 — Middle lobe vein (owner: author B). Video 1:13–2:17: strands + peanut via the access incision, retraction
// swap to the access incision, curved-tip vascular stapler.
// R9 port chain (T865b): step 2 leaves the scope in the low camera port and the retractor held in the access incision;
// cautery and peanut share the access incision with it; the vein stapler comes through the posterior port, the only
// one square to the vein (10° vs 50°; video: low port — flagged in PROGRESS). The scope stays in the low port.
import type { WalkStep } from '../types';
import { CAM, POST, RML, STRANDS, UTIL, VEIN } from './ports';

export const step03: WalkStep = {
  step: 3,
  scopePort: CAM,
  beats: [
    {
      id: 'hold',
      kind: 'result',
      // Vein with the held lobe: the access-incision grasper on the reflected lobe is in the frame too.
      cam: { k: 'frame', subject: [VEIN, RML] },
      glow: VEIN,
      say: 'The lung stays held back and the hilum lies open below it: fine pale strands still tie the middle lobe vein down.',
    },
    {
      id: 'cautery-in',
      kind: 'insert',
      act: { k: 'insert', tool: 'cautery', port: UTIL, target: STRANDS },
      say: 'The hook cautery comes in through the access incision, beside the grasper.',
    },
    {
      id: 'strands',
      kind: 'working',
      act: { k: 'sweep' },
      // The strands wrap the hilar vessels (≈ 80 % of their samples lie behind them from any port): frame the vein
      // they cover, glow the strands.
      cam: { k: 'frame', subject: VEIN },
      glow: STRANDS,
      say: 'Short, light strokes divide the strands over the vein, a little at a time.',
    },
    { id: 'cautery-out', kind: 'withdraw', act: { k: 'withdraw' }, say: 'The hook comes out.' },
    {
      id: 'peanut-in',
      kind: 'insert',
      act: { k: 'insert', tool: 'peanut', port: UTIL, target: VEIN },
      say: 'A peanut swab comes in beside the vein.',
    },
    {
      id: 'peanut',
      kind: 'working',
      act: { k: 'sweep' },
      cam: { k: 'frame', subject: VEIN },
      say: 'The peanut presses gently along the edge of the vein, freeing it from its sheath to open a passage behind it.',
    },
    {
      id: 'peanut-out',
      kind: 'withdraw',
      act: { k: 'withdraw' },
      say: 'Passage made; the peanut comes out.',
    },
    {
      id: 'stapler-in',
      kind: 'insert',
      act: { k: 'insert', tool: 'stapler', sub: 'vascular-curved', port: POST, target: VEIN },
      say: 'The curved-tip vascular stapler comes in through the posterior port, square to the vein.',
    },
    {
      id: 'fire',
      kind: 'working',
      act: { k: 'fire', target: VEIN },
      cam: { k: 'frame', subject: VEIN },
      say: 'The anvil passes behind the vein, the jaws close, and firing divides it between two staple lines.',
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
      cam: { k: 'frame', subject: VEIN },
      say: 'The vein is divided: two stumps, each closed by its own staple line.',
    },
  ],
  end: {
    finish: { veinDivided: true },
    state: { retract_hilum: 1 },
    divided: [VEIN],
    holds: [{ port: UTIL, target: RML, key: 'retract_hilum' }],
    scopePort: CAM,
  },
};
