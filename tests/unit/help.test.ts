import { describe, expect, it } from 'vitest';
import { keybindings } from '../../src/core/keybindings';
import { CONTEXT_ACTIONS, HOTBAR_KEYS, SLOTS } from '../../src/sim/hotbar';
import { buildHelpModel, GROUP_ORDER, keyCap, MOUSE_BINDINGS } from '../../src/ui/helpOverlay';

const sources = {
  keybindings,
  hotbarKeys: HOTBAR_KEYS,
  toolNames: SLOTS.map((s) => s.name),
  contextActions: CONTEXT_ACTIONS,
};

describe('help overlay model', () => {
  const model = buildHelpModel(sources);
  const labels = model.flatMap((g) => g.rows.map((r) => r.label));

  it('lists every key binding exactly once', () => {
    const expected = [
      ...Object.values(sources.keybindings).map((b) => b.label),
      ...CONTEXT_ACTIONS.map((a) => a.label),
      HOTBAR_KEYS.prev.label,
      HOTBAR_KEYS.next.label,
    ];
    for (const l of expected) expect(labels.filter((x) => x === l)).toHaveLength(1);
    for (const [i, b] of HOTBAR_KEYS.slots.entries())
      expect(labels.filter((x) => x === `${b.label}: ${SLOTS[i]?.name}`)).toHaveLength(1);
  });

  it('orders groups, ungrouped → General, Mouse last with all mouse bindings', () => {
    const titles = model.map((g) => g.title);
    const known = titles.filter((t) => t !== 'Mouse');
    expect(known).toEqual(GROUP_ORDER.filter((g) => known.includes(g)));
    expect(titles.at(-1)).toBe('Mouse');
    expect(model.at(-1)?.rows).toEqual(MOUSE_BINDINGS);
    expect(model.find((g) => g.title === 'General')?.rows.map((r) => r.label)).toContain(
      keybindings.toggleView.label,
    );
    expect(model.find((g) => g.title === 'Scope')?.rows[0]).toEqual({
      keys: ['H'],
      label: keybindings.horizonLock.label,
    });
  });

  it('renders key caps incl. alternates', () => {
    expect(keyCap('Digit3')).toBe('3');
    expect(keyCap('Numpad3')).toBe('Num 3');
    expect(keyCap('ArrowRight')).toBe('→');
    const next = model.flatMap((g) => g.rows).find((r) => r.label === keybindings.guidedNext.label);
    expect(next?.keys).toEqual(['→', 'PgDn']);
  });

  it('drops empty groups and appends unknown groups before Mouse', () => {
    const m = buildHelpModel({ keybindings: { x: { code: 'KeyX', label: 'X thing', group: 'Extra' } } });
    expect(m.map((g) => g.title)).toEqual(['Extra', 'Mouse']);
  });
});
