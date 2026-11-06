// T844 guided demonstrations ("Show me", Guided + Explore): a scripted, skippable, replayable run of a step's key
// actions, driven only through the public instrument / action APIs (window.__sim.placeTool, m4.press / hold /
// releaseHold, m4.finish gates, the context-action keys, sim/state tweenTo). Scripts are plain data per step, so the
// instrument rework (T840/T841/T842) changes behaviour, not the scripts. Event-time code only (timers between
// beats), nothing runs per frame. The demo acts on the live case, like a user would (no scene reset exists).
import type { FinishState } from '../sim/actions/finish';
import { CONTEXT_ACTIONS } from '../sim/hotbar';
import { tweenTo } from '../sim/state';
import type { TweenKey } from '../sim/state';

export type DemoAction =
  /** Select `tool` (+ `sub`) and bring it to `target` through `port` (any free port when omitted). */
  | 'place'
  /** Left button down on the placed target (grasp, cautery on, stapler close / fire, clamp); `ms` later up,
   *  unless `keep` (a grasp that is then held). */
  | 'press'
  /** G: leave the grasper holding in its port. */
  | 'hold'
  /** Shift+G: let go of the most recent hold. */
  | 'release'
  /** Esc: withdraw the instrument in hand (a grasped node comes out with it). */
  | 'withdraw'
  /** Ease the morph `key` to `to` over `ms` (the held lobe being pulled). */
  | 'pull'
  /** Context action `tool` (bag / ventilate): the same key event the trainee presses. */
  | 'context'
  /** T842 "Irrigate the field" (m4.irrigate). */
  | 'irrigate';

export interface DemoBeat {
  readonly action: DemoAction;
  readonly tool?: string;
  readonly sub?: string;
  readonly port?: string;
  readonly target?: string;
  readonly key?: TweenKey;
  readonly to?: number;
  readonly keep?: boolean;
  /** Time this beat takes before the next one starts. */
  readonly ms: number;
  /** Short narration shown while the beat runs (paraphrased teaching text). */
  readonly say: string;
}

export interface DemoScript {
  /** Physical prerequisites the guided step implies are already done (finish.ts gates), set on every (re)run. */
  readonly given: Partial<FinishState>;
  readonly beats: readonly DemoBeat[];
}

const UTIL = 'port_utility_5ICS';
const RET = 'port_retraction_8ICS';
const RUL = 'lung_upper_lobe_right';
const RML = 'lung_middle_lobe_right';
const FIRE_MS = 2500; // stapler close + compression + fire + open, with margin
const NODES = ['LN_11R', 'LN_12R'];
const VEIN_DONE = { veinDivided: true };
const NODES_DONE = { ...VEIN_DONE, specimens: NODES };
const HILUM_DONE = { ...NODES_DONE, bronchusDivided: true, arteryDivided: true };

/** Per guided step. Steps without a script (1) have no "Show me". */
export const DEMOS: Readonly<Record<number, DemoScript>> = {
  2: {
    given: {},
    beats: [
      {
        action: 'place',
        tool: 'grasper',
        sub: 'retractor',
        target: RUL,
        port: RET,
        ms: 600,
        say: 'The grasper takes the upper lobe through the posterior port.',
      },
      { action: 'press', keep: true, ms: 400, say: 'It lifts the lung back off the hilum…' },
      { action: 'hold', ms: 600, say: '…and is left holding it.' },
      {
        action: 'place',
        tool: 'cautery',
        target: 'mediastinal_pleura_hilum',
        port: UTIL,
        ms: 600,
        say: 'The hook comes in through the access incision.',
      },
      { action: 'press', ms: 2500, say: 'Short touches open the mediastinal pleura over the veins.' },
    ],
  },
  3: {
    given: {},
    beats: [
      {
        action: 'place',
        tool: 'cautery',
        target: 'hilar_connective_tissue',
        port: UTIL,
        ms: 600,
        say: 'The strands around the middle lobe vein are divided first.',
      },
      { action: 'press', ms: 2500, say: 'Energy on the strands, never on the vein wall.' },
      {
        action: 'place',
        tool: 'peanut',
        target: 'middle_lobe_vein',
        port: UTIL,
        ms: 600,
        say: 'The peanut slips behind the vein…',
      },
      { action: 'press', ms: 600, say: '…and opens the passage for the stapler.' },
      {
        action: 'place',
        tool: 'stapler',
        sub: 'vascular-curved',
        target: 'middle_lobe_vein',
        ms: 600,
        say: 'The curved-tip vascular stapler follows the passage.',
      },
      {
        action: 'press',
        ms: FIRE_MS,
        say: 'Close, compress, fire: the vein is divided between two staple lines.',
      },
    ],
  },
  4: {
    given: VEIN_DONE,
    beats: [
      {
        action: 'place',
        tool: 'grasper',
        sub: 'ring',
        target: 'LN_11R',
        port: UTIL,
        ms: 600,
        say: 'Ring forceps on node 11R…',
      },
      { action: 'press', ms: 800, say: '…grasped and teased free.' },
      {
        action: 'place',
        tool: 'grasper',
        sub: 'ring',
        target: 'LN_12R',
        port: UTIL,
        ms: 600,
        say: 'The forceps move on to node 12R at the bronchus root.',
      },
      { action: 'press', ms: 800, say: 'Then node 12R; 11R came out with the forceps.' },
      {
        action: 'withdraw',
        ms: 1500,
        say: 'Both nodes out. The bed oozes a little: a touch of cautery seals it.',
      },
    ],
  },
  5: {
    given: NODES_DONE,
    beats: [
      {
        action: 'place',
        tool: 'clamp',
        target: 'middle_lobe_bronchus',
        port: UTIL,
        ms: 600,
        say: 'The clamp closes on the middle lobe bronchus.',
      },
      { action: 'press', ms: 600, say: 'Clamped.' },
      {
        action: 'place',
        tool: 'stapler',
        sub: 'bronchial',
        target: 'middle_lobe_bronchus',
        ms: 600,
        say: 'The bronchial stapler closes across it without firing.',
      },
      { action: 'press', ms: 800, say: 'Stapler closed.' },
      {
        action: 'context',
        tool: 'ventilate',
        ms: 4500,
        say: 'A breath: upper and lower lobes inflate, the middle lobe stays flat.',
      },
      { action: 'press', ms: FIRE_MS, say: 'Right airway confirmed: fire.' },
    ],
  },
  6: {
    given: { ...NODES_DONE, bronchusDivided: true },
    beats: [
      {
        action: 'place',
        tool: 'peanut',
        target: 'middle_lobe_artery',
        port: UTIL,
        ms: 600,
        say: 'The peanut opens a gentle passage behind the artery.',
      },
      { action: 'press', ms: 600, say: 'No pull on the lung while the passage is open.' },
      {
        action: 'place',
        tool: 'stapler',
        sub: 'vascular-leader',
        target: 'middle_lobe_artery',
        ms: 600,
        say: 'The leader guides the vascular stapler through.',
      },
      { action: 'press', ms: FIRE_MS, say: 'Fire: both middle lobe artery branches divided.' },
    ],
  },
  7: {
    given: { ...HILUM_DONE, fissureFires: 0, undersideConfirmed: true, lobeFree: false, lobeRemoved: false },
    beats: [
      {
        action: 'place',
        tool: 'grasper',
        sub: 'retractor',
        target: RML,
        port: UTIL,
        ms: 600,
        say: 'The grasper takes hold of the middle lobe.',
      },
      { action: 'press', keep: true, ms: 400, say: 'It pulls the lobe away from its neighbours…' },
      { action: 'pull', key: 'retract_fissure', to: 1, ms: 1200, say: '…opening both fissures.' },
      { action: 'hold', ms: 400, say: 'The grasper holds the lobe on tension.' },
      {
        action: 'place',
        tool: 'stapler',
        sub: 'parenchyma',
        target: RML,
        ms: 600,
        say: 'The powered stapler (parenchyma reload) lies across the horizontal fissure.',
      },
      { action: 'press', ms: FIRE_MS, say: 'First fire: the horizontal fissure is completed.' },
      {
        action: 'place',
        tool: 'stapler',
        sub: 'parenchyma',
        target: RML,
        ms: 600,
        say: 'Repositioned across the oblique fissure, stump checked outside the jaws.',
      },
      { action: 'press', ms: FIRE_MS, say: 'Second fire: the lobe is divided from the lung and free.' },
    ],
  },
  8: {
    given: { ...HILUM_DONE, lobeFree: true, lobeRemoved: false },
    beats: [
      {
        action: 'place',
        tool: 'grasper',
        sub: 'retractor',
        target: RML,
        port: UTIL,
        ms: 600,
        say: 'The free lobe is guided towards the access incision.',
      },
      { action: 'press', ms: 600, say: 'Into the opened retrieval bag…' },
      {
        action: 'context',
        tool: 'bag',
        ms: 2500,
        say: '…and the closed bag comes out through the access incision.',
      },
    ],
  },
  9: {
    given: { ...HILUM_DONE, lobeFree: true, lobeRemoved: true, fluidFilled: false },
    beats: [
      {
        action: 'irrigate',
        ms: 4000,
        say: 'Warm saline fills the chest until the hilum and the stumps are under water.',
      },
      {
        action: 'context',
        tool: 'ventilate',
        ms: 2500,
        say: 'A breath under saline: no bubbles, no air leak.',
      },
      {
        action: 'place',
        tool: 'sucker',
        sub: 'suction',
        target: 'bronchial_tree',
        port: UTIL,
        ms: 600,
        say: 'Suction clears the fluid.',
      },
      { action: 'press', ms: 2000, say: 'Field dry; stumps and node beds checked once more.' },
    ],
  },
};

export const hasDemo = (step: number): boolean => DEMOS[step] !== undefined;

const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
const CODES: Readonly<Record<string, string>> = Object.fromEntries(
  CONTEXT_ACTIONS.map((c) => [c.id, c.code]),
);

let token = 0; // run id: a newer run or stop() makes older loops exit at their next beat
let held = 0;
let pressed = false;

function cleanUp(): void {
  const m4 = window.__sim.m4;
  if (pressed) m4?.press(false);
  pressed = false;
  for (; held > 0; held--) m4?.releaseHold();
}

/** Skip: stop at the next beat, release what the demo holds. */
export function stopDemo(): void {
  token++;
  cleanUp();
}

/** Run step `step`'s demo; `say` gets the narration. Resolves 'done', 'stopped' or the refusal that ended it. */
export async function runDemo(step: number, say: (text: string) => void): Promise<string> {
  const script = DEMOS[step];
  const sim = window.__sim;
  const m4 = sim.m4;
  if (!script || !m4 || !sim.placeTool) return 'no demo';
  stopDemo();
  const me = token;
  Object.assign(m4.finish, script.given, { specimens: [...(script.given.specimens ?? m4.finish.specimens)] });
  for (const b of script.beats) {
    if (me !== token) return 'stopped';
    say(b.say);
    // Only a failed placement ends the run; press / hold / context answer with toasts the trainee sees anyway.
    if (b.action === 'place') {
      const r = await sim.placeTool(b.tool ?? '', b.target ?? '', b.sub, b.port);
      if (r !== 'ok') {
        cleanUp();
        return r;
      }
    } else if (b.action === 'press') {
      pressed = m4.press(true) === 'ok' && b.keep === true;
      if (!pressed) {
        await wait(b.ms);
        m4.press(false);
        continue;
      }
    } else if (b.action === 'hold') {
      const n = m4.occupancy.holds.length;
      m4.hold();
      pressed = false;
      if (m4.occupancy.holds.length > n) held++;
    } else if (b.action === 'withdraw') m4.withdraw();
    else if (b.action === 'release') {
      m4.releaseHold();
      held = Math.max(0, held - 1);
    } else if (b.action === 'pull' && b.key) tweenTo(sim.state, b.key, b.to ?? 1, b.ms);
    else if (b.action === 'irrigate') m4.irrigate();
    else if (b.action === 'context') {
      const code = CODES[b.tool ?? ''];
      if (code) window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    }
    await wait(b.ms);
  }
  return me === token ? 'done' : 'stopped';
}
