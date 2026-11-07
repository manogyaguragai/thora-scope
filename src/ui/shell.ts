// App layout shell (§6.7): overlay regions over the full-bleed canvas. Plain DOM (ADR-007).
// The shell root ignores pointer events; only its panels take them, so the canvas stays interactive elsewhere.
import { config } from '../core/config';
import './panels.css';

export const SHELL_MODES = [
  { mode: 'guided', label: 'Guided walkthrough' },
  { mode: 'practice', label: 'Practice' },
  { mode: 'explore', label: 'Explore' },
  { mode: 'physiology', label: 'Physiology' },
  { mode: 'quiz', label: 'Quiz' },
] as const;
export type ShellMode = (typeof SHELL_MODES)[number]['mode'];

export interface Shell {
  root: HTMLElement;
  /** Mode switcher buttons, keyed by mode (data-mode attr). */
  modeButtons: Record<ShellMode, HTMLButtonElement>;
  /** Inside (scope) / Outside (theatre) view switch (T816); wired + aria-pressed in M3. */
  viewButtons: Record<ShellView, HTMLButtonElement>;
  /** T843 ventilation switch (One-lung / Two-lung); wired + aria-pressed in M3. */
  ventButtons: Record<ShellVent, HTMLButtonElement>;
  /** `?` button; the help overlay is wired in M3. */
  help: HTMLButtonElement;
  rail: HTMLElement;
  inspector: HTMLElement;
  /** T862 side dock (R5): walkthrough panel, practice bar, messages and the action toast, stacked in the right
   *  margin beside the scope aperture, above the vitals monitor. */
  caption: HTMLElement;
  /** Reserved for the M3 tool hotbar (§6.3). */
  hotbar: HTMLElement;
  ports: HTMLElement;
  /** Reflect the active mode: aria-pressed on the switcher + `data-mode` on the root for CSS. */
  setMode: (mode: ShellMode) => void;
}

export const SHELL_VIEWS = [
  { view: 'scope', label: 'Inside (scope)' },
  { view: 'outside', label: 'Outside (theatre)' },
] as const;
export type ShellView = (typeof SHELL_VIEWS)[number]['view'];

export const SHELL_VENTS = [
  { vent: 'one', text: 'One-lung', label: 'One-lung ventilation' },
  { vent: 'two', text: 'Two-lung', label: 'Two-lung ventilation' },
] as const;
export type ShellVent = (typeof SHELL_VENTS)[number]['vent'];

let uid = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/** Side panel with a header toggle (aria-expanded) that collapses its body; returns [panel, body]. */
function collapsible(side: 'rail' | 'inspector', label: string, region = label): [HTMLElement, HTMLElement] {
  const panel = el('aside', `shell-side shell-${side}`);
  panel.setAttribute('aria-label', region);
  const body = el('div', 'shell-side-body');
  body.id = `shell-${side}-${uid++}`;
  const toggle = el('button', 'shell-toggle');
  toggle.type = 'button';
  toggle.textContent = label;
  toggle.setAttribute('aria-controls', body.id);
  toggle.setAttribute('aria-expanded', 'true');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
  });
  panel.append(toggle, body);
  return [panel, body];
}

export function mountShell(host: HTMLElement, onModeSelect: (mode: ShellMode) => void): Shell {
  const root = el('div', 'shell');
  // T862: the dock width keeps the panels outside the central part of the 5:4 aperture (same letterbox fit as the
  // post-FX mask; panels.css --dock-w).
  const M = config.postfx;
  root.style.setProperty('--mask-aspect', String(M.maskAspect));
  root.style.setProperty('--mask-fill', String(M.maskFill));
  root.style.setProperty('--dock-clear', String(config.viewing.dockClearFrac));

  const top = el('header', 'shell-top');
  const name = el('span', 'shell-name');
  name.textContent = 'ThoraScope';
  const nav = el('nav', 'shell-modes');
  nav.setAttribute('aria-label', 'Mode');
  const modeButtons = {} as Record<ShellMode, HTMLButtonElement>;
  for (const { mode, label } of SHELL_MODES) {
    const b = el('button', 'shell-mode');
    b.type = 'button';
    b.dataset.mode = mode;
    b.textContent = label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onModeSelect(mode));
    modeButtons[mode] = b;
    nav.append(b);
  }
  const views = el('nav', 'shell-modes shell-views');
  views.setAttribute('aria-label', 'View');
  const viewButtons = {} as Record<ShellView, HTMLButtonElement>;
  for (const { view, label } of SHELL_VIEWS) {
    const b = el('button', 'shell-mode');
    b.type = 'button';
    b.dataset.view = view;
    b.textContent = label.split(' ')[0] ?? label; // compact text ('Inside' / 'Outside'); full name stays the accessible label
    b.setAttribute('aria-label', label);
    b.title = label;
    b.setAttribute('aria-pressed', 'false');
    viewButtons[view] = b;
    views.append(b);
  }
  const vents = el('nav', 'shell-modes shell-vents');
  vents.setAttribute('aria-label', 'Ventilation');
  const ventTitle = el('span', 'shell-vents-title');
  ventTitle.textContent = 'Ventilation';
  ventTitle.setAttribute('aria-hidden', 'true');
  vents.append(ventTitle);
  const ventButtons = {} as Record<ShellVent, HTMLButtonElement>;
  for (const { vent, text, label } of SHELL_VENTS) {
    const b = el('button', 'shell-mode');
    b.type = 'button';
    b.dataset.vent = vent;
    b.textContent = text;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.setAttribute('aria-pressed', 'false');
    ventButtons[vent] = b;
    vents.append(b);
  }
  const help = el('button', 'shell-help');
  help.type = 'button';
  help.textContent = '?';
  help.setAttribute('aria-label', 'Keyboard shortcuts');
  top.append(name, nav, views, vents, help);

  const [railPanel, rail] = collapsible('rail', 'Steps', 'Guided walkthrough steps');
  const [inspectorPanel, inspector] = collapsible('inspector', 'Inspector');
  const right = el('div', 'shell-right');
  const caption = el('div', 'shell-caption');
  right.append(inspectorPanel, caption);

  const bottom = el('div', 'shell-bottom');
  const dock = el('div', 'shell-dock');
  const hotbar = el('div', 'shell-hotbar');
  const ports = el('div', 'shell-ports');
  dock.append(hotbar, ports);
  bottom.append(dock);

  root.append(top, railPanel, right, bottom);
  host.append(root);

  const setMode = (mode: ShellMode): void => {
    root.dataset.mode = mode;
    for (const { mode: m } of SHELL_MODES) modeButtons[m].setAttribute('aria-pressed', String(m === mode));
  };
  setMode('guided');

  return {
    root,
    modeButtons,
    viewButtons,
    ventButtons,
    help,
    rail,
    inspector,
    caption,
    hotbar,
    ports,
    setMode,
  };
}
