// Tool hotbar state (CONTEXT §6.3): 9 slots, keys 1–9 select, re-pressing the active key cycles its sub-option,
// Q/E cycle slots (wrapping). Pure state + plain listeners; zero DOM. Slot indices are 0-based (key 1 = slot 0).
import { CONTEXT_KEYS, HOTBAR_KEYS } from '../core/keybindings';

export interface HotbarSlot {
  readonly id: string;
  readonly name: string;
  /** Sprite symbol id (src/ui/icons.ts). */
  readonly icon: string;
  readonly subOptions: readonly string[];
  /** Per-sub-option icon override. */
  readonly subIcons?: readonly string[];
}

export const SLOTS: readonly HotbarSlot[] = [
  { id: 'hands', name: 'Hands (scope)', icon: 'i-hands', subOptions: [] },
  {
    id: 'grasper',
    name: 'Grasper / retractor',
    icon: 'i-grasper',
    subOptions: ['Lung retractor', 'Ring clamp'],
    subIcons: ['i-grasper', 'i-ring-clamp'],
  },
  { id: 'sponge', name: 'Sponge-stick', icon: 'i-sponge', subOptions: [] },
  { id: 'peanut', name: 'Peanut dissector', icon: 'i-peanut', subOptions: [] },
  { id: 'cautery', name: 'Energy / cautery', icon: 'i-cautery', subOptions: [] },
  { id: 'clamp', name: 'Blunt / right-angle clamp', icon: 'i-clamp', subOptions: [] },
  {
    id: 'stapler',
    name: 'Endostapler',
    icon: 'i-stapler',
    subOptions: ['Vascular curved-tip', 'Vascular + silicone leader', 'Bronchial', 'Parenchyma'],
  },
  { id: 'clip', name: 'Clip applier', icon: 'i-clip', subOptions: [] },
  { id: 'sucker', name: 'Sucker', icon: 'i-sucker', subOptions: ['Suction', 'Irrigation'] },
];

export { HOTBAR_KEYS };

/** Context actions (not slots), listed for the help overlay. Codes: CONTEXT_KEYS (keybindings.ts). */
export const CONTEXT_ACTIONS = [
  { id: 'bag', code: CONTEXT_KEYS.bag, key: 'B', icon: 'i-bag', label: 'Extraction bag' },
  {
    id: 'ventilate',
    code: CONTEXT_KEYS.ventilate,
    key: 'A',
    icon: 'i-ventilate',
    label: 'Ask anaesthetist to ventilate',
  },
  {
    id: 'hold',
    code: CONTEXT_KEYS.hold,
    key: 'G',
    icon: 'i-hold',
    label: 'Hold the retraction in its port (Shift+G releases the last hold)',
  },
  {
    id: 'chestTube',
    code: CONTEXT_KEYS.chestTube,
    key: 'T',
    icon: 'i-chest-tube',
    label: 'Chest tube (step 7, optional)',
  },
] as const;

export interface HotbarChange {
  slot: number;
  /** Index into SLOTS[slot].subOptions; 0 when the slot has none. */
  subOption: number;
}
export type HotbarListener = (e: HotbarChange) => void;

export interface Hotbar {
  readonly slot: number;
  /** Current sub-option index of `slot` (each slot remembers its own). */
  subOption(slot?: number): number;
  /** Select slot `i`; if already active, cycle its sub-option (no-op without sub-options). */
  select(i: number): void;
  /** Q/E: move ±1 slot, wrapping. */
  cycle(dir: 1 | -1): void;
  /** Keyboard shortcut handler (KeyboardEvent.code); true if consumed. */
  handleKey(code: string): boolean;
  /** Returns an unsubscribe function. */
  on(ev: 'change', fn: HotbarListener): () => void;
}

export function createHotbar(): Hotbar {
  let slot = 0;
  const subs = SLOTS.map(() => 0);
  const listeners: HotbarListener[] = [];
  const emit = (): void => {
    const e = { slot, subOption: subs[slot] ?? 0 };
    for (const fn of listeners) fn(e);
  };

  const hb: Hotbar = {
    get slot() {
      return slot;
    },
    subOption: (i = slot) => subs[i] ?? 0,
    select(i) {
      const def = SLOTS[i];
      if (!def) return;
      if (i === slot) {
        const n = def.subOptions.length;
        if (n < 2) return;
        subs[i] = ((subs[i] ?? 0) + 1) % n;
      } else slot = i;
      emit();
    },
    cycle(dir) {
      slot = (slot + dir + SLOTS.length) % SLOTS.length;
      emit();
    },
    handleKey(code) {
      const i = HOTBAR_KEYS.slots.findIndex((b) => b.code === code || b.alt.includes(code));
      if (i >= 0) hb.select(i);
      else if (code === HOTBAR_KEYS.prev.code) hb.cycle(-1);
      else if (code === HOTBAR_KEYS.next.code) hb.cycle(1);
      else return false;
      return true;
    },
    on(_ev, fn) {
      listeners.push(fn);
      return () => {
        const k = listeners.indexOf(fn);
        if (k >= 0) listeners.splice(k, 1);
      };
    },
  };
  return hb;
}
