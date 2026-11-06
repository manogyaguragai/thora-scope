// Actionable targets for Practice (CONTEXT §6.4, VIDEO_STEP_MAP (d)) + the anatomy manifest's structure roles.
// Roles (danger, divided segments, dissectable layers, nodes to clear, lobes) come from src/content/anatomy.json so a
// v8 model with the same names is a drop-in (docs/MODEL_INTEGRATION.md). `point` / `axis` are APPROXIMATE (pending
// clinician review): centroid + principal axis of each node's vertices in public/models/thorax_sim.opt.glb (v8, recomputed T844), at
// the pose its action happens in (collapse_* = 1 + that step's retract key), rounded. Callers pass the live point.
import { ANATOMY, structuresWhere as where } from './anatomy';

export type ToolId =
  'hands' | 'grasper' | 'sponge' | 'peanut' | 'cautery' | 'clamp' | 'stapler' | 'clip' | 'sucker';

/** Sub-option ids, same order as SLOTS[].subOptions in src/sim/hotbar.ts. */
export const SUB_IDS: Readonly<Partial<Record<ToolId, readonly string[]>>> = {
  grasper: ['retractor', 'ring'],
  stapler: ['vascular-curved', 'vascular-leader', 'bronchial', 'parenchyma'],
  sucker: ['suction', 'irrigation'],
};

export type DangerLevel = 'major' | 'minor';
const S = ANATOMY.structures;

/** CONTEXT §6.4 Complications: manifest `danger` (major / minor). */
export const DANGER_STRUCTURES: readonly string[] = where((e) => e.danger !== undefined);
export const dangerLevel = (name: string): DangerLevel | null => S[name]?.danger ?? null;

/** Segments divided together with `name` (same manifest divideStep), [] if it is not divided. */
export function divisionGroup(name: string): readonly string[] {
  const step = S[name]?.divideStep;
  return step === undefined ? [] : where((e) => e.divideStep === step);
}
/** Soft-tissue layers cautery / peanut dissection opens and removes (manifest `dissectable` + `dissectStep`). */
export const DISSECT_LAYERS: readonly string[] = where(
  (e) => e.dissectable === true && e.dissectStep !== undefined,
);
export const lobeOf = (name: string): string | null => S[name]?.lobe ?? null;

type Vec3 = readonly [number, number, number];

export interface TargetDef {
  /** glTF node name. */
  readonly id: string;
  /** Acceptable tools → allowed sub-option ids; [] = any (or the tool has none). For the stapler = cartridges. */
  readonly tools: Readonly<Partial<Record<ToolId, readonly string[]>>>;
  /** Approximate centroid at the action pose. */
  readonly point: Vec3;
  /** Stapler only: the shaft should be ~perpendicular to this axis (vessel/airway long axis, fissure-plane normal). */
  readonly axis?: Vec3;
  /** Per-target override of PORT_CONFIG.maxApproachDeg (src/sim/portOccupancy.ts). */
  readonly maxApproachDeg?: number;
}

const VASCULAR = ['vascular-curved', 'vascular-leader'];
// T844: the peanut makes the passage behind a vessel / the bronchus; the clamp only clamps.
const VESSEL = { peanut: [], clamp: [], stapler: VASCULAR, clip: [] };
const BRONCHUS = { peanut: [], clamp: [], stapler: ['bronchial'] };
const NODE_TOOLS = { grasper: [], peanut: [] }; // T840: lung grasper or ring forceps grasp the node out
const RETRACT_TOOLS = { grasper: ['retractor'], sponge: [], peanut: [] }; // T840: a peanut can push a lobe too
const LAYER_TOOLS = { peanut: [], cautery: [] };

export const TARGETS: readonly TargetDef[] = [
  // Step 2–3 layers (OLV + retract_hilum).
  { id: 'mediastinal_pleura_hilum', tools: LAYER_TOOLS, point: [-0.0187, 0.0216, 0.017] },
  { id: 'hilar_connective_tissue', tools: LAYER_TOOLS, point: [-0.036, 0.0416, 0.0009] },
  // Swept aside with the peanut only (cautery here = complication, VIDEO_STEP_MAP (c) #14).
  { id: 'phrenic_nerve_right', tools: { peanut: [] }, point: [-0.0238, 0.0254, 0.0599] },
  // Step 3 vein (OLV + retract_hilum).
  { id: 'middle_lobe_vein', tools: VESSEL, point: [-0.0375, 0.0274, 0.0137], axis: [-0.44, 0.89, 0.1] },
  { id: 'middle_lobe_vein_V4', tools: VESSEL, point: [-0.0457, 0.0692, 0.0157], axis: [0.18, 0.98, 0.02] },
  { id: 'middle_lobe_vein_V5', tools: VESSEL, point: [-0.0511, 0.0614, 0.0167], axis: [-0.05, 0.97, 0.24] },
  // Step 4 nodes (OLV + retract_hilum) and step 5 bronchus (+ retract_RML_lateral).
  { id: 'LN_11R', tools: NODE_TOOLS, point: [-0.0368, 0.029, -0.0134] },
  { id: 'LN_12R', tools: NODE_TOOLS, point: [-0.0387, 0.0347, 0.0055] },
  { id: 'LN_4R', tools: NODE_TOOLS, point: [0.0216, 0.0231, 0.002] },
  { id: 'LN_7', tools: NODE_TOOLS, point: [-0.017, 0.0037, -0.0087] },
  {
    id: 'middle_lobe_bronchus',
    tools: BRONCHUS,
    point: [-0.0363, 0.0401, 0.0026],
    axis: [-0.43, 0.8, 0.42],
  },
  {
    id: 'middle_lobe_bronchus_B4',
    tools: BRONCHUS,
    point: [-0.0502, 0.0863, 0.0098],
    axis: [-0.16, 0.99, 0.02],
  },
  {
    id: 'middle_lobe_bronchus_B5',
    tools: BRONCHUS,
    point: [-0.0578, 0.0796, 0.0144],
    axis: [-0.43, 0.89, 0.12],
  },
  // Step 6 arteries (OLV + retract_hilum; the long serpentine tunnel takes the curved tip or the leader).
  { id: 'middle_lobe_artery', tools: VESSEL, point: [-0.0387, 0.0611, -0.0115], axis: [-0.42, 0.9, -0.14] },
  {
    id: 'middle_lobe_artery_A4',
    tools: VESSEL,
    point: [-0.0402, 0.0793, -0.0013],
    axis: [-0.07, 0.75, 0.66],
  },
  {
    id: 'middle_lobe_artery_A5',
    tools: VESSEL,
    point: [-0.0465, 0.0711, -0.002],
    axis: [0.24, -0.5, -0.83],
  },
  // Lobes (OLV + retract_hilum); the middle lobe at the fissure pose (+ retract_fissure), axis = horizontal-fissure
  // normal (RML → RUL centroid).
  { id: 'lung_upper_lobe_right', tools: RETRACT_TOOLS, point: [0.0157, 0.0608, -0.0096] },
  { id: 'lung_lower_lobe_right', tools: RETRACT_TOOLS, point: [-0.0823, 0.0753, -0.0384] },
  {
    id: 'lung_middle_lobe_right',
    tools: { ...RETRACT_TOOLS, stapler: ['parenchyma'] },
    point: [-0.0556, 0.0907, 0.0306],
    axis: [0.88, -0.26, -0.4],
  },
  // Water test over the bronchial stump: the middle lobe bronchus origin on the airway tree (step-9 pose).
  { id: 'bronchial_tree', tools: { sucker: [] }, point: [-0.0285, 0.0326, 0.0013] },
];

export const TARGET_BY_ID: ReadonlyMap<string, TargetDef> = new Map(TARGETS.map((t) => [t.id, t]));
