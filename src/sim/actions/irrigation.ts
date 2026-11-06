// T842 "Irrigate the field" (final-step context action, docs/FEEDBACK_v7_LIVE.md item 14): a button in the port strip +
// waterConfig.key. Fills the hemithorax (water.ts); the held sucker then drains it. Practice keeps finish.ts's
// prerequisite (lobe out); guided / explore's final step already shows the lobe out by its step state.
import { waterConfig } from '../../scene/water.config';
import { FINISH_CONFIG, irrigate } from './finish';
import type { FinishResult, FinishState } from './finish';

/** `stepShowsLobeOut`: guided / explore on the final step (the step state removed the lobe). */
export function irrigateField(s: FinishState, stepShowsLobeOut: boolean): FinishResult {
  if (!stepShowsLobeOut || s.lobeRemoved) return irrigate(s);
  s.fluidFilled = true;
  return { ok: true, requests: [{ kind: 'fluid', level: FINISH_CONFIG.irrigationLevel }] };
}

export interface IrrigateButton {
  readonly el: HTMLButtonElement;
  setShown(v: boolean): void;
}

/** One button, built once; hidden until the final step. */
export function mountIrrigateButton(host: HTMLElement, onClick: () => void): IrrigateButton {
  const strip = document.createElement('div');
  strip.className = 'retraction-strip';
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'retraction-btn';
  el.dataset.action = 'irrigate';
  el.textContent = `Irrigate the field · ${waterConfig.keyLabel}`;
  el.title = 'Fill the chest with warm saline over the hilum and stumps (leak test); the sucker drains it';
  el.addEventListener('click', onClick);
  strip.append(el);
  host.append(strip);
  const api = {
    el,
    setShown(v: boolean) {
      strip.style.display = v ? '' : 'none'; // .retraction-strip's display:flex beats [hidden]
    },
  };
  api.setShown(false);
  return api;
}
