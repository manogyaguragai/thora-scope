import { describe, expect, test, vi } from 'vitest';
import { keybindings, matchesKey } from '../../src/core/keybindings';
import { config } from '../../src/core/config';
import { createGuided } from '../../src/sim/guided';
import { getMode, onModeChange, setMode } from '../../src/sim/modes';
import type { Mode } from '../../src/sim/modes';
import { createState, updateTweens } from '../../src/sim/state';
import { createStepVisibility, getStep } from '../../src/sim/steps';
import type { Toggleable } from '../../src/sim/steps';

const GUIDED_CONFIG = config.guided;
const MS = GUIDED_CONFIG.transitionMs;

function setup(create = createGuided) {
  const objects = new Map<string, Toggleable>();
  const vis = createStepVisibility((name) => {
    const o = { name, visible: true };
    objects.set(name, o);
    return o;
  });
  const state = createState();
  const cams: [string, boolean][] = [];
  const fades = new Map<string, number[]>();
  const g = create({
    vis,
    state,
    setCamera: (name, instant) => cams.push([name, instant]),
    setFade: (o, a) => {
      const list = fades.get(o.name) ?? [];
      list.push(a);
      fades.set(o.name, list);
    },
  });
  const events: string[] = [];
  g.on('stepchange', (n) => events.push(`change:${n}`));
  g.on('transitionend', (n) => events.push(`end:${n}`));
  const obj = (name: string): Toggleable => objects.get(name) ?? { name: '?', visible: false };
  return { g, state, cams, fades, events, obj };
}

describe('guided controller', () => {
  test('instant goTo applies the step with no transition or fades', () => {
    const { g, state, cams, fades, events } = setup();
    g.goTo(1, true);
    expect(g.current).toBe(1);
    expect(g.transitioning).toBe(false);
    expect(cams).toEqual([[getStep(1).camera, true]]);
    expect(state.deflate_RML).toBe(getStep(1).state.deflate_RML);
    expect(fades.size).toBe(0);
    expect(events).toEqual(['change:1', 'end:1']);
  });

  test('transition lasts ~1.5 s, eased, and state tweens land on the step targets', () => {
    const { g, state, cams, events } = setup();
    g.goTo(1, true);
    const t0 = 10_000;
    state.t = t0;
    g.next();
    expect(cams[1]).toEqual([getStep(2).camera, false]);
    expect(g.transitioning).toBe(true);
    for (const t of [t0, t0 + MS / 2, t0 + MS - 1]) {
      g.update(t);
      updateTweens(state, t);
    }
    expect(g.transitioning).toBe(true);
    g.update(t0 + MS);
    updateTweens(state, t0 + MS);
    expect(g.transitioning).toBe(false);
    expect(MS).toBeGreaterThanOrEqual(1200);
    expect(MS).toBeLessThanOrEqual(1800);
    for (const k of ['deflate_RUL', 'deflate_RML', 'deflate_RLL'] as const)
      expect(state[k]).toBe(getStep(2).state[k]);
    expect(events).toEqual(['change:1', 'end:1', 'change:2', 'end:2']);
  });

  test('slow frames: the transition ends in the same frame as the state tweens (same clock origin)', () => {
    const { g, state } = setup();
    g.goTo(5, true);
    state.t = 10_000; // last tick before the click
    g.next(); // 5 → 6 tweens retract_posterior / retract_fissure
    const late = state.t + MS + 1; // one multi-second SwiftShader frame later
    updateTweens(state, late); // tickSim runs before guided.update in the frame loop
    g.update(late);
    expect(Object.values(state.tweens).some((t) => t.active)).toBe(false);
    expect(g.transitioning).toBe(false);
  });

  test('fades: swap to transparent → eased fade → swap back to opaque (or hide)', () => {
    const { g, fades, obj } = setup();
    g.goTo(2, true);
    const leaving = obj('hilar_connective_tissue'); // shown in step 2, hidden in step 3
    const entering = obj('hilar_connective_tissue_window');
    expect([leaving.visible, entering.visible]).toEqual([true, false]);
    g.goTo(3);
    // both drawn during the fade, on the transparent variant from the start
    expect([leaving.visible, entering.visible]).toEqual([true, true]);
    expect(fades.get(leaving.name)).toEqual([GUIDED_CONFIG.fadeCeil]);
    expect(fades.get(entering.name)).toEqual([0]);
    g.update(0);
    g.update(MS / 2);
    g.update(MS);
    const out = fades.get(leaving.name) ?? [];
    const inn = fades.get(entering.name) ?? [];
    expect(out.slice(1)).toEqual([GUIDED_CONFIG.fadeCeil, GUIDED_CONFIG.fadeCeil / 2, 0, 1]);
    expect(inn.slice(1)).toEqual([0, GUIDED_CONFIG.fadeCeil / 2, GUIDED_CONFIG.fadeCeil, 1]);
    for (const a of [...out, ...inn].slice(0, -1)) expect(a).toBeLessThanOrEqual(1);
    expect([leaving.visible, entering.visible]).toEqual([false, true]);
    expect(fades.has('lung_middle_lobe_right')).toBe(false); // unchanged meshes are untouched
  });

  test('input during a transition queues only the latest target', () => {
    const { g, events } = setup();
    g.goTo(1, true);
    g.next(); // → 2
    g.goTo(6);
    g.goTo(4);
    expect(g.current).toBe(2);
    g.update(0);
    g.update(MS); // ends 2, starts 4 (no 6)
    expect(g.current).toBe(4);
    expect(g.transitioning).toBe(true);
    g.update(MS + 1);
    g.update(2 * MS + 1);
    expect(events).toEqual(['change:1', 'end:1', 'change:2', 'end:2', 'change:4', 'end:4']);
  });

  test('next/prev accumulate on the queued target; range is clamped', () => {
    const { g } = setup();
    g.prev(); // from no step → first
    expect(g.current).toBe(1);
    g.update(0);
    g.next();
    g.next();
    g.next(); // queued 2 + 1 + 1 → 4 after the first finishes
    g.update(MS); // ends 1, starts the queued 4 (one transition, no stacking)
    expect(g.current).toBe(4);
    g.goTo(99, true);
    expect(g.current).toBe(7);
    g.goTo(-3, true);
    expect(g.current).toBe(1);
  });
});

describe('guided under prefers-reduced-motion', () => {
  test('every step change is instant: no transition, no fades, camera jumps', async () => {
    vi.resetModules();
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduce'),
      addEventListener: () => {},
    }));
    try {
      const { createGuided: create } = await import('../../src/sim/guided');
      const { g, cams, fades, events } = setup(create);
      g.goTo(1);
      g.next();
      expect(g.current).toBe(2);
      expect(g.transitioning).toBe(false);
      expect(cams.map(([, instant]) => instant)).toEqual([true, true]);
      expect(fades.size).toBe(0);
      expect(events).toEqual(['change:1', 'end:1', 'change:2', 'end:2']);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

describe('mode registry', () => {
  test('defaults to guided; listeners fire on change only', () => {
    expect(getMode()).toBe('guided');
    const seen: [Mode, Mode][] = [];
    onModeChange((m, prev) => seen.push([m, prev]));
    setMode('guided');
    setMode('physiology');
    setMode('explore');
    expect(getMode()).toBe('explore');
    expect(seen).toEqual([
      ['physiology', 'guided'],
      ['explore', 'physiology'],
    ]);
    setMode('guided');
  });
});

describe('keybindings', () => {
  test('guided next/prev keys, with descriptions', () => {
    expect(matchesKey(keybindings.guidedNext, 'ArrowRight')).toBe(true);
    expect(matchesKey(keybindings.guidedNext, 'PageDown')).toBe(true);
    expect(matchesKey(keybindings.guidedPrev, 'PageUp')).toBe(true);
    expect(matchesKey(keybindings.guidedPrev, 'ArrowRight')).toBe(false);
    for (const b of Object.values(keybindings)) expect(b.label.length).toBeGreaterThan(0);
  });
});
