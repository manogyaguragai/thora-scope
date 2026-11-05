// Physiology lab inspector (§6.1 item 4). Plain DOM (ADR-007), no three import: lazy-loaded chunk.
// Event-driven; the only periodic DOM write is the ≤ 4 Hz slider sync, which reuses the same inputs.
import { config } from '../core/config';
import type { AppState, Lobe } from '../sim/state';
import './panels.css';

export interface PhysiologySim {
  state: AppState;
  cmd: {
    startOLV: () => void;
    clamp: () => void;
    release: () => void;
    setLobe: (lobe: Lobe, v: number) => void;
  };
}

const LIMITS = config.physiology.limits;

const LOBES: readonly Lobe[] = ['RUL', 'RML', 'RLL'];
const sec = (ms: number): string => `${Math.round(ms / 1000)} s`;
const P = config.physiology;
const Q = 1 / LIMITS.sliderStep;
/** Lobe value as the range input would report it (snapped to its step), so unchanged values skip the write. */
const snap = (v: number): string => String(Math.round(v * Q) / Q);

// Paraphrased teaching text (pending clinician review).
const STATUS = {
  idle: 'Both lungs ventilated: the right lobes rise and fall gently with each breath.',
  olv: `One-lung ventilation: the right lung is no longer ventilated, so all three right lobes collapse over about ${sec(P.olvMs)}.`,
  clamp:
    "RML bronchus clamped, lung ventilated: RUL and RLL re-inflate, RML stays collapsed — the clamped bronchus is the middle lobe's.",
  release: `Clamp released: air reaches the middle lobe again and it re-inflates over about ${sec(P.releaseMs)}.`,
  divided: 'The middle lobe bronchus is already divided, so the middle lobe stays collapsed.',
  manual: 'Manual control: each slider sets how collapsed that lobe is (0 = inflated, 1 = collapsed).',
} as const;

let uid = 0;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** Number input + label; clamps to [min, max] on change and writes back the clamped value. */
function rateInput(
  label: string,
  unit: string,
  value: number,
  lim: { min: number; max: number },
  set: (v: number) => void,
): HTMLElement {
  const id = `phys-${uid++}`;
  const input = h('input', {
    id,
    type: 'number',
    min: String(lim.min),
    max: String(lim.max),
    step: '1',
    value: String(value),
  });
  input.addEventListener('change', () => {
    const n = Number(input.value);
    const v = Number.isFinite(n) ? Math.min(lim.max, Math.max(lim.min, Math.round(n))) : value;
    input.value = String(v);
    set(v);
  });
  return h('div', { className: 'panel-field' }, h('label', { htmlFor: id }, `${label} (${unit})`), input);
}

/** Switch (native checkbox, role=switch) wired to a boolean. */
function toggle(label: string, on: boolean, set: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: on, className: 'panel-switch' });
  input.setAttribute('role', 'switch');
  input.addEventListener('change', () => set(input.checked));
  return h('label', { className: 'panel-toggle' }, input, label);
}

/** Mounts the panel into `host`; returns a dispose function (stops the sync timer, removes the DOM). */
export function mountPhysiologyPanel(host: HTMLElement, sim: PhysiologySim): () => void {
  const { state, cmd } = sim;
  const status = h('p', { className: 'panel-status', textContent: STATUS.idle });
  status.setAttribute('role', 'status'); // implies aria-live=polite
  const say = (msg: string): void => {
    status.textContent = msg;
  };

  const sliders = LOBES.map((lobe) => {
    const id = `phys-${uid++}`;
    const input = h('input', {
      id,
      type: 'range',
      min: '0',
      max: '1',
      step: String(LIMITS.sliderStep),
      value: snap(state[`deflate_${lobe}`]),
    });
    input.addEventListener('input', () => {
      cmd.setLobe(lobe, Number(input.value));
      say(STATUS.manual);
    });
    return {
      lobe,
      input,
      row: h('div', { className: 'panel-field' }, h('label', { htmlFor: id }, `${lobe} collapse`), input),
    };
  });

  const button = (text: string, run: () => void, msg: () => string): HTMLButtonElement => {
    const b = h('button', { type: 'button', className: 'panel-button', textContent: text });
    b.addEventListener('click', () => {
      run();
      say(msg());
    });
    return b;
  };

  const titleId = `phys-${uid++}`;
  const root = h(
    'section',
    { className: 'panel' },
    h('h2', { id: titleId, className: 'panel-title' }, 'Physiology lab'),
    h(
      'div',
      { className: 'panel-group' },
      button('Start one-lung ventilation', cmd.startOLV, () => STATUS.olv),
      button('Clamp RML bronchus + re-inflate', cmd.clamp, () => STATUS.clamp),
      button('Release clamp', cmd.release, () => (state.rmlDivided ? STATUS.divided : STATUS.release)),
    ),
    status,
    h('div', { className: 'panel-group' }, ...sliders.map((s) => s.row)),
    h(
      'div',
      { className: 'panel-group' },
      toggle('Heartbeat', state.heartbeatOn, (v) => (state.heartbeatOn = v)),
      rateInput('Heart rate', 'bpm', state.hrBpm, LIMITS.hr, (v) => (state.hrBpm = v)),
      toggle('Breathing', state.breathingOn, (v) => (state.breathingOn = v)),
      rateInput('Respiratory rate', 'breaths/min', state.rrPerMin, LIMITS.rr, (v) => (state.rrPerMin = v)),
    ),
  );
  root.setAttribute('aria-labelledby', titleId);

  // Reflect tweens (OLV/clamp/step changes) into the sliders; skip the one being dragged; write only on change.
  const timer = setInterval(() => {
    for (const { lobe, input } of sliders) {
      if (input.matches(':active')) continue;
      const v = snap(state[`deflate_${lobe}`]);
      if (input.value !== v) input.value = v;
    }
  }, LIMITS.syncMs);

  host.append(root);
  return () => {
    clearInterval(timer);
    root.remove();
  };
}
