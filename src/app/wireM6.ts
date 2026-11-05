// M6 glue (T604): quiz mode. Lazy chunk (main.ts imports it when Quiz is selected); the panel is its own lazy chunk.
// Identify items take canvas clicks through the M3 picker (M3.onPick); static screens (next-step question,
// feedback, results) hold rendering (T703), identify items release it so the scope stays live. No three import.
import { getMode, onModeChange, setMode } from '../sim/modes';
import type { QuizSession } from '../sim/quiz';
import type { M3 } from './wireM3';

export interface M6Context {
  /** Panel host (the shell inspector slot). */
  host: HTMLElement;
  m3: M3;
  holdRendering: (reason: string) => void;
  releaseRendering: (reason: string) => void;
  requestRender: () => void;
}

declare global {
  interface Window {
    /** e2e hook: the live quiz session (null when closed). */
    __quiz?: { session: () => QuizSession | null };
  }
}

const HOLD = 'quiz';
let wired = false;

/** Open the quiz for quiz mode (no-op if the mode changed meanwhile or it is already open). */
export async function enterQuiz(ctx: M6Context): Promise<void> {
  const q = await import('../ui/quiz');
  if (getMode() !== 'quiz' || q.isQuizOpen()) return;
  if (!wired) {
    wired = true;
    onModeChange((m) => {
      if (m !== 'quiz') q.closeQuiz();
    });
    window.addEventListener('resize', ctx.requestRender); // setSize clears a held canvas
    window.__quiz = { session: q.quizSession };
  }
  q.openQuiz(ctx.host, {
    onIdentifyRequest: (cb) => {
      ctx.m3.onPick = cb;
      if (cb) ctx.releaseRendering(HOLD);
      else ctx.holdRendering(HOLD);
    },
    onClose: () => {
      ctx.m3.onPick = null;
      ctx.releaseRendering(HOLD);
      if (getMode() === 'quiz') setMode('guided');
    },
  });
}
