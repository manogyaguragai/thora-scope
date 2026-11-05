// Quiz content (CONTEXT §6.6). Own wording, paraphrased from CONTEXT §13, docs/VIDEO_STEP_MAP.md and
// docs/BOOK_NOTES.md; next-step order follows ADR-005. Lazy-load this module. Pending clinician review.

export interface IdentifyItem {
  /** glTF node name (labels.ts) the prompt is about. */
  node: string;
  prompt: string;
  /** Node names counted as correct; merged-mesh suffixes (`.001`) are stripped before matching. */
  accept: readonly string[];
}

export interface NextStepItem {
  situation: string;
  options: readonly string[];
  correctIndex: number;
  rationale: string;
  /** practice_actions.json id of the correct action, when one exists. */
  practiceActionId?: string;
}

export const QUIZ_META = { pendingReview: true } as const;

export const IDENTIFY_ITEMS: readonly IdentifyItem[] = [
  {
    node: 'lung_middle_lobe_right',
    prompt: 'Click the lobe that this operation removes.',
    accept: ['lung_middle_lobe_right'],
  },
  {
    node: 'lung_upper_lobe_right',
    prompt: 'Click the lobe that is pulled up to put the middle lobe bronchus on stretch.',
    accept: ['lung_upper_lobe_right'],
  },
  {
    node: 'lung_lower_lobe_right',
    prompt: 'Click the large right lobe sitting behind and below the one being removed.',
    accept: ['lung_lower_lobe_right'],
  },
  {
    node: 'V_RML_common',
    prompt: 'Click the vein draining the middle lobe — the first structure to be divided.',
    accept: ['V_RML_common', 'V4_lateral', 'V5_medial'],
  },
  {
    node: 'V4_lateral',
    prompt: 'Click the venous branch coming from the lateral segment of the middle lobe.',
    accept: ['V4_lateral'],
  },
  {
    node: 'B_RML_common',
    prompt: 'Click the airway that is clamped and test-ventilated before it is stapled.',
    accept: ['B_RML_common', 'B4_lateral', 'B5_medial'],
  },
  {
    node: 'A_RML_common',
    prompt: 'Click the arterial supply of the middle lobe, which comes into view after the airway is cut.',
    accept: ['A_RML_common', 'A4_lateral', 'A5_medial'],
  },
  {
    node: 'A5_medial',
    prompt: 'Click the artery branch feeding the medial segment of the middle lobe.',
    accept: ['A5_medial'],
  },
  {
    node: 'LN_11R',
    prompt: 'Click the interlobar node lying between the lobar airways.',
    accept: ['LN_11R'],
  },
  {
    node: 'LN_12R',
    prompt: 'Click the lobar node hugging the middle lobe bronchus at its origin.',
    accept: ['LN_12R'],
  },
  {
    node: 'LN_4R',
    prompt: 'Click the paratracheal node station reached by lifting the azygos vein.',
    accept: ['LN_4R'],
  },
  {
    node: 'LN_7',
    prompt: 'Click the node station found under the carina, between the two main bronchi.',
    accept: ['LN_7'],
  },
  {
    node: 'phrenic_nerve_right',
    prompt: 'Click the nerve crossing in front of the hilum that must be swept aside, never burned.',
    accept: ['phrenic_nerve_right'],
  },
  {
    node: 'azygos_vein',
    prompt: 'Click the vein arching over the right main bronchus into the SVC.',
    accept: ['azygos_vein'],
  },
  {
    node: 'superior_vena_cava',
    prompt: 'Click the thin-walled great vein over which the pleura is stretched at the start.',
    accept: ['superior_vena_cava'],
  },
  {
    node: 'tree_pulm_artery_base',
    prompt: 'Click the artery tree feeding the lobes that stay — it must never be stapled.',
    accept: ['tree_pulm_artery_base'],
  },
  {
    node: 'tree_pulm_vein_base',
    prompt: 'Click the vein tree whose upper lobe drainage has to be kept open.',
    accept: ['tree_pulm_vein_base'],
  },
  {
    node: 'port_utility_5ICS',
    prompt: 'Click the larger front incision through which the bagged lobe is taken out.',
    accept: ['port_utility_5ICS'],
  },
  {
    node: 'port_camera_8ICS',
    prompt: 'Click the low port where the thoracoscope first enters the chest.',
    accept: ['port_camera_8ICS'],
  },
];

export const NEXT_STEP_ITEMS: readonly NextStepItem[] = [
  {
    situation:
      'Lung down, scope repositioned, retractors lifting the upper and middle lobes so the pleura over the SVC is taut.',
    options: [
      'Fire the stapler across the fissure',
      'Clear the mediastinal pleura bluntly with a peanut',
      'Put the lobe into the bag',
      'Run the water leak test',
    ],
    correctIndex: 1,
    rationale:
      'Gentle blunt clearing exposes the middle lobe vein branches; nothing can be stapled before it is seen.',
    practiceActionId: 'PA04',
  },
  {
    situation: 'The phrenic nerve lies across the front of the hilum close to where you need to work.',
    options: [
      'Coagulate the tissue around it with diathermy',
      'Divide it to widen the window',
      'Push it gently out of the way with a peanut',
    ],
    correctIndex: 2,
    rationale:
      'Pushing the nerve forward with a blunt peanut keeps it safe; diathermy close to it risks diaphragm paralysis.',
    practiceActionId: 'PA05',
  },
  {
    situation: 'Both middle lobe vein branches are visible and the tissue around them has been cleared.',
    options: [
      'Pass a blunt clamp behind both branches to open a tunnel',
      'Staple the branches without testing the space behind them',
      'Divide the bronchus first',
      'Start on the fissure',
    ],
    correctIndex: 0,
    rationale:
      'A clamp passing freely behind the vessels proves the stapler anvil will follow without tearing anything.',
    practiceActionId: 'PA08',
  },
  {
    situation:
      'The tunnel behind the veins is open, but the stapler has to enter through the former camera port where the retractors sit.',
    options: [
      'Force the stapler in next to the retractors',
      'Hand the retraction to a clamp through the access incision',
      'Give up and convert to an open operation',
    ],
    correctIndex: 1,
    rationale:
      'Moving the retraction to the access incision frees the port with the right angle for the curved stapler.',
    practiceActionId: 'PA09',
  },
  {
    situation: 'Veins divided; lymphatic tissue and a node crowd the lower edge of the middle lobe bronchus.',
    options: [
      'Pull the nodes out with a ring clamp to clear the bronchus',
      'Staple straight through the nodes with the bronchus',
      'Ignore them and move on to the arteries',
    ],
    correctIndex: 0,
    rationale:
      'Taking stations 11R and 12R improves the view of the airway and is part of the cancer staging.',
    practiceActionId: 'PA14',
  },
  {
    situation:
      'A blunt clamp is around the middle lobe bronchus and the stapler is closed on it, not yet fired.',
    options: [
      'Fire straight away',
      'Ask the anaesthetist to ventilate and check the remaining lobes inflate and deflate',
      'Release the stapler and divide the artery first',
      'Bag the lobe',
    ],
    correctIndex: 1,
    rationale:
      'A test breath proves the right airway is in the jaws; stapling the wrong bronchus is a classic disaster.',
    practiceActionId: 'PA18',
  },
  {
    situation:
      'During the test breath the upper and lower lobes fill and empty normally while the middle lobe stays flat.',
    options: [
      'Fire the stapler to divide the bronchus',
      'Reposition the stapler onto the intermediate bronchus',
      'Abandon the stapler and tie the airway',
    ],
    correctIndex: 0,
    rationale:
      'Only the target lobe is excluded, so the airway in the jaws is the correct one and can be divided.',
    practiceActionId: 'PA19',
  },
  {
    situation:
      'The bronchus is cut and both middle lobe artery branches are exposed, but the tunnel behind them is long and twisting.',
    options: [
      'Push the anvil through and dilate the tunnel by force',
      'Attach a soft leader to the stapler tip to guide the anvil',
      'Leave the arteries and pull the lobe out',
      'Coagulate the arteries with the cautery hook',
    ],
    correctIndex: 1,
    rationale:
      'A leader follows the winding path without widening it, so fragile artery branches are not torn.',
    practiceActionId: 'PA22',
  },
  {
    situation: 'Vein, bronchus and arteries are divided; the lobe now hangs on the incomplete fissure alone.',
    options: [
      'Separate the fissure by pulling and burning',
      'Staple along the fissure',
      'Bag the lobe while it is still attached',
    ],
    correctIndex: 1,
    rationale:
      'Leaving the fissure until last means less dissection and less air leak; stapling seals the lung edge.',
    practiceActionId: 'PA25',
  },
  {
    situation: 'The lobe is completely free inside the chest.',
    options: [
      'Pull it out bare through the access incision',
      'Put it in a retrieval bag and remove it through the access incision',
      'Leave it until the chest tube is in',
    ],
    correctIndex: 1,
    rationale:
      'A bag stops tumour cells seeding the wound and lets the lobe slide out through the small incision.',
    practiceActionId: 'PA28',
  },
  {
    situation: 'The specimen is out and the field is dry.',
    options: [
      'Close at once without further nodes',
      'Sample the right paratracheal and subcarinal stations (4R and 7)',
      'Divide the azygos vein routinely',
    ],
    correctIndex: 1,
    rationale: 'Completing the mediastinal node dissection finishes the staging before the chest is closed.',
    practiceActionId: 'PA30',
  },
  {
    situation: 'Nodes taken. One check remains before closing.',
    options: [
      'Fill the cavity with saline and watch the stump while the lung is ventilated',
      'Remove the chest tube again',
      'Re-staple the bronchus just in case',
    ],
    correctIndex: 0,
    rationale:
      'Bubbles under the fluid during a gentle breath reveal a leak from the stump or the stapled lung edge.',
    practiceActionId: 'PA32',
  },
];

const MESH_SUFFIX = /\.\d+$/;

/** True when a clicked node (or one of its merged meshes, e.g. `V4_lateral.001`) answers the item. */
export const isAccepted = (item: IdentifyItem, clickedNode: string): boolean =>
  item.accept.includes(clickedNode.replace(MESH_SUFFIX, ''));
