// Click-to-label content (§6.5). Keyed by glTF NODE name (§7.2 + the v7/v8 manifest names, src/content/anatomy.json).
// Own wording, paraphrased. Layer groups live in src/ui/layersPanel.ts (manifest `group`).
import { dangerLevel } from './targets';

export interface StructureLabel {
  name: string;
  description: string;
  /** Must not be stapled / burned (§6.4): manifest `danger` for model structures, else flagged here. */
  danger?: boolean;
}

type Entry = [node: string, name: string, description: string, danger?: boolean];

const ENTRIES: Entry[] = [
  // Lungs
  [
    'lung_upper_lobe_right',
    'Right upper lobe',
    'Stays in: keep its airway, artery and venous drainage intact.',
  ],
  [
    'lung_middle_lobe_right',
    'Right middle lobe',
    'The lobe being removed. Smallest right lobe, lying in front.',
  ],
  ['lung_lower_lobe_right', 'Right lower lobe', 'Large posterior-basal lobe; stays in and re-inflates.'],
  [
    'lung_upper_lobe_left',
    'Left upper lobe',
    'Ventilated during the case (one-lung ventilation on the left).',
  ],
  ['lung_lower_lobe_left', 'Left lower lobe', 'Ventilated during the case; moves with each breath.'],
  ['arteries_left_intrapulm', 'Left lung arteries', 'Arterial branches inside the left lung.'],
  // Middle lobe hilum (divided segments)
  [
    'middle_lobe_vein',
    'Middle lobe vein',
    'Drains the middle lobe into the superior pulmonary vein. First structure stapled.',
  ],
  [
    'middle_lobe_vein_V4',
    'Middle lobe vein, lateral branch (V4)',
    'Drains the lateral segment into the middle lobe vein.',
  ],
  [
    'middle_lobe_vein_V5',
    'Middle lobe vein, medial branch (V5)',
    'Drains the medial segment into the middle lobe vein.',
  ],
  [
    'middle_lobe_bronchus',
    'Middle lobe bronchus',
    'Lies behind the vein. Clamp it and test-ventilate before firing the stapler.',
  ],
  [
    'middle_lobe_bronchus_B4',
    'Middle lobe bronchus, lateral branch (B4)',
    'Segmental airway to the lateral segment.',
  ],
  [
    'middle_lobe_bronchus_B5',
    'Middle lobe bronchus, medial branch (B5)',
    'Segmental airway to the medial segment.',
  ],
  [
    'middle_lobe_artery',
    'Middle lobe artery',
    'Comes off the interlobar artery in the fissure; taken after the bronchus.',
  ],
  [
    'middle_lobe_artery_A4',
    'Middle lobe artery, lateral branch (A4)',
    'Feeds the lateral segment. Thin-walled: no traction while the passage behind it is made.',
  ],
  [
    'middle_lobe_artery_A5',
    'Middle lobe artery, medial branch (A5)',
    'Feeds the medial segment. Thin-walled: no traction while the passage behind it is made.',
  ],
  // Parent trees (kept)
  [
    'pulmonary_artery_tree',
    'Pulmonary artery tree',
    'Main, right and interlobar arteries supplying the lobes that stay. Never staple it.',
  ],
  [
    'pulmonary_vein_tree',
    'Pulmonary vein tree',
    'Superior and inferior veins; the upper lobe drainage must stay open.',
  ],
  [
    'bronchial_tree',
    'Bronchial tree',
    'Trachea, main and intermediate bronchi; carries the middle lobe stump.',
  ],
  // Lymph nodes
  [
    'LN_4R',
    'Lymph node station 4R (right paratracheal)',
    'Beside the lower trachea, reached by lifting the azygos vein.',
  ],
  ['LN_7', 'Lymph node station 7 (subcarinal)', 'Sits below the carina between the main bronchi.'],
  ['LN_10R', 'Lymph node station 10R (right hilar)', 'Around the right main bronchus at the hilum.'],
  [
    'LN_11R',
    'Lymph node station 11R (interlobar)',
    'Between the lobar bronchi; taking it opens the view of the bronchus.',
  ],
  [
    'LN_12R',
    'Lymph node station 12R (lobar)',
    'Hugs the middle lobe bronchus at its origin; cleared before stapling.',
  ],
  // Soft tissue
  [
    'mediastinal_pleura_hilum',
    'Mediastinal pleura over the hilum',
    'Thin see-through layer over the hilar vessels; opened with the hook first.',
  ],
  [
    'hilar_connective_tissue',
    'Hilar connective tissue',
    'Fine strands binding the middle lobe vessels and airway; divided to free them.',
  ],
  [
    'mediastinal_fat',
    'Mediastinal fat',
    'Fat pads around the hilum and node stations (hidden in this model).',
  ],
  ['diaphragm', 'Diaphragm', 'Dome-shaped breathing muscle forming the floor of the chest.'],
  // Mediastinum
  [
    'phrenic_nerve_right',
    'Right phrenic nerve',
    'Runs down in front of the hilum to the diaphragm. Sweep it aside; no energy near it.',
  ],
  [
    'vagus_nerve_right',
    'Right vagus nerve',
    'Runs behind the hilum beside the trachea and oesophagus.',
    true,
  ],
  [
    'azygos_vein',
    'Azygos vein',
    'Arches over the right main bronchus into the SVC; lift it to reach node 4R.',
  ],
  [
    'superior_vena_cava',
    'Superior vena cava',
    'Large thin-walled vein returning blood from the upper body; injury bleeds fast.',
  ],
  [
    'inferior_vena_cava',
    'Inferior vena cava',
    'Returns blood from the lower body into the right atrium.',
    true,
  ],
  ['aorta', 'Aorta', 'Main artery from the heart, arching over to the left.', true],
  [
    'brachiocephalic_trunk',
    'Brachiocephalic trunk',
    'First branch of the aortic arch, feeding the right arm and head.',
    true,
  ],
  [
    'brachiocephalic_vein_left',
    'Left brachiocephalic vein',
    'Crosses in front of the arch branches to form the SVC.',
    true,
  ],
  ['brachiocephalic_vein_right', 'Right brachiocephalic vein', 'Joins the left one to form the SVC.', true],
  ['heart_rest', 'Heart', 'Beats under the pericardium; its motion is transmitted to the hilum.', true],
  ['esophagus', 'Oesophagus', 'Behind the airway; keep diathermy off it during subcarinal node work.', true],
  [
    'pericardium',
    'Pericardium',
    'Fibrous sac around the heart; the medial wall of the field. Avoid burning it.',
  ],
  // Chest wall
  ['skin', 'Skin', 'Outermost layer of the chest wall.'],
  ['subcutaneous_fat', 'Subcutaneous fat', 'Fat layer just under the skin.'],
  ['chest_wall_muscle', 'Chest wall muscles', 'Muscle layer split (not cut) when making the ports.'],
  [
    'intercostal_muscles',
    'Intercostal muscles',
    'Between the ribs; enter along the upper rib border to spare the nerve.',
  ],
  ['parietal_pleura_wall', 'Parietal pleura', 'Thin lining on the inside of the chest wall.'],
  // Bones (ribs added below)
  ['spine', 'Spine', 'Thoracic vertebrae at the back of the chest.'],
  ['sternum', 'Sternum', 'Breastbone at the front of the chest.'],
  ['scapula_left', 'Left scapula', 'Left shoulder blade.'],
  ['scapula_right', 'Right scapula', 'Right shoulder blade; the arm is raised to move it out of the way.'],
  ['clavicula_left', 'Left clavicle', 'Left collarbone.'],
  ['clavicula_right', 'Right clavicle', 'Right collarbone.'],
  ['costal_cartilages', 'Costal cartilages', 'Cartilage joining the front ends of the ribs to the sternum.'],
  // Ports
  [
    'port_camera_8ICS',
    'Camera port (8th intercostal space)',
    'Thoracoscope entry, just behind the anterior axillary line.',
  ],
  [
    'port_utility_5ICS',
    'Access incision (5th intercostal space)',
    'Main working incision at the front; the lobe comes out here.',
  ],
  [
    'port_retraction_8ICS',
    'Posterior port (8th intercostal space)',
    'Extra port, often used for a retractor or a second instrument.',
  ],
];

const RIB_RE = /^rib_([RL])(\d+)$/;

/**
 * Anatomical rib number for a rib node (§7.2): rib_R5 + rib_R6 are two halves of anatomical rib 5,
 * so rib_R7..R12 are ribs 6–11. Left ribs follow their names. Returns null for non-rib nodes.
 */
export function anatomicalRibNumber(nodeName: string): number | null {
  const m = RIB_RE.exec(nodeName);
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] === 'R' && n >= 6 ? n - 1 : n;
}

// ponytail: left ribs labelled plainly — no split documented in ASSETS.md (rib_L5 bounds look like a
// small posterior fragment; verify against the model before trusting left rib numbers).
function ribEntries(): Entry[] {
  const out: Entry[] = [];
  for (const side of ['R', 'L'] as const) {
    for (let i = 1; i <= 12; i++) {
      const node = `rib_${side}${i}`;
      const n = anatomicalRibNumber(node) ?? i;
      // Measured on the model: rib_R5 lies posterior (−Z), rib_R6 anterior (+Z).
      const part = node === 'rib_R5' ? ' (posterior part)' : node === 'rib_R6' ? ' (anterior part)' : '';
      const sideName = side === 'R' ? 'Right' : 'Left';
      const note = part ? ' The model splits this rib into two pieces.' : '';
      out.push([
        node,
        `${sideName} rib ${n}${part}`,
        `Anatomical ${sideName.toLowerCase()} rib ${n}.${note}`,
      ]);
    }
  }
  return out;
}
ENTRIES.push(...ribEntries());

export const STRUCTURE_LABELS: Readonly<Record<string, StructureLabel>> = Object.freeze(
  Object.fromEntries(
    ENTRIES.map(([node, name, description, flagged]) => {
      const danger = flagged === true || dangerLevel(node) !== null;
      return [node, danger ? { name, description, danger } : { name, description }];
    }),
  ),
);

const prettify = (s: string): string => {
  const t = s.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Label for a node; mesh-name suffixes like `.001` are stripped; unknown nodes get a prettified name. */
export function labelFor(nodeName: string): StructureLabel {
  const base = nodeName.replace(/\.\d+$/, '');
  return STRUCTURE_LABELS[base] ?? { name: prettify(base), description: 'No description yet.' };
}
