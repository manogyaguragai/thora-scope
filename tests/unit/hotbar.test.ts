import { describe, expect, it } from 'vitest';
import { createHotbar, SLOTS } from '../../src/sim/hotbar';
import type { HotbarChange } from '../../src/sim/hotbar';

function setup() {
  const hb = createHotbar();
  const events: HotbarChange[] = [];
  hb.on('change', (e) => events.push({ ...e }));
  return { hb, events };
}

describe('hotbar state', () => {
  it('has 9 slots, Hands active by default', () => {
    expect(SLOTS).toHaveLength(9);
    expect(createHotbar().slot).toBe(0);
  });

  it('keys 1–9 select slots 0–8, one event each', () => {
    const { hb, events } = setup();
    for (let k = 2; k <= 9; k++) {
      expect(hb.handleKey(`Digit${k}`)).toBe(true);
      expect(hb.slot).toBe(k - 1);
    }
    expect(hb.handleKey('Numpad1')).toBe(true);
    expect(hb.slot).toBe(0);
    expect(events.map((e) => e.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0]);
    expect(hb.handleKey('KeyZ')).toBe(false);
  });

  it.each([
    ['grasper', 2],
    ['stapler', 4],
    ['sucker', 2],
  ])('re-pressing %s cycles its %i sub-options and wraps', (id, n) => {
    const { hb, events } = setup();
    const i = SLOTS.findIndex((s) => s.id === id);
    hb.select(i);
    events.length = 0;
    const seen: number[] = [];
    for (let k = 0; k < n; k++) {
      hb.handleKey(`Digit${i + 1}`);
      seen.push(hb.subOption());
    }
    expect(seen).toEqual([...Array(n).keys()].map((k) => (k + 1) % n));
    expect(events).toEqual(seen.map((subOption) => ({ slot: i, subOption })));
  });

  it('re-press on a slot without sub-options is a no-op (no event)', () => {
    const { hb, events } = setup();
    for (const [i, s] of SLOTS.entries()) {
      if (s.subOptions.length) continue;
      hb.select(i);
      events.length = 0;
      hb.select(i);
      expect(events).toHaveLength(0);
      expect(hb.subOption()).toBe(0);
    }
  });

  it('sub-option is remembered per slot', () => {
    const { hb } = setup();
    hb.select(6);
    hb.select(6);
    hb.select(1);
    expect(hb.subOption()).toBe(0);
    expect(hb.subOption(6)).toBe(1);
    hb.select(6);
    expect(hb.subOption()).toBe(1);
  });

  it('Q/E cycle and wrap, one event each', () => {
    const { hb, events } = setup();
    hb.handleKey('KeyQ');
    expect(hb.slot).toBe(8);
    hb.handleKey('KeyE');
    hb.handleKey('KeyE');
    expect(hb.slot).toBe(1);
    expect(events.map((e) => e.slot)).toEqual([8, 0, 1]);
  });

  it('ignores out-of-range select and stops after unsubscribe', () => {
    const hb = createHotbar();
    let n = 0;
    const off = hb.on('change', () => n++);
    hb.select(9);
    hb.select(-1);
    expect(n).toBe(0);
    off();
    hb.select(3);
    expect(n).toBe(0);
    expect(hb.slot).toBe(3);
  });

  it('T840: in-use counts notify only on change', () => {
    const hb = createHotbar();
    let n = 0;
    const off = hb.onUsage(() => n++);
    expect(hb.inUse('grasper')).toBe(0);
    hb.setInUse('grasper', 2);
    hb.setInUse('grasper', 2);
    expect([hb.inUse('grasper'), n]).toEqual([2, 1]);
    off();
    hb.setInUse('grasper', 1);
    expect(n).toBe(1);
  });
});
