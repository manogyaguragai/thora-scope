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
  env?: number; // × env-map reflections (scene.environmentIntensity overrides per-material intensity); default 1
  rings?: number; // cartilage-ring groove darkening (look.rings), default 0
  // Shade with the derivative normal where the rest-pose normal is wrong: true = look.normalFix edges, or own edges.
  normalFix?: boolean | readonly [number, number];
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
const bronchus = {
  ...wet,
  color: '#f2e4c4',
  bakedMaps: false,
  roughness: 0.55,
  clearcoat: 0.8,
  clearcoatRoughness: 0.15,
  microNormal: 0.25,
  env: 0.3,
  normalFix: true,
};
const subsurface = { wrap: 0.5, scatter: '#ff3020', scatterStrength: 1.2 };

export const TISSUES = {
  collapsedLung: {
    ...wet,
    ...subsurface,
    color: '#b09098', // T807b: greyer + lighter than the plum vein / pleura (3-way luma gap at the step-3 pose)
    mapLuma: 0.25,
    roughness: 0.4,
    microNormal: 0.8, // T111: breaks the env reflection into wet glints (frames: many small sharp highlights)
    scatterStrength: 0.6, // T807b: less red back-scatter → greyer than the plum vein / pleura
    // T807b: collapsed lobes kept rest-pose normals → dark maroon blotches at the step-3 pose. T818: retract_fissure
    // tilts the RLL fissural face only 25–35° off its rest normals (dot 0.8–0.9, under look.normalFix), which then
    // face away from the headlight → dark maroon "V" between RML and RLL at step 6; lungs use tighter edges.
    normalFix: [0.88, 0.97],
    env: 0.3, // T807: grazing lobe surfaces mirrored the env room as silver bands close up
    speckle: 0.35, // T807b: fine anthracotic flecks (0.85 read as polka dots close up)
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
    lobular: 0.18, // T807: visible fat lobules
    scatter: '#ff7a20',
  },
  // T807 clarity classes (teaching sim: readable > literal footage): PA blue-violet, PV darker plum (luminance
  // contrast too), no baked maps on hilar structures (their dark streaky bakes read as grey chrome), low env.
  vein: {
    ...wet,
    color: '#3a1846', // T807b: darkest of vein / pleura / lung
    bakedMaps: false,
    clearcoat: 0.8,
    clearcoatRoughness: 0.25,
    microNormal: 0.3,
    env: 0.15, // the RoomEnvironment's hard-edged boxes mirrored as grey bands
    normalFix: true,
    rim: '#e0a0d0',
    rimStrength: 0.1,
  },
  svc: {
    ...wet,
    color: '#76507e',
    bakedMaps: false,
    clearcoat: 0.8,
    clearcoatRoughness: 0.25,
    env: 0.15, // the RoomEnvironment's hard-edged boxes mirrored as grey bands
    normalFix: true,
    rim: '#c0c8ff',
    rimStrength: 0.08,
  },
  artery: {
    ...wet,
    color: '#5560b8',
    bakedMaps: false,
    roughness: 0.5,
    clearcoat: 0.8,
    clearcoatRoughness: 0.25,
    microNormal: 0.3,
    env: 0.15, // the RoomEnvironment's hard-edged boxes mirrored as grey bands
    normalFix: true,
    rim: '#c0d0ff',
    rimStrength: 0.12,
  },
  aorta: { ...wet, color: '#d8a090', roughness: 0.5 },
  bronchus: { ...bronchus, rings: 0.45 },
  // T807c: no rings on the airway tree (its spherical-shell rings read as grey parallel bands on the step-7 stump).
  airwayTree: bronchus,
  nerve: {
    ...wet,
    color: '#f6eebc',
    bakedMaps: false,
    roughness: 0.4,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    env: 0.5,
    rimStrength: 0.15,
    normalFix: true,
  },
  lymphNode: {
    ...wet,
    color: '#6e5c50',
    bakedMaps: false,
    roughness: 0.6,
    clearcoat: 0.7,
    clearcoatRoughness: 0.15,
    env: 0.4,
    speckle: 0.7, // T807b: anthracotic node (vs the plain ivory bronchus)
    lobular: 0.15,
    normalFix: true,
  },
  connective: {
    ...wet,
    ...subsurface,
    color: '#e8ccb4',
    retint: 0.6,
    mapLuma: 0.5,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    opacity: 0.4, // T807: thin veil over the hilum (glTF 0.55) so the structures being dissected show through
  },
  pericardium: {
    ...wet,
    color: '#8a7cc0', // T810: lavender after the warm grade (01:01); #9a7090 read tan and collided with the SPV
    bakedMaps: false, // T807: its baked streaks read as grey chrome close up
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
    env: 0.4,
    rim: '#c8c0ff',
    rimStrength: 0.12,
  },
  heart: { ...wet, ...subsurface, color: '#8a3a3c', mapLuma: 0.1 },
  pleuraWall: {
    ...wet,
    color: '#9c8494', // T810: mauve-grey so the SPV is the only plum; T807c (#946084): glossy lavender pleura (05:21); still lighter than the plum vein, darker than the lung
    retint: 1,
    bakedMaps: false, // T111: its baked maps have patchy islands (crimson/grey blotches); plain violet matches 04:29
    mapLuma: 0.5,
    opacity: 1, // T111: opaque variant; at 0.75 the crimson muscle showed through as blotches
    clearcoat: 1,
    clearcoatRoughness: 0.07,
    rim: '#c8c0ff', // T807c: subtle lavender sheen at grazing angles
    rimStrength: 0.1,
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
  [/^tree_airway_base$/, 'airwayTree'],
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
  2: ['tree_pulm_vein_base', 'V_RML_common'], // the phrenic nerve is outside the cam_2 view
  3: ['V_RML_common', 'V4_lateral', 'V5_medial', 'V_RML_accessory_2'], // accessory_1: scope-hidden (stripes)
  4: ['B_RML_common', 'B4_lateral', 'B5_medial', 'LN_11R', 'LN_12R'],
  5: ['A_RML_common', 'A4_lateral', 'A5_medial', 'A_RML_accessory_1', 'A_RML_accessory_2', 'A_RML_extra_1'],
  6: ['lung_middle_lobe_right'],
  7: ['tree_airway_base'], // the stump; LN_4R / LN_7 are behind the re-inflated lobes from the cam_7 fix pose
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
    speckleTiling: 0.9, // × microTiling → ≈ 1.7 mm cells on the lung (T807b: 0.45 → 3.5 mm read as polka dots)
    lobularTiling: 0.225, // × microTiling → ≈ 8 mm lobules
    speckleEdge: [0.08, 0.04] as const, // smoothstep(a, b, F1): dot radius in cells (soft → hard), ≈ 0.1 mm
    speckleFloor: 0.25, // dot strength inside lobules (1 at borders)
    lobularEdge: [0.45, 0.8] as const, // smoothstep(a, b, F1): darkening toward cell borders
  },
  detailRange: [0.45, 1.8] as const, // retint detail (map luma / mapLuma) clamp: lifts baked dark lines, caps hot spots
  lumaWeights: [0.2126, 0.7152, 0.0722] as const,
  rimPower: 4,
  // T807 cartilage rings: grooves on spherical shells around the bbox centre of a branch's parent airway, so they
  // cut the branch roughly across its axis (it leaves the parent radially). No UV dependence (atlas UVs).
  rings: {
    defaultOrigin: 'tree_airway_base',
    origins: { B4_lateral: 'B_RML_common', B5_medial: 'B_RML_common' } as Readonly<Record<string, string>>,
    spacingM: 0.003, // T807c: 1.5 mm read as grey stripes on the step-7 stump
    groove: [0.5, 0.95] as const, // smoothstep on sin(phase): dark groove ≈ a sixth of each period (T807c: a quarter)
  },
  // T807 step-focus highlight (uniform-driven emissive rim on the step's STEP_FOCUS meshes; fades with the step).
  focus: {
    // A complementary tint (e.g. UI teal on plum) greys the vessel out, so the focus glows in its own colour
    // (self-illumination × albedo) plus a thin warm-white fresnel rim.
    color: '#fff2dc', // rim colour
    strength: 0.65, // rim emissive radiance at grazing angles
    self: 0.8, // emissive = albedo × self (keeps the structure's hue, lifts it above its neighbours)
    rimPower: 2, // T807c: wider rim so the outline stands out from the pink lung
    modes: ['guided'] as readonly string[], // Layers checkbox default on in these modes, off elsewhere (practice, quiz)
  },
  // T807: smoothstep(a, b, dot(vertex normal, derivative normal)): below a the shading uses the derivative normal.
  normalFix: [0.2, 0.5] as const,
  // T807: polygon offset (factor, units) per node: pushes it behind coincident neighbours (z-fighting streaks close
  // up). GL state only, no program change. T807b: the RML entry went (its slope factor stair-stepped the lobe edges).
  depthBias: {
    tree_pulm_artery_base: [2, 1000], // the base trees lose to the coincident RML branch meshes
    tree_pulm_vein_base: [2, 1000],
    tree_airway_base: [2, 1000],
    mediastinal_fat: [2, 1000], // T807c: pokes through the coincident pericardium as a yellow patch (step 2)
  } as Readonly<Record<string, readonly [number, number]>>,
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
