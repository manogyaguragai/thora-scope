// Quiz panel (CONTEXT §6.6, §6.7). Lazy chunk: load with dynamic import(); no three import. Non-modal <dialog>
// (.show()) so the scene stays clickable for "identify" items; main.ts feeds picker clicks through the callback it
// receives from onIdentifyRequest. DOM changes only on answer/next/close events. Keys: 1-9 choose an option,
// Enter activates the focused button, Esc closes.
import { labelFor } from '../content/labels';
import {
  answer,
  createSession,
  currentItem,
  isFinished,
  reviewList,
  score,
  type QuizAnswer,
  type QuizItem,
  type QuizSession,
} from '../sim/quiz';
import './panels.css';
import './quiz.css';

export interface QuizOptions {
  /** Called with a pick handler while an identify item waits for a click, and with null when it stops waiting. */
  readonly onIdentifyRequest: (cb: ((nodeName: string) => void) | null) => void;
  /** Fires once whenever the panel closes (Close button, Esc, handle.close()). */
  readonly onClose?: () => void;
  /** Shuffle seed; defaults to the current time (a fresh order per open). */
  readonly seed?: number;
  /** Items per session; defaults to every item. */
  readonly count?: number;
}

export interface QuizHandle {
  close(): void;
}

let dialog: HTMLDialogElement | null = null;
let opts: QuizOptions | null = null;
let session: QuizSession | null = null;
/** Option buttons of the next-step question on screen (empty otherwise) — the targets of number keys. */
let optionButtons: HTMLButtonElement[] = [];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

const nodeName = (node: string): string => labelFor(node).name;

const questionText = (q: QuizItem): string => (q.kind === 'identify' ? q.item.prompt : q.item.situation);

const correctText = (q: QuizItem): string =>
  q.kind === 'identify' ? nodeName(q.item.node) : (q.item.options[q.item.correctIndex] ?? '');

function givenText(a: QuizAnswer): string {
  if (a.given === '') return 'Skipped';
  if (a.item.kind === 'identify') return nodeName(String(a.given));
  return a.item.item.options[Number(a.given)] ?? '';
}

/** Replace the panel body; focus `focus` (the primary control of the new state). */
function show(
  head: string,
  body: readonly Node[],
  actions: readonly HTMLButtonElement[],
  focus?: HTMLElement,
): void {
  if (!dialog) return;
  const top = el('div', 'quiz-head');
  const title = el('h2', 'quiz-title', 'Quiz');
  title.id = 'quiz-title';
  top.append(title, el('span', 'quiz-muted', head), button('Close', 'quiz-button', closeQuiz));
  const main = el('div', 'quiz-body');
  main.append(...body);
  const bar = el('div', 'quiz-actions');
  bar.append(...actions);
  dialog.replaceChildren(top, main, bar);
  focus?.focus();
}

const progress = (s: QuizSession): string => `${Math.min(s.index + 1, s.items.length)} / ${s.items.length}`;

function renderQuestion(): void {
  const s = session;
  const q = s && currentItem(s);
  if (!s || !q || !opts) return;
  optionButtons = [];
  const prompt = el('p', 'quiz-prompt', questionText(q));
  if (q.kind === 'identify') {
    const skip = button('Skip', 'quiz-button', () => submit(''));
    show(progress(s), [prompt, el('p', 'quiz-muted', 'Click the structure in the view.')], [skip], skip);
    opts.onIdentifyRequest(submit);
    return;
  }
  opts.onIdentifyRequest(null);
  const list = el('ol', 'quiz-options');
  optionButtons = q.item.options.map((text, i) => {
    const b = button('', 'quiz-button quiz-option', () => submit(i));
    b.append(el('kbd', undefined, String(i + 1)), text);
    const li = el('li');
    li.append(b);
    list.append(li);
    return b;
  });
  show(progress(s), [prompt, el('p', 'quiz-muted', 'What is the next step?'), list], [], optionButtons[0]);
}

function submit(given: string | number): void {
  if (!session || !opts) return;
  const a = answer(session, given);
  if (!a) return;
  opts.onIdentifyRequest(null);
  optionButtons = [];
  const fb = el('div', a.correct ? 'quiz-feedback quiz-correct' : 'quiz-feedback quiz-wrong');
  fb.setAttribute('role', 'status');
  fb.append(el('p', 'quiz-verdict', a.correct ? 'Correct' : 'Not quite'));
  if (!a.correct) {
    fb.append(
      el('p', undefined, `Your answer: ${givenText(a)}`),
      el('p', undefined, `Answer: ${correctText(a.item)}`),
    );
  }
  const why = a.item.kind === 'identify' ? labelFor(a.item.item.node).description : a.item.item.rationale;
  fb.append(el('p', 'quiz-rationale', why), el('span', 'panel-badge', 'Pending clinician review'));
  const done = isFinished(session);
  const next = button(
    done ? 'See results' : 'Next',
    'quiz-button quiz-primary',
    done ? renderResults : renderQuestion,
  );
  show(
    `${session.index} / ${session.items.length}`,
    [el('p', 'quiz-prompt', questionText(a.item)), fb],
    [next],
    next,
  );
}

function renderResults(): void {
  if (!session || !opts) return;
  const sc = score(session);
  const total = el('p', 'quiz-total');
  total.append(el('strong', undefined, String(sc.correct)), ` / ${sc.total} correct`);
  const body: Node[] = [total];
  const misses = reviewList(session);
  if (misses.length) {
    body.push(el('h3', 'quiz-group-title', 'Review'));
    const dl = el('dl', 'quiz-review');
    for (const m of misses)
      dl.append(el('dt', undefined, questionText(m.item)), el('dd', 'quiz-muted', correctText(m.item)));
    body.push(dl);
  }
  body.push(el('span', 'panel-badge', 'Pending clinician review'));
  const seed = session.seed + 1;
  const count = session.items.length;
  const again = button('Try again', 'quiz-button quiz-primary', () => start(seed, count));
  show('Results', body, [again, button('Close', 'quiz-button', closeQuiz)], again);
}

function start(seed: number, count?: number): void {
  session = createSession(seed, count);
  renderQuestion();
}

function onKey(e: KeyboardEvent): void {
  // Keep scope/tool shortcuts (digits select hotbar slots) from firing while focus is in the quiz.
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    closeQuiz();
    return;
  }
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  const b = m ? optionButtons[Number(m[1]) - 1] : undefined;
  if (b) {
    e.preventDefault();
    b.click();
  }
}

/** Open the quiz with a fresh session (idempotent if already open: restarts). One dialog is built and reused. */
export function openQuiz(host: HTMLElement, options: QuizOptions): QuizHandle {
  if (!dialog) {
    dialog = el('dialog', 'quiz');
    dialog.setAttribute('aria-labelledby', 'quiz-title');
    dialog.addEventListener('keydown', onKey);
    dialog.addEventListener('close', () => {
      opts?.onIdentifyRequest(null);
      optionButtons = [];
      session = null;
      const cb = opts?.onClose;
      opts = null;
      cb?.();
    });
    host.append(dialog);
  }
  opts = options;
  if (!dialog.open) dialog.show();
  start(options.seed ?? Date.now() >>> 0, options.count);
  return { close: closeQuiz };
}

export function closeQuiz(): void {
  dialog?.close();
}

export const isQuizOpen = (): boolean => dialog?.open ?? false;

/** Live session (null when closed): the item on screen + score, for the e2e hook. */
export const quizSession = (): QuizSession | null => session;
