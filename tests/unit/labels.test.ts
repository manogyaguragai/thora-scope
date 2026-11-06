import { describe, expect, test } from 'vitest';
import procedure from '../../src/content/procedure_steps.json';
import { ANATOMY } from '../../src/content/anatomy';
import { STRUCTURE_LABELS, anatomicalRibNumber, labelFor } from '../../src/content/labels';
import { DANGER_STRUCTURES } from '../../src/content/targets';
import { LAYER_GROUPS } from '../../src/ui/layersPanel';

const REMOVED = ['V_RML_common', 'A4_lateral', 'B_RML_common', 'tree_airway_base', 'mediastinal_fat_window'];

describe('structure labels', () => {
  test('every manifest structure and every layer-group node is labelled; removed names are gone', () => {
    for (const n of Object.keys(ANATOMY.structures)) expect(STRUCTURE_LABELS[n], n).toBeDefined();
    for (const n of Object.values(LAYER_GROUPS).flat()) expect(STRUCTURE_LABELS[n], n).toBeDefined();
    for (const n of Object.values(procedure.layer_groups).flat())
      expect(STRUCTURE_LABELS[n], n).toBeDefined();
    for (const n of REMOVED) expect(STRUCTURE_LABELS[n], n).toBeUndefined();
  });

  test('non-empty names, descriptions ≤ 120 chars', () => {
    for (const [n, l] of Object.entries(STRUCTURE_LABELS)) {
      expect(l.name.trim(), n).not.toBe('');
      expect(l.description.trim(), n).not.toBe('');
      expect(l.description.length, n).toBeLessThanOrEqual(120);
    }
  });

  test('rib correction (§7.2)', () => {
    expect(anatomicalRibNumber('rib_R5')).toBe(5);
    expect(anatomicalRibNumber('rib_R6')).toBe(5);
    expect(anatomicalRibNumber('rib_R7')).toBe(6);
    expect(anatomicalRibNumber('rib_R12')).toBe(11);
    expect(anatomicalRibNumber('rib_L7')).toBe(7);
    expect(anatomicalRibNumber('spine')).toBeNull();
    expect(STRUCTURE_LABELS.rib_R6?.name).toMatch(/^Right rib 5 \(/);
    expect(STRUCTURE_LABELS.rib_R12?.name).toBe('Right rib 11');
  });

  test('danger flags follow the manifest', () => {
    for (const n of DANGER_STRUCTURES) expect(STRUCTURE_LABELS[n]?.danger, n).toBe(true);
    expect(STRUCTURE_LABELS.vagus_nerve_right?.danger).toBe(true); // outside the manifest
    expect(STRUCTURE_LABELS.middle_lobe_vein?.danger).toBeUndefined();
  });

  test('labelFor strips mesh suffix and falls back to a prettified name', () => {
    expect(labelFor('port_utility_5ICS.001').name).toBe(STRUCTURE_LABELS.port_utility_5ICS?.name);
    expect(labelFor('some_new_node').name).toBe('Some new node');
  });
});
