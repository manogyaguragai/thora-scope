// Typed view of the RML hilum model manifest (src/content/anatomy.json, docs/MODEL_INTEGRATION.md). Code derives
// hilum names, morph keys, divided / hidden sets and danger structures from here, never from literals, so a new model
// version with the same contract is a drop-in (copy the file, bump `source`, npm run assets:optimize).
import raw from './anatomy.json' with { type: 'json' };

export interface Structure {
  tissue: string;
  group: string;
  lobe?: 'RUL' | 'RML' | 'RLL';
  /** Guided step that divides it (hidden from the next step on). */
  divideStep?: number;
  /** Guided step that clears it (lymph nodes; hidden from the next step on). */
  clearStep?: number;
  /** Guided step whose cautery dissection opens it (hidden from the next step on). */
  dissectStep?: number;
  dissectable?: boolean;
  /** Removed with the specimen after this step (hidden from the next step on). */
  removedAfterStep?: number;
  danger?: 'major' | 'minor';
  /** Heartbeat pulse weight (materials). */
  pulse?: number;
  /** Never shown. */
  hidden?: boolean;
}

export interface Anatomy {
  version: string;
  source: string;
  base: string;
  morphs: readonly string[];
  referenceCameras: readonly string[];
  removedFromBase: readonly string[];
  structures: Readonly<Record<string, Structure>>;
}

export const ANATOMY: Anatomy = raw as Anatomy;

/** Manifest structure names matching `pred`, in manifest order. */
export function structuresWhere(pred: (s: Structure, name: string) => boolean): string[] {
  return Object.entries(ANATOMY.structures)
    .filter(([n, s]) => pred(s, n))
    .map(([n]) => n);
}

/** Last guided step at which a structure is still shown (Infinity = never removed by the procedure). */
export function lastShownStep(s: Structure): number {
  return Math.min(
    s.divideStep ?? Infinity,
    s.clearStep ?? Infinity,
    s.dissectStep ?? Infinity,
    s.removedAfterStep ?? Infinity,
  );
}

/** Structures hidden at guided step n (0 = before any step): always-hidden + everything done in an earlier step. */
export function hiddenAtStep(n: number): string[] {
  return structuresWhere((s) => s.hidden === true || (n > 0 && n > lastShownStep(s)));
}
