// Guided procedure UI (§6.1 item 1): step list in the left rail + caption bar above the hotbar dock.
// Plain DOM (ADR-007). Event-driven: the DOM is rewritten only on 'stepchange', never per frame.
type Demo = typeof import('../app/guidedDemo');
import type { GuidedStep } from '../content/steps';
import { keybindings, matchesKey } from '../core/keybindings';
import { onModeChange } from '../sim/modes';
import type { Shell } from './shell';
import './panels.css';

const READY_POLL_MS = 100; // ?demo= waits for the app's "ready" (load time only)

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

function navButton(text: string, aria: string, run: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', className: 'panel-button guided-nav', textContent: text });
  b.setAttribute('aria-label', aria);
  b.addEventListener('click', run);
  return b;
}

/** Mounts the step list into shell.rail and the caption bar into shell.caption; returns a dispose function. */
export function mountGuidedPanel(shell: Shell, guided: GuidedNav, steps: readonly GuidedStep[]): () => void {
  const items = steps.map((s) => {
    const b = h(
      'button',
      { type: 'button', className: 'guided-step' },
      h('span', { className: 'guided-step-num' }, String(s.step)),
      s.rail,
    );
    b.setAttribute('aria-label', `${s.step}. ${s.title}`);
    b.title = s.title;
    b.addEventListener('click', () => guided.goTo(s.step));
    return b;
  });
  const list = h('ol', { className: 'guided-steps' }, ...items.map((b) => h('li', {}, b)));

  const title = h('h2', { className: 'guided-title' });
  title.setAttribute('aria-live', 'polite');
  const counter = h('span', { className: 'guided-counter' });
  const port = h('span', { className: 'guided-port' });
  const caption = h('p', { className: 'guided-text' });
  const points = h('ul', { className: 'guided-points' });
  const video = h('p', { className: 'guided-video' });
  const note = h('p', { className: 'guided-note' });
  // T844 "Show me": the step's scripted demonstration (Guided here, Explore in its own small bar); Stop skips it.
  const demoText = h('p', { className: 'guided-demo-text', hidden: true });
  demoText.setAttribute('aria-live', 'polite');
  const exploreText = h('p', { className: 'guided-demo-text', hidden: true });
  exploreText.setAttribute('aria-live', 'polite');
  let demoRunning = false;
  let demo: Demo | null = null; // lazy chunk (keeps the scripts out of the initial bundle)
  const showMe = [
    h('button', { type: 'button', className: 'panel-button guided-demo', textContent: 'Show me' }),
    h('button', { type: 'button', className: 'panel-button guided-demo', textContent: 'Show me' }),
  ];
  const setDemo = (running: boolean, text = ''): void => {
    demoRunning = running;
    for (const b of showMe) {
      b.textContent = running ? 'Stop' : b === showMe[1] ? `Show me step ${guided.current}` : 'Show me';
      b.setAttribute('aria-label', running ? 'Stop the demonstration' : 'Show me this step');
      b.disabled = !running && !demo?.hasDemo(guided.current);
    }
    for (const t of [demoText, exploreText]) {
      t.textContent = text;
      t.hidden = !text;
    }
  };
  // T851 "Try it": back to the step's start after a demo (a reload when the demo divided / removed something).
  const tryIt = h('button', {
    type: 'button',
    className: 'panel-button guided-demo',
    textContent: 'Try it',
    hidden: true,
  });
  tryIt.setAttribute('aria-label', 'Try this step yourself');
  tryIt.addEventListener('click', () => {
    tryIt.hidden = true;
    if (!demo) return;
    if (demo.pristine(guided.current)) demo.applyStart(guided.current);
    else demo.reloadInto(guided.current, 'try');
  });
  const toggleDemo = (fresh = false): void => {
    if (!demo) return;
    tryIt.hidden = true;
    if (demoRunning) {
      demo.stopDemo();
      return setDemo(false);
    }
    setDemo(true);
    void demo
      .runDemo(guided.current, (t) => setDemo(true, t), fresh)
      .then((r) => {
        if (r === 'reload') return; // the page reloads into the step and plays it there
        tryIt.hidden = false;
        if (r !== 'stopped') setDemo(false, r === 'done' ? '' : `Demonstration stopped: ${r}`);
      });
  };
  for (const b of showMe) b.addEventListener('click', () => toggleDemo());
  const exploreBar = h('section', { className: 'guided-demo-bar' }, showMe[1] as HTMLElement, exploreText);
  exploreBar.setAttribute('aria-label', 'Demonstration');
  exploreBar.style.cssText =
    'display:flex;gap:var(--space-1);align-items:center;padding:var(--space-1) var(--space-2);background:var(--color-surface-overlay);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-lg)';
  const showExplore = (mode: string | undefined): void => {
    exploreBar.hidden = mode !== 'explore';
    exploreBar.style.display = exploreBar.hidden ? 'none' : 'flex'; // inline display beats [hidden]
  };
  onModeChange((m) => {
    if (demoRunning) demo?.stopDemo();
    setDemo(false);
    showExplore(m);
  });
  // T851: from the theatre (outside view), the first Next / PageDown only takes the scope in at step 1 (wireM3
  // enterScope); it used to skip straight to step 2. data-view is the view shown before this input.
  const advance = (): void => {
    if (guided.current === steps[0]?.step && shell.root.dataset.view !== 'scope') return;
    guided.next();
  };
  const prev = navButton('Prev', 'Previous step', () => guided.prev());
  const next = navButton('Next', 'Next step', advance);
  // Learning points, video note and model note sit behind "More" so the bar stays short (T205).
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
  const body = h('div', { className: 'guided-body' }, caption, details);
  const bar = h(
    'section',
    { className: 'guided-caption' },
    h(
      'div',
      { className: 'guided-head' },
      title,
      port,
      h('div', { className: 'guided-controls' }, showMe[0] as HTMLElement, tryIt, more, prev, counter, next),
    ),
    demoText,
    body,
  );
  bar.setAttribute('aria-label', 'Guided procedure');

  const render = (n: number): void => {
    const i = Math.max(
      0,
      steps.findIndex((s) => s.step === n),
    );
    const s = steps[i];
    if (!s) return;
    items.forEach((b, j) =>
      j === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current'),
    );
    title.textContent = s.title;
    counter.textContent = `${i + 1} / ${steps.length}`;
    port.textContent = s.portLabel;
    caption.textContent = s.caption;
    points.replaceChildren(...s.points.map((p) => h('li', {}, p)));
    video.textContent = `${s.video.text} (${s.video.from}–${s.video.to})`;
    note.textContent = s.note ?? '';
    note.hidden = !s.note;
    if (demoRunning) demo?.stopDemo();
    setDemo(false);
    tryIt.hidden = true;
    prev.disabled = i === 0;
    next.disabled = i === steps.length - 1;
    // Restart the enter animation (opacity/transform; 0 ms under reduced motion via tokens.css).
    body.classList.remove('guided-enter');
    void body.offsetWidth;
    body.classList.add('guided-enter');
  };

  const onKey = (e: KeyboardEvent): void => {
    if (shell.root.dataset.mode !== 'guided' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]'))
      return;
    if (matchesKey(keybindings.guidedNext, e.code)) advance();
    else if (matchesKey(keybindings.guidedPrev, e.code)) guided.prev();
    else return;
    e.preventDefault();
  };

  render(guided.current);
  guided.on('stepchange', render);
  window.addEventListener('keydown', onKey);
  shell.rail.append(list);
  shell.caption.append(bar, exploreBar);
  showExplore(shell.root.dataset.mode);
  void import('../app/guidedDemo').then((d) => {
    demo = d;
    if (!demoRunning) setDemo(false);
    // T851: a reload into a step (?demo=run plays its demo, ?demo=try starts it) once the app is ready.
    const u = new URL(location.href);
    const want = u.searchParams.get('demo');
    if (want !== 'run' && want !== 'try') return;
    u.searchParams.delete('demo');
    history.replaceState(history.state, '', u);
    const go = (): void => {
      if (!window.__perf?.ready) return void window.setTimeout(go, READY_POLL_MS);
      if (want === 'run') toggleDemo(true);
      else d.applyStart(guided.current);
    };
    go();
  });
  return () => {
    guided.off('stepchange', render);
    window.removeEventListener('keydown', onKey);
    list.remove();
    bar.remove();
    exploreBar.remove();
  };
}
