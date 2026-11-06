// Practice-mode text (T505): complication + vitals messages (keys from src/sim/complications.ts), engine error
// feedback and debrief complication names. Paraphrased teaching text.
import type { ToastKey, VitalsKey } from '../sim/complications';
import type { PracticeErrorKind } from '../sim/practice';

export const COMPLICATION_TEXT: Readonly<Record<ToastKey | VitalsKey, string>> = {
  'complication.danger':
    'A structure that must be kept was hit (main vessel, airway or nerve). Stop and re-check the anatomy.',
  'complication.dangerMinor':
    'The pericardium was burned or caught. Minor, but keep energy and staplers off the heart sac.',
  'complication.bleed':
    'A vessel is bleeding. Clear the blood with the sucker, then press with the sponge stick.',
  'complication.tear':
    'Pulling too hard with the artery encircled tore a branch. Suction, then steady pressure.',
  'complication.injury': 'Tissue damaged: this instrument does not belong on that structure.',
  'complication.coagulated': 'Bleeding controlled: the small bleeding point is sealed.',
  'complication.coagMajor':
    'Cautery cannot seal a major vessel injury. Press with the sponge stick, then clip or staple the vessel.',
  'vitals.bleed.major': 'Vitals: pressure dropping and pulse climbing (major bleeding).',
  'vitals.bleed.minor': 'Vitals: pulse slowly rising (ongoing minor bleeding).',
};

export const PRACTICE_ERROR_TEXT: Readonly<Record<PracticeErrorKind, string>> = {
  'wrong-order': 'Not yet: an earlier part of the case is still open.',
  'wrong-target': 'Right instrument, wrong structure for this point in the case.',
  'wrong-tool': 'Wrong instrument or setting for this structure.',
  'wrong-port': 'This works better through another port.',
  'poor-angle': 'The stapler angle from this port is poor: choose another port.',
  unexpected: 'That action is not part of the plan here.',
};

/** Debrief names for complication log events (scoring `kind`). */
export const COMPLICATION_KIND = {
  bleed: 'bleeding',
  tear: 'arterial tear',
  danger: 'danger structure hit',
  injury: 'tissue injury',
} as const;

export const PRACTICE_UI = {
  hintPrefix: 'Next: ',
  noHint: 'Nothing left to do: end the run for your debrief.',
  done: 'Case complete.',
} as const;

/** T844: the practice bar's instruction per step (same 9 steps as Guided): what, with which instrument, where.
 *  Hotbar keys in brackets; pressing a slot key again cycles its sub-option. */
export const PRACTICE_STEP_TEXT: Readonly<Record<number, string>> = {
  1: 'The scope is in the camera port. Look around with Hands (1): drag to pivot, wheel to zoom. Click the upper, middle and lower lobes to name them, then carry on.',
  2: 'Grasper (2) through the posterior port: lift the lung back and hold it (G). Peanut (4) eases the phrenic nerve forward, then the cautery (5) opens the pleura over the veins.',
  3: 'Cautery (5) clears the strands around the middle lobe vein; click it and the superior pulmonary vein to check them. Peanut (4): passage behind it. Re-grasp the upper lobe through the access incision (G) to free the posterior port, then staple (7) through that port.',
  4: 'Ring forceps (press 2 twice) through the access incision: grasp nodes 11R and 12R and withdraw them (Esc). Then hold the cautery (5) on the oozing node bed until it stops.',
  5: 'Let go of the upper lobe (Shift+G). Grasper (2) pulls the middle lobe out (G holds it). Clamp (6) the bronchus, close the bronchial stapler (7) through the posterior port, ask for a breath (A), then fire.',
  6: 'Peanut (4): open a passage behind the middle lobe artery. Stapler (7) with the leader or curved tip through the posterior port, then fire.',
  7: 'Grasper (2) pulls the middle lobe away (G). Stapler (7, parenchyma) through the posterior port along the horizontal fissure, look under the lobe and click the airway, then fire along the oblique fissure.',
  8: 'Bag (B): the free lobe goes into the bag and out through the access incision.',
  9: 'Irrigate the field (W or the button) to fill the chest with saline, ask for a breath (A) to test the stumps under water, then the sucker (9) on suction clears it.',
};
