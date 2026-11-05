// Quiz engine (CONTEXT §6.6). Pure: no DOM, no three. Seeded shuffle so a session is reproducible from its seed.
import {
  IDENTIFY_ITEMS,
  isAccepted,
  NEXT_STEP_ITEMS,
  type IdentifyItem,
  type NextStepItem,
} from '../content/quiz';

export type QuizItem =
  | { readonly kind: 'identify'; readonly item: IdentifyItem }
  | { readonly kind: 'nextStep'; readonly item: NextStepItem };

export interface QuizAnswer {
  readonly item: QuizItem;
  /** Clicked node name (identify) or chosen option index (nextStep). */
  readonly given: string | number;
  readonly correct: boolean;
}

export interface QuizSession {
  readonly seed: number;
  readonly items: readonly QuizItem[];
  index: number;
  readonly answers: QuizAnswer[];
}

/** mulberry32: tiny 32-bit seeded PRNG, returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates on a copy. */
export function shuffle<T>(list: readonly T[], rng: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i] as T;
    out[i] = out[j] as T;
    out[j] = t;
  }
  return out;
}

export const ALL_ITEMS: readonly QuizItem[] = [
  ...IDENTIFY_ITEMS.map((item) => ({ kind: 'identify', item }) as const),
  ...NEXT_STEP_ITEMS.map((item) => ({ kind: 'nextStep', item }) as const),
];

/** Copy of a next-step item with its options shuffled and `correctIndex` remapped. */
function shuffleOptions(item: NextStepItem, rng: () => number): NextStepItem {
  const order = shuffle(
    item.options.map((_, i) => i),
    rng,
  );
  return {
    ...item,
    options: order.map((i) => item.options[i] ?? ''),
    correctIndex: order.indexOf(item.correctIndex),
  };
}

/** New session over both item kinds, next-step options shuffled too; `count` caps the length (default: all). */
export function createSession(seed: number, count: number = ALL_ITEMS.length): QuizSession {
  const rng = mulberry32(seed);
  const items = shuffle(ALL_ITEMS, rng)
    .slice(0, count)
    .map((q): QuizItem =>
      q.kind === 'nextStep' ? { kind: 'nextStep', item: shuffleOptions(q.item, rng) } : q,
    );
  return { seed, items, index: 0, answers: [] };
}

export const currentItem = (s: QuizSession): QuizItem | undefined => s.items[s.index];
export const isFinished = (s: QuizSession): boolean => s.index >= s.items.length;

export function checkAnswer(q: QuizItem, given: string | number): boolean {
  if (q.kind === 'identify') return typeof given === 'string' && isAccepted(q.item, given);
  return given === q.item.correctIndex;
}

/** Record an answer to the current item and advance. Returns null when the session is already finished. */
export function answer(s: QuizSession, given: string | number): QuizAnswer | null {
  const item = currentItem(s);
  if (!item) return null;
  const a: QuizAnswer = { item, given, correct: checkAnswer(item, given) };
  s.answers.push(a);
  s.index++;
  return a;
}

export interface QuizScore {
  readonly correct: number;
  readonly answered: number;
  readonly total: number;
}

export function score(s: QuizSession): QuizScore {
  return {
    correct: s.answers.filter((a) => a.correct).length,
    answered: s.answers.length,
    total: s.items.length,
  };
}

/** Missed answers, in the order they were given. */
export const reviewList = (s: QuizSession): QuizAnswer[] => s.answers.filter((a) => !a.correct);
