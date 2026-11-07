// Guided walkthrough UI (§6.1 item 1, FEEDBACK_GUIDED_v1 §2.3 + R5): step rail on the left (with the walkthrough's
// sub-progress) and, in the right side dock above the vitals monitor, the walkthrough panel (title, Prev / Replay /
// Pause / Next, the beat caption, learning points) plus side messages. Playback runs through
// window.__sim.walkthrough (T860 timeline) when it exists, else the panel drives the guided controller directly.
// Plain DOM (ADR-007). Event-driven: the DOM is rewritten on step / walkthrough events only, never per frame.
import type { WalkState, WalkthroughHook } from '../app/walkthrough/types';
import type { GuidedStep } from '../content/steps';
import { config } from '../core/config';
import { keybindings, matchesKey } from '../core/keybindings';
import { onModeChange } from '../sim/modes';
import { PORT_LABELS } from '../sim/ports';
import type { Shell } from './shell';
import './panels.css';

const READY_POLL_MS = 100; // the walkthrough hook may land after mount (load time only)
const MSG_MAX = config.viewing.walkMsgMax;

/** What the panel needs from src/sim/guided.ts. */
export interface GuidedNav {
  /** Current step number (GuidedStep.step). */
  readonly current: number;
  next: () => void;
  prev: () => void;
  goTo: (n: number) => void;
  on: (event: 'stepchange', cb: (n: number) => void) => void;
  off: (event: 'stepchange', cb: (n: number) => void) => void;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function button(className: string, text: string, aria: string, run: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', className: `panel-button ${className}`, textContent: text });
  b.setAttribute('aria-label', aria);
  b.title = aria;
  b.addEventListener('click', run);
  return b;
}

/** The T860 engine hook, null until it is wired. */
const hook = (): WalkthroughHook | null =>
  (window.__sim as { walkthrough?: WalkthroughHook | null } | undefined)?.walkthrough ?? null;

/** Mounts the step list into shell.rail and the walkthrough panel into the side dock; returns a dispose function. */
export function mountGuidedPanel(shell: Shell, guided: GuidedNav, steps: readonly GuidedStep[]): () => void {
  const sub = h('span', { className: 'guided-sub', hidden: true });
  const items = steps.map((s) => {
    const b = h(
      'button',
      { type: 'button', className: 'guided-step' },
      h('span', { className: 'guided-step-num' }, String(s.step)),
      s.rail,
    );
    b.setAttribute('aria-label', `${s.step}. ${s.title}`);
    b.title = s.title;
    b.addEventListener('click', () => {
      const w = attach();
      if (w) void w.seek(s.step);
      else guided.goTo(s.step);
    });
    return b;
  });
  const list = h('ol', { className: 'guided-steps' }, ...items.map((b) => h('li', {}, b)));
  list.setAttribute('aria-label', 'Guided walkthrough steps');

  const title = h('h2', { className: 'guided-title' });
  title.setAttribute('aria-live', 'polite');
  const counter = h('span', { className: 'guided-counter' });
  const port = h('span', { className: 'guided-port' });
  const caption = h('p', { className: 'guided-text' }); // beat caption (walkthrough) or the step caption
  caption.setAttribute('aria-live', 'polite');
  const points = h('ul', { className: 'guided-points' });
  const video = h('p', { className: 'guided-video' });
  const note = h('p', { className: 'guided-note' });
  const msgs = h('ul', { className: 'guided-msgs', hidden: true });
  msgs.setAttribute('aria-label', 'Walkthrough messages');
  msgs.setAttribute('aria-live', 'polite');

  // T851: from the theatre (outside view), the first Next / PageDown only takes the scope in at step 1 (wireM3
  // enterScope). data-view is the view shown before this input.
  const advance = (): void => {
    if (guided.current === steps[0]?.step && shell.root.dataset.view !== 'scope') return;
    const w = attach();
    if (w) w.next();
    else guided.next();
  };
  const back = (): void => {
    const w = attach();
    if (w) w.prev();
    else guided.prev();
  };
  const prev = button('guided-nav', 'Prev', 'Previous step', back);
  const next = button('guided-nav', 'Next', 'Next step', advance);
  const replay = button('guided-play', '↻', 'Replay step', () => attach()?.replay());
  const play = button('guided-play', '▶', 'Play', () => {
    const w = attach();
    if (w?.state().status === 'playing') w.pause();
    else w?.play();
  });

  // Learning points, video note and model note sit behind "More" (T205).
  const details = h(
    'div',
    { className: 'guided-details', id: 'guided-details', hidden: true },
    points,
    video,
    note,
  );
  const more = h('button', { type: 'button', className: 'panel-button guided-more', textContent: 'More' });
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', details.id);
  more.addEventListener('click', () => {
    details.hidden = !details.hidden;
    more.textContent = details.hidden ? 'More' : 'Less';
    more.setAttribute('aria-expanded', String(!details.hidden));
  });
  const body = h('div', { className: 'guided-body', id: 'guided-body' }, caption, more, details);
  // R5: collapsible (only the head + controls stay).
  const fold = h('button', { type: 'button', className: 'panel-button guided-fold', textContent: '−' });
  fold.setAttribute('aria-label', 'Step text');
  fold.setAttribute('aria-expanded', 'true');
  fold.setAttribute('aria-controls', body.id);
  fold.addEventListener('click', () => {
    body.hidden = !body.hidden;
    fold.textContent = body.hidden ? '+' : '−';
    fold.setAttribute('aria-expanded', String(!body.hidden));
  });
  const bar = h(
    'section',
    { className: 'guided-caption' },
    h('div', { className: 'guided-head' }, title, fold),
    h('div', { className: 'guided-meta' }, port, counter),
    h('div', { className: 'guided-controls' }, prev, replay, play, next),
    body,
  );
  bar.setAttribute('aria-label', 'Guided walkthrough');

  let shown = 0; // step number on screen
  let said = 0; // step whose beat caption is on screen (a caption may arrive before the step's state event)
  const render = (n: number): void => {
    const i = Math.max(
      0,
      steps.findIndex((s) => s.step === n),
    );
    const s = steps[i];
    if (!s) return;
    shown = s.step;
    items.forEach((b, j) =>
      j === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current'),
    );
    items[i]?.append(sub);
    title.textContent = s.title;
    counter.textContent = `${i + 1} / ${steps.length}`;
    port.textContent = s.portLabel;
    if (said !== s.step) caption.textContent = s.caption; // replaced by the beat captions while the walkthrough plays
    points.replaceChildren(...s.points.map((p) => h('li', {}, p)));
    video.textContent = `${s.video.text} (${s.video.from}–${s.video.to})`;
    note.textContent = s.note ?? '';
    note.hidden = !s.note;
    clearMsgs();
    prev.disabled = i === 0;
    next.disabled = i === steps.length - 1;
    // Restart the enter animation (opacity/transform; 0 ms under reduced motion via tokens.css).
    body.classList.remove('guided-enter');
    void body.offsetWidth;
    body.classList.add('guided-enter');
  };

  const clearMsgs = (): void => {
    msgs.replaceChildren();
    msgs.hidden = true;
  };
  // T872: walkthrough messages belong to the walkthrough: none carried into (or arriving during) another mode.
  const pushMsg = (text: string): void => {
    if (!text || shell.root.dataset.mode !== 'guided') return;
    msgs.append(h('li', {}, text));
    while (msgs.childElementCount > MSG_MAX) msgs.firstElementChild?.remove();
    msgs.hidden = false;
  };
  let lastBeat = 0;
  const onState = (s: WalkState): void => {
    if (s.step !== shown) render(s.step);
    else if (s.beat < lastBeat) clearMsgs(); // U4: a seek / replay back inside the step drops stale messages
    lastBeat = s.beat;
    port.textContent = PORT_LABELS[s.scopePort] ?? s.scopePort; // U3: where the scope is now, not the step's declared port
    sub.textContent = s.sub ? `${s.sub.at}/${s.sub.of}` : '';
    sub.hidden = !s.sub;
    const playing = s.status === 'playing';
    play.textContent = playing ? '❚❚' : '▶';
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    play.title = playing ? 'Pause' : 'Play';
    prev.disabled = s.step === steps[0]?.step && (!s.sub || s.sub.at <= 1);
    if (s.status === 'error' && s.error) pushMsg(s.error);
  };

  let walk: WalkthroughHook | null = null;
  /** Subscribes once the T860 hook exists; null = fall back to the guided controller. */
  function attach(): WalkthroughHook | null {
    if (walk) return walk;
    walk = hook();
    replay.disabled = play.disabled = !walk;
    if (!walk) return null;
    walk.on('caption', (s, text) => {
      said = s.step;
      caption.textContent = text;
    });
    walk.on('msg', (_s, text) => pushMsg(text));
    walk.on('state', (s) => onState(s));
    onState(walk.state());
    return walk;
  }

  const onKey = (e: KeyboardEvent): void => {
    if (shell.root.dataset.mode !== 'guided' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]'))
      return;
    if (matchesKey(keybindings.guidedNext, e.code)) advance();
    else if (matchesKey(keybindings.guidedPrev, e.code)) back();
    else return;
    e.preventDefault();
  };
  const onStep = (n: number): void => {
    attach();
    if (n !== shown) render(n);
  };

  render(guided.current);
  guided.on('stepchange', onStep);
  onModeChange(clearMsgs);
  window.addEventListener('keydown', onKey);
  shell.rail.append(list);
  shell.caption.append(bar, msgs);
  const poll = (): void => {
    if (!attach() && !window.__perf?.ready) window.setTimeout(poll, READY_POLL_MS);
  };
  poll();
  return () => {
    guided.off('stepchange', onStep);
    window.removeEventListener('keydown', onKey);
    list.remove();
    bar.remove();
    msgs.remove();
  };
}
