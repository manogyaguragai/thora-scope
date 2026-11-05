import { describe, expect, it } from 'vitest';
import { buildNoiseTexture, tissueOf } from '../../src/scene/materials';

describe('tissue classes (glTF node names, CONTEXT §7.2)', () => {
  it.each([
    ['lung_middle_lobe_right', 'collapsedLung'],
    ['lung_upper_lobe_left', 'ventilatedLung'],
    ['mediastinal_fat_window', 'fat'],
    ['subcutaneous_fat', 'fat'],
    ['V_RML_common', 'vein'],
    ['V4_lateral', 'vein'],
    ['tree_pulm_vein_base', 'vein'],
    ['brachiocephalic_vein_left', 'vein'],
    ['superior_vena_cava', 'svc'],
    ['A5_medial', 'artery'],
    ['tree_pulm_artery_base', 'artery'],
    ['aorta', 'aorta'],
    ['B_RML_common', 'bronchus'],
    ['tree_airway_base', 'bronchus'],
    ['phrenic_nerve_right', 'nerve'],
    ['LN_11R', 'lymphNode'],
    ['pericardium', 'pericardium'],
    ['heart_rest', 'heart'],
    ['parietal_pleura_wall', 'pleuraWall'],
    ['intercostal_muscles', 'muscle'],
    ['rib_R7', 'bone'],
    ['costal_cartilages', 'bone'],
    ['port_utility_5ICS', 'trocar'],
    ['hilar_connective_tissue', 'connective'],
  ])('%s → %s', (name, cls) => expect(tissueOf(name)).toBe(cls));
});

describe('shared noise texture', () => {
  it('is RGBA8, tiling, with unit-ish normals and a Worley alpha', () => {
    const tex = buildNoiseTexture();
    const { data, width, height } = tex.image as { data: Uint8Array; width: number; height: number };
    expect(data.length).toBe(width * height * 4);
    let minA = 255;
    let maxA = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [x, y, z] = [0, 1, 2].map((k) => (data[i + k] ?? 0) / 127.5 - 1) as [number, number, number];
      expect(Math.abs(Math.hypot(x, y, z) - 1)).toBeLessThan(0.03);
      expect(z).toBeGreaterThan(0);
      minA = Math.min(minA, data[i + 3] ?? 0);
      maxA = Math.max(maxA, data[i + 3] ?? 0);
    }
    expect(minA).toBeLessThan(20); // feature points (speckle dots)
    expect(maxA).toBeGreaterThan(120); // cell borders (lobules)
  });
});
