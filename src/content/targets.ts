// Actionable targets for Practice (CONTEXT §6.4, VIDEO_STEP_MAP (d)). Pure data, glTF coordinates (CONTEXT §7.1).
// `point` / `axis` are APPROXIMATE (pending clinician review): rest-pose centroid and principal axis of each node's
// vertices in public/models/thorax_sim.opt.glb, rounded. Morphs (collapse, mediastinal shift ≈ 1 cm, retraction)
// move structures, so callers should pass the live point when they have one.

export type ToolId =
  'hands' | 'grasper' | 'sponge' | 'peanut' | 'cautery' | 'clamp' | 'stapler' | 'clip' | 'sucker';

/** Sub-option ids, same order as SLOTS[].subOptions in src/sim/hotbar.ts. */
export const SUB_IDS: Readonly<Partial<Record<ToolId, readonly string[]>>> = {
  grasper: ['retractor', 'ring'],
  stapler: ['vascular-curved', 'vascular-leader', 'bronchial', 'parenchyma'],
  sucker: ['suction', 'irrigation'],
};

/** CONTEXT §6.4 Complications. The upper-lobe venous drainage zone lives in tree_pulm_vein_base and the bronchus
 *  intermedius zone in tree_airway_base (no separate nodes). */
export const DANGER_STRUCTURES = [
  'tree_pulm_artery_base',
  'tree_pulm_vein_base',
  'tree_airway_base',
  'phrenic_nerve_right',
  'vagus_nerve_right',
  'azygos_vein',
  'superior_vena_cava',
] as const;

type Vec3 = readonly [number, number, number];

export interface TargetDef {
  /** glTF node name. */
  readonly id: string;
  /** Acceptable tools → allowed sub-option ids; [] = any (or the tool has none). For the stapler = cartridges. */
  readonly tools: Readonly<Partial<Record<ToolId, readonly string[]>>>;
  /** Approximate rest-pose centroid. */
  readonly point: Vec3;
  /** Stapler only: the shaft should be ~perpendicular to this axis (vessel/airway long axis, fissure-plane normal). */
  readonly axis?: Vec3;
  /** Per-target override of PORT_CONFIG.maxApproachDeg (src/sim/portOccupancy.ts). */
  readonly maxApproachDeg?: number;
  /** Nearby danger structures (subset of DANGER_STRUCTURES or the target itself). */
  readonly danger: readonly string[];
}

const VASCULAR = ['vascular-curved', 'vascular-leader'];
const VEIN_DANGER = ['tree_pulm_vein_base', 'superior_vena_cava', 'phrenic_nerve_right'];
const ARTERY_DANGER = ['tree_pulm_artery_base', 'tree_airway_base'];
const NODE_TOOLS = { grasper: ['ring'], peanut: [] };
const RETRACT_TOOLS = { grasper: ['retractor'], sponge: [] };

export const TARGETS: readonly TargetDef[] = [
  {
    id: 'V_RML_common',
    tools: { clamp: [], stapler: VASCULAR },
    point: [-0.0388, 0.0319, 0.026],
    axis: [0.5, -0.56, -0.66],
    danger: VEIN_DANGER,
  },
  {
    id: 'V4_lateral',
    tools: { clamp: [], stapler: VASCULAR, clip: [] },
    point: [-0.0479, 0.0736, 0.044],
    axis: [0.1, -0.99, -0.14],
    danger: VEIN_DANGER,
  },
  {
    id: 'V5_medial',
    tools: { clamp: [], stapler: VASCULAR, clip: [] },
    point: [-0.0804, 0.0559, 0.0667],
    axis: [0.39, 0.9, -0.18],
    danger: VEIN_DANGER,
  },
  {
    id: 'B_RML_common',
    tools: { clamp: [], stapler: ['bronchial'] },
    point: [-0.0289, 0.0269, 0.0039],
    axis: [0.45, -0.52, -0.72],
    // Video 3:09: "any working incision can pass the stapler"; the asset's access incision sits almost on the
    // bronchus axis (≈83°), so the angle check is waived here. Pending clinician review.
    maxApproachDeg: 90,
    danger: ['tree_airway_base', 'tree_pulm_artery_base'],
  },
  {
    // Long serpentine tunnel: curved tip or silicone leader (both vascular cartridges).
    id: 'A_RML_common',
    tools: { clamp: [], stapler: VASCULAR },
    point: [-0.0232, 0.034, 0.0163],
    axis: [0.5, -0.62, -0.61],
    danger: ARTERY_DANGER,
  },
  {
    id: 'A4_lateral',
    tools: { clamp: [], stapler: VASCULAR, clip: [] },
    point: [-0.0695, 0.064, 0.0503],
    axis: [0.69, -0.39, -0.6],
    danger: ARTERY_DANGER,
  },
  {
    id: 'A5_medial',
    tools: { clamp: [], stapler: VASCULAR, clip: [] },
    point: [-0.0597, 0.0454, 0.067],
    axis: [0.83, 0.37, -0.43],
    danger: ARTERY_DANGER,
  },
  {
    id: 'LN_11R',
    tools: NODE_TOOLS,
    point: [-0.0321, 0.0196, -0.0096],
    danger: ['tree_airway_base', 'tree_pulm_artery_base'],
  },
  {
    id: 'LN_12R',
    tools: NODE_TOOLS,
    point: [-0.0379, 0.0268, 0.0089],
    danger: ['tree_airway_base', 'tree_pulm_artery_base'],
  },
  {
    id: 'LN_4R',
    tools: NODE_TOOLS,
    point: [0.0221, 0.0159, 0.0041],
    danger: ['azygos_vein', 'superior_vena_cava', 'vagus_nerve_right'],
  },
  {
    id: 'LN_7',
    tools: NODE_TOOLS,
    point: [-0.0161, 0.0014, -0.0079],
    danger: ['vagus_nerve_right', 'tree_airway_base'],
  },
  {
    // Interlobar / hilar pleura over the vein, bronchus and arteries.
    id: 'hilar_connective_tissue',
    tools: { peanut: [], cautery: [] },
    point: [-0.0277, 0.0311, 0.0098],
    danger: ['tree_pulm_vein_base', 'tree_pulm_artery_base', 'phrenic_nerve_right'],
  },
  {
    id: 'mediastinal_fat',
    tools: { peanut: [], cautery: [] },
    point: [-0.0299, -0.009, 0.0262],
    danger: ['phrenic_nerve_right', 'superior_vena_cava', 'azygos_vein', 'vagus_nerve_right'],
  },
  {
    // Swept anteriorly with the peanut only (cautery here = complication, VIDEO_STEP_MAP (c) #14).
    id: 'phrenic_nerve_right',
    tools: { peanut: [] },
    point: [-0.0299, -0.009, 0.0262],
    danger: ['phrenic_nerve_right'],
  },
  {
    id: 'lung_upper_lobe_right',
    tools: RETRACT_TOOLS,
    point: [0.0178, 0.0471, 0.0157],
    danger: [],
  },
  {
    // Fissure completion: axis = horizontal-fissure normal (RML → RUL centroid direction).
    id: 'lung_middle_lobe_right',
    tools: { ...RETRACT_TOOLS, cautery: [], stapler: ['parenchyma'] },
    point: [-0.0583, 0.0562, 0.0531],
    axis: [0.9, -0.11, -0.44],
    danger: ['tree_airway_base'],
  },
  {
    // Water test over the bronchial stump.
    id: 'tree_airway_base',
    tools: { sucker: [] },
    point: [-0.0289, 0.0269, 0.0039],
    danger: [],
  },
];

export const TARGET_BY_ID: ReadonlyMap<string, TargetDef> = new Map(TARGETS.map((t) => [t.id, t]));
