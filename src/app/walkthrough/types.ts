// T860 FROZEN INTERFACE — Guided walkthrough (docs/FEEDBACK_GUIDED_v1.md). Step files (steps/stepNN.ts) are pure data
// against these types; the engine (engine.ts) + primitives (shots.ts) interpret them. Changing this file needs the
// orchestrator (every step author depends on it). Additive optional fields are OK; renames/removals are not.
import type { Voice } from './voice';
import type { FinishState } from '../../sim/actions/finish';
import type { TweenKey } from '../../sim/state';

/** Internal port ids (stable; display labels live in src/sim/ports.ts PORT_LABELS). */
export type PortId = 'port_camera_8ICS' | 'port_utility_5ICS' | 'port_retraction_8ICS';

/** What a beat is about: anatomy node name(s) (src/content/anatomy.json / targets), or a special subject. */
export type Subject =
  | string
  | readonly string[]
  /** Glowing band along the gap between lobes (reuses the step-7 fissure-guide geometry). */
  | { readonly fissure: 'horizontal' | 'oblique' }
  /** The last removed node's bed point (bleed / coagulation). */
  | { readonly bed: true }
  /** The next step-7 fissure-guide segment. */
  | { readonly segment: true };

/** Camera move started at beat start; eased by the scope rig (1.5–3 s; reduced motion: short cross-fade). */
export type Cam =
  /** Ease until `subject` passes the framing contract (FEEDBACK §2.1-6 / R3) from the scope's current port. */
  | { readonly k: 'frame'; readonly subject: Subject; readonly ms?: number }
  /** Ease back (wider) on `subject`, e.g. the clamp-test overview; `back` = extra depth out, m. */
  | { readonly k: 'wide'; readonly subject: Subject; readonly back: number; readonly ms?: number }
  /** Scope changes port (video R1): withdraw shot out of the current port, reinsert through `port`, frame `subject`. */
  | { readonly k: 'scopePort'; readonly port: PortId; readonly subject: Subject }
  /** The authored glb step view (cam_N) — fallback only. */
  | { readonly k: 'step' };

export type Tool = 'grasper' | 'cautery' | 'peanut' | 'clamp' | 'stapler' | 'sucker' | 'bag' | 'chestTube';

export type Act =
  /** Insertion shot (§2.1-5): scope pulls back to show `port`'s pleural entry, tip enters along the port axis
   *  (camera follows), push back in to the working pose on `target`. Refused if the port is occupied. */
  | {
      readonly k: 'insert';
      readonly tool: Tool;
      readonly sub?: string;
      readonly port: PortId;
      readonly target: Subject;
    }
  /** Withdrawal shot (shorter mirror) of the active (non-holding) instrument, out through its port. */
  | { readonly k: 'withdraw' }
  /** Retraction hand-off (R1): a new grasper through `port` takes `target` BEFORE the current holder withdraws;
   *  the retract keys never relax. */
  | { readonly k: 'handoff'; readonly port: PortId; readonly target: Subject }
  /** Jaws close on the target; the lung follows `key` → `to` (tweened, jaws following); `hold` keeps holding. */
  | { readonly k: 'grasp'; readonly key?: TweenKey; readonly to?: number; readonly hold?: boolean }
  /** Release the persistent hold (lobe extraction, step 8) and withdraw that grasper. */
  | { readonly k: 'release' }
  /** Energy / blunt strokes along a path over the target: progressive dissection (+ light smoke for cautery). */
  | { readonly k: 'sweep'; readonly strokes?: number }
  /** Jaws close across the target without firing (clamp, stapler close). */
  | { readonly k: 'close' }
  /** Stapler: (articulate perpendicular,) close, fire, open; division into two stumps + staple lines. */
  | { readonly k: 'fire'; readonly target: string }
  /** Ring clamp: grasp node `id`, pull free, carry it out through the port (leaves frame); message shown. */
  | { readonly k: 'node'; readonly id: string }
  /** Node-bed ooze starts at the exact bed point (rivulet + pool, no particles). */
  | { readonly k: 'ooze' }
  /** Cautery touch on the bed point: ooze stops, darkens to a coagulum. */
  | { readonly k: 'coagulate' }
  /** Ventilation mode switch (clamp test / leak test), with its on-screen message. */
  | { readonly k: 'ventilate'; readonly mode: 'two' | 'one' }
  /** Step 7: stapler (inserted through `port` on the first segment) to the next fissure-guide segment, fire. */
  | { readonly k: 'segment'; readonly port: PortId }
  | { readonly k: 'irrigate' }
  | { readonly k: 'suction' }
  /** Bag the free lobe and take it out through the access incision. */
  | { readonly k: 'bag' }
  /** Ease a state key (start pose). */
  | { readonly k: 'pose'; readonly key: TweenKey; readonly to: number }
  /** A look-only check (finish flags), narrated by the camera move. */
  | { readonly k: 'set'; readonly finish: Partial<FinishState> };

/** insert / withdraw / transition beats are exempt from the framing contract; working + result beats must pass. */
export type BeatKind = 'insert' | 'withdraw' | 'working' | 'result' | 'transition';

export interface Beat {
  /** Stable slug (screenshot name sNN-bMM-<id>.png, e2e seek). */
  readonly id: string;
  readonly kind: BeatKind;
  /** Caption, shown in the side panel when the beat starts. Paraphrased teaching text. */
  readonly say: string;
  /** Minimum beat duration, ms (scaled by timeScale); the beat lasts until its cam + act are done. */
  readonly ms?: number;
  readonly cam?: Cam;
  readonly act?: Act;
  /** Highlight subject (fade in at beat start, out at end). Default: the cam's subject on working/result beats;
   *  null = no glow. */
  readonly glow?: Subject | null;
  /** Side-panel message (e.g. "Lymph node 11R sent for pathology"). */
  readonly msg?: string;
  /** Hold after this beat until Next (step 1 parts); counts as a rail sub-step. */
  readonly pause?: boolean;
  /** T874: anatomy node names drawn semi-transparent for the beat (pre-compiled transparent variant, faded in at beat
   *  start, out at its end; a pause beat keeps it until Next) so a hidden subject shows through; framing occlusion
   *  rays look through them. */
  readonly ghost?: readonly string[];
  /** T876: an "Outside view" inset in the side dock while the beat runs (pause beats: until Next): 'lungs' = a fixed
   *  outside camera on the right lung, chest wall hidden in the inset only, the beat's glow showing there too. */
  readonly inset?: 'lungs';
}

/** End-state of a step, applied INSTANTLY when entering a later step (rail / Prev / ?step=N) — §2.1-8. */
export interface EndState {
  /** Finish flags after the step (cumulative: merged in step order). */
  readonly finish: Partial<FinishState>;
  /** State keys after the step (deflate_*, retract_*). */
  readonly state: Partial<Record<TweenKey, number>>;
  /** Structures divided by the step (stumps + staple lines rebuilt). */
  readonly divided?: readonly string[];
  /** Nodes removed by the step. */
  readonly removed?: readonly string[];
  /** Persistent holds left by the step: the grasper is placed holding, in its port. */
  readonly holds?: readonly { readonly port: PortId; readonly target: string; readonly key: TweenKey }[];
  /** Scope port at the end of the step. */
  readonly scopePort: PortId;
  /** Node bed coagulated (step 4). */
  readonly bedSealed?: boolean;
  /** Fissure segments fired (step 7). */
  readonly fissureFires?: number;
}

export interface WalkStep {
  readonly step: number;
  /** Scope port at the start of the step (normally the previous step's end). */
  readonly scopePort: PortId;
  readonly beats: readonly Beat[];
  readonly end: EndState;
}

/** Framing metric (R3), aperture-normalised. */
export interface Framing {
  /** Bbox centre offset from aperture centre, fraction of aperture half-size (|x|,|y| ≤ 0.12 passes). */
  readonly offset: readonly [number, number];
  /** Projected bbox area / aperture area. */
  readonly coverage: number;
  /** Fraction of subject sample points unoccluded by anatomy. */
  readonly unoccluded: number;
  /** Active instrument tip inside the aperture (null = no instrument). */
  readonly tipInside: boolean | null;
  readonly pass: boolean;
  /** T888: an unoccluded part of the holding grasper (jaws / distal shaft) in the aperture; false = no pose within
   *  the rig limits showed it with the subject (the subject was kept); null = no hold asked. */
  readonly heldVisible?: boolean | null;
}

export type WalkStatus = 'idle' | 'playing' | 'paused' | 'holding' | 'waiting' | 'error';

export interface WalkState {
  readonly status: WalkStatus;
  readonly step: number;
  readonly beat: number;
  /** Error / refusal text when status = 'error'. */
  readonly error: string | null;
  readonly tool: string | null;
  readonly toolPort: string | null;
  readonly scopePort: string;
  readonly holds: readonly { readonly port: string; readonly target: string }[];
  /** Lung reflected (retract_hilum or the step's retract key ≥ threshold). */
  readonly reflected: boolean;
  /** Lens inside the chest, not in tissue. */
  readonly scopeInside: boolean;
  /** Framing of the current beat's subject (null when the beat has no subject). */
  readonly framing: Framing | null;
  /** Beats finished in this step (e2e: wait for a beat to complete). */
  readonly done: number;
  /** Rail sub-progress for steps with pause beats (step 1: at = current part 1-based, of = 6); else null. */
  readonly sub: { readonly at: number; readonly of: number } | null;
}

/** UI events: 'caption' (beat say), 'msg' (side-panel message), 'state' (any status / beat / step change). */
export type WalkEvent = 'caption' | 'msg' | 'state';

/** window.__sim.walkthrough (§2.1-10). */
export interface WalkthroughHook {
  /** Rebuild end-state of steps 1…step-1 instantly, then play `step` from `beat` (earlier beats applied instantly). */
  seek(step: number, beat?: number): Promise<void>;
  /** Playback speed (1 = real time). Specs use 4–20. */
  timeScale: number;
  /** Narration (null = none, e.g. under automation); the guided panel's voice toggle mutes it. */
  readonly voice: Voice | null;
  state(): WalkState;
  currentBeat(): (Beat & { readonly step: number; readonly index: number }) | null;
  play(): void;
  pause(): void;
  replay(): void;
  next(): void;
  prev(): void;
  /** Resolves when the current beat (or the whole step with 'step') has finished. */
  settle(what?: 'beat' | 'step'): Promise<WalkState>;
  /** Subscribe; returns unsubscribe. `text` = caption / message ('' for 'state'). */
  on(ev: WalkEvent, cb: (s: WalkState, text: string) => void): () => void;
  /** T870 (optional, authoring aid): best framing of `subject` from `port` (the rig search, then the rig is put
   *  back; nothing moves on screen). Lets authors check which port can frame a beat. */
  probeFraming?(subject: Subject, port: PortId): Framing;
  /** T874 (optional, authoring aid): ghost these nodes now as a beat's `ghost` would (null = fade back). */
  ghost?(names: readonly string[] | null): void;
  /** T876 (optional, authoring aid): show / hide the Beat.inset 'lungs' inset now. */
  inset?(on: boolean): void;
}

/** W2 highlight (src/scene/highlight.ts; window.__sim.highlight). Built + compiled at load; uniforms only.
 *  Soft glow outline + rim, ≈2 s eased pulse; only one subject at a time. Node names or a fissure band. */
export interface HighlightApi {
  show(subject: readonly string[] | { readonly fissure: 'horizontal' | 'oblique' }, fadeMs: number): void;
  hide(fadeMs: number): void;
  /** Currently glowing (e2e), null when faded out. */
  readonly active: string | null;
}

/** W2 node-bed bleed (src/scene/effects.ts; reachable as window.__sim.m4.fx.bed): ooze welling at the exact
 *  point + gravity rivulet + small pool (no particles), stopped and darkened to a coagulum by cautery. */
export interface BedFxApi {
  ooze(at: { readonly x: number; readonly y: number; readonly z: number }): void;
  coagulate(): void;
  /** Instant end-state (seek): 'coagulated' shows the dark coagulum without the ooze animation. */
  set(
    state: 'none' | 'coagulated',
    at?: { readonly x: number; readonly y: number; readonly z: number },
  ): void;
  readonly state: 'none' | 'oozing' | 'coagulated';
}
