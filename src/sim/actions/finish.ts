// Finish-phase gating (§6.4, practice_actions.json steps 4–7): bronchus test, LN 11R/12R removal, fissure completion with
// underside check, bag extraction, chest tube, re-inflation, water test. Pure: every call mutates only FinishState
// and returns state-change requests for the caller (T409 wiring) to apply to AppState / scene / effects.
import type { TweenKey } from '../state';
import { config } from '../../core/config';

export const FINISH_CONFIG = config.finish; // values in src/core/config.ts

export type FinishRequest =
  | { kind: 'tween'; key: TweenKey; to: number; ms: number; delayMs: number }
  | { kind: 'divide'; nodes: readonly string[] } // staple.ts performs the clip + cap
  | { kind: 'hide'; node: string }
  | { kind: 'specimen'; node: string } // add to the specimen tray
  | { kind: 'flag'; flag: string } // practice flag (practice_actions.json result.flags)
  | { kind: 'advance'; step: number }
  | { kind: 'rmlDivided' } // AppState.rmlDivided = true
  | { kind: 'fluid'; level: number } // IrrigationFluid.setLevel
  | { kind: 'bubbles'; node: string }; // effects.bubbleBurst at that node's stump

export type FinishResult =
  | { ok: true; requests: readonly FinishRequest[] }
  /** error = a scored trainee error (debrief), not just "not yet". */
  | { ok: false; reason: string; error: boolean };

export interface FinishState {
  specimens: string[];
  veinDivided: boolean;
  arteryDivided: boolean;
  bronchusClamped: boolean;
  bronchusTestPassed: boolean;
  bronchusDivided: boolean;
  fissureFires: number;
  undersideConfirmed: boolean;
  lobeFree: boolean;
  lobeRemoved: boolean;
  chestTube: boolean;
  fluidFilled: boolean;
  /** Set by staple/complication logic when the stump is not sealed; the water test then bubbles. */
  leak: boolean;
  caseComplete: boolean;
}

export function createFinishState(): FinishState {
  return {
    specimens: [],
    veinDivided: false,
    arteryDivided: false,
    bronchusClamped: false,
    bronchusTestPassed: false,
    bronchusDivided: false,
    fissureFires: 0,
    undersideConfirmed: false,
    lobeFree: false,
    lobeRemoved: false,
    chestTube: false,
    fluidFilled: false,
    leak: false,
    caseComplete: false,
  };
}

const C = FINISH_CONFIG;
const no = (reason: string, error = false): FinishResult => ({ ok: false, reason, error });
const ok = (...requests: FinishRequest[]): FinishResult => ({ ok: true, requests });
const tween = (key: TweenKey, to: number, ms: number, delayMs = 0): FinishRequest => ({
  kind: 'tween',
  key,
  to,
  ms,
  delayMs,
});

/** Vein/artery divisions happen in staple.ts; it reports them here so later gates can check the sequence. */
export function noteDivided(s: FinishState, what: 'vein' | 'artery'): void {
  if (what === 'vein') s.veinDivided = true;
  else s.arteryDivided = true;
}

const isRequired = (n: string): boolean => (C.requiredNodes as readonly string[]).includes(n);
const isOptional = (n: string): boolean => (C.optionalNodes as readonly string[]).includes(n);
export const nodesCleared = (s: FinishState): boolean =>
  C.requiredNodes.every((n) => s.specimens.includes(n));

/** Ring clamp on a lymph node (11R/12R, optional 4R/7 at the end). */
export function removeNode(s: FinishState, node: string, port: string): FinishResult {
  if (!isRequired(node) && !isOptional(node)) return no('Not a node for removal here');
  if (s.specimens.includes(node)) return no('Node already removed');
  if (port !== C.accessPort) return no('Use the access incision for the ring clamp');
  if (isOptional(node) && !s.lobeRemoved) return no('Clear 4R/7 at the end, after extraction');
  s.specimens.push(node);
  return ok({ kind: 'hide', node }, { kind: 'specimen', node });
}

/** Bronchial stapler closed across the middle lobe bronchus without firing. */
export function clampBronchus(s: FinishState): FinishResult {
  if (!s.veinDivided) return no('Divide the middle-lobe vein first');
  if (!nodesCleared(s)) return no('Remove nodes 11R and 12R beside the bronchus first');
  if (s.bronchusDivided) return no('Bronchus already divided');
  s.bronchusClamped = true;
  return ok({ kind: 'flag', flag: 'bronchus_clamped' });
}

/** Stapler opened again before firing: the test must be repeated after re-clamping. */
export function unclampBronchus(s: FinishState): void {
  if (s.bronchusDivided) return;
  s.bronchusClamped = false;
  s.bronchusTestPassed = false;
}

/** `A` key: bronchus test while clamped, water test after irrigation. */
export function ventilate(s: FinishState): FinishResult {
  if (s.fluidFilled) return waterTest(s);
  if (!s.bronchusClamped || s.bronchusDivided)
    return no('Nothing to test: clamp the bronchus or irrigate first');
  s.bronchusTestPassed = true;
  const back = C.testVentilationMs; // re-collapse once the test window ends
  return ok(
    tween('deflate_RUL', 0, C.inflateMs),
    tween('deflate_RLL', 0, C.inflateMs),
    tween('deflate_RML', 1, C.inflateMs),
    tween('deflate_RUL', 1, C.recollapseMs, back),
    tween('deflate_RLL', 1, C.recollapseMs, back),
    { kind: 'flag', flag: 'bronchus_test_passed' },
  );
}

/** Fire the bronchial stapler. Firing without the test is a scored error. */
export function fireBronchus(s: FinishState): FinishResult {
  if (s.bronchusDivided) return no('Bronchus already divided');
  if (!s.bronchusClamped) return no('Close the stapler across the bronchus first');
  if (!s.bronchusTestPassed) return no('Test ventilation (A) before firing on the bronchus', true);
  s.bronchusDivided = true;
  return ok({ kind: 'divide', nodes: C.bronchus }, { kind: 'rmlDivided' }, { kind: 'advance', step: 5 });
}

/** Parenchyma stapler fire along the fissure; the final fire needs the underside check. */
export function fireFissure(s: FinishState, retractFissure: number): FinishResult {
  if (s.lobeFree) return no('Fissure already complete');
  if (!s.bronchusDivided || !s.arteryDivided) return no('Divide the bronchus and artery before the fissure');
  if (retractFissure < C.minFissureRetract) return no('Open the fissure with the retractor first');
  const final = s.fissureFires + 1 >= C.fissureFiresRequired;
  if (final && !s.undersideConfirmed)
    return no('View the lobe from below: confirm the stump lies above the stapler', true);
  s.fissureFires++;
  if (!final) return ok({ kind: 'flag', flag: `fissure_fire_${s.fissureFires}` });
  s.lobeFree = true;
  return ok({ kind: 'flag', flag: 'lobe_free' }, { kind: 'advance', step: 7 });
}

/** Lobe flipped via retraction and viewed from underneath. */
export function confirmUnderside(s: FinishState, retractFissure: number): FinishResult {
  if (s.fissureFires < 1) return no('Make the first fissure fire before checking the underside');
  if (retractFissure < C.minFissureRetract) return no('Flip the lobe with the retractor to see underneath');
  s.undersideConfirmed = true;
  return ok({ kind: 'flag', flag: 'stump_above_stapler_confirmed' });
}

/** `B`: bag the freed lobe, remove it via the access incision; RUL/RLL re-inflate. */
export function bagExtract(s: FinishState, port: string): FinishResult {
  if (s.lobeRemoved) return no('Lobe already removed');
  if (!(s.veinDivided && s.bronchusDivided && s.arteryDivided && s.lobeFree)) {
    return no('Finish all divisions before bagging the lobe');
  }
  if (port !== C.accessPort) return no('Remove the bag through the access incision');
  s.lobeRemoved = true;
  s.specimens.push(C.lobe);
  return ok(
    { kind: 'hide', node: C.lobe },
    { kind: 'specimen', node: C.lobe },
    tween('deflate_RUL', 0, C.inflateMs),
    tween('deflate_RLL', 0, C.inflateMs),
    { kind: 'flag', flag: 'lobe_removed' },
  );
}

/** `T` (optional): tube through the camera port, scope elsewhere. */
export function placeChestTube(s: FinishState, port: string, scopePort: string): FinishResult {
  if (!s.lobeRemoved) return no('Place the chest tube after extraction');
  if (s.chestTube) return no('Chest tube already placed');
  if (port !== C.chestTubePort) return no('Use the lowest (camera) port for the tube');
  if (scopePort === port) return no('Move the scope to another port first');
  s.chestTube = true;
  return ok({ kind: 'flag', flag: 'chest_tube_placed' });
}

/** Sucker in irrigation mode: fill fluid over the stump (water test part 1). */
export function irrigate(s: FinishState): FinishResult {
  if (!s.lobeRemoved) return no('Irrigate after the lobe is out');
  s.fluidFilled = true;
  return ok({ kind: 'fluid', level: C.irrigationLevel });
}

/** Ventilation at FINISH_CONFIG.waterTestCmH2O under fluid: bubbles only on leak; otherwise case complete. */
function waterTest(s: FinishState): FinishResult {
  if (s.leak) return ok({ kind: 'bubbles', node: C.stump }, { kind: 'flag', flag: 'air_leak' });
  s.caseComplete = true;
  return ok({ kind: 'flag', flag: 'case_complete' });
}
