// Practice debrief (CONTEXT §6.1 mode 2, §6.10 lazy chunk + render on demand). Load with dynamic import(); imports
// only the pure scoring module, never three. Native <dialog>.showModal() gives the focus trap, Esc close and focus
// return. While open the scene is static: callers pause the frame loop (`renderOnDemand`) until onClose.
import { ERROR_LABELS, type ScoreBreakdown } from '../sim/scoring';
import type { PracticeErrorKind } from '../sim/practice';
import './debrief.css';

export interface DebriefCallbacks {
  /** Retry pressed: fires before the dialog closes (onClose follows). */
  readonly onRetry?: () => void;
  /** Fires once whenever the dialog closes (Close, Esc, Retry): resume the loop here. */
  readonly onClose?: () => void;
}

export interface DebriefHandle {
  /** Hint for main.ts: nothing animates behind the modal, so pause the loop while it is open. */
  readonly renderOnDemand: true;
  close(): void;
}

let dialog: HTMLDialogElement | null = null;
let callbacks: DebriefCallbacks = {};

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

function build(): HTMLDialogElement {
  const d = el('dialog', 'debrief');
  d.setAttribute('aria-labelledby', 'debrief-title');
  // Keep scope/tool shortcuts from firing behind the modal.
  d.addEventListener('keydown', (e) => e.stopPropagation());
  d.addEventListener('close', () => callbacks.onClose?.());
  return d;
}

function fill(d: HTMLDialogElement, b: ScoreBreakdown): void {
  const head = el('div', 'debrief-head');
  const title = el('h2', 'debrief-title', 'Case debrief');
  title.id = 'debrief-title';
  head.append(title);

  const total = el('p', 'debrief-total');
  total.append(el('strong', undefined, String(b.total)), ' / 100');
  if (!b.finished) total.append(el('span', 'debrief-muted', ' (incomplete)'));

  const list = el('dl', 'debrief-items');
  for (const i of b.items) {
    const dt = el('dt', 'debrief-item');
    dt.append(el('span', undefined, i.label), el('span', 'debrief-points', `${i.points} / ${i.weight}`));
    list.append(dt, el('dd', 'debrief-detail', i.detail));
  }

  const body = el('div', 'debrief-body');
  body.append(total, list);
  const errs = (Object.keys(b.errors) as PracticeErrorKind[]).filter((k) => b.errors[k] > 0);
  if (errs.length) {
    const sec = el('section', 'debrief-group');
    sec.append(el('h3', 'debrief-group-title', 'Errors by type'));
    const ul = el('ul', 'debrief-errors');
    for (const k of errs) ul.append(el('li', undefined, `${ERROR_LABELS[k]}: ${b.errors[k]}`));
    sec.append(ul);
    body.append(sec);
  }

  const actions = el('div', 'debrief-actions');
  const retry = button('Retry case', 'debrief-button debrief-primary', () => {
    callbacks.onRetry?.();
    d.close();
  });
  retry.autofocus = true;
  actions.append(
    retry,
    button('Close', 'debrief-button', () => d.close()),
  );

  d.replaceChildren(head, body, actions);
}

/** Show the debrief for `breakdown`. One dialog is built on first open and refilled afterwards. */
export function openDebrief(
  host: HTMLElement,
  breakdown: ScoreBreakdown,
  cb: DebriefCallbacks = {},
): DebriefHandle {
  if (!dialog) {
    dialog = build();
    host.append(dialog);
  }
  callbacks = cb;
  fill(dialog, breakdown);
  if (!dialog.open) dialog.showModal();
  return { renderOnDemand: true, close: closeDebrief };
}

export function closeDebrief(): void {
  dialog?.close();
}

export const isDebriefOpen = (): boolean => dialog?.open ?? false;
