import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  ShaderLib,
  Vector2,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/core/config';
import {
  applyMaterials,
  buildNoiseTexture,
  getDivisionPlanes,
  getPalette,
  parkCutaway,
  setCutawayPlane,
  setHeartbeat,
  setPalette,
  setXray,
  tissueOf,
} from '../../src/scene/materials';
import {
  DISSECTABLE,
  HIDDEN_AT_LOAD,
  PALETTES,
  PULSE,
  REALISTIC,
  STEP_FOCUS,
  STRUCTURES,
  TISSUES,
  TISSUE_RULES,
  look,
  paletteParams,
} from '../../src/scene/materials.config';
import type { TissueClass } from '../../src/scene/materials.config';

describe('tissue classes (manifest + glTF node names, CONTEXT §7.2)', () => {
  it('every manifest structure maps to its manifest class, and that class exists', () => {
    for (const [name, s] of Object.entries(STRUCTURES)) {
      expect(s.tissue in TISSUES, `${name}: ${s.tissue}`).toBe(true);
      expect(tissueOf(name), name).toBe(s.tissue);
    }
  });

  // Kept base-scene (non-manifest) meshes: name patterns.
  it.each([
    ['lung_upper_lobe_left', 'ventilatedLung'],
    ['arteries_left_intrapulm', 'artery'],
    ['subcutaneous_fat', 'fat'],
    ['inferior_vena_cava', 'svc'],
    ['brachiocephalic_vein_left', 'svc'],
    ['aorta', 'aorta'],
    ['vagus_nerve_right', 'nerve'],
    ['heart_rest', 'heart'],
    ['parietal_pleura_wall', 'pleuraWall'],
    ['intercostal_muscles', 'muscle'],
    ['rib_R7', 'bone'],
    ['costal_cartilages', 'bone'],
    ['port_utility_5ICS', 'trocar'],
  ])('%s → %s', (name, cls) => expect(tissueOf(name)).toBe(cls));

  it('dissectable / hidden / pulse / step focus are derived from the manifest', () => {
    const names = Object.keys(STRUCTURES);
    for (const n of names) {
      const s = STRUCTURES[n];
      expect(DISSECTABLE.test(n), n).toBe(s?.dissectable === true);
      expect(HIDDEN_AT_LOAD.includes(n), n).toBe(s?.hidden === true);
      if (s?.pulse !== undefined) expect(PULSE[n], n).toBe(s.pulse); // manifest wins
      // T842: the heartbeat reaches every hilar vessel (manifest weight or the config fallback)
      if (s?.tissue === 'artery' || s?.tissue === 'vein') expect(PULSE[n] ?? 0, n).toBeGreaterThan(0);
      for (const k of ['divideStep', 'dissectStep', 'clearStep', 'removedAfterStep'] as const) {
        const step = s?.[k];
        if (step !== undefined) expect(STEP_FOCUS[step], `${n} ${k}`).toContain(n);
      }
    }
    expect(DISSECTABLE.test('parietal_pleura_wall')).toBe(true);
    expect(DISSECTABLE.test('parietal_pleura_wall_x')).toBe(false);
    expect(names.some((n) => DISSECTABLE.test(n))).toBe(true);
    for (const w of Object.values(PULSE)) {
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(1);
    }
    for (const list of Object.values(STEP_FOCUS))
      for (const n of list)
        expect(
          TISSUE_RULES.some(([re]) => re.test(n)),
          n,
        ).toBe(true); // not the fallback
  });

  it('hidden structures start invisible; the normal fix is off on meshes with morph normals', () => {
    const root = new Group();
    const mk = (name: string, morphNormals: boolean): Mesh => {
      const g = new BoxGeometry();
      g.morphAttributes.position = [g.getAttribute('position').clone()];
      if (morphNormals) g.morphAttributes.normal = [g.getAttribute('normal').clone()];
      const m = new Mesh(g, new MeshStandardMaterial());
      m.name = name;
      root.add(m);
      return m;
    };
    const hidden = HIDDEN_AT_LOAD[0] ?? '';
    const fat = mk(hidden, true);
    const withN = mk('lung_middle_lobe_right', true);
    const without = mk('lung_lower_lobe_left', false); // collapsed class edges apply only without morph normals
    const lobe = mk('lung_upper_lobe_right', false);
    applyMaterials(root);
    expect(fat.visible).toBe(false);
    expect(withN.visible).toBe(true);
    const fix = (m: Mesh): Vector2 => uniformsOf(m)['uNormalFix']?.value as Vector2;
    expect(fix(withN).y).toBe(0);
    expect(fix(lobe).y).toBeGreaterThan(0);
    expect(fix(without).y).toBe(0); // ventilatedLung has no normal fix configured
  });
});

const uniformsOf = (m: Mesh): Record<string, { value: unknown }> => {
  const mat = m.material as MeshPhysicalMaterial;
  const shader = {
    uniforms: {},
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
  };
  mat.onBeforeCompile(shader as never, null as never);
  expect(shader.vertexShader).toContain('uHeartbeat');
  return shader.uniforms;
};

describe('heartbeat pulse (T831)', () => {
  it('per-mesh amplitude = manifest pulse × config, one shared heartbeat uniform, no material change', () => {
    const root = new Group();
    const mk = (name: string): Mesh => {
      const m = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
      m.name = name;
      root.add(m);
      return m;
    };
    const [beating = '', w = 0] = Object.entries(PULSE)[0] ?? [];
    const pa = mk(beating);
    const still = mk(Object.keys(STRUCTURES).find((n) => !PULSE[n]) ?? '');
    applyMaterials(root);
    const u = uniformsOf(pa);
    expect(u['uPulse']?.value).toBeCloseTo(w * look.pulse.amplitudeM, 9);
    expect(uniformsOf(still)['uPulse']?.value).toBe(0);
    const version = (pa.material as MeshPhysicalMaterial).version;
    setHeartbeat(0.7);
    expect(u['uHeartbeat']?.value).toBe(0.7);
    expect(uniformsOf(still)['uHeartbeat']).toBe(u['uHeartbeat']); // shared
    setHeartbeat(0);
    expect((pa.material as MeshPhysicalMaterial).version).toBe(version);
  });
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
    a.name = 'middle_lobe_vein';
    const b = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    b.name = 'middle_lobe_artery_A5';
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

describe('colour palettes (T826, ADR-013)', () => {
  const HEX = /^#[0-9a-f]{6}$/i;
  it('every tissue class resolves valid values in both palettes; realistic is the default', () => {
    expect(look.palette.default).toBe('realistic');
    for (const cls of Object.keys(TISSUES) as TissueClass[])
      for (const p of PALETTES) {
        const c = paletteParams(cls, p);
        expect(c.color, `${cls} ${p}`).toMatch(HEX);
        expect(c.rim, `${cls} ${p}`).toMatch(HEX);
        expect(c.retint).toBeGreaterThanOrEqual(0);
        expect(c.retint).toBeLessThanOrEqual(1);
      }
    // The teaching-coded hilar classes really differ.
    for (const cls of ['artery', 'vein', 'nerve', 'pericardium'] as const)
      expect(paletteParams(cls, 'realistic').color).not.toBe(paletteParams(cls, 'teaching').color);
    expect(Object.keys(REALISTIC).every((k) => k in TISSUES)).toBe(true);
    // ADR-014 Teaching = STS: artery blue, vein red, bronchus ivory, nerve yellow, nodes grey-purple.
    const rgb = (cls: TissueClass): Color => new Color(paletteParams(cls, 'teaching').color);
    expect(rgb('artery').b).toBeGreaterThan(2 * rgb('artery').r);
    expect(rgb('vein').r).toBeGreaterThan(2 * rgb('vein').b);
    expect(Math.min(rgb('bronchus').r, rgb('bronchus').g)).toBeGreaterThan(0.6); // pale
    expect(rgb('nerve').b).toBeLessThan(0.5 * rgb('nerve').g); // yellow
    expect(rgb('lymphNode').b).toBeGreaterThan(rgb('lymphNode').g); // purple cast
    expect(Math.max(rgb('lymphNode').r, rgb('lymphNode').b)).toBeLessThan(0.3); // grey-dark
    expect(look.palette.hint).toMatch(/veins red/);
  });

  it('setPalette writes colour values only (material version unchanged → no recompile)', () => {
    const root = new Group();
    const a = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    a.name = 'middle_lobe_artery_A5';
    root.add(a);
    applyMaterials(root);
    const m = a.material as MeshPhysicalMaterial;
    const version = m.version;
    expect(getPalette()).toBe('realistic');
    expect(m.color.equals(new Color(REALISTIC.artery?.color))).toBe(true);
    setPalette('teaching');
    expect(m.color.equals(new Color(TISSUES.artery.color))).toBe(true);
    setXray(true);
    expect((a.material as MeshPhysicalMaterial).color.equals(new Color(TISSUES.artery.color))).toBe(true);
    setXray(false);
    setPalette('realistic');
    expect(m.color.equals(new Color(REALISTIC.artery?.color))).toBe(true);
    expect(m.version).toBe(version);
  });
});
