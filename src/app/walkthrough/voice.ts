// Guided narration: one recorded clip per walkthrough beat, started with the beat's caption (engine.ts), so text and
// voice stay in step. One reused <audio> plays; a second one prefetches the next beat's clip. Event time only.
import { walkthroughConfig } from './walkthrough.config';

const V = walkthroughConfig.voice;

export interface Voice {
  /** Start `clip` (file stem, e.g. s01_rul) from the top; `next` is prefetched. */
  play(clip: string, next: string | null): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Closed: clips are tracked but silent (the app opens on the theatre; narration starts with the scope view).
   *  Opening starts the current beat's clip from the top. Open by default. */
  gate(open: boolean): void;
  /** A clip is playing or paused part-way: the engine holds the beat until this is false. */
  readonly busy: boolean;
  /** Persisted; muting releases a held beat at once. */
  muted: boolean;
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(V.storageKey) === '0';
  } catch {
    return false;
  }
}

function saveMuted(m: boolean): void {
  try {
    localStorage.setItem(V.storageKey, m ? '0' : '1');
  } catch {
    /* storage blocked: the toggle still works for this session */
  }
}

export const clipUrl = (clip: string): string => `${V.dir}${V.alias[clip] ?? clip}.mp3`;

export function createVoice(
  make: () => HTMLAudioElement = () => new Audio(),
  target: EventTarget = window,
): Voice {
  const a = make();
  const pre = make();
  pre.preload = 'auto';
  a.volume = V.volume;
  let cur: string | null = null; // clip of the current beat
  let busy = false;
  let held = false; // paused by the walkthrough
  let blocked = false; // autoplay refused: retried on the first user gesture
  let open = true;
  let gen = 0; // a superseded play()'s rejection must not touch the newer clip
  let muted = loadMuted();

  const start = (): void => {
    const g = ++gen;
    busy = true;
    a.play().catch((e: unknown) => {
      if (g !== gen) return;
      busy = false; // never hold the walkthrough on audio that cannot play
      blocked = (e as { name?: string } | null)?.name === 'NotAllowedError';
    });
  };
  const done = (): void => {
    busy = false;
  };
  a.addEventListener('ended', done);
  a.addEventListener('error', done);
  const unlock = (): void => {
    if (!blocked) return;
    blocked = false;
    if (cur && !muted && !held && open) start();
  };
  target.addEventListener('pointerdown', unlock, true);
  target.addEventListener('keydown', unlock, true);

  const voice: Voice = {
    play(clip, next) {
      voice.stop();
      cur = clip;
      if (next) pre.src = clipUrl(next);
      a.src = clipUrl(clip);
      if (!muted && open) start();
    },
    pause() {
      held = true;
      if (busy) a.pause();
    },
    resume() {
      held = false;
      if (busy) start();
    },
    gate(on) {
      const opening = on && !open;
      open = on;
      if (opening && cur && !muted && !held && !busy) start();
      else if (!on && busy) {
        gen++;
        busy = false;
        a.pause();
      }
    },
    stop() {
      gen++;
      cur = null;
      busy = held = false;
      a.pause();
    },
    get busy() {
      return busy;
    },
    get muted() {
      return muted;
    },
    set muted(m: boolean) {
      muted = m;
      saveMuted(m);
      if (m) {
        gen++;
        busy = false;
        a.pause();
      } else if (cur && open && !held && !busy) {
        a.currentTime = 0; // unmuting speaks the caption on screen from the top
        start();
      }
    },
  };
  return voice;
}
