// Practice-mode text (T505): complication + vitals messages (keys from src/sim/complications.ts), engine error
// feedback and debrief complication names. Paraphrased teaching text.
import type { ToastKey, VitalsKey } from '../sim/complications';
import type { PracticeErrorKind } from '../sim/practice';

export const COMPLICATION_TEXT: Readonly<Record<ToastKey | VitalsKey, string>> = {
  'complication.danger': 'Danger structure hit. It must never be divided: stop and re-check the anatomy.',
  'complication.bleed':
    'A vessel is bleeding. Clear the blood with the sucker, then press with the sponge stick.',
  'complication.tear':
    'Pulling too hard with the artery encircled tore a branch. Suction, then steady pressure.',
  'complication.injury': 'Tissue damaged: this instrument does not belong on that structure.',
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
