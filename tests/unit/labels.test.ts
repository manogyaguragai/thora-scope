import { describe, expect, test } from 'vitest';
import procedure from '../../src/content/procedure_steps.json';
import { STRUCTURE_LABELS, anatomicalRibNumber, labelFor } from '../../src/content/labels';

const ribs = (s: string): string[] => Array.from({ length: 12 }, (_, i) => `rib_${s}${i + 1}`);
// CONTEXT §7.2 names
const SPEC_NAMES = [
  'lung_upper_lobe_right',
  'lung_middle_lobe_right',
  'lung_lower_lobe_right',
  'lung_upper_lobe_left',
  'lung_lower_lobe_left',
  'tree_pulm_artery_base',
  'tree_pulm_vein_base',
  'tree_airway_base',
  'V_RML_common',
  'V4_lateral',
  'V5_medial',
  'V_RML_accessory_1',
  'V_RML_accessory_2',
  'A_RML_common',
  'A4_lateral',
  'A5_medial',
  'A_RML_accessory_1',
  'A_RML_accessory_2',
  'A_RML_extra_1',
  'B_RML_common',
  'B4_lateral',
  'B5_medial',
  'mediastinal_fat',
  'mediastinal_fat_window',
  'hilar_connective_tissue',
  'hilar_connective_tissue_window',
  'pericardium',
  'inferior_pulmonary_ligament',
  'LN_4R',
  'LN_7',
  'LN_10R',
  'LN_11R',
  'LN_12R',
  'phrenic_nerve_right',
  'vagus_nerve_right',
  'azygos_vein',
  'superior_vena_cava',
  'inferior_vena_cava',
  'aorta',
  'heart_rest',
  'left_atrium_provisional',
  'esophagus',
  'diaphragm',
  'brachiocephalic_trunk',
  'brachiocephalic_vein_left',
  'brachiocephalic_vein_right',
  'pa_left',
  'skin',
  'subcutaneous_fat',
  'chest_wall_muscle',
  'intercostal_muscles',
  'parietal_pleura_wall',
  ...ribs('R'),
  ...ribs('L'),
  'spine',
  'sternum',
  'scapula_left',
  'scapula_right',
  'clavicula_left',
  'clavicula_right',
  'costal_cartilages',
  'port_camera_8ICS',
  'port_utility_5ICS',
  'port_retraction_8ICS',
];

describe('structure labels', () => {
  test('every layer_groups node has a label in the matching group', () => {
    for (const [group, nodes] of Object.entries(procedure.layer_groups)) {
      for (const n of nodes) expect(STRUCTURE_LABELS[n]?.group, n).toBe(group);
    }
  });

  test('every §7.2 name is labelled', () => {
    for (const n of SPEC_NAMES) expect(STRUCTURE_LABELS[n], n).toBeDefined();
  });

  test('non-empty names, descriptions ≤ 120 chars', () => {
    for (const [n, l] of Object.entries(STRUCTURE_LABELS)) {
      expect(l.name.trim(), n).not.toBe('');
      expect(l.description.trim(), n).not.toBe('');
      expect(l.group.trim(), n).not.toBe('');
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

  test('danger flags and trimmed-tree note', () => {
    for (const n of ['tree_airway_base', 'tree_pulm_artery_base', 'tree_pulm_vein_base']) {
      expect(STRUCTURE_LABELS[n]?.danger, n).toBe(true);
      expect(STRUCTURE_LABELS[n]?.description, n).toMatch(/hilar vessels only/i);
    }
    for (const n of ['phrenic_nerve_right', 'vagus_nerve_right', 'azygos_vein', 'superior_vena_cava']) {
      expect(STRUCTURE_LABELS[n]?.danger, n).toBe(true);
    }
    expect(STRUCTURE_LABELS.V_RML_common?.danger).toBeUndefined();
  });

  test('labelFor strips mesh suffix and falls back to a prettified name', () => {
    expect(labelFor('port_utility_5ICS.001').name).toBe(STRUCTURE_LABELS.port_utility_5ICS?.name);
    expect(labelFor('some_new_node').name).toBe('Some new node');
  });
});
