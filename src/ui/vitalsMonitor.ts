// OT-style patient monitor (T814): sweep-drawn ECG + pleth on ONE canvas reused forever, numerics as DOM text
// rewritten ≤ textHz, optional mirror canvases (OT-room 3D screen) composited ≤ mirrorHz. Reads AppState only, so it
// follows the Physiology panel for free. No three import; nothing allocated per frame. Values are simulated.
import { config } from '../core/config';
import type { AppState } from '../sim/state';
import { vitalsConfig as V } from './vitals.config';
import './vitals.css';

const T = V.trace;
const W = V.wave;
const C = V.colors;
const M = V.mirror;
const I = V.interference;

type Deflate = Pick<AppState, 'deflate_RUL' | 'deflate_RML' | 'deflate_RLL'>;

/** SpO2 (%): base on two-lung ventilation, lerped toward the OLV value by the most collapsed right lobe. */
export function spo2For(s: Deflate): number {
  const d = Math.min(1, Math.max(0, s.deflate_RUL, s.deflate_RML, s.deflate_RLL));
  return Math.round(V.spo2.basePct + (V.spo2.olvPct - V.spo2.basePct) * d);
}

/** Pulse-oximeter beep pitch (Hz): higher SpO2 = higher tone. */
export const beepHz = (spo2: number): number =>
  Math.max(V.beep.minHz, V.beep.hzAt100 - (100 - spo2) * V.beep.hzPerPct);

export const nibpSys = (hr: number): number =>
  Math.round(V.nibp.sysMmHg + (hr - V.nibp.refHrBpm) * V.nibp.sysPerBpm);
export const nibpDia = (hr: number): number =>
  Math.round(V.nibp.diaMmHg + (hr - V.nibp.refHrBpm) * V.nibp.diaPerBpm);

/** Beat = heartPhase wrapped since the last call (R wave), only while the heartbeat runs. */
export interface BeatDetector {
  last: number;
}
export function detectBeat(d: BeatDetector, s: Pick<AppState, 'heartPhase' | 'heartbeatOn'>): boolean {
  const wrapped = s.heartPhase < d.last;
  d.last = s.heartPhase;
  return wrapped && s.heartbeatOn;
}

const gauss = (x: number, mu: number, w: number): number => Math.exp(-(((x - mu) / w) ** 2));

/** PQRST, ~0 baseline, R = 1 at phase 0. */
export function ecgWave(phase: number): number {
  const e = (phase + W.ecgShift) % 1;
  let v = 0;
  for (let i = 0; i < W.ecg.length; i++) {
    const g = W.ecg[i] as (typeof W.ecg)[number];
    v += g[1] * gauss(e, g[0], g[2]);
  }
  return v;
}

/** Diathermy noise for trace sample k (deterministic, ±(amp + ripple)). */
export function diathermyNoise(k: number): number {
  const h = Math.sin(k * 12.9898) * 43758.5453;
  return I.amp * (2 * (h - Math.floor(h)) - 1) + I.ripple * Math.sin(k * I.rippleRad);
}

/** ECG trace value: PQRST while the heart beats (flat otherwise), plus diathermy noise while `cautery` is on. */
export const ecgTrace = (phase: number, beat: boolean, cautery: boolean, k: number): number =>
  (beat ? ecgWave(phase) : 0) + (cautery ? diathermyNoise(k) : 0);

const PLETH_FLOOR = Math.exp(-(1 - W.plethRise) * W.plethDecay);
/** Finger pleth 0..~1: upstroke, exponential run-off with a dicrotic notch; 0 at the start of each pulse. */
export function plethWave(phase: number): number {
  const p = (phase - W.plethDelay + 1) % 1;
  if (p < W.plethRise) return Math.sin(((p / W.plethRise) * Math.PI) / 2);
  const run = (Math.exp(-(p - W.plethRise) * W.plethDecay) - PLETH_FLOOR) / (1 - PLETH_FLOOR);
  return run + W.plethNotch[1] * gauss(p, W.plethNotch[0], W.plethNotch[2]);
}

const VITALS = [
  ['hr', 'HR', 'bpm', C.ecg],
  ['spo2', 'SpO₂', '%', C.pleth],
  ['nibp', 'NIBP', 'mmHg', C.nibp],
  ['rr', 'RR', '/min', C.rr],
  ['etco2', 'EtCO₂', 'mmHg', C.etco2],
] as const;
const N = VITALS.length;
const NONE = '--';

export interface MonitorView {
  readonly el: HTMLElement;
  readonly soundButton: HTMLButtonElement;
  /** Collapse / expand toggle (T821; wireM7 persists it): aria-expanded + data-collapsed on `el`. */
  readonly collapseButton: HTMLButtonElement;
  /** Advance the sweep; true on a beat (R wave). */
  tick(now: number): boolean;
  addMirror(canvas: HTMLCanvasElement, onDrawn: () => void): void;
  /** Latest displayed values (refreshed ≤ textHz). */
  readonly hr: number;
  readonly spo2: number;
  dispose(): void;
}

const SPEAKER = `<svg class="vitals-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z"/>
<path class="vitals-on" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/><path class="vitals-off" d="M16 9l5 6M21 9l-5 6"/></svg>`;
const CHEVRON = `<svg class="vitals-icon vitals-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

export function mountMonitor(state: AppState, host: HTMLElement): MonitorView {
  const el = document.createElement('section');
  el.className = 'vitals';
  el.id = 'vitals';
  el.setAttribute('aria-label', 'Patient monitor (simulated values)');
  const pip = config.hands.pip;
  const root = document.documentElement.style; // :root vars: the inspector rule in vitals.css reads them too
  root.setProperty('--vitals-pip-h', `${Math.round((pip.cssWidth * pip.height) / pip.width)}px`);
  root.setProperty('--vitals-bg', C.bg);

  const canvas = document.createElement('canvas');
  canvas.className = 'vitals-trace';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(window.devicePixelRatio || 1, T.maxDpr);
  canvas.width = Math.round(T.cssWidth * dpr);
  canvas.height = Math.round(T.cssHeight * dpr);
  canvas.style.width = `${T.cssWidth}px`;
  canvas.style.height = `${T.cssHeight}px`;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.lineWidth = T.lineWidthPx;
  g.lineJoin = 'round';
  g.fillStyle = C.bg;
  g.fillRect(0, 0, T.cssWidth, T.cssHeight);

  const nums = document.createElement('dl');
  nums.className = 'vitals-nums';
  const texts: Text[] = [];
  for (const [key, label, unit, color] of VITALS) {
    const cell = document.createElement('div');
    cell.className = 'vitals-cell';
    cell.dataset.vital = key;
    cell.style.color = color;
    const dt = document.createElement('dt');
    dt.textContent = `${label} `;
    const u = document.createElement('span');
    u.className = 'vitals-unit';
    u.textContent = unit;
    dt.append(u);
    const dd = document.createElement('dd');
    texts.push(dd.appendChild(document.createTextNode(NONE)));
    cell.append(dt, dd);
    nums.append(cell);
  }

  const soundButton = document.createElement('button');
  soundButton.type = 'button';
  soundButton.className = 'vitals-sound';
  soundButton.setAttribute('aria-pressed', 'false');
  soundButton.setAttribute('aria-label', 'Pulse beep sound');
  soundButton.title = 'Pulse beep (M)';
  soundButton.innerHTML = SPEAKER;

  const collapseButton = document.createElement('button');
  collapseButton.type = 'button';
  collapseButton.className = 'vitals-sound vitals-collapse'; // same small square button look
  collapseButton.setAttribute('aria-expanded', 'true');
  collapseButton.setAttribute('aria-label', 'Monitor details');
  collapseButton.title = 'Show / hide the monitor';
  collapseButton.innerHTML = CHEVRON;

  const buttons = document.createElement('div');
  buttons.className = 'vitals-buttons';
  buttons.append(soundButton, collapseButton);
  el.append(canvas, nums, buttons);
  host.append(el);

  // Displayed strings (built ≤ textHz) — also reused by the mirror compositor.
  const shown: string[] = VITALS.map(() => NONE);
  let hr = 0;
  let spo2 = 0;
  function refreshText(): void {
    hr = state.hrBpm;
    spo2 = spo2For(state);
    const beat = state.heartbeatOn;
    const breath = state.breathingOn;
    shown[0] = beat ? String(Math.round(hr)) : NONE;
    shown[1] = beat ? String(spo2) : NONE; // no pulse, no pleth reading
    shown[2] = `${nibpSys(hr)}/${nibpDia(hr)}`; // last cuff reading stays on screen
    shown[3] = breath ? String(Math.round(state.rrPerMin)) : NONE;
    shown[4] = breath ? String(V.etco2MmHg) : NONE;
    for (let i = 0; i < N; i++) {
      const t = texts[i] as Text;
      const s = shown[i] as string;
      if (t.data !== s) t.data = s;
    }
  }
  refreshText();

  // Sweep state.
  const bandH = T.cssHeight / 2;
  const ecgY = (v: number): number => bandH * T.ecgBase - v * bandH * T.ecgAmp;
  const plethY = (v: number): number => bandH + bandH * T.plethBase - v * bandH * T.plethAmp;
  let x = 0;
  let lastT = 0;
  let lastPhase = 0;
  let lastText = 0;
  let lastMirror = 0;
  let noiseK = 0; // diathermy noise sample counter
  const det: BeatDetector = { last: state.heartPhase };

  /** One trace from x0 over n samples of dx px, phase advancing dPhase per sample; wraps at the right edge. */
  function stroke(
    color: string,
    band: 0 | 1,
    x0: number,
    ph0: number,
    n: number,
    dx: number,
    dPh: number,
  ): void {
    const on = state.heartbeatOn;
    const cautery = state.cauteryActive;
    const y = band === 0 ? ecgY : plethY;
    g.strokeStyle = color;
    g.beginPath();
    let px = x0;
    g.moveTo(px, y(band === 0 ? ecgTrace(ph0, on, cautery, noiseK) : on ? plethWave(ph0) : 0));
    for (let k = 1; k <= n; k++) {
      px += dx;
      const ph = (ph0 + dPh * k) % 1;
      if (band === 0) noiseK = (noiseK + 1) % I.period;
      const v = y(band === 0 ? ecgTrace(ph, on, cautery, noiseK) : on ? plethWave(ph) : 0);
      if (px >= T.cssWidth) {
        px -= T.cssWidth;
        g.stroke();
        g.beginPath();
        g.moveTo(px, v);
      } else g.lineTo(px, v);
    }
    g.stroke();
  }

  function clearAhead(from: number, w: number): void {
    g.fillStyle = C.bg;
    g.fillRect(from, 0, w, T.cssHeight);
    if (from + w > T.cssWidth) g.fillRect(0, 0, from + w - T.cssWidth, T.cssHeight);
  }

  // Mirrors: fixed arrays, grown only by addMirror (never per frame).
  const mirrors: CanvasRenderingContext2D[] = [];
  const mirrorDone: (() => void)[] = [];
  const mirrorFonts: string[] = [];
  function drawMirrors(): void {
    for (let m = 0; m < mirrors.length; m++) {
      const mc = mirrors[m] as CanvasRenderingContext2D;
      const mw = mc.canvas.width;
      const mh = mc.canvas.height;
      const split = Math.round(mw * M.traceShare);
      mc.fillStyle = C.bg;
      mc.fillRect(0, 0, mw, mh);
      mc.drawImage(canvas, 0, 0, split, mh);
      mc.font = mirrorFonts[m] as string;
      const row = mh / N;
      for (let i = 0; i < N; i++) {
        mc.fillStyle = (VITALS[i] as (typeof VITALS)[number])[3];
        mc.fillText(shown[i] as string, split + row * M.padRowShare, row * (i + M.fontRowShare));
      }
      (mirrorDone[m] as () => void)();
    }
  }

  return {
    el,
    soundButton,
    collapseButton,
    get hr() {
      return hr;
    },
    get spo2() {
      return spo2;
    },
    tick(now: number): boolean {
      const beat = detectBeat(det, state);
      const elapsed = now - lastT;
      const ph = state.heartPhase;
      if (lastT > 0 && elapsed > 0 && elapsed <= T.maxStepMs) {
        const dist = (elapsed / 1000) * T.sweepPxPerS;
        const n = Math.max(1, Math.ceil(dist / T.samplePx));
        const dx = dist / n;
        const dPh = ((ph - lastPhase + 1) % 1) / n;
        clearAhead(x, dist + T.eraseBarPx);
        stroke(C.ecg, 0, x, lastPhase, n, dx, dPh);
        stroke(C.pleth, 1, x, lastPhase, n, dx, dPh);
        x = (x + dist) % T.cssWidth;
      }
      lastT = now;
      lastPhase = ph;
      if (now - lastText >= 1000 / V.textHz) {
        lastText = now;
        refreshText();
      }
      if (mirrors.length > 0 && now - lastMirror >= 1000 / M.hz) {
        lastMirror = now;
        drawMirrors();
      }
      return beat;
    },
    addMirror(mirror: HTMLCanvasElement, onDrawn: () => void): void {
      const mc = mirror.getContext('2d');
      if (!mc) return;
      mirrors.push(mc);
      mirrorDone.push(onDrawn);
      mirrorFonts.push(
        `600 ${Math.round((mirror.height / N) * M.fontRowShare)}px ${getComputedStyle(el).fontFamily}`,
      );
      drawMirrors();
    },
    dispose(): void {
      mirrors.length = 0;
      mirrorDone.length = 0;
      el.remove();
      root.removeProperty('--vitals-pip-h');
      root.removeProperty('--vitals-bg');
    },
  };
}
