// The single key-bindings config (CONTEXT §6.2). `code` is KeyboardEvent.code (layout-independent), `alt` extra
// codes for the same action; `label` is the human-readable description for the help overlay (M3).
export interface KeyBinding {
  readonly code: string;
  readonly alt?: readonly string[];
  readonly label: string;
  /** Help overlay section (ungrouped → 'General'). */
  readonly group?: string;
}

export const keybindings = {
  toggleView: { code: 'KeyO', label: 'Toggle outside / scope view' },
  help: { code: 'Slash', label: 'Show / hide this help' },
  toggleSound: { code: 'KeyM', label: 'Monitor pulse beep on / off' },
  guidedNext: { code: 'PageDown', label: 'Guided: next step', group: 'Guided' },
  guidedPrev: { code: 'PageUp', label: 'Guided: previous step', group: 'Guided' },
  // Scope view, any tool (T816): hold to pivot the scope about its port, in screen terms.
  scopeUp: { code: 'ArrowUp', label: 'Hold: angle the scope view up', group: 'Scope' },
  scopeDown: { code: 'ArrowDown', label: 'Hold: angle the scope view down', group: 'Scope' },
  scopeLeft: { code: 'ArrowLeft', label: 'Hold: pan the scope view left', group: 'Scope' },
  scopeRight: { code: 'ArrowRight', label: 'Hold: pan the scope view right', group: 'Scope' },
  // Scope (§6.2): active with Hands (slot 1).
  horizonLock: { code: 'KeyH', label: 'Horizon lock on / off', group: 'Scope' },
  opticLeft: { code: 'KeyZ', label: '30° optic: rotate light post left', group: 'Scope' },
  opticRight: { code: 'KeyX', label: '30° optic: rotate light post right', group: 'Scope' },
  zoomIn: { code: 'Equal', alt: ['NumpadAdd'], label: 'Digital zoom in', group: 'Scope' },
  zoomOut: { code: 'Minus', alt: ['NumpadSubtract'], label: 'Digital zoom out', group: 'Scope' },
  nextPort: {
    code: 'KeyP',
    label: 'Shift+P: move the scope to the next port (plain P moves the instrument)',
    group: 'Scope',
  },
  snapToStep: { code: 'KeyV', label: 'Snap to the step view', group: 'Scope' },
  resetScope: { code: 'KeyR', label: 'Reset the scope view', group: 'Scope' },
  rollHeadLeft: { code: 'Comma', label: 'Roll the camera head left (unlocks the level)', group: 'Scope' },
  rollHeadRight: { code: 'Period', label: 'Roll the camera head right (unlocks the level)', group: 'Scope' },
  // Instruments (§6.4): active with a tool slot (2–9).
  instrumentWithdraw: { code: 'Escape', label: 'Withdraw the instrument to its port', group: 'Tools' },
  // Viewing aids (§6.5).
  toggleLabels: { code: 'KeyL', label: 'Toggle all structure labels', group: 'Views & labels' },
  dismissLabel: { code: 'Escape', label: 'Dismiss structure label', group: 'Views & labels' },
  togglePip: {
    code: 'KeyI',
    label: "Surgeon's-view inset with the hands (scope view)",
    group: 'Views & labels',
  },
} as const satisfies Record<string, KeyBinding>;

/** Hotbar (§6.3): keys 1–9 select a slot, Q/E cycle. Listed separately in the help overlay (with tool names). */
export const HOTBAR_KEYS = {
  slots: Array.from({ length: 9 }, (_, i) => ({
    code: `Digit${i + 1}`,
    alt: [`Numpad${i + 1}`],
    label: `Select tool ${i + 1}`,
  })),
  prev: { code: 'KeyQ', label: 'Previous tool' },
  next: { code: 'KeyE', label: 'Next tool' },
} as const satisfies { slots: readonly KeyBinding[]; prev: KeyBinding; next: KeyBinding };

/** Context-action keys (§6.3; not slots). Labels live with the actions in src/sim/hotbar.ts. */
export const CONTEXT_KEYS = { bag: 'KeyB', ventilate: 'KeyA', hold: 'KeyG', chestTube: 'KeyT' } as const;

/** Does KeyboardEvent.code `code` trigger binding `b`? */
export const matchesKey = (b: KeyBinding, code: string): boolean =>
  b.code === code || (b.alt?.includes(code) ?? false);
