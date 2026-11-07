// T860 walkthrough input lock (FEEDBACK_GUIDED_v1 §2.1-1): Guided mode is the non-interactive walkthrough. The user
// input handlers for the hotbar, tool activation, scope drag / arrows / wheel / keys, port switching and the
// ventilation switch return early while inputLocked(); Next / Prev / rail / replay / pause / hover / mode switch never
// check it. The walkthrough engine drives the same paths inside asEngine().
import { getMode } from './modes';

let engine = 0;

export const inputLocked = (): boolean => engine === 0 && getMode() === 'guided';

/** Run `fn` as the walkthrough engine (the lock lets it through). */
export function asEngine<T>(fn: () => T): T {
  engine++;
  try {
    return fn();
  } finally {
    engine--;
  }
}

/** The walkthrough's clock rate for m4's own animations (stapler fire, jaws, instrument moves): 0 while paused,
 *  timeScale while playing, 1 outside the walkthrough. Set by the engine only. */
export const walkRate = { value: 1 };
