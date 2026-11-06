// Practice scoring (CONTEXT §6.1 mode 2, §6.4). Pure: turns the practice event log + port swaps + complications into
// a 0–100 breakdown for the debrief. Imports only config + types (no three) so the debrief chunk stays light.
// All weights, limits and wording pending clinician review.
import { config } from '../core/config';
import type { PracticeErrorKind, PracticeEvent } from './practice';
import type { PracticeAction } from './practiceActions';

export const SCORING_CONFIG = config.scoring; // values in src/core/config.ts

export type Severity = keyof typeof SCORING_CONFIG.severityPenalty;

/** Generic complication record (T503 maps its events onto this). `structure` = node hit, if known. */
export interface ComplicationRecord {
  readonly kind: string;
  readonly severity: Severity;
  readonly t: number;
  readonly structure?: string;
}

export interface ScoreInput {
  readonly log: readonly PracticeEvent[];
  /** Action table (engine.actions) for weights. */
  readonly actions: readonly PracticeAction[];
  /** PortOccupancy.swaps. */
  readonly swaps: number;
  readonly elapsedSec: number;
  readonly complications?: readonly ComplicationRecord[];
}

export type ScoreItemId = keyof typeof SCORING_CONFIG.weights;

export interface ScoreItem {
  readonly id: ScoreItemId;
  readonly label: string;
  /** One-line paraphrased feedback. */
  readonly detail: string;
  /** 0–1 */
  readonly score: number;
  readonly weight: number;
  /** score × weight, rounded. */
  readonly points: number;
}

export interface ScoreBreakdown {
  /** 0–100 */
  readonly total: number;
  readonly finished: boolean;
  readonly elapsedSec: number;
  readonly requiredDone: number;
  readonly requiredTotal: number;
  readonly errors: Readonly<Record<PracticeErrorKind, number>>;
  readonly portAngleErrors: number;
  readonly complications: readonly ComplicationRecord[];
  readonly bronchusTested: boolean;
  readonly upperLobeVeinPreserved: boolean;
  readonly swaps: number;
  readonly items: readonly ScoreItem[];
}

export const ERROR_LABELS: Readonly<Record<PracticeErrorKind, string>> = {
  'wrong-order': 'Step out of sequence',
  'wrong-target': 'Wrong structure',
  'wrong-tool': 'Wrong instrument',
  'wrong-port': 'Wrong port',
  'poor-angle': 'Poor stapler angle',
  unexpected: 'Action not in the plan',
};

const ITEM_LABELS: Readonly<Record<ScoreItemId, string>> = {
  order: 'Procedure completed',
  errors: 'Errors',
  complications: 'Complications',
  time: 'Time',
  bronchusTest: 'Bronchus test ventilation',
  veinPreserved: 'Upper lobe vein preserved',
  portAngle: 'Port and angle choices',
  swaps: 'Retraction swaps',
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const isPortError = (e: PracticeErrorKind): boolean => e === 'wrong-port' || e === 'poor-angle';

/** One injury often logs several records (danger-hit + bleed on the same node, same instant): keep the most severe. */
function dedupe(list: readonly ComplicationRecord[]): ComplicationRecord[] {
  const P = SCORING_CONFIG.severityPenalty;
  const out: ComplicationRecord[] = [];
  for (const c of list) {
    const i = out.findIndex(
      (o) =>
        c.structure !== undefined &&
        o.structure === c.structure &&
        Math.abs(o.t - c.t) <= SCORING_CONFIG.dedupeWindowSec,
    );
    const prev = out[i];
    if (!prev) out.push(c);
    else if (P[c.severity] > P[prev.severity]) out[i] = c;
  }
  return out;
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function scoreRun(input: ScoreInput): ScoreBreakdown {
  const C = SCORING_CONFIG;
  const complications = dedupe(input.complications ?? []);
  const done = new Set<string>();
  const errors = Object.fromEntries(Object.keys(ERROR_LABELS).map((k) => [k, 0])) as Record<
    PracticeErrorKind,
    number
  >;
  const vein = C.upperLobeVein;
  let finished = false;
  let veinCut = false;
  for (const e of input.log) {
    if (e.type === 'action') {
      done.add(e.actionId);
      if (e.result.divide?.includes(vein)) veinCut = true;
    } else if (e.type === 'error') {
      errors[e.error]++;
      const a = e.attempt;
      if (a.target === vein && (a.kind === 'fire' || a.tool === 'clip')) veinCut = true;
    } else if (e.type === 'finish') finished = true;
  }
  if (complications.some((c) => c.structure === vein)) veinCut = true;

  const required = input.actions.filter((a) => !a.optional);
  const wTotal = required.reduce((s, a) => s + a.weight, 0);
  const wDone = required.reduce((s, a) => s + (done.has(a.id) ? a.weight : 0), 0);
  const requiredDone = required.filter((a) => done.has(a.id)).length;
  // Progress-independent items are only earned for work actually done: an empty run must not score.
  const completion = required.length > 0 ? requiredDone / required.length : 1;

  let nErrors = 0;
  let portAngleErrors = 0;
  for (const k of Object.keys(errors) as PracticeErrorKind[]) {
    if (isPortError(k)) portAngleErrors += errors[k];
    else nErrors += errors[k];
  }
  const compPenalty = complications.reduce((s, c) => s + C.severityPenalty[c.severity], 0);
  const extraSwaps = Math.max(0, input.swaps - C.expectedSwaps);
  // The bronchus clamp test = the table's (single) test-ventilation action.
  const test = input.actions.find((a) => a.action === 'ventilate');
  const bronchusTested = test !== undefined && done.has(test.id);
  const sec = input.elapsedSec;

  const raw: Record<ScoreItemId, [number, string]> = {
    order: [
      wTotal > 0 ? wDone / wTotal : 1,
      `${requiredDone} of ${required.length} required actions done${finished ? '' : ' (case not finished)'}.`,
    ],
    errors: [
      clamp01(1 - nErrors * C.perError),
      nErrors === 0 ? 'No errors.' : `${nErrors} error(s); see the list below.`,
    ],
    complications: [
      clamp01(1 - compPenalty),
      complications.length === 0
        ? 'No complications.'
        : `${complications.length} complication(s): ${complications.map((c) => c.kind).join(', ')}.`,
    ],
    time: [
      clamp01(1 - (sec - C.targetSec) / (C.maxSec - C.targetSec)),
      `${mmss(sec)} (full marks up to ${mmss(C.targetSec)}).`,
    ],
    bronchusTest: [
      bronchusTested ? 1 : 0,
      bronchusTested
        ? 'Clamped and test-ventilated before stapling.'
        : 'Not done: confirm the right airway with a clamp and test breath before stapling.',
    ],
    veinPreserved: [
      veinCut ? 0 : 1,
      veinCut
        ? 'The upper lobe venous drainage was injured; trace each vein branch to the middle lobe first.'
        : 'Upper lobe venous drainage left intact.',
    ],
    portAngle: [
      clamp01(1 - portAngleErrors * C.perPortError),
      portAngleErrors === 0
        ? 'Every instrument came through a suitable port.'
        : `${portAngleErrors} attempt(s) through a poor port or at a poor angle.`,
    ],
    swaps: [
      clamp01(1 - extraSwaps * C.perSwap),
      `${input.swaps} retraction swap(s); about ${C.expectedSwaps} expected.`,
    ],
  };

  const items: ScoreItem[] = (Object.keys(C.weights) as ScoreItemId[]).map((id) => {
    const [base, detail] = raw[id];
    const score = id === 'order' || id === 'bronchusTest' ? base : base * completion;
    const weight = C.weights[id];
    return { id, label: ITEM_LABELS[id], detail, score, weight, points: Math.round(score * weight) };
  });
  const total = Math.round(items.reduce((s, i) => s + i.score * i.weight, 0));

  return {
    total,
    finished,
    elapsedSec: sec,
    requiredDone,
    requiredTotal: required.length,
    errors,
    portAngleErrors,
    complications,
    bronchusTested,
    upperLobeVeinPreserved: !veinCut,
    swaps: input.swaps,
    items,
  };
}
