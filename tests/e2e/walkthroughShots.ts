import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { WalkState } from '../../src/app/walkthrough/types';

// T882 shared walkthrough key-frame harness (qa/critic-r1.md H1–H2). The engine starts the next beat (and its caption)
// synchronously when a beat finishes, so a beat's last frame cannot be caught after it ends. Instead the page pauses on
// EVERY frame of the step and Node keeps candidate screenshots of the running beat: the end frame is the last one taken
// inside the beat (pause / waiting / holding beats: taken at that status), the mid frame (insert / withdraw / release /
// working beats) the candidate nearest half the beat's engine time. Each written frame's dock caption must be its own
// beat's `say`. Old sNN-*.png of a step are deleted before the step writes its own.
export const SHOTS = 'qa/screenshots/walkthrough';
export const SCALE = 10;
const MID_KINDS = ['insert', 'withdraw', 'working'];

type Rect = { x: number; y: number; width: number; height: number };
/** What the page showed at a capture (read right after the screenshot, engine still paused). */
interface Probe {
  beat: number;
  caption: string;
  inset: Rect | null;
  dock: Rect | null;
  highlight: string | null;
}
export interface Shot extends Probe {
  name: string;
  at: 'mid' | 'end';
  index: number;
  id: string;
  kind: string;
  say: string;
}
export interface BeatRec {
  index: number;
  id: string;
  kind: string;
  say: string;
  /** State when the beat finished (framing measured, done++). */
  end: WalkState;
}
export interface StepRun {
  start: WalkState;
  end: WalkState;
  beats: BeatRec[];
  shots: Shot[];
}
interface Msg {
  type: 'cand' | 'final' | 'done';
  index: number;
  id: string;
  kind: string;
  say: string;
  mid: boolean;
  /** Engine ms into the beat (cand: at the capture; done: the beat's length). */
  e: number;
}
interface Cand extends Probe {
  e: number;
  buf: Buffer;
  insetBuf: Buffer | null;
}

const handlers = new WeakMap<Page, (m: Msg) => Promise<void>>();

export const fmt = (s: WalkState): string =>
  s.framing
    ? `pass ${s.framing.pass} off ${s.framing.offset.map((v) => v.toFixed(2)).join(',')} cov ${s.framing.coverage.toFixed(3)} un ${s.framing.unoccluded.toFixed(2)} tip ${s.framing.tipInside}`
    : 'no framing';

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => {
    const rect = (e: Element | null): Rect | null => {
      if (!(e instanceof HTMLElement) || !e.checkVisibility()) return null;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    };
    return {
      beat: window.__sim.walkthrough?.state().beat ?? -1,
      caption: document.querySelector('.shell-caption .guided-text')?.textContent ?? '',
      inset: rect(document.querySelector('#pip-walk-inset')),
      dock: rect(document.querySelector('.shell-caption')),
      highlight: window.__sim.highlight?.active ?? null,
    };
  });

/** seek(step) at ×scale and play it to 'holding' (or 'error'), writing sNN-bMM-<id>[-mid][-inset].png + sNN-final.png.
 *  Pause beats (step 1 parts) advance with Next after their end frame. */
export async function playStep(page: Page, step: number, scale = SCALE): Promise<StepRun> {
  const pfx = `s${String(step).padStart(2, '0')}`;
  mkdirSync(SHOTS, { recursive: true });
  for (const f of readdirSync(SHOTS))
    if (f.startsWith(`${pfx}-`) && f.endsWith('.png')) rmSync(`${SHOTS}/${f}`);
  if (!handlers.has(page))
    await page.exposeBinding('__wtShot', (_src, m: Msg) =>
      (handlers.get(page) as (m: Msg) => Promise<void>)(m),
    );

  const shots: Shot[] = [];
  let cands: Cand[] = [];
  const write = (c: Cand, m: Msg, at: Shot['at']): void => {
    const name = `${pfx}-b${String(m.index).padStart(2, '0')}-${m.id}${at === 'mid' ? '-mid' : ''}`;
    writeFileSync(`${SHOTS}/${name}.png`, c.buf);
    if (c.insetBuf) writeFileSync(`${SHOTS}/${name}-inset.png`, c.insetBuf);
    const { beat, caption, inset, dock, highlight } = c;
    const shot: Shot = {
      beat,
      caption,
      inset,
      dock,
      highlight,
      name,
      at,
      index: m.index,
      id: m.id,
      kind: m.kind,
      say: m.say,
    };
    const i = shots.findIndex((x) => x.name === name);
    if (i < 0) shots.push(shot);
    else shots[i] = shot; // a waiting / holding capture replaces the last running frame
  };
  handlers.set(page, async (m) => {
    if (m.type === 'done') {
      // End = the last frame inside the beat; mid = the candidate nearest half its engine time.
      const end = cands.at(-1);
      if (end) write(end, m, 'end');
      if (m.mid && cands.length) {
        const mid = cands.reduce((a, b) => (Math.abs(b.e - m.e / 2) < Math.abs(a.e - m.e / 2) ? b : a));
        write(mid, m, 'mid');
      }
      cands = [];
      return;
    }
    const buf = await page.screenshot();
    const p = await probe(page);
    if (p.beat !== m.index) return; // the beat ended during the capture: not its frame
    const c: Cand = {
      ...p,
      e: m.e,
      buf,
      insetBuf: p.inset ? await page.screenshot({ clip: p.inset }) : null,
    };
    if (m.type === 'final')
      write(c, m, 'end'); // waiting / holding: still this beat, framing measured
    else cands.push(c);
  });

  const run = await page.evaluate(
    ([n, k, midKinds]) =>
      new Promise<{ start: WalkState; end: WalkState; beats: BeatRec[] }>((res, rej) => {
        const w = window.__sim.walkthrough;
        const shot = (window as unknown as { __wtShot: (m: Msg) => Promise<void> }).__wtShot;
        if (!w) return rej(new Error('no walkthrough hook'));
        type Cur = Msg & { end: WalkState | null; final: boolean };
        const beats: BeatRec[] = [];
        let cur: Cur | null = null;
        let seen = 0;
        let busy = false;
        let last = 0;
        let over = false;
        let start: WalkState | null = null;
        const begin = (): Cur | null => {
          const b = w.currentBeat();
          if (!b) return null;
          const mid = midKinds.includes(b.kind) || b.act?.k === 'release';
          return {
            type: 'cand',
            index: b.index,
            id: b.id,
            kind: b.kind,
            say: b.say,
            mid,
            e: 0,
            end: null,
            final: false,
          };
        };
        const off = w.on('state', (s) => {
          if (s.step !== n || !start) return;
          if (s.done > seen && cur) {
            seen = s.done;
            cur.end = s;
            beats.push({ index: cur.index, id: cur.id, kind: cur.kind, say: cur.say, end: s });
            void shot({ ...cur, type: 'done' });
          } else if (!cur || s.beat !== cur.index) cur = begin();
        });
        const take = (m: Cur, type: Msg['type'], then: () => void): void => {
          busy = true;
          const paused = w.state().status === 'playing';
          if (paused) w.pause();
          void shot({ ...m, type }).then(() => {
            busy = false;
            if (paused && w.state().status === 'paused') w.play();
            then();
          });
        };
        const finish = (s: WalkState): void => {
          over = true;
          off();
          res({ start: start as WalkState, end: s, beats });
        };
        const frame = (now: number): void => {
          const dt = last ? now - last : 0;
          last = now;
          if (over) return;
          requestAnimationFrame(frame);
          if (busy || !cur) return;
          const s = w.state();
          if (s.step !== n) return;
          if (s.status === 'error') return finish(s);
          if (s.status === 'playing' && s.beat === cur.index && !cur.end) {
            cur.e += dt * k;
            take(cur, 'cand', () => {});
          } else if ((s.status === 'waiting' || s.status === 'holding') && s.beat === cur.index) {
            const c = cur;
            if (c.final) return s.status === 'holding' ? finish(s) : undefined;
            c.final = true;
            take(c, 'final', () => (s.status === 'waiting' ? w.next() : finish(w.state())));
          }
        };
        w.timeScale = k;
        void w.seek(n).then(() => {
          start = w.state();
          cur = begin();
          // First frame now, before any engine tick: the frame after a seek's rebuild is long (dt capped at
          // maxDtMs × timeScale) and can finish a short first beat (s06 'held', 800 ms) before rAF sees it.
          if (cur) take(cur, 'cand', () => {});
          requestAnimationFrame(frame);
        });
      }),
    [step, scale, MID_KINDS] as const,
  );
  await page.screenshot({ path: `${SHOTS}/${pfx}-final.png` });
  for (const x of shots) {
    const b = run.beats.find((y) => y.index === x.index);
    console.log(`${x.name} [${x.kind}] ${b ? fmt(b.end) : ''}`);
    expect.soft(x.caption, `${x.name}: dock caption is its own beat's`).toBe(x.say);
  }
  for (const b of run.beats)
    expect
      .soft(
        shots.some((x) => x.index === b.index && x.at === 'end'),
        `${pfx} ${b.id}: a frame inside the beat`,
      )
      .toBe(true);
  return { ...run, shots };
}
