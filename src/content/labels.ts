// Click-to-label content (§6.5). Keyed by glTF NODE name (§7.2). Own wording; pending clinician review.
// `group` matches the procedure_steps.json layer_groups key. `danger` = must not be stapled/burned (§6.4).

export interface StructureLabel {
  name: string;
  description: string;
  group: string;
  danger?: boolean;
}

type Entry = [node: string, name: string, description: string, danger?: boolean];

const TRIMMED = 'Hilar vessels only — branches are trimmed inside the lung.';

const GROUPS: Record<string, Entry[]> = {
  Lobes: [
    [
      'lung_upper_lobe_right',
      'Right upper lobe',
      'Must keep its own airway, artery and venous drainage intact.',
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
  ],
  RML_hilum: [
    [
      'V_RML_common',
      'Middle lobe vein — common trunk',
      'Drains the middle lobe into the superior pulmonary vein. First structure divided.',
    ],
    [
      'V4_lateral',
      'Middle lobe vein — lateral branch (V4)',
      'Drains the lateral segment; joins the common middle lobe vein.',
    ],
    [
      'V5_medial',
      'Middle lobe vein — medial branch (V5)',
      'Drains the medial segment; joins the common middle lobe vein.',
    ],
    [
      'V_RML_accessory_1',
      'Accessory middle lobe vein 1',
      'Small variant vein; check it drains only the middle lobe before dividing.',
    ],
    [
      'V_RML_accessory_2',
      'Accessory middle lobe vein 2',
      'Small variant vein; check it drains only the middle lobe before dividing.',
    ],
    [
      'A_RML_common',
      'Middle lobe artery — common trunk',
      'Arises from the interlobar artery; taken after the bronchus.',
    ],
    [
      'A4_lateral',
      'Middle lobe artery — lateral branch (A4)',
      'Supplies the lateral segment; fragile, avoid traction while passing a clamp.',
    ],
    [
      'A5_medial',
      'Middle lobe artery — medial branch (A5)',
      'Supplies the medial segment; fragile, avoid traction while passing a clamp.',
    ],
    [
      'A_RML_accessory_1',
      'Accessory middle lobe artery 1',
      'Small variant branch; clip or staple it once proven to go to the middle lobe.',
    ],
    [
      'A_RML_accessory_2',
      'Accessory middle lobe artery 2',
      'Small variant branch; clip or staple it once proven to go to the middle lobe.',
    ],
    [
      'A_RML_extra_1',
      'Extra middle lobe artery branch',
      'Additional arterial twig to the middle lobe; look for it before the fissure.',
    ],
    [
      'B_RML_common',
      'Middle lobe bronchus',
      'Lies behind the vein. Clamp and test-inflate before firing the stapler.',
    ],
    ['B4_lateral', 'Middle lobe bronchus — lateral branch (B4)', 'Segmental airway to the lateral segment.'],
    ['B5_medial', 'Middle lobe bronchus — medial branch (B5)', 'Segmental airway to the medial segment.'],
  ],
  Lymph_nodes: [
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
      'Between lobar bronchi; removing it opens the view of the bronchus.',
    ],
    [
      'LN_12R',
      'Lymph node station 12R (lobar)',
      'Beside the middle lobe bronchus; often hides small bronchial arteries.',
    ],
  ],
  Hilar_vessels_airway: [
    [
      'tree_airway_base',
      'Right bronchial tree',
      `Trachea and right bronchi kept after the lobectomy. ${TRIMMED}`,
      true,
    ],
    [
      'tree_pulm_artery_base',
      'Right pulmonary artery tree',
      `Supplies the upper and lower lobes; never staple it. ${TRIMMED}`,
      true,
    ],
    [
      'tree_pulm_vein_base',
      'Right pulmonary vein tree',
      `Upper lobe drainage must be preserved. ${TRIMMED}`,
      true,
    ],
  ],
  Mediastinum: [
    [
      'phrenic_nerve_right',
      'Right phrenic nerve',
      'Runs in front of the hilum to the diaphragm. Sweep it away; no diathermy near it.',
      true,
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
      true,
    ],
    [
      'superior_vena_cava',
      'Superior vena cava',
      'Large thin-walled vein returning blood from the upper body; injury bleeds fast.',
      true,
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
    [
      'esophagus',
      'Oesophagus',
      'Behind the airway; keep diathermy off it during subcarinal node work.',
      true,
    ],
    ['pericardium', 'Pericardium', 'Fibrous sac around the heart, forming the medial wall of the field.'],
    [
      'inferior_pulmonary_ligament',
      'Inferior pulmonary ligament',
      'Pleural fold tethering the lower lobe to the mediastinum.',
    ],
  ],
  Pulmonary_arteries: [
    ['pa_left', 'Left pulmonary artery', 'Carries blood to the left lung; not part of this operation.', true],
    ['arteries_left_intrapulm', 'Left lung arteries', 'Arterial branches inside the left lung.'],
  ],
  Pulmonary_veins_LA: [
    [
      'left_atrium_provisional',
      'Left atrium (approximate)',
      'Receives the pulmonary veins; shape is a rough stand-in.',
      true,
    ],
  ],
  Soft_tissue: [
    ['diaphragm', 'Diaphragm', 'Dome-shaped breathing muscle forming the floor of the chest.'],
    ['mediastinal_fat', 'Mediastinal fat', 'Fatty tissue over the hilum; dissect it to expose the vessels.'],
    [
      'mediastinal_fat_window',
      'Mediastinal fat (dissected)',
      'Mediastinal fat after a window has been opened.',
    ],
    [
      'hilar_connective_tissue',
      'Hilar connective tissue',
      'Loose tissue wrapping the hilar structures; cleared before encircling.',
    ],
    [
      'hilar_connective_tissue_window',
      'Hilar connective tissue (dissected)',
      'Hilar tissue after dissection, leaving the vessels bare.',
    ],
  ],
  ChestWall: [
    ['skin', 'Skin', 'Outermost layer of the chest wall.'],
    ['subcutaneous_fat', 'Subcutaneous fat', 'Fat layer just under the skin.'],
    ['chest_wall_muscle', 'Chest wall muscles', 'Muscle layer split (not cut) when making the ports.'],
    [
      'intercostal_muscles',
      'Intercostal muscles',
      'Between the ribs; enter along the upper rib border to spare the nerve.',
    ],
    ['parietal_pleura_wall', 'Parietal pleura', 'Thin lining on the inside of the chest wall.'],
  ],
  Bones: [
    ['spine', 'Spine', 'Thoracic vertebrae at the back of the chest.'],
    ['sternum', 'Sternum', 'Breastbone at the front of the chest.'],
    ['scapula_left', 'Left scapula', 'Left shoulder blade.'],
    ['scapula_right', 'Right scapula', 'Right shoulder blade; the arm is raised to move it out of the way.'],
    ['clavicula_left', 'Left clavicle', 'Left collarbone.'],
    ['clavicula_right', 'Right clavicle', 'Right collarbone.'],
    [
      'costal_cartilages',
      'Costal cartilages',
      'Cartilage joining the front ends of the ribs to the sternum.',
    ],
  ],
  Ports: [
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
  ],
};

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
GROUPS.Bones?.push(...ribEntries());

export const STRUCTURE_LABELS: Readonly<Record<string, StructureLabel>> = Object.freeze(
  Object.fromEntries(
    Object.entries(GROUPS).flatMap(([group, entries]) =>
      entries.map(([node, name, description, danger]) => [
        node,
        danger ? { name, description, group, danger } : { name, description, group },
      ]),
    ),
  ),
);

const prettify = (s: string): string => {
  const t = s.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Label for a node; mesh-name suffixes like `.001` are stripped; unknown nodes get a prettified name. */
export function labelFor(nodeName: string): StructureLabel {
  const base = nodeName.replace(/\.\d+$/, '');
  return (
    STRUCTURE_LABELS[base] ?? { name: prettify(base), description: 'No description yet.', group: 'Other' }
  );
}
