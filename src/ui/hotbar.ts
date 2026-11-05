// Tool hotbar dock + port status chips (CONTEXT §6.3, §6.7). Plain DOM (ADR-007), event-driven: DOM writes only
// on hotbar 'change' / setOccupant, never per frame.
import type { Hotbar, HotbarSlot } from '../sim/hotbar';
import { SLOTS } from '../sim/hotbar';
import { ensureIconSprite, icon } from './icons';
import './hotbar.css';

const slotLabel = (s: HotbarSlot, sub: number): string =>
  s.subOptions.length ? `${s.name}: ${s.subOptions[sub]}` : s.name;

/** Mounts the dock into `host` (the shell's bottom hotbar host); returns a dispose function. */
export function mountHotbar(host: HTMLElement, hotbar: Hotbar): () => void {
  ensureIconSprite();
  const bar = document.createElement('div');
  bar.className = 'hotbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Instruments');

  const slots = SLOTS.map((slot, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hotbar-slot';
    btn.dataset.slot = slot.id;
    const key = document.createElement('span');
    key.className = 'hotbar-key';
    key.textContent = String(i + 1);
    key.setAttribute('aria-hidden', 'true');
    const svg = icon(slot.icon);
    const tip = document.createElement('span');
    tip.className = 'hotbar-tip';
    tip.setAttribute('aria-hidden', 'true'); // aria-label already carries name + sub-option
    const dots = slot.subOptions.map(() => document.createElement('i'));
    const dotRow = document.createElement('span');
    dotRow.className = 'hotbar-dots';
    dotRow.append(...dots);
    btn.append(key, svg, tip, dotRow);
    btn.addEventListener('click', () => hotbar.select(i));
    return { slot, btn, use: svg.firstElementChild as SVGUseElement, tip, dots };
  });

  function render(i: number): void {
    const s = slots[i];
    if (!s) return;
    const { slot, btn, use, tip, dots } = s;
    const active = i === hotbar.slot;
    const sub = hotbar.subOption(i);
    const text = slotLabel(slot, sub);
    btn.setAttribute('aria-label', `${text} (key ${i + 1})`);
    btn.setAttribute('aria-pressed', String(active));
    btn.tabIndex = active ? 0 : -1;
    tip.textContent = text;
    use.setAttribute('href', `#${slot.subIcons?.[sub] ?? slot.icon}`);
    dots.forEach((d, k) => d.classList.toggle('on', k === sub));
  }

  let shown = hotbar.slot;
  for (let i = 0; i < slots.length; i++) render(i);
  const off = hotbar.on('change', ({ slot }) => {
    const moveFocus = bar.contains(document.activeElement);
    if (slot !== shown) render(shown);
    render(slot);
    shown = slot;
    if (moveFocus) slots[slot]?.btn.focus();
  });

  // Roving tabindex: arrows/Home/End move focus only; Enter/Space (native click) selects.
  bar.addEventListener('keydown', (e) => {
    const cur = slots.findIndex((s) => s.btn === document.activeElement);
    if (cur < 0) return;
    const n = slots.length;
    const next =
      e.key === 'ArrowRight'
        ? (cur + 1) % n
        : e.key === 'ArrowLeft'
          ? (cur - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation(); // arrows are also guided prev/next globally
    slots.forEach((s, k) => (s.btn.tabIndex = k === next ? 0 : -1));
    slots[next]?.btn.focus();
  });
  // Leaving the toolbar resets the tab stop to the active slot.
  bar.addEventListener('focusout', (e) => {
    if (bar.contains(e.relatedTarget as Node | null)) return;
    slots.forEach((s, i) => (s.btn.tabIndex = i === hotbar.slot ? 0 : -1));
  });

  bar.append(...slots.map((s) => s.btn));
  host.append(bar);
  return () => {
    off();
    bar.remove();
  };
}

export interface PortChip {
  id: string;
  label: string;
}

export interface PortChips {
  setOccupant(portId: string, text: string): void;
  /** Mark the scope's port (aria-pressed). */
  setCurrent(portId: string): void;
  dispose(): void;
}

/** Port status chips (occupant per port), shown beside the dock; each is a button that moves the scope there
 *  (T808). Update via `setOccupant` / `setCurrent` (event-driven). */
export function mountPortChips(
  host: HTMLElement,
  ports: readonly PortChip[],
  getOccupant: (portId: string) => string,
  onSelect: (portId: string) => void,
): PortChips {
  const list = document.createElement('div');
  list.className = 'port-chips';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Scope port: click to view from that port');
  const occ = new Map<string, HTMLElement>();
  const btns = new Map<string, HTMLButtonElement>();
  for (const p of ports) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'port-chip';
    btn.dataset.port = p.id;
    btn.setAttribute('aria-pressed', 'false');
    btn.title = `View from the ${p.label.toLowerCase()} (Shift+P)`;
    const name = document.createElement('span');
    name.className = 'port-chip-name';
    name.textContent = p.label;
    const who = document.createElement('span');
    who.className = 'port-chip-occupant';
    who.textContent = getOccupant(p.id);
    btn.append(name, who);
    btn.addEventListener('click', () => onSelect(p.id));
    occ.set(p.id, who);
    btns.set(p.id, btn);
    list.append(btn);
  }
  host.append(list);
  return {
    setOccupant(portId, text) {
      const el = occ.get(portId);
      if (el && el.textContent !== text) el.textContent = text;
    },
    setCurrent(portId) {
      for (const [id, b] of btns) b.setAttribute('aria-pressed', String(id === portId));
    },
    dispose: () => list.remove(),
  };
}

export interface RetractionStrip {
  /** Number of held instruments (enables Release, shows the count). */
  setHeld(n: number): void;
  dispose(): void;
}

/** T820: Hold / Release buttons beside the port chips, keys shown (G, Shift+G). Event-driven DOM writes only. */
export function mountRetractionStrip(
  host: HTMLElement,
  on: { hold: () => void; release: () => void },
): RetractionStrip {
  const strip = document.createElement('div');
  strip.className = 'retraction-strip';
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', 'Retraction');
  const button = (id: string, text: string, title: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'retraction-btn';
    b.dataset.action = id;
    b.textContent = text;
    b.title = title;
    b.addEventListener('click', fn);
    strip.append(b);
    return b;
  };
  button('hold', 'Hold · G', 'Lock the placed grasper / sponge-stick in its port, lung retracted', on.hold);
  const rel = button('release', 'Release · Shift+G', 'Let go of the most recent held instrument', on.release);
  host.append(strip);
  const api = {
    setHeld(n: number) {
      rel.disabled = n === 0;
      const text = n ? `Release · Shift+G (${n})` : 'Release · Shift+G';
      if (rel.textContent !== text) rel.textContent = text;
    },
    dispose: () => strip.remove(),
  };
  api.setHeld(0);
  return api;
}
