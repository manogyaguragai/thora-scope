// Practice engine (CONTEXT §6.1 mode 2, §6.4 "Practice progression & scoring"). Pure logic: validates trainee
// attempts against the action table + port occupancy, classifies errors, keeps a typed event log and a timer.
// No scene access: accepted actions emit their table `result` as a state-change request for the wiring (T505).
import { config } from '../core/config';
import { TARGET_BY_ID, type ToolId } from '../content/targets';
import { SLOTS } from './hotbar';
import { type FireCheck, type PointLike, type PortOccupancy } from './portOccupancy';
import {
  loadPracticeActions,
  type ActionKind,
  type PracticeAction,
  type PracticeResult,
  type PracticeTool,
} from './practiceActions';

export const PRACTICE_CONFIG = config.practice; // values in src/core/config.ts

export interface PracticeAttempt {
  readonly tool: PracticeTool;
  readonly subOption: string | null;
  /** Structure acted on; null for actions without a target (move scope, chest tube). */
  readonly target: string | null;
  /** Port the tool came through (scope port for hands; destination for move-scope); null = none. */
  readonly port: string | null;
  readonly kind: ActionKind;
  /** Live target point for the stapler angle check (morphs move structures). */
  readonly point?: PointLike;
}

export type PracticeErrorKind =
  | 'wrong-order'
  | 'wrong-target'
  | 'wrong-tool'
  | 'wrong-port'
  | 'poor-angle'
  /** Matches nothing still to do. */
  | 'unexpected';

export interface PracticeHint {
  readonly actionId: string;
  readonly tool: PracticeTool;
  readonly subOption: string | null;
  readonly port: string | null;
  readonly targets: readonly string[];
  readonly text: string;
  readonly optional: boolean;
}

/** `t` = seconds since start (injected clock). */
export type PracticeEvent =
  | { readonly type: 'start'; readonly t: number }
  /** One target of a multi-target action done. */
  | { readonly type: 'progress'; readonly t: number; readonly actionId: string; readonly target: string }
  /** Action complete; `result` is the state-change request (morph state, divide, hide/show, flags …). */
  | {
      readonly type: 'action';
      readonly t: number;
      readonly actionId: string;
      readonly optional: boolean;
      /** Index into `alternatives` when an accepted alternative was used, else null. */
      readonly alternative: number | null;
      readonly result: PracticeResult;
    }
  | { readonly type: 'step'; readonly t: number; readonly step: number }
  | {
      readonly type: 'error';
      readonly t: number;
      readonly error: PracticeErrorKind;
      /** Action the attempt was closest to, if any. */
      readonly actionId: string | null;
      readonly attempt: PracticeAttempt;
      /** Port-occupancy verdict behind wrong-port / poor-angle / wrong-tool. */
      readonly fire?: FireCheck;
    }
  | { readonly type: 'hint'; readonly t: number; readonly actionIds: readonly string[] }
  | { readonly type: 'finish'; readonly t: number };

interface Use {
  readonly tool: PracticeTool;
  readonly subOption: string | null;
  readonly targets: readonly string[];
}

/** Instruments canFire understands (hands and context actions bag/ventilate/hold/chestTube excluded). */
const INSTRUMENTS = new Set<string>(SLOTS.map((s) => s.id).filter((id) => id !== 'hands'));

function shorten(note: string): string {
  const max = PRACTICE_CONFIG.hintMaxChars;
  if (note.length <= max) return note;
  const cut = note.lastIndexOf(' ', max);
  return `${note.slice(0, cut > 0 ? cut : max)}…`;
}

export class PracticeEngine {
  readonly actions: readonly PracticeAction[];
  readonly log: PracticeEvent[] = [];
  step = 1;
  finished = false;

  private readonly uses: ReadonlyMap<string, readonly Use[]>;
  private readonly done = new Set<string>();
  /** `${actionId}#${useIndex}` → targets already acted on. */
  private readonly partial = new Map<string, Set<string>>();
  private t0 = 0;
  private tEnd: number | null = null;

  constructor(
    private readonly occupancy: PortOccupancy,
    private readonly clock: () => number = () => performance.now(),
    actions: readonly PracticeAction[] = loadPracticeActions(),
    private readonly onEvent?: (e: PracticeEvent) => void,
  ) {
    this.actions = actions;
    this.uses = new Map(actions.map((a) => [a.id, [a, ...(a.alternatives ?? [])]]));
    this.reset();
  }

  /** Restart the case: clears progress, log and timer. */
  reset(): void {
    this.done.clear();
    this.partial.clear();
    this.log.length = 0;
    this.step = 1;
    this.finished = false;
    this.t0 = this.clock();
    this.tEnd = null;
    this.emit({ type: 'start', t: 0 });
  }

  /** Seconds since start (frozen at finish). */
  elapsed(): number {
    return ((this.tEnd ?? this.clock()) - this.t0) / 1000;
  }

  isDone(id: string): boolean {
    return this.done.has(id);
  }

  completed(): readonly string[] {
    return [...this.done];
  }

  /** Not done and every prerequisite done. */
  available(): PracticeAction[] {
    return this.actions.filter((a) => this.isAvailable(a));
  }

  /** Next available actions (required first) as short hints; logged for the debrief. */
  hint(): PracticeHint[] {
    const avail = this.available().sort((a, b) => Number(a.optional) - Number(b.optional));
    const hints = avail.slice(0, PRACTICE_CONFIG.maxHints).map((a) => ({
      actionId: a.id,
      tool: a.tool,
      subOption: a.subOption,
      port: a.port.preferred,
      targets: a.targets.filter((t) => !this.partial.get(`${a.id}#0`)?.has(t)),
      text: shorten(a.note),
      optional: a.optional,
    }));
    this.emit({ type: 'hint', t: this.elapsed(), actionIds: hints.map((h) => h.actionId) });
    return hints;
  }

  /** Validate one attempt; returns the event it produced (progress / action / error). */
  attempt(at: PracticeAttempt): PracticeEvent {
    // Best match per class, in table order: [action, use index].
    let full: [PracticeAction, number] | null = null;
    let badPort: PracticeAction | null = null;
    let early: PracticeAction | null = null;
    let badTarget: PracticeAction | null = null;
    let badTool: PracticeAction | null = null;
    for (const a of this.actions) {
      if (this.done.has(a.id)) continue;
      const avail = this.isAvailable(a);
      const portOk = a.port.allowed.length === 0 || (at.port !== null && a.port.allowed.includes(at.port));
      const uses = this.uses.get(a.id) ?? [];
      for (const [i, u] of uses.entries()) {
        const toolOk =
          a.action === at.kind &&
          u.tool === at.tool &&
          (u.subOption === null || u.subOption === at.subOption);
        const targetOk =
          u.targets.length === 0 ||
          (at.target !== null &&
            u.targets.includes(at.target) &&
            !this.partial.get(`${a.id}#${i}`)?.has(at.target));
        if (toolOk && targetOk) {
          if (!avail) early ??= a;
          else if (!portOk) badPort ??= a;
          else if (!full) full = [a, i];
        } else if (avail && toolOk) badTarget ??= a;
        else if (avail && targetOk && u.targets.length > 0) badTool ??= a;
      }
      if (full) break;
    }

    if (full) {
      const [a, i] = full;
      const fire = this.fireCheck(at);
      if (fire === 'ok') return this.accept(a, i, at.target);
      const error: PracticeErrorKind =
        fire === 'poor-angle' ? 'poor-angle' : fire === 'wrong-tool' ? 'wrong-tool' : 'wrong-port';
      return this.error(error, a.id, at, fire);
    }
    if (badPort) return this.error('wrong-port', badPort.id, at);
    if (early) return this.error('wrong-order', early.id, at);
    if (badTarget) return this.error('wrong-target', badTarget.id, at);
    if (badTool) return this.error('wrong-tool', badTool.id, at);
    return this.error('unexpected', null, at);
  }

  private isAvailable(a: PracticeAction): boolean {
    return !this.done.has(a.id) && a.prerequisites.every((p) => this.done.has(p));
  }

  /** Port occupancy / approach angle for instruments acting on a known target; hands and context actions pass. */
  private fireCheck(at: PracticeAttempt): FireCheck {
    if (!INSTRUMENTS.has(at.tool) || at.target === null || at.port === null) return 'ok';
    if (!TARGET_BY_ID.has(at.target)) return 'ok';
    return this.occupancy.canFire(at.tool as ToolId, at.target, at.port, at.subOption, at.point);
  }

  private accept(a: PracticeAction, useIdx: number, target: string | null): PracticeEvent {
    const nTargets = this.uses.get(a.id)?.[useIdx]?.targets.length ?? 0;
    const t = this.elapsed();
    if (target !== null && nTargets > 1) {
      const key = `${a.id}#${useIdx}`;
      const got = this.partial.get(key) ?? new Set<string>();
      got.add(target);
      this.partial.set(key, got);
      if (got.size < nTargets) return this.emit({ type: 'progress', t, actionId: a.id, target });
    }
    this.done.add(a.id);
    const ev = this.emit({
      type: 'action',
      t,
      actionId: a.id,
      optional: a.optional,
      alternative: useIdx === 0 ? null : useIdx - 1,
      result: a.result,
    });
    if (a.result.advanceTo !== undefined && a.result.advanceTo > this.step) {
      this.step = a.result.advanceTo;
      this.emit({ type: 'step', t, step: this.step });
    }
    if (!this.finished && this.actions.every((x) => x.optional || this.done.has(x.id))) {
      this.finished = true;
      this.tEnd = this.clock();
      this.emit({ type: 'finish', t });
    }
    return ev;
  }

  private error(
    error: PracticeErrorKind,
    actionId: string | null,
    attempt: PracticeAttempt,
    fire?: FireCheck,
  ) {
    const t = this.elapsed();
    return this.emit(
      fire
        ? { type: 'error', t, error, actionId, attempt, fire }
        : { type: 'error', t, error, actionId, attempt },
    );
  }

  private emit(e: PracticeEvent): PracticeEvent {
    if (this.log.length >= PRACTICE_CONFIG.maxLogEvents) this.log.shift();
    this.log.push(e);
    this.onEvent?.(e);
    return e;
  }
}
