import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/core/config';
import {
  applyMaterials,
  buildNoiseTexture,
  getDivisionPlanes,
  parkCutaway,
  setCutawayPlane,
  setXray,
  tissueOf,
} from '../../src/scene/materials';

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
    // One expect per property after the loop (65k per-texel expects took > 5 s under parallel load).
    let minA = 255;
    let maxA = 0;
    let maxLenErr = 0;
    let minZ = 1;
    const c = (k: number): number => (data[k] ?? 0) / 127.5 - 1;
    for (let i = 0; i < data.length; i += 4) {
      maxLenErr = Math.max(maxLenErr, Math.abs(Math.hypot(c(i), c(i + 1), c(i + 2)) - 1));
      minZ = Math.min(minZ, c(i + 2));
      minA = Math.min(minA, data[i + 3] ?? 0);
      maxA = Math.max(maxA, data[i + 3] ?? 0);
    }
    expect(maxLenErr).toBeLessThan(0.03);
    expect(minZ).toBeGreaterThan(0);
    expect(minA).toBeLessThan(20); // feature points (speckle dots)
    expect(maxA).toBeGreaterThan(120); // cell borders (lobules)
  });
});

describe('clipping planes (fixed count from load, §6.4/§6.5)', () => {
  it('both variants share [cut-away, ...division]; moving planes never changes the arrays', () => {
    const root = new Group();
    const a = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    a.name = 'V_RML_common';
    const b = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    b.name = 'A5_medial';
    root.add(a, b);
    const proxies = applyMaterials(root);
    expect(proxies.children).toHaveLength(2);

    const planesOf = (m: Mesh): unknown[] => (m.material as MeshPhysicalMaterial).clippingPlanes ?? [];
    const opaqueA = planesOf(a);
    setXray(true);
    const transparentA = planesOf(a);
    setXray(false);
    expect(transparentA).toBe(opaqueA);
    expect(opaqueA).toHaveLength(1 + config.clipping.divisionPlanes);
    expect(planesOf(b)[0]).toBe(opaqueA[0]); // cut-away shared
    expect(planesOf(b)[1]).not.toBe(opaqueA[1]); // division per mesh
    expect(getDivisionPlanes(a)).toEqual(opaqueA.slice(1));

    const cut = opaqueA[0];
    setCutawayPlane(new Vector3(1, 0, 0), -0.1);
    expect(opaqueA[0]).toBe(cut);
    expect(opaqueA).toHaveLength(1 + config.clipping.divisionPlanes);
    expect(cut).toMatchObject({ normal: { x: 1, y: 0, z: 0 }, constant: -0.1 });
    parkCutaway();
    expect(cut).toMatchObject({ constant: config.clipping.parkConstant });
  });
});
