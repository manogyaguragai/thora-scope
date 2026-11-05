// Mode registry (CONTEXT §6.1): one current mode, plain listeners, no framework. Default: guided.
export const MODES = ['guided', 'practice', 'explore', 'physiology', 'quiz'] as const;
export type Mode = (typeof MODES)[number];
export type ModeListener = (mode: Mode, prev: Mode) => void;

let current: Mode = 'guided';
const listeners: ModeListener[] = [];

export const getMode = (): Mode => current;

/** Switch mode; listeners fire only on an actual change. */
export function setMode(mode: Mode): void {
  if (mode === current) return;
  const prev = current;
  current = mode;
  for (const fn of listeners) fn(mode, prev);
}

export function onModeChange(fn: ModeListener): void {
  listeners.push(fn);
}
