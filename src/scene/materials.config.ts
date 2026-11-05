// Look config (CONTEXT §8): per-tissue material params, shared noise, scope headlight. All look numbers live here.
// Colours are sRGB hex. Targets come from docs/REFERENCE_FRAMES.md "Sampled tissue colours" (mid-field values,
// slightly darkened because the ref values are lit + graded); tuned by eye against the ref-frames.

export interface TissueParams {
  /** Base albedo. With a baked map, retint ∈ [0,1] blends the map's hue toward this colour (map luminance kept as detail). */
  color: string;
  retint: number;
  mapLuma: number; // mean linear luminance of this class's baked maps (measured offline); detail = luma / mapLuma
  roughness: number;
  clearcoat: number; // §8: 0.7–1.0 for wet tissue
  clearcoatRoughness: number; // §8: 0.05–0.15
  microNormal: number; // clearcoat micro-normal (liquid film) strength
  wrap: number; // wrap-lighting amount (0 = Lambert)
  scatter: string; // red-shifted back-scatter colour near the terminator
  scatterStrength: number;
  rim: string; // fresnel rim colour
  rimStrength: number;
  speckle: number; // anthracotic black dots (needs UVs)
  lobular: number; // lobular network darkening (needs UVs)
  opacity?: number; // overrides the glTF alpha for BLEND materials (default look)
  bakedMaps?: boolean; // false: drop the glTF colour/normal/roughness maps (broken bakes); default true
}

const wet = {
  retint: 1,
  mapLuma: 0.25,
  roughness: 0.55,
  clearcoat: 0.9,
  clearcoatRoughness: 0.08,
  microNormal: 0.2,
  wrap: 0,
  scatter: '#000000',
  scatterStrength: 0,
  rim: '#ffffff',
  rimStrength: 0.06,
  speckle: 0,
  lobular: 0,
};
const subsurface = { wrap: 0.5, scatter: '#ff3020', scatterStrength: 1.2 };

export const TISSUES = {
  collapsedLung: {
    ...wet,
    ...subsurface,
    color: '#b06c7a',
    mapLuma: 0.25,
    roughness: 0.4,
    microNormal: 0.8, // T111: breaks the env reflection into wet glints (frames: many small sharp highlights)
    speckle: 0.85,
    lobular: 0.22,
    rim: '#ffd0e0',
    rimStrength: 0.1,
  },
  ventilatedLung: { ...wet, ...subsurface, color: '#e0a098', roughness: 0.45 },
  fat: {
    ...wet,
    ...subsurface,
    color: '#f0c068',
    retint: 0.6,
    mapLuma: 0.4,
    roughness: 0.4,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    microNormal: 0.8,
    scatter: '#ff7a20',
  },
  vein: {
    ...wet,
    color: '#5a2c48',
    mapLuma: 0.035,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    rim: '#c0a0ff',
    rimStrength: 0.08,
  },
  svc: {
    ...wet,
    color: '#6a5c8c',
    mapLuma: 0.045,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    rim: '#c0c8ff',
    rimStrength: 0.08,
  },
  artery: {
    ...wet,
    color: '#e09080',
    mapLuma: 0.115,
    roughness: 0.5,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
  },
  aorta: { ...wet, color: '#d8a090', roughness: 0.5 },
  bronchus: {
    ...wet,
    color: '#ecd8b0',
    mapLuma: 0.43,
    roughness: 0.5,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
    microNormal: 0.25,
  },
  nerve: {
    ...wet,
    color: '#f0e4d4',
    mapLuma: 0.18,
    roughness: 0.4,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    rimStrength: 0.12,
  },
  lymphNode: { ...wet, color: '#4a3c3e', mapLuma: 0.05, speckle: 0.6, lobular: 0.1 },
  connective: {
    ...wet,
    ...subsurface,
    color: '#e8ccb4',
    retint: 0.6,
    mapLuma: 0.5,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  },
  pericardium: {
    ...wet,
    color: '#8c5870',
    mapLuma: 0.55,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    rim: '#c8c0ff',
    rimStrength: 0.12,
  },
  heart: { ...wet, ...subsurface, color: '#8a3a3c', mapLuma: 0.1 },
  pleuraWall: {
    ...wet,
    color: '#80506a',
    retint: 1,
    bakedMaps: false, // T111: its baked maps have patchy islands (crimson/grey blotches); plain violet matches 04:29
    mapLuma: 0.5,
    opacity: 1, // T111: opaque variant; at 0.75 the crimson muscle showed through as blotches
    clearcoat: 1,
    clearcoatRoughness: 0.07,
  },
  muscle: { ...wet, color: '#8a3a40', retint: 0.7, mapLuma: 0.07 },
  esophagus: { ...wet, color: '#b07068' },
  bone: {
    ...wet,
    color: '#e6d8cc', // pale ivory ribs (outside view; scope sees them through the pleura)
    roughness: 0.6,
    clearcoat: 0.7,
    clearcoatRoughness: 0.15,
    microNormal: 0.1,
  },
  skin: {
    ...wet,
    color: '#a86a4c', // T801: '#c89878' read as cream under the outside auto-exposure
    roughness: 0.8,
    clearcoat: 0.2,
    clearcoatRoughness: 0.15,
    microNormal: 0,
    rimStrength: 0,
  },
  trocar: {
    ...wet,
    color: '#1c1c1e',
    roughness: 0.35,
    clearcoat: 0.7,
    clearcoatRoughness: 0.15,
    microNormal: 0,
    rimStrength: 0,
  },
} satisfies Record<string, TissueParams>;

export type TissueClass = keyof typeof TISSUES;

/** glTF node name → tissue class; first match wins (CONTEXT §7.2 names). */
export const TISSUE_RULES: readonly [RegExp, TissueClass][] = [
  [/^lung_.*_right$/, 'collapsedLung'], // right lobes are collapsed for most of the procedure
  [/^lung_/, 'ventilatedLung'],
  [/fat/, 'fat'],
  [/^superior_vena_cava$/, 'svc'],
  [/^(V\d|V_|tree_pulm_vein|azygos|inferior_vena|brachiocephalic_vein)/, 'vein'],
  [/^(aorta|brachiocephalic_trunk)$/, 'aorta'],
  [/^(A\d|A_|tree_pulm_artery|pa_left|arteries_)/, 'artery'],
  [/^(B\d|B_|tree_airway)/, 'bronchus'],
  [/_nerve_/, 'nerve'],
  [/^LN_/, 'lymphNode'],
  [/^(hilar_connective|inferior_pulmonary_ligament)/, 'connective'],
  [/^pericardium$/, 'pericardium'],
  [/^(heart_|left_atrium)/, 'heart'],
  [/^parietal_pleura_wall$/, 'pleuraWall'],
  [/^(intercostal_muscles|chest_wall_muscle|diaphragm)$/, 'muscle'],
  [/^esophagus$/, 'esophagus'],
  [/^(rib_|spine|sternum|scapula|clavicula|costal_cartilages)/, 'bone'],
  [/^skin$/, 'skin'],
  [/^port_/, 'trocar'],
];
export const FALLBACK_TISSUE: TissueClass = 'connective';

/**
 * T807: structures each procedure step is about (§7.2 node names). Drives the step-focus highlight and the
 * focus-only labels. Curated for teaching (the practice targets also list the lobes the lung retractor holds).
 */
export const STEP_FOCUS: Readonly<Record<number, readonly string[]>> = {
  1: ['lung_middle_lobe_right'],
  2: ['phrenic_nerve_right', 'tree_pulm_vein_base', 'V_RML_common'],
  3: ['V_RML_common', 'V4_lateral', 'V5_medial'],
  4: ['B_RML_common', 'B4_lateral', 'B5_medial', 'LN_11R', 'LN_12R'],
  5: ['A_RML_common', 'A4_lateral', 'A5_medial'],
  6: ['lung_middle_lobe_right'],
  7: ['tree_airway_base', 'LN_4R', 'LN_7'],
};

export const look = {
  /** Shared procedural noise (built once): RGB = micro-normal, A = cellular distance (speckle/lobules). */
  noise: {
    size: 256,
    seed: 1337,
    heightOctaves: 4,
    heightCells: 8, // lattice cells per tile, first octave
    heightAmp: 3, // finite-difference gain → normal steepness
    worleyCells: 12, // feature points per tile edge
    microTiling: 16, // texture repeats per UV unit (liquid film); lung UV unit ≈ 0.3 m (T111 measured)
    speckleTiling: 0.45, // × microTiling → ≈ 3.5 mm cells on the lung (was 0.35 mm: mip-averaged away)
    lobularTiling: 0.225, // × microTiling → ≈ 8 mm lobules
    speckleEdge: [0.16, 0.08] as const, // smoothstep(a, b, F1): dot radius in cells (soft → hard), ≈ 0.5 mm
    speckleFloor: 0.25, // dot strength inside lobules (1 at borders)
    lobularEdge: [0.45, 0.8] as const, // smoothstep(a, b, F1): darkening toward cell borders
  },
  detailRange: [0.45, 1.8] as const, // retint detail (map luma / mapLuma) clamp: lifts baked dark lines, caps hot spots
  lumaWeights: [0.2126, 0.7152, 0.0722] as const,
  rimPower: 4,
  /** X-ray: every mesh swaps to its transparent variant at this opacity. */
  xrayOpacity: 0.3,
  headlight: {
    color: '#fff4ea', // warm halogen/xenon
    intensity: 0.05, // candela; inverse-square (decay 2) in metres: ≈ bright at 3–5 cm, dark beyond ~15 cm
    distance: 0, // no cutoff; inverse-square does the falloff
    decay: 2,
    angle: 0.95, // rad half-angle; covers the widest glTF scope FOV diagonal
    penumbra: 0.6,
  },
  // outsideIntensity: hemisphere intensity in the outside view (no headlight reaches the body there).
  ambient: { sky: '#ffe0e0', ground: '#401018', intensity: 0.04, outsideIntensity: 0.3 },
  env: { intensity: 0.4, sigma: 0.04 }, // PMREM RoomEnvironment: reflections only (T111: wet glints via micro-normal)
} as const;
