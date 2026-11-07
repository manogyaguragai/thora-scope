// Help overlay (`?`, CONTEXT §6.2): a modal listing every key + mouse binding, data-driven from the passed
// sources so new bindings show up without touching this file. Lazy chunk: type-only imports, no three.
// Native <dialog>.showModal() supplies the focus trap (rest of the page inert), Esc close and focus return.
// Also hosts the quality setting (§6.10 user override): persisted via core/adaptiveResolution, applied by reload.
import { loadQualityChoice, saveQualityChoice } from '../core/adaptiveResolution';
import { CREDITS, CREDITS_PREFIX } from '../content/credits';
import { config } from '../core/config';
import type { KeyBinding } from '../core/keybindings';
import type { QualityName } from '../core/quality';
import './help.css';

/** A binding may carry an optional `group`; ungrouped ones land in 'General'. */
export type HelpBinding = KeyBinding & { readonly group?: string };

export interface HelpSources {
  readonly keybindings: Readonly<Record<string, HelpBinding>>;
  readonly hotbarKeys?: {
    readonly slots: readonly KeyBinding[];
    readonly prev: KeyBinding;
    readonly next: KeyBinding;
  };
  /** Tool names per slot (SLOTS[i].name), appended to the slot labels. */
  readonly toolNames?: readonly string[];
  readonly contextActions?: readonly { readonly code: string; readonly label: string }[];
}

export interface HelpRow {
  readonly keys: readonly string[];
  readonly label: string;
}
export interface HelpGroup {
  readonly title: string;
  readonly rows: HelpRow[];
}

/** Display order; unknown groups follow in first-seen order, Mouse is always last. */
export const GROUP_ORDER = [
  'Scope',
  'Tools',
  'Context actions',
  'Views & labels',
  'Guided walkthrough',
  'General',
];
const MOUSE = 'Mouse';

/** Static mouse bindings (CONTEXT §6.2 scope, §6.4 manual control, §6.5 click-to-label). */
export const MOUSE_BINDINGS: readonly HelpRow[] = [
  { keys: ['Left-drag'], label: 'Hands: pivot the scope about its port' },
  { keys: ['Wheel'], label: 'Hands: insert / withdraw the scope' },
  { keys: ['Left-click'], label: 'Hands: label a structure' },
  { keys: ['Hover'], label: 'Guided walkthrough: name a structure (touch: long-press)' },
  { keys: ['Port chip'], label: 'Any tool: move the scope to that port (Enter / Space when focused)' },
  { keys: ['Left-click'], label: 'Tool: snap the tip to a structure' },
  { keys: ['Right-click'], label: 'Tool: park it where it is (select it again to move it)' },
  { keys: ['Wheel'], label: 'Tool: insert / withdraw depth' },
  { keys: ['Left-click', 'hold'], label: 'Tool: close jaws / fire / activate' },
];

const CODE_NAMES: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Escape: 'Esc',
  Equal: '+',
  Minus: '-',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  Slash: '?',
  Space: 'Space',
  Comma: ',',
  Period: '.',
};

/** KeyboardEvent.code → key-cap text ('KeyH' → 'H', 'Digit1' → '1', 'Numpad1' → 'Num 1'). */
export function keyCap(code: string): string {
  const named = CODE_NAMES[code];
  if (named) return named;
  const m = /^(Key|Digit|Numpad)(.+)$/.exec(code);
  if (!m) return code;
  return m[1] === 'Numpad' ? `Num ${m[2]}` : (m[2] ?? code);
}

const caps = (b: KeyBinding): string[] => [b.code, ...(b.alt ?? [])].map(keyCap);

export function buildHelpModel(src: HelpSources): HelpGroup[] {
  const groups = new Map<string, HelpRow[]>(GROUP_ORDER.map((g) => [g, []]));
  const add = (title: string, row: HelpRow): void => {
    let rows = groups.get(title);
    if (!rows) groups.set(title, (rows = []));
    rows.push(row);
  };
  for (const b of Object.values(src.keybindings))
    add(b.group ?? 'General', { keys: caps(b), label: b.label });
  const hk = src.hotbarKeys;
  if (hk) {
    hk.slots.forEach((b, i) => {
      const name = src.toolNames?.[i];
      add('Tools', { keys: caps(b), label: name ? `${b.label}: ${name}` : b.label });
    });
    add('Tools', { keys: caps(hk.prev), label: hk.prev.label });
    add('Tools', { keys: caps(hk.next), label: hk.next.label });
    add('Tools', { keys: ['active tool key'], label: 'Press again to cycle the sub-option' });
  }
  for (const a of src.contextActions ?? [])
    add('Context actions', { keys: [keyCap(a.code)], label: a.label });
  groups.delete(MOUSE); // keep Mouse last even if a binding claimed it
  const out: HelpGroup[] = [];
  for (const [title, rows] of groups) if (rows.length) out.push({ title, rows });
  out.push({ title: MOUSE, rows: [...MOUSE_BINDINGS] });
  return out;
}

let dialog: HTMLDialogElement | null = null;
let builtFor = '';

/** U5: the Guided walkthrough is film-like: only its own keys, the label keys and general ones. */
const GUIDED_GROUPS = new Set(['Guided walkthrough', 'Views & labels', 'General']);
const GUIDED_MOUSE = ['Hover'];
const WALK_ROWS: readonly HelpRow[] = [
  { keys: ['▶ / ❚❚'], label: 'Pause or resume the walkthrough (panel button)' },
  { keys: ['↻'], label: 'Replay the current step (panel button)' },
];

const AUTO = 'auto';

/** Quality preset select (Automatic = device check) + hold-resolution toggle; Apply saves and reloads. */
function renderQuality(): HTMLElement {
  const choice = loadQualityChoice();
  const sec = el('section', 'help-settings');
  sec.setAttribute('aria-labelledby', 'help-quality-title');
  const title = el('h3', 'help-group-title', 'Quality');
  title.id = 'help-quality-title';
  const select = el('select', 'help-select');
  select.id = 'help-quality';
  select.setAttribute('aria-label', 'Quality preset');
  select.append(new Option('Automatic', AUTO));
  for (const q of config.quality.order) select.append(new Option(q[0]?.toUpperCase() + q.slice(1), q));
  select.value = choice.preset ?? AUTO;
  const lockLabel = el('label', 'help-check');
  const lock = el('input');
  lock.type = 'checkbox';
  lock.id = 'help-quality-lock';
  lock.checked = choice.locked;
  lockLabel.append(lock, ' Hold full resolution (no auto-adjust)');
  const apply = el('button', 'help-close', 'Apply and reload');
  apply.type = 'button';
  apply.id = 'help-quality-apply';
  apply.addEventListener('click', () => {
    const preset = select.value === AUTO ? null : (select.value as QualityName);
    saveQualityChoice({ preset, locked: lock.checked });
    location.reload();
  });
  sec.append(title, select, lockLabel, apply);
  return sec;
}

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

/** Credits footer: "Built by A and B", each name a new-tab link (no prefetch). */
function renderCredits(): HTMLElement {
  const foot = el('footer', 'help-credits');
  foot.append(`${CREDITS_PREFIX} `);
  CREDITS.forEach((c, i) => {
    if (i) foot.append(i === CREDITS.length - 1 ? ' and ' : ', ');
    const a = el('a', 'help-credit-link', c.name);
    a.href = c.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    foot.append(a);
  });
  return foot;
}

function render(groups: readonly HelpGroup[]): HTMLDialogElement {
  const d = el('dialog', 'help');
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-modal', 'true');
  d.setAttribute('aria-labelledby', 'help-title');
  const head = el('div', 'help-head');
  const title = el('h2', 'help-title', 'Controls');
  title.id = 'help-title';
  const close = el('button', 'help-close', 'Close');
  close.type = 'button';
  close.addEventListener('click', closeHelp);
  head.append(title, close);
  const body = el('div', 'help-body');
  for (const g of groups) {
    const sec = el('section', 'help-group');
    sec.append(el('h3', 'help-group-title', g.title));
    const dl = el('dl', 'help-list');
    for (const r of g.rows) {
      const dt = el('dt', 'help-keys');
      r.keys.forEach((k, i) => {
        if (i) dt.append(' / ');
        dt.append(el('kbd', undefined, k));
      });
      dl.append(dt, el('dd', 'help-label', r.label));
    }
    sec.append(dl);
    body.append(sec);
  }
  d.append(head, body, renderQuality(), renderCredits());
  // Keep scope/tool shortcuts from firing behind the modal; `?` toggles it closed.
  d.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === '?') closeHelp();
  });
  return d;
}

/** Open (idempotent). The dialog is built on first open from `sources` and reused afterwards. */
export function openHelp(host: HTMLElement, sources: HelpSources): void {
  const mode = document.querySelector<HTMLElement>('.shell')?.dataset.mode ?? '';
  const key = mode === 'guided' ? 'guided' : 'other';
  if (dialog && builtFor !== key) {
    dialog.remove();
    dialog = null;
  }
  if (!dialog) {
    let groups = buildHelpModel(sources);
    if (key === 'guided') {
      groups = groups
        .filter((g) => GUIDED_GROUPS.has(g.title) || g.title === MOUSE)
        .map((g) =>
          g.title === MOUSE
            ? { ...g, rows: g.rows.filter((r) => GUIDED_MOUSE.includes(r.keys[0] ?? '')) }
            : g.title === 'Guided walkthrough'
              ? { ...g, rows: [...g.rows, ...WALK_ROWS] }
              : g,
        );
    }
    dialog = render(groups);
    builtFor = key;
    host.append(dialog);
  }
  if (!dialog.open) dialog.showModal();
}

export function closeHelp(): void {
  dialog?.close();
}

export const isHelpOpen = (): boolean => dialog?.open ?? false;
