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

const VEIN = ['middle_lobe_vein', 'middle_lobe_vein_V4', 'middle_lobe_vein_V5'];
const BRONCHUS = ['middle_lobe_bronchus', 'middle_lobe_bronchus_B4', 'middle_lobe_bronchus_B5'];
const ARTERY = ['middle_lobe_artery', 'middle_lobe_artery_A4', 'middle_lobe_artery_A5'];

export const IDENTIFY_ITEMS: readonly IdentifyItem[] = [
  {
    node: 'lung_middle_lobe_right',
    prompt: 'Click the lobe that this operation removes.',
    accept: ['lung_middle_lobe_right'],
  },
  {
    node: 'lung_upper_lobe_right',
    prompt: 'Click the lobe gripped to lift the lung off the front of the hilum.',
    accept: ['lung_upper_lobe_right'],
  },
  {
    node: 'lung_lower_lobe_right',
    prompt: 'Click the large right lobe sitting behind and below the one being removed.',
    accept: ['lung_lower_lobe_right'],
  },
  {
    node: 'mediastinal_pleura_hilum',
    prompt: 'Click the thin see-through layer that the hook opens first over the front of the hilum.',
    accept: ['mediastinal_pleura_hilum'],
  },
  {
    node: 'middle_lobe_vein',
    prompt: 'Click the vein draining the middle lobe, the first structure to be stapled.',
    accept: VEIN,
  },
  {
    node: 'middle_lobe_vein_V4',
    prompt: 'Click V4, the venous branch coming from the lateral segment of the middle lobe.',
    accept: ['middle_lobe_vein_V4'],
  },
  {
    node: 'middle_lobe_vein_V5',
    prompt: 'Click V5, the venous branch draining the medial segment.',
    accept: ['middle_lobe_vein_V5'],
  },
  {
    node: 'middle_lobe_bronchus',
    prompt: 'Click the airway that is clamped and test-ventilated before it is stapled.',
    accept: BRONCHUS,
  },
  {
    node: 'middle_lobe_bronchus_B4',
    prompt: 'Click B4, the segmental airway to the lateral segment.',
    accept: ['middle_lobe_bronchus_B4'],
  },
  {
    node: 'middle_lobe_bronchus_B5',
    prompt: 'Click B5, the segmental airway to the medial segment.',
    accept: ['middle_lobe_bronchus_B5'],
  },
  {
    node: 'middle_lobe_artery',
    prompt: 'Click the arterial supply of the middle lobe, reached once the airway is cut.',
    accept: ARTERY,
  },
  {
    node: 'middle_lobe_artery_A4',
    prompt: 'Click A4, the artery branch feeding the lateral segment.',
    accept: ['middle_lobe_artery_A4'],
  },
  {
    node: 'middle_lobe_artery_A5',
    prompt: 'Click A5, the artery branch feeding the medial segment of the middle lobe.',
    accept: ['middle_lobe_artery_A5'],
  },
  {
    node: 'LN_11R',
    prompt: 'Click the interlobar node lying between the lobar airways (station 11R).',
    accept: ['LN_11R'],
  },
  {
    node: 'LN_12R',
    prompt: 'Click the lobar node hugging the middle lobe bronchus at its origin (station 12R).',
    accept: ['LN_12R'],
  },
  {
    node: 'phrenic_nerve_right',
    prompt: 'Click the nerve running down in front of the hilum that is moved aside, never burned.',
    accept: ['phrenic_nerve_right'],
  },
  {
    node: 'azygos_vein',
    prompt: 'Click the vein arching over the right main bronchus into the SVC.',
    accept: ['azygos_vein'],
  },
  {
    node: 'superior_vena_cava',
    prompt: 'Click the thin-walled great vein bringing blood back from the head and arms.',
    accept: ['superior_vena_cava'],
  },
  {
    node: 'pulmonary_artery_tree',
    prompt: 'Click the artery tree feeding the lobes that stay; it must never be stapled.',
    accept: ['pulmonary_artery_tree'],
  },
  {
    node: 'pulmonary_vein_tree',
    prompt: 'Click the vein tree whose upper lobe drainage has to be kept open.',
    accept: ['pulmonary_vein_tree'],
  },
  {
    node: 'port_utility_5ICS',
    prompt: 'Click the larger front incision through which the bagged lobe is taken out.',
    accept: ['port_utility_5ICS'],
  },
];

export const NEXT_STEP_ITEMS: readonly NextStepItem[] = [
  {
    situation:
      'Lung down on one-lung ventilation; the front of the hilum is hidden under the collapsed lobes.',
    options: [
      'Fire the stapler across the fissure',
      'Grip the upper lobe and lift the lung away from the mediastinum',
      'Put the lobe into the bag',
      'Run the water leak test',
    ],
    correctIndex: 1,
    rationale:
      'Retracting the lung outwards and backwards opens the anterior window where the middle lobe vein lies.',
    practiceActionId: 'PA02',
  },
  {
    situation: 'The phrenic nerve runs down across the front of the hilum close to where you need to work.',
    options: [
      'Coagulate the tissue around it with diathermy',
      'Divide it to widen the window',
      'Push it gently out of the way with a peanut',
    ],
    correctIndex: 2,
    rationale:
      'Pushing the nerve forward with a blunt peanut keeps it safe; diathermy close to it risks diaphragm paralysis.',
    practiceActionId: 'PA03',
  },
  {
    situation: 'A thin shiny layer still covers the superior pulmonary vein and the middle lobe vein.',
    options: [
      'Open that layer with the hook, staying on it',
      'Staple through it together with the vein',
      'Leave it and pass the clamp blindly',
    ],
    correctIndex: 0,
    rationale:
      'The vessels can only be dissected safely once the pleura over them is opened and they can be seen.',
    practiceActionId: 'PA04',
  },
  {
    situation: 'Both middle lobe vein branches are visible and the strands around them have been divided.',
    options: [
      'Open a passage behind the vein bluntly with the peanut',
      'Force the closed clamp behind the vein to make a tunnel',
      'Staple the vein without testing the space behind it',
      'Start on the fissure',
    ],
    correctIndex: 0,
    rationale:
      'A gentle blunt passage proves the stapler anvil will follow; a clamp is for clamping, not for tunnelling.',
    practiceActionId: 'PA07',
  },
  {
    situation: 'Vein divided; two nodes crowd the origin of the middle lobe bronchus.',
    options: [
      'Lift the nodes out with the ring forceps to clear the bronchus',
      'Staple straight through the nodes with the bronchus',
      'Ignore them and move on to the arteries',
    ],
    correctIndex: 0,
    rationale:
      'Taking stations 11R and 12R improves the view of the airway and is part of the cancer staging.',
    practiceActionId: 'PA10',
  },
  {
    situation: 'Both nodes are out and their bed is oozing a little blood.',
    options: [
      'Touch the oozing point briefly with the cautery',
      'Staple across the node bed',
      'Carry on and leave the ooze',
    ],
    correctIndex: 0,
    rationale:
      'Small bronchial arteries feed the nodes; a short touch of energy seals them and keeps the field clean.',
    practiceActionId: 'PA11',
  },
  {
    situation: 'The bronchus is clear but slack, folded behind the stump of the vein.',
    options: [
      'Grip the middle lobe and pull it outwards to tension the bronchus',
      'Release the lung retraction completely',
      'Re-inflate both lungs to straighten it',
    ],
    correctIndex: 0,
    rationale:
      'Traction on the lobe being removed straightens its airway so a clamp and stapler pass easily.',
    practiceActionId: 'PA12',
  },
  {
    situation: 'The middle lobe bronchus is clamped and the stapler is closed on it, not yet fired.',
    options: [
      'Fire straight away',
      'Ask the anaesthetist to ventilate and check the remaining lobes inflate and deflate',
      'Release the stapler and divide the artery first',
      'Bag the lobe',
    ],
    correctIndex: 1,
    rationale:
      'A test breath proves the right airway is in the jaws; stapling the wrong bronchus is a classic disaster.',
    practiceActionId: 'PA15',
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
    practiceActionId: 'PA16',
  },
  {
    situation:
      'The bronchus is cut and A4 and A5 are exposed, but the tunnel behind the artery is long and twisting.',
    options: [
      'Push the anvil through and dilate the tunnel by force',
      'Attach a soft leader to the stapler tip to guide the anvil',
      'Leave the arteries and pull the lobe out',
      'Coagulate the arteries with the cautery hook',
    ],
    correctIndex: 1,
    rationale:
      'A leader follows the winding path without widening it, so fragile artery branches are not torn.',
    practiceActionId: 'PA18',
  },
  {
    situation: 'Vein, bronchus and arteries are divided; the lobe now hangs on the incomplete fissure alone.',
    options: [
      'Separate the fissure by pulling and burning',
      'Draw the neighbouring lobe away and staple along the fissure',
      'Bag the lobe while it is still attached',
    ],
    correctIndex: 1,
    rationale:
      'Leaving the fissure until last means less dissection and less air leak; stapling seals the lung edge.',
    practiceActionId: 'PA20',
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
    practiceActionId: 'PA23',
  },
  {
    situation: 'The specimen is out and the field is dry. One check remains before closing.',
    options: [
      'Fill the cavity with saline and watch the stump while the lung is ventilated',
      'Remove the chest tube again',
      'Re-staple the bronchus just in case',
    ],
    correctIndex: 0,
    rationale:
      'Bubbles under the fluid during a gentle breath reveal a leak from the stump or the stapled lung edge.',
    practiceActionId: 'PA24',
  },
];

const MESH_SUFFIX = /\.\d+$/;

/** True when a clicked node (or one of its merged meshes, e.g. `middle_lobe_vein_V4.001`) answers the item. */
export const isAccepted = (item: IdentifyItem, clickedNode: string): boolean =>
  item.accept.includes(clickedNode.replace(MESH_SUFFIX, ''));
