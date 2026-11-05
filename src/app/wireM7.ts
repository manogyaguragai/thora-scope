// M7 glue (T814): vitals monitor + pulse beep. Lazy chunk; main.ts mounts it and calls tick(now) from the frame loop.
// Audio: ONE AudioContext + ONE always-running OscillatorNode behind a GainNode, created on the first sound-on
// (user gesture, autoplay policy); each beat is a gain envelope. Suspended while sound is off or the tab is hidden.
import { keybindings, matchesKey } from '../core/keybindings';
import type { AppState } from '../sim/state';
import { vitalsConfig } from '../ui/vitals.config';
import { beepHz, mountMonitor } from '../ui/vitalsMonitor';

export interface VitalsMonitor {
  tick(now: number): void;
  addMirror(canvas: HTMLCanvasElement, onDrawn: () => void): void;
  setSoundOn(on: boolean): void;
  readonly el: HTMLElement;
  dispose(): void;
}

declare global {
  interface Window {
    /** e2e hook: displayed HR / SpO2, sound state, number of beeps scheduled, ECG diathermy interference. */
    __vitals?: { hr: number; spo2: number; soundOn: boolean; beeps: number; interference: boolean };
  }
}

const B = vitalsConfig.beep;
const SKIP_TARGETS = 'input, select, textarea, [contenteditable], dialog';

function loadSoundPref(): boolean {
  try {
    return localStorage.getItem(B.storageKey) === '1';
  } catch {
    return false;
  }
}

function saveSoundPref(on: boolean): void {
  try {
    localStorage.setItem(B.storageKey, on ? '1' : '0');
  } catch {
    /* storage blocked: the toggle still works for this session */
  }
}

export function wireVitals(ctx: { state: AppState; host: HTMLElement }): VitalsMonitor {
  const view = mountMonitor(ctx.state, ctx.host);
  const hook = { hr: view.hr, spo2: view.spo2, soundOn: false, beeps: 0, interference: false };
  window.__vitals = hook;

  let audio: AudioContext | null = null;
  let osc: OscillatorNode | null = null;
  let gain: GainNode | null = null;

  function ensureAudio(): void {
    if (audio) return;
    try {
      audio = new AudioContext();
      osc = audio.createOscillator();
      gain = audio.createGain();
      osc.type = 'sine';
      gain.gain.value = 0;
      osc.connect(gain).connect(audio.destination);
      osc.start();
    } catch {
      audio = null; // no WebAudio: the monitor still runs silently
    }
  }

  /** Run the context only while it can be heard. */
  function syncAudio(): void {
    if (!audio) return;
    const run = hook.soundOn && !document.hidden;
    if (run && audio.state === 'suspended') void audio.resume().catch(() => undefined);
    else if (!run && audio.state === 'running') void audio.suspend().catch(() => undefined);
  }

  function beep(): void {
    if (!audio || !osc || !gain) return;
    const t = audio.currentTime;
    const len = B.lengthMs / 1000;
    const g = gain.gain;
    osc.frequency.setValueAtTime(beepHz(view.spo2), t);
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(B.volume, t + B.attackMs / 1000);
    g.setValueAtTime(B.volume, t + len - B.releaseMs / 1000);
    g.linearRampToValueAtTime(0, t + len);
    hook.beeps++;
  }

  function setSoundOn(on: boolean): void {
    hook.soundOn = on;
    view.soundButton.setAttribute('aria-pressed', String(on));
    saveSoundPref(on);
    if (on) ensureAudio();
    syncAudio();
  }

  const toggle = (): void => setSoundOn(!hook.soundOn);
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target instanceof Element && e.target.closest(SKIP_TARGETS)) return;
    if (!matchesKey(keybindings.toggleSound, e.code)) return;
    toggle();
    e.preventDefault();
  };
  view.soundButton.addEventListener('click', toggle);
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', syncAudio);

  // Persisted "on": the AudioContext needs a user gesture, so it starts on the first click / key press.
  const unlock = (): void => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    if (hook.soundOn) setSoundOn(true);
  };
  if (loadSoundPref()) {
    hook.soundOn = true;
    view.soundButton.setAttribute('aria-pressed', 'true');
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  return {
    el: view.el,
    tick(now: number): void {
      const beat = view.tick(now);
      hook.hr = view.hr;
      hook.spo2 = view.spo2;
      hook.interference = ctx.state.cauteryActive;
      if (beat && hook.soundOn && !document.hidden) beep();
    },
    addMirror: view.addMirror,
    setSoundOn,
    dispose(): void {
      view.soundButton.removeEventListener('click', toggle);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', syncAudio);
      if (audio) void audio.close().catch(() => undefined);
      audio = osc = gain = null;
      view.dispose();
      if (window.__vitals === hook) delete window.__vitals;
    },
  };
}
