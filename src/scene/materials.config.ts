// Look config (CONTEXT §8): per-tissue material params, shared noise, scope headlight. All look numbers live here.
// Colours are sRGB hex. Targets come from docs/REFERENCE_FRAMES.md "Sampled tissue colours" (mid-field values,
// slightly darkened because the ref values are lit + graded); tuned by eye against the ref-frames.
// T831: hilum structures are keyed off the model manifest (src/content/anatomy.json `structures`: tissue class, pulse
// weight, dissectable, hidden, step fields), so a new model version with the same names needs no code change.
import anatomyJson from '../content/anatomy.json' with { type: 'json' };
const { structures } = anatomyJson;
import type { Family } from './tissueTextures.config';

/** One manifest entry (docs/MODEL_INTEGRATION.md). `tissue` must be a TissueClass (unit-tested). */
export interface ManifestStructure {
  tissue: string;
  lobe?: string;
  group?: string;
  divideStep?: number;
  dissectStep?: number;
  clearStep?: number;
  removedAfterStep?: number;
  danger?: string;
  pulse?: number; // heartbeat pulse weight 0..1 (× look.pulse.amplitudeM)
  dissectable?: boolean;
  hidden?: boolean; // starts invisible (visibility, not material)
}
export const STRUCTURES: Readonly<Record<string, ManifestStructure>> = structures;

/** T824 procedural triplanar detail (tissueTextures.ts atlas layer), sampled in rest-pose object space (metres). */
export interface TissueDetail {
  family: Family;
  scale: number; // tiles per metre
  bump: number; // relief as a fraction of the tile size (keep fat/lung subtle: cobblestones at ≳ 0.01)
  albedo: number; // albedo modulation by the layer's B channel (± around 0.5)
  mask: number; // tint toward maskColor by the layer's A channel (capillaries / anthracotic dots)
  maskColor: string;
}

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
  speckle: number; // anthracotic black dots (needs UVs; UV-less meshes use `detail` instead)
  lobular: number; // lobular network darkening (needs UVs)
  veil?: number; // T831 thin membranes: alpha → 1 toward grazing angles (fresnel), transparent variants only
  opacity?: number; // overrides the glTF alpha for BLEND materials (default look)
  bakedMaps?: boolean; // false: drop the glTF colour/normal/roughness maps (broken bakes); default true
  env?: number; // × env-map reflections (scene.environmentIntensity overrides per-material intensity); default 1
  // Shade with the derivative normal where the rest-pose normal is wrong: true = look.normalFix edges, or own edges.
  // T831: applied only to meshes WITHOUT morph normals (position-only morphs keep stale rest normals).
  normalFix?: boolean | readonly [number, number];
  detail?: TissueDetail; // T824, default none (no extra texture fetches: uniform-gated)
  blood?: number; // T824 blood staining (look.blood) strength, default 0
}

// T824 detail presets (scales from anatomy: vessel capillary net ≈ 3 mm cells, fat lobules ≈ 5 mm, lung secondary
// lobules ≈ 1.3 cm, pleural grain ≈ 5 cm tiles).
const vesselDetail = {
  family: 'vessel',
  scale: 50,
  bump: 0.003,
  albedo: 0.25,
  mask: 0.55,
  maskColor: '#5a0c1c',
} as const satisfies TissueDetail;
const pleuraDetail = {
  family: 'pleura',
  scale: 20,
  bump: 0.002,
  albedo: 0.25,
  mask: 0.45,
  maskColor: '#9a1c24',
} as const satisfies TissueDetail;
const lungDetail = {
  family: 'lung',
  scale: 12,
  bump: 0.0008, // T831: 0.0015 creased every lobule border into a honeycomb close up
  albedo: 0.15,
  mask: 0.4,
  maskColor: '#201418',
} as const satisfies TissueDetail;
// T831 vessel walls: arteries thick + pale with fine red vasa vasorum; veins thin-walled, darker, fewer visible vasa.
const arteryDetail = { ...vesselDetail, mask: 0.3, maskColor: '#a8202c' } as const satisfies TissueDetail;
const veinDetail = {
  ...vesselDetail,
  bump: 0.002,
  albedo: 0.3,
  mask: 0.12, // T831: 0.3 read as dark cracks close up
  maskColor: '#3a0818',
} as const satisfies TissueDetail;

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
  color: '#eed8b8', // T823
  bakedMaps: false,
  roughness: 0.55,
  clearcoat: 0.8,
  clearcoatRoughness: 0.08, // T823
  microNormal: 0.6, // T823
  env: 0.5, // T823
  normalFix: true,
  // T831: the cartilage rings are model geometry; the detail adds ivory cartilage grain + pinkish membranous patches
  // with fine vessels between the rings.
  detail: {
    family: 'bronchus',
    scale: 50,
    bump: 0.003,
    albedo: 0.25,
    mask: 0.35,
    maskColor: '#c87c78',
  } as const,
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
    // T807b/T818: position-only morphs keep rest normals → dark bands at collapse/retract poses. T831: skipped per mesh
    // when the mesh ships morph normals (manifest models do).
    normalFix: [0.88, 0.97],
    env: 0.3, // T807: grazing lobe surfaces mirrored the env room as silver bands close up
    clearcoatRoughness: 0.06, // T831: glossy visceral pleura
    rim: '#ffd0e0',
    rimStrength: 0.1,
    detail: { ...lungDetail, mask: 0.55 }, // lobules + anthracotic dots (UV-free, unlike speckle/lobular)
  },
  ventilatedLung: { ...wet, ...subsurface, color: '#e0a098', roughness: 0.45, detail: lungDetail },
  fat: {
    ...wet,
    ...subsurface,
    color: '#f2c896', // T823: paler (#f0c068 read flat orange-yellow)
    retint: 0.8, // T823
    mapLuma: 0.4,
    roughness: 0.4,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    microNormal: 0.8,
    lobular: 0.15, // T846: 0.3 + the detail cells read as cobblestones; real fat lobules are small and soft
    scatter: '#ff7a20',
    detail: { family: 'fat', scale: 90, bump: 0.0015, albedo: 0.12, mask: 0.3, maskColor: '#b02818' }, // T846: smaller, softer lobules
    blood: 0.2, // seen through the translucent pericardium, more reads as purple bruising
  },
  // Teaching palette = STS colours (ADR-014): pulmonary artery blue, pulmonary vein red, systemic veins navy; no baked
  // maps on hilar structures (their dark streaky bakes read as grey chrome), low env. REALISTIC below (ADR-013).
  vein: {
    ...wet,
    color: '#b8282c', // T831 STS red (ADR-012 plum #5a2c56 superseded)
    bakedMaps: false,
    roughness: 0.45,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1, // T823: glossy tube highlights
    microNormal: 0.3,
    env: 0.15, // the RoomEnvironment's hard-edged boxes mirrored as grey bands
    // T831: thin wall, the dark blood glows through toward the terminator (arteries: thick, opaque)
    wrap: 0.3,
    scatter: '#5a0a24',
    scatterStrength: 0.8,
    normalFix: true,
    rim: '#ffb0a0',
    rimStrength: 0.1,
    detail: veinDetail,
    blood: 0.45, // T824: hilar vessels carry smears in the refs (03:52); T831 0.25 was invisible
  },
  svc: {
    ...wet,
    color: '#3a4688', // T831: systemic veins STS blue, darker than the PA so the two stay apart
    bakedMaps: false,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12, // T823
    env: 0.15, // the RoomEnvironment's hard-edged boxes mirrored as grey bands
    wrap: 0.3,
    scatter: '#3a0a2a',
    scatterStrength: 0.6,
    normalFix: true,
    rim: '#c0c8ff',
    rimStrength: 0.08,
    detail: veinDetail,
  },
  artery: {
    ...wet,
    color: '#3a5ac8', // T831 STS blue
    bakedMaps: false,
    roughness: 0.5,
    clearcoat: 0.8,
    clearcoatRoughness: 0.14, // T823 0.12; T831 thicker wall, a touch more satin than the vein
    microNormal: 0.3,
    env: 0.15, // the RoomEnvironment's hard-edged boxes mirrored as grey bands
    normalFix: true,
    rim: '#c0d0ff',
    rimStrength: 0.12,
    detail: arteryDetail,
    blood: 0.45, // T824: hilar vessels carry smears in the refs (03:52); T831 0.25 was invisible
  },
  aorta: { ...wet, color: '#d8a090', roughness: 0.5, detail: arteryDetail },
  bronchus,
  nerve: {
    ...wet,
    color: '#ecc848', // T831 STS yellow
    bakedMaps: false,
    roughness: 0.4,
    clearcoat: 1,
    clearcoatRoughness: 0.06, // glossy epineurium
    env: 0.5,
    rimStrength: 0.15,
    normalFix: true,
    detail: { ...pleuraDetail, scale: 60, mask: 0.3 }, // fibres + a small accompanying vessel
  },
  lymphNode: {
    ...wet,
    color: '#6a5c78', // T831 STS grey-purple
    bakedMaps: false,
    roughness: 0.6,
    clearcoat: 0.7,
    clearcoatRoughness: 0.15,
    env: 0.4,
    blood: 0.3,
    normalFix: true,
    // T831: lobulation + anthracotic dots via the UV-free lung family at node scale (≈ 3 mm lobules)
    detail: { family: 'lung', scale: 40, bump: 0.003, albedo: 0.25, mask: 0.75, maskColor: '#141014' },
  },
  // T831 manifest soft tissue (cautery-dissectable, manifest `dissectable`): glTF BLEND sheets → pre-built
  // transparent variants at load; `veil` makes them read as a membrane (milky at grazing angles).
  pleuraHilum: {
    ...wet,
    color: '#d8c4c4', // faintly milky pink-grey: the hilar vessels show through (#f2e2de read as white paper)
    bakedMaps: false,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.05, // glistening
    microNormal: 0.4,
    env: 0.35,
    opacity: 0.18,
    veil: 0.35,
    rimStrength: 0.18,
    // fibrous grain + fine capillaries
    detail: { family: 'pleura', scale: 45, bump: 0.002, albedo: 0.2, mask: 0.4, maskColor: '#b01c26' },
    blood: 0.5,
  },
  connective: {
    ...wet,
    ...subsurface,
    color: '#f0d4c8', // T831: pale areolar strands (T823 #e8b0a0)
    retint: 0.6,
    mapLuma: 0.5,
    roughness: 0.4,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    opacity: 0.7, // slightly translucent strands (T807/T823 sheet: 0.55)
    veil: 0.4,
    detail: { ...pleuraDetail, scale: 90, mask: 0.3 }, // fine fibres
    blood: 0.75, // T824: blood-tinged in the refs (03:52, 04:29)
  },
  pericardium: {
    ...wet,
    color: '#8a7cc0', // T810: lavender after the warm grade (01:01); #9a7090 read tan and collided with the SPV
    bakedMaps: false, // T807: its baked streaks read as grey chrome close up
    clearcoat: 1,
    clearcoatRoughness: 0.06, // T831: glossy fibrous sac
    env: 0.4,
    rim: '#c8c0ff',
    rimStrength: 0.12,
    detail: { ...pleuraDetail, scale: 30, mask: 0.25 },
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
    detail: pleuraDetail, // fibrous grain + fine intercostal capillaries (§8)
    blood: 0.15,
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

/** T826 colour palettes (ADR-013). TISSUES holds the Teaching values; REALISTIC overrides only what differs. Every
 *  palette field is a uniform / material.color (setPalette never compiles). */
export const PALETTES = ['realistic', 'teaching'] as const;
export type Palette = (typeof PALETTES)[number];
export type PaletteParams = Pick<TissueParams, 'color' | 'retint' | 'rim' | 'scatterStrength'> & {
  blood: number;
};
// Footage-true targets (docs/REFERENCE_FRAMES.md sampled colours, darkened like TISSUES: the refs are lit + graded).
export const REALISTIC: Partial<Record<TissueClass, Partial<PaletteParams>>> = {
  collapsedLung: { color: '#a06e7c' }, // dusky pink-grey (04:29 #BC7B84; T831 #aa7682 read bright pink close up)
  fat: { color: '#f0c880' }, // rich yellow (01:17 #F8C899)
  // T846b: blood film + red back-scatter cut on the realistic vessels (they read crimson / saturated close up).
  vein: { color: '#200a18', rim: '#e0a0b8', blood: 0.15, scatterStrength: 0.3 }, // dark plum-maroon (01:01 #64324A)
  svc: { color: '#6e4a62', rim: '#e0c0d8' }, // preserved upper vein (05:21 #74455A)
  artery: { color: '#c4a0a6', rim: '#f0d8e0', blood: 0.12 }, // pale grey-pink, faint blue cast (03:52 salmon under its blood film)
  bronchus: { color: '#e0c6b6' }, // pale ivory-pink cartilage (03:18 #FFE8BF; T831 #eed4c4 clipped to white close up)
  nerve: { color: '#f2ece0' }, // white-cream (01:01 #FFF1E0)
  lymphNode: { color: '#5e5048' }, // grey-brown, anthracotic speckle
  pericardium: { color: '#a07888', rim: '#f0d0e0' }, // glossy pale pink-lavender (01:01 #965C74)
  pleuraWall: { color: '#9a7282', rim: '#f0d0e0' }, // violet-pink chest wall (04:29 #87536D)
};
export function paletteParams(cls: TissueClass, p: Palette): PaletteParams {
  const t: TissueParams = TISSUES[cls];
  const r = p === 'realistic' ? REALISTIC[cls] : undefined;
  return {
    color: r?.color ?? t.color,
    retint: r?.retint ?? t.retint,
    rim: r?.rim ?? t.rim,
    scatterStrength: r?.scatterStrength ?? t.scatterStrength,
    blood: r?.blood ?? t.blood ?? 0,
  };
}

/** Manifest names with `flag`, e.g. every dissectable structure. */
const manifestWith = (pick: (s: ManifestStructure) => unknown): string[] =>
  Object.keys(STRUCTURES).filter((n) => pick(STRUCTURES[n] as ManifestStructure));
const exactly = (names: readonly string[]): RegExp => new RegExp(`^(${names.join('|')})$`);
const isClass = (c: string): c is TissueClass => c in TISSUES;

/** glTF node name → tissue class; first match wins: the manifest's `tissue` per structure, then name patterns for the
 *  non-manifest (base scene) meshes (CONTEXT §7.2 names). */
export const TISSUE_RULES: readonly [RegExp, TissueClass][] = [
  ...Object.entries(STRUCTURES).flatMap(([n, s]): [RegExp, TissueClass][] =>
    isClass(s.tissue) ? [[exactly([n]), s.tissue]] : [],
  ),
  [/^lung_/, 'ventilatedLung'],
  [/fat/, 'fat'],
  [/^(inferior_vena_cava|brachiocephalic_vein)/, 'svc'], // systemic veins
  [/^(aorta|brachiocephalic_trunk)$/, 'aorta'],
  [/^arteries_/, 'artery'],
  [/_nerve_/, 'nerve'],
  [/^heart_/, 'heart'],
  [/^parietal_pleura_wall$/, 'pleuraWall'],
  [/^(intercostal_muscles|chest_wall_muscle|diaphragm)$/, 'muscle'],
  [/^esophagus$/, 'esophagus'],
  [/^(rib_|spine|sternum|scapula|clavicula|costal_cartilages)/, 'bone'],
  [/^skin$/, 'skin'],
  [/^port_/, 'trocar'],
];
export const FALLBACK_TISSUE: TissueClass = 'connective';

/** T822: soft overlying layers the energised cautery opens (shader openings + coagulated rim): manifest `dissectable`
 *  + the base scene's chest-wall pleura. Anything else (lung, vessels, nerves …) only takes a subtle sear / char mark. */
export const DISSECTABLE = exactly([...manifestWith((s) => s.dissectable), 'parietal_pleura_wall']);

/** T831: manifest structures that start invisible (`hidden`, e.g. fat the procedure never needs). */
export const HIDDEN_AT_LOAD: readonly string[] = manifestWith((s) => s.hidden);

/** T842 heartbeat transmitted to every hilar vessel: weights for structures whose manifest entry has no `pulse` yet
 *  (veins subtle; the PA tree, RML arteries and pericardium carry theirs). The manifest wins once it lists them.
 *  Stumps share their parent's material, so they ride the parent's pulse. */
const PULSE_FALLBACK: Readonly<Record<string, number>> = {
  pulmonary_vein_tree: 0.25,
  middle_lobe_vein: 0.15,
  middle_lobe_vein_V4: 0.1,
  middle_lobe_vein_V5: 0.1,
};
/** T831 heartbeat pulse weight per manifest structure (0..1, × look.pulse.amplitudeM). */
export const PULSE: Readonly<Record<string, number>> = {
  ...PULSE_FALLBACK,
  ...Object.fromEntries(manifestWith((s) => s.pulse).map((n) => [n, STRUCTURES[n]?.pulse ?? 0])),
};

// Curated additions to the manifest-derived step focus (steps the manifest step fields do not cover).
const STEP_FOCUS_EXTRA: Readonly<Record<number, readonly string[]>> = {
  1: ['lung_middle_lobe_right'], // inspect: the lobe to remove
  2: ['middle_lobe_vein', 'phrenic_nerve_right'], // the pleura opens over the vein; the nerve is protected
  7: ['lung_middle_lobe_right'], // T844: the fissures around the lobe
  9: ['bronchial_tree'], // the stump under saline
};
const STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
/**
 * T807: structures each procedure step is about. Drives the step-focus highlight, the focus-only labels and the scope
 * aim. T831: manifest structures whose divideStep / dissectStep / clearStep / removedAfterStep is the step, + extras.
 */
export const STEP_FOCUS: Readonly<Record<number, readonly string[]>> = Object.fromEntries(
  STEPS.map((step) => [
    step,
    [
      ...manifestWith((s) => [s.divideStep, s.dissectStep, s.clearStep, s.removedAfterStep].includes(step)),
      ...(STEP_FOCUS_EXTRA[step] ?? []),
    ],
  ]),
);

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
  // T831: only on meshes without morph normals.
  normalFix: [0.2, 0.5] as const,
  // T807: polygon offset (factor, units) per node: pushes it behind coincident neighbours (z-fighting streaks close
  // up). GL state only, no program change. T807b: the RML entry went (its slope factor stair-stepped the lobe edges).
  depthBias: {
    pulmonary_artery_tree: [2, 1000], // the trees lose to coincident middle-lobe branch meshes at the joins
    pulmonary_vein_tree: [2, 1000],
    bronchial_tree: [2, 1000],
    // T843 (v8: 0.2–0.5 mm fissure gaps): units-only steps (no slope factor, see T807b) give touching lobes a fixed
    // depth order instead of z-fighting: RUL in front, then RML, then RLL.
    lung_middle_lobe_right: [0, 4],
    lung_lower_lobe_right: [0, 8],
  } as Readonly<Record<string, readonly [number, number]>>,
  // T826: Layers → Colours. `?palette=teaching|realistic` overrides the stored choice (tests).
  palette: {
    default: 'realistic' as Palette,
    storageKey: 'thorascope.palette',
    param: 'palette',
    labels: { realistic: 'Realistic', teaching: 'Teaching' } as Readonly<Record<Palette, string>>,
    hint: 'Teaching colours (STS): arteries blue, veins red, bronchus ivory, nerves yellow, nodes grey-purple',
  },
  // T831 heartbeat pulse (docs/MODEL_INTEGRATION.md decision 1): radial vertex push along the normal =
  // manifest `pulse` weight × amplitudeM × state.heartbeat (0 diastole … 1 systole). ponytail: uniform per mesh, no
  // distal fade along the tree; add a fade if thin intrapulmonary branches poke through the lobes.
  pulse: { amplitudeM: 0.0006 },
  /** X-ray: every mesh swaps to its transparent variant at this opacity … */
  xrayOpacity: 0.3,
  /** … except these classes (T847a: from outside, the chest wall + lung nearly vanish and the hilum stays opaque —
   *  ≥ 1 keeps the opaque variant — so it reads through the ribs; 0 new programs, only variant swaps). */
  xrayByClass: {
    skin: 0.05,
    muscle: 0.05,
    pleuraWall: 0.05,
    fat: 0.05,
    bone: 0.07,
    collapsedLung: 0.12,
    ventilatedLung: 0.12,
    pleuraHilum: 0.15,
    connective: 0.15,
    artery: 1,
    vein: 1,
    svc: 1,
    aorta: 1,
    bronchus: 1,
    lymphNode: 1,
    nerve: 1,
  } as Partial<Record<TissueClass, number>>,
  headlight: {
    color: '#fff4ea', // warm halogen/xenon
    intensity: 0.05, // candela; inverse-square (decay 2) in metres: ≈ bright at 3–5 cm, dark beyond ~15 cm
    distance: 0, // no cutoff; inverse-square does the falloff
    decay: 2,
    angle: 0.95, // rad half-angle; covers the widest glTF scope FOV diagonal
    penumbra: 0.6,
  },
  // outsideIntensity: hemisphere intensity in the outside view (no headlight reaches the body there).
  ambient: { sky: '#ffe0e0', ground: '#401018', intensity: 0.07, outsideIntensity: 0.3 }, // T823 0.04 → 0.07
  // T824 blood staining: tissueTextures 'blood' layer (B = smear, A = clot core) × TissueParams.blood.
  blood: { scale: 45, color: '#8a1014', clot: '#3a0608', roughness: 0.2 }, // smears are opaque on veils too; T831 20 → 45 (≈ 7 mm smears; 20 missed whole close-up views)
  env: { intensity: 0.4, sigma: 0.04 }, // PMREM RoomEnvironment: reflections only (T111: wet glints via micro-normal)
} as const;
