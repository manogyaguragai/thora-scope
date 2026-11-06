// Tool hotbar dock + port status chips (CONTEXT §6.3, §6.7). Plain DOM (ADR-007), event-driven: DOM writes only
// on hotbar 'change' / setOccupant, never per frame.
import { SUB_IDS } from '../content/targets';
import type { ToolId } from '../content/targets';
import type { Hotbar, HotbarSlot } from '../sim/hotbar';
import { SLOTS } from '../sim/hotbar';
import { interactionConfig, invKind } from '../sim/interaction.config';
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
    // T840: inventory count, e.g. "· 1/2 in use".
    const kind = invKind(slot.id, SUB_IDS[slot.id as ToolId]?.[sub] ?? null);
    const cap = interactionConfig.inventory[kind];
    const text = `${slotLabel(slot, sub)}${cap ? ` · ${hotbar.inUse(kind)}/${cap} in use` : ''}`;
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
  const offUsage = hotbar.onUsage(() => {
    for (let i = 0; i < slots.length; i++) render(i);
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
    offUsage();
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

/** T840: per-port withdraw button beside each chip (shown while the port holds an instrument). */
export interface PortWithdraw {
  can: (portId: string) => boolean;
  run: (portId: string) => void;
}

/** Port status chips (occupant per port), shown beside the dock; each is a button that moves the scope there
 *  (T808), plus an optional withdraw button (T840). Update via `setOccupant` / `setCurrent` (event-driven). */
export function mountPortChips(
  host: HTMLElement,
  ports: readonly PortChip[],
  getOccupant: (portId: string) => string,
  onSelect: (portId: string) => void,
  withdraw?: PortWithdraw,
): PortChips {
  const list = document.createElement('div');
  list.className = 'port-chips';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Scope port: click to view from that port');
  const occ = new Map<string, HTMLElement>();
  const btns = new Map<string, HTMLButtonElement>();
  const outs = new Map<string, HTMLButtonElement>();
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
    const row = document.createElement('span');
    row.className = 'port-chip-row';
    row.append(btn);
    list.append(row);
    if (withdraw) {
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'port-chip-withdraw';
      out.dataset.port = p.id;
      out.textContent = '⏏';
      out.title = `Withdraw the last instrument from the ${p.label.toLowerCase()}`;
      out.setAttribute('aria-label', out.title);
      out.hidden = !withdraw.can(p.id);
      out.addEventListener('click', () => withdraw.run(p.id));
      outs.set(p.id, out);
      row.append(out);
    }
  }
  host.append(list);
  return {
    setOccupant(portId, text) {
      const el = occ.get(portId);
      if (el && el.textContent !== text) el.textContent = text;
      const out = outs.get(portId);
      if (out && withdraw) out.hidden = !withdraw.can(portId);
    },
    setCurrent(portId) {
      for (const [id, b] of btns) b.setAttribute('aria-pressed', String(id === portId));
    },
    dispose: () => list.remove(),
  };
}

/** T850 "Insert via" picker: one button per port (key cap shown); event-driven DOM writes only. */
export interface PortPicker {
  setShown(on: boolean): void;
  /** `reason` ≠ '' greys the port out (aria-disabled, tooltip); `current` = the instrument is in it. */
  set(portId: string, reason: string, current: boolean, recommended: boolean): void;
  dispose(): void;
}

export function mountPortPicker(
  host: HTMLElement,
  ports: readonly (PortChip & { key: string })[],
  onPick: (portId: string) => void,
): PortPicker {
  const box = document.createElement('div');
  box.className = 'port-picker';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Insert the instrument via');
  box.hidden = true;
  const head = document.createElement('span');
  head.className = 'port-picker-head';
  head.textContent = 'Insert via:';
  box.append(head);
  const btns = new Map<string, { b: HTMLButtonElement; p: PortChip & { key: string } }>();
  for (const p of ports) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'port-pick';
    b.dataset.port = p.id;
    b.textContent = `${p.label} · ${p.key}`;
    b.addEventListener('click', () => onPick(p.id));
    btns.set(p.id, { b, p });
    box.append(b);
  }
  host.append(box);
  return {
    setShown(on) {
      box.hidden = !on;
    },
    set(id, reason, current, recommended) {
      const e = btns.get(id);
      if (!e) return;
      const { b, p } = e;
      const title = reason
        ? `${p.label}: ${reason}`
        : `${current ? 'Re-insert' : 'Insert'} the instrument via the ${p.label.toLowerCase()} (${p.key})${recommended ? ': recommended for this step' : ''}`;
      if (b.title !== title) {
        b.title = title;
        b.setAttribute('aria-label', title);
      }
      b.setAttribute('aria-disabled', String(reason !== ''));
      b.setAttribute('aria-pressed', String(current));
      b.dataset.recommended = String(recommended);
    },
    dispose: () => box.remove(),
  };
}

export interface RetractionStrip {
  /** Number of held instruments (enables Release, shows the count). */
  setHeld(n: number): void;
  /** T850: lymph-node station in the jaws ('11R'), null hides "Record sample". */
  setSample(station: string | null): void;
  dispose(): void;
}

/** T820: Hold / Release buttons beside the port chips, keys shown (G, Shift+G). Event-driven DOM writes only. */
export function mountRetractionStrip(
  host: HTMLElement,
  on: { hold: () => void; release: () => void; sample: () => void },
  sampleKey = 'S',
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
  const smp = button('sample', '', 'Take the grasped lymph node out as a labelled sample', on.sample);
  host.append(strip);
  const api = {
    setHeld(n: number) {
      rel.disabled = n === 0;
      const text = n ? `Release · Shift+G (${n})` : 'Release · Shift+G';
      if (rel.textContent !== text) rel.textContent = text;
    },
    setSample(station: string | null) {
      smp.hidden = station === null;
      const text = station ? `Record sample: Station ${station} · ${sampleKey}` : '';
      if (smp.textContent !== text) smp.textContent = text;
    },
    dispose: () => strip.remove(),
  };
  api.setHeld(0);
  api.setSample(null);
  return api;
}
