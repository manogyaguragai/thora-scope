// Guided-mode teaching text (CONTEXT §6.1 item 1). Own wording, paraphrased from docs/BOOK_NOTES.md,
// docs/VIDEO_STEP_MAP.md and CONTEXT §13. Port labels follow ADR-004. Pending clinician review.

export interface GuidedStep {
  step: number;
  title: string;
  /** Short label for the steps rail (one line at the rail width, so all 9 steps fit); the caption shows `title`. */
  rail: string;
  caption: string;
  points: readonly string[];
  video: { from: string; to: string; text: string };
  portLabel: string;
  note?: string;
}

const CAMERA_PORT = 'Camera port (8th space)';
const ACCESS_INCISION = 'Access incision (5th space)';

export const GUIDED_STEPS: readonly GuidedStep[] = [
  {
    step: 1,
    rail: 'Inspect',
    title: 'Inspect the chest',
    caption:
      'The scope goes in through the camera port. With only the left lung ventilated the right lung is down: find the upper, middle and lower lobes, the two fissures and the phrenic nerve before touching anything.',
    points: [
      'The patient lies on the left side, right side up. Only the left lung is ventilated, so the right lung falls away from the chest wall.',
      'Try the ventilation switch: with both lungs ventilated the right lung fills the cavity and hides the hilum, which is why surgery runs on one lung.',
      'Name the landmarks: three right lobes, the horizontal fissure above the middle lobe, the oblique one below it, and the phrenic nerve on the pericardium.',
      'Ports: camera port low in the 8th space, access incision higher and further forward in the 5th, plus one more 1 cm port. Roles can swap.',
      'A 30° angled telescope lets you look around structures by rotating the optic rather than moving the port.',
    ],
    video: {
      from: '0:26',
      to: '0:39',
      text: 'In the reference video: the anterior working port and a roughly 4 cm access incision are made, then the collapsed lung is surveyed.',
    },
    portLabel: CAMERA_PORT,
  },
  {
    step: 2,
    rail: 'Hilum',
    title: 'Expose the hilum',
    caption:
      'A grasper lifts the collapsed lung backwards and outwards, opening a window onto the front of the hilum. Cautery then opens the thin mediastinal pleura over the superior pulmonary vein and the middle lobe vein, well clear of the phrenic nerve.',
    points: [
      'Lifting the lung away from the mediastinum tents the pleura over the hilum, so it can be opened in a shallow, controlled line.',
      'The phrenic nerve runs down the pericardium in front of the hilum. Keep the energised tip away from it; heat spread can paralyse the diaphragm.',
      'Open the pleura along the front of the superior pulmonary vein and over the middle lobe vein, not across the vein itself.',
      'Name the landmarks before going deeper: superior pulmonary vein, superior vena cava above it and the azygos vein arching over the top of the hilum.',
      'The scope now sits in the access incision and looks straight onto the hilum; any port can change job during the case.',
    ],
    video: {
      from: '0:46',
      to: '1:13',
      text: 'In the reference video: the scope changes port, two retractors hold the upper and middle lobes back and the pleura over the SVC is cleared bluntly.',
    },
    portLabel: ACCESS_INCISION,
  },
  {
    step: 3,
    rail: 'Vein',
    title: 'Middle lobe vein (V4/V5)',
    caption:
      'Divide the fine strands that still tie the middle lobe vein down, follow V4 and V5 into the middle lobe, open a passage behind the vein with the peanut, then pass the stapler through it and fire. The upper lobe vein stays.',
    points: [
      'The superior pulmonary vein drains both the upper and the middle lobe. Trace each branch into its own lobe before deciding what to divide.',
      'Divide the loose strands around the middle lobe vein close to the vein wall, so a clean passage opens behind it.',
      'The passage is made bluntly with a peanut or a grasper; the clamp is for clamping, not for tunnelling behind a thin-walled vein.',
      'Take only the middle lobe branches. Narrowing the upper lobe vein risks a clot and congestion of the upper lobe.',
      'The pulmonary artery lies just behind the vein: keep the dissector hugging the vein and pointing away from the artery.',
    ],
    video: {
      from: '1:13',
      to: '2:17',
      text: 'In the reference video: two vein branches are freed, retraction moves to the access incision and a curved-tip stapler divides both branches in one fire.',
    },
    portLabel: ACCESS_INCISION,
  },
  {
    step: 4,
    rail: 'Nodes',
    title: 'Lymph nodes 11R/12R',
    caption:
      'With the vein gone, nodes 11R and 12R sit in the angle at the root of the middle lobe bronchus. Grasp each with the ring forceps and lift it out; the small ooze from the node bed is sealed with the cautery.',
    points: [
      'Interlobar (11R) and lobar (12R) nodes are sent for staging and, once out, the bronchus and its arteries are much easier to see.',
      'Grasp the node itself, not the vessels around it, and tease it free with gentle traction rather than tearing it out.',
      'Small bronchial arteries feed the nodes, so the bed usually oozes a little. A short touch of cautery on the bleeding point seals it.',
      'Keep the energy off the bronchus wall and off the pulmonary artery just above it.',
    ],
    video: {
      from: '2:44',
      to: '3:04',
      text: 'In the reference video: a node beside the bronchus is grasped and removed, improving the view of the airway.',
    },
    portLabel: ACCESS_INCISION,
  },
  {
    step: 5,
    rail: 'Bronchus',
    title: 'Middle lobe bronchus',
    caption:
      'The middle lobe is drawn outwards to put its bronchus on stretch. Clamp it, ask for a breath to prove it is the right airway (upper and lower lobes inflate, the middle lobe stays flat), then staple it.',
    points: [
      'Pulling the middle lobe outwards straightens its bronchus and opens the angle with the bronchus intermedius.',
      'The clamp closes on the bronchus; it does not make passages around vessels.',
      'Before firing: clamp, then give a breath. The upper and lower lobes should inflate while the middle lobe stays flat.',
      'Staple close to the origin, keeping the bronchus intermedius and the lower lobe bronchus out of the jaws.',
    ],
    video: {
      from: '3:04',
      to: '3:41',
      text: 'In the reference video: the lobe is pulled to tension the bronchus, a blunt clamp goes around it and it is stapled.',
    },
    portLabel: ACCESS_INCISION,
  },
  {
    step: 6,
    rail: 'Arteries',
    title: 'Middle lobe arteries (A4/A5)',
    caption:
      'Dividing the bronchus uncovers the one or two middle lobe arteries (A4/A5) coming off the interlobar artery above its stump. Open a passage behind them with the peanut and staple them.',
    points: [
      'Once the bronchus is cut, the middle lobe artery branches are easy to see just above the bronchial stump.',
      'These branches are thin-walled. Avoid traction on them while the passage is open and steer away from the main pulmonary artery.',
      'A soft leader on the stapler tip can follow a long, curving tunnel without stretching the tissue.',
      'Staple them together or one by one, or clip a small branch; check that no lower lobe artery is inside the jaws.',
    ],
    video: {
      from: '3:41',
      to: '5:00',
      text: 'In the reference video: two artery branches appear, a silicone leader guides the stapler through a long tunnel and both branches are divided together.',
    },
    portLabel: ACCESS_INCISION,
  },
  {
    step: 7,
    rail: 'Fissures',
    title: 'Complete the fissures',
    caption:
      'Back at the camera port, a grasper holds the middle lobe and pulls it away. The powered stapler is laid across the horizontal and then the oblique fissure and fired until the lobe is free.',
    points: [
      'Doing the fissure last avoids hunting for arteries through fused lung and leaves a smaller raw surface with fewer air leaks.',
      'A short breath shows where the aerated upper and lower lobes meet the flat middle lobe, marking the line to staple along.',
      'Look at the lobe from above, then turn it and look from below: the divided bronchus must lie outside the staple line.',
      'Use the parenchyma reload; expect two or three fires. Keep the lower lobe arteries and bronchus clear of the jaws.',
    ],
    video: {
      from: '5:14',
      to: '6:11',
      text: 'In the reference video: the scope returns to the camera port, the lobe is checked from above and below, and stapler fires complete the fissure.',
    },
    portLabel: CAMERA_PORT,
    note: 'Not modelled: the video patient had a middle lobe tumour, so an extra strip of upper lobe was taken with the specimen. Neither is in this model.',
  },
  {
    step: 8,
    rail: 'Lobe out',
    title: 'Lobe out in a bag',
    caption:
      'The free middle lobe goes into a retrieval bag inside the chest, and the closed bag is drawn out through the access incision.',
    points: [
      'Bagging the specimen keeps tumour cells off the wound edges and stops the lobe tearing on the way out.',
      'Open the bag fully, then guide the lobe in with a grasper before closing the neck.',
      'Pull steadily, rocking the bag through the incision; widen the incision rather than tear the specimen.',
    ],
    video: {
      from: '6:11',
      to: '6:23',
      text: 'In the reference video: the lobe is placed in a bag and pulled out through the access incision.',
    },
    portLabel: CAMERA_PORT,
  },
  {
    step: 9,
    rail: 'Leak test',
    title: 'Irrigate and leak test',
    caption:
      'Warm saline fills the right chest until the hilum and the stumps are under water. A breath at about 20 cmH₂O tests the stumps: no bubbles, no air leak. Suction then clears the fluid.',
    points: [
      'Bubbles rising from the bronchial stump or a staple line mean an air leak; a leaking stump is re-stapled or sealed before closing.',
      'Small surface leaks usually settle on their own once the lung is expanded.',
      'Suction the saline back out and check the stumps and the node beds once more for bleeding.',
      'Finish the node clearance (paratracheal 4R, subcarinal 7) if planned, then place one chest drain through the lowest port.',
    ],
    video: {
      from: '6:23',
      to: '6:46',
      text: 'In the reference video: nodes are cleared, a chest tube goes in and the stump is checked under saline while ventilating.',
    },
    portLabel: CAMERA_PORT,
  },
];

// Short paraphrase of CONTEXT §7.6 for an "About this model" panel.
export const MODEL_LIMITATIONS: readonly string[] = [
  'The lobes collapse and retract by fixed shape blends, not by tissue physics; the fissure opens along one preset path.',
  'Divided vessels and the bronchus end in a stump cap generated by the app; the model itself has no stump ends.',
  'Wet shine and tissue translucency are added by the renderer, not stored in the model.',
  'Nerve paths and retraction amounts are approximations; vessels look longer than in life when the lung is fully lifted.',
  'Vessel trees stop just inside the lung, so with the lungs hidden you see the hilar vessels only.',
  'See-through pleura can occasionally draw in the wrong order.',
  'The tumour in the reference video, and the extra upper lobe margin taken for it, are not modelled.',
  'Port positions differ from the video; ports are matched by role (camera port, access incision, anterior working port).',
];
