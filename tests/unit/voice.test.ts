import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { WALK_STEPS } from '../../src/app/walkthrough/steps';
import { clipUrl, createVoice } from '../../src/app/walkthrough/voice';

// Narration: every walkthrough beat has its clip on disk, and the voice holds / releases beats correctly.
const PUBLIC = 'public';
const base = import.meta.env.BASE_URL;

class FakeAudio extends EventTarget {
  src = '';
  preload = '';
  volume = 1;
  paused = true;
  plays = 0;
  reject: string | null = null;
  play(): Promise<void> {
    this.plays++;
    if (this.reject) return Promise.reject(Object.assign(new Error(this.reject), { name: this.reject }));
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

function rig(): { a: FakeAudio; pre: FakeAudio; gestures: EventTarget; v: ReturnType<typeof createVoice> } {
  const els: FakeAudio[] = [];
  const gestures = new EventTarget();
  const v = createVoice(() => {
    const e = new FakeAudio();
    els.push(e);
    return e as unknown as HTMLAudioElement;
  }, gestures);
  return { a: els[0] as FakeAudio, pre: els[1] as FakeAudio, gestures, v };
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

test('every walkthrough beat has a narration clip', () => {
  const missing = WALK_STEPS.flatMap((s) =>
    s.beats
      .map((b) => clipUrl(`s${String(s.step).padStart(2, '0')}_${b.id}`))
      .filter((u) => !existsSync(`${PUBLIC}/${u.slice(base.length)}`)),
  );
  expect(missing).toEqual([]);
});

describe('voice', () => {
  test('play holds the beat until the clip ends; prefetches the next clip', () => {
    const { a, pre, v } = rig();
    v.play('s01_rul', 's01_rml');
    expect(a.src).toBe(clipUrl('s01_rul'));
    expect(pre.src).toBe(clipUrl('s01_rml'));
    expect(v.busy).toBe(true);
    a.dispatchEvent(new Event('ended'));
    expect(v.busy).toBe(false);
  });

  test('pause keeps the beat held; resume continues; stop releases', () => {
    const { a, v } = rig();
    v.play('s02_grasp', null);
    v.pause();
    expect(a.paused).toBe(true);
    expect(v.busy).toBe(true);
    v.resume();
    expect(a.paused).toBe(false);
    v.stop();
    expect(v.busy).toBe(false);
    expect(a.paused).toBe(true);
  });

  test("a superseded play()'s rejection does not release the newer clip", async () => {
    const { a, v } = rig();
    a.reject = 'AbortError';
    v.play('s02_rml', null);
    a.reject = null;
    v.play('s02_grasp', null);
    await flush();
    expect(v.busy).toBe(true);
  });

  test('autoplay refused: the beat is not held; the first gesture starts the current clip', async () => {
    const { a, gestures, v } = rig();
    a.reject = 'NotAllowedError';
    v.play('s01_rul', null);
    await flush();
    expect(v.busy).toBe(false);
    a.reject = null;
    gestures.dispatchEvent(new Event('pointerdown'));
    expect(v.busy).toBe(true);
    expect(a.plays).toBe(2);
  });

  test('gate closed: silent and not held; opening starts the current clip from the top', () => {
    const { a, v } = rig();
    v.gate(false);
    v.play('s01_rul', 's01_rml');
    expect(v.busy).toBe(false);
    expect(a.plays).toBe(0);
    v.gate(true);
    expect(v.busy).toBe(true);
    expect(a.src).toBe(clipUrl('s01_rul'));
    expect(a.plays).toBe(1);
  });

  test('muted: nothing plays and muting mid-clip releases the beat', () => {
    const { a, v } = rig();
    v.play('s03_fire', null);
    v.muted = true;
    expect(v.busy).toBe(false);
    v.play('s03_stapler-out', null);
    expect(v.busy).toBe(false);
    expect(a.plays).toBe(1);
    v.muted = false; // unmuting speaks the current caption
    expect(v.busy).toBe(true);
    expect(a.src).toBe(clipUrl('s03_stapler-out'));
  });
});
