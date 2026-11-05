// Guided-mode teaching text (CONTEXT §6.1 item 1). Own wording, paraphrased from docs/BOOK_NOTES.md,
// docs/VIDEO_STEP_MAP.md and CONTEXT §13. Port labels follow ADR-004. Pending clinician review.

export interface GuidedStep {
  step: number;
  title: string;
  caption: string;
  points: readonly string[];
  video: { from: string; to: string; text: string };
  portLabel: string;
  note?: string;
  pendingReview: true;
}

const CAMERA_PORT = 'Camera port (8th space)';
const ACCESS_INCISION = 'Access incision (5th space)';
const WORKING_PORT = 'Anterior working port';

export const GUIDED_STEPS: readonly GuidedStep[] = [
  {
    step: 1,
    title: 'Inspect the chest',
    caption:
      'Looking in from the camera port with the right lung collapsed. Survey the cavity and confirm all three right lobes are down before any dissection.',
    points: [
      'The patient lies on the left side, right side up. Only the left lung is ventilated, so the right lung falls away from the chest wall.',
      'Check that the upper, middle and lower lobes are all flat. A half-inflated lung crowds the view and makes every later step harder.',
      'Free any adhesions first, then look around the whole cavity so the plan can be confirmed before dissection starts.',
      'Ports: camera port low in the 8th space, access incision higher and further forward in the 5th, plus one more 1 cm port. Roles can swap.',
      'A 30° angled telescope lets you look around structures by rotating the optic rather than moving the port.',
    ],
    video: {
      from: '0:26',
      to: '0:39',
      text: 'In the reference video: the anterior working port and a roughly 4 cm access incision are made, then the collapsed lung is surveyed.',
    },
    portLabel: CAMERA_PORT,
    pendingReview: true,
  },
  {
    step: 2,
    title: 'Open the anterior hilum',
    caption:
      'The upper and middle lobes are pushed backwards to open the front of the hilum. Under the mediastinal pleura you can now see the phrenic nerve running down the pericardium and, behind it, the superior pulmonary vein.',
    points: [
      'Pushing the lobes backwards stretches the mediastinal pleura over the hilum, so it can be cleared with a blunt peanut swab.',
      'The phrenic nerve runs across the anterior face of the upper vein. Move it medially out of the field and keep cautery well away.',
      'Near the phrenic nerve, stop small bleeding points with clips rather than diathermy: heat spread can paralyse the diaphragm.',
      'Name the landmarks: superior pulmonary vein, superior vena cava above it, and the azygos vein arching over the top of the hilum.',
      'In the video the scope moves to another port so the retractors can use the former camera port. Any port can change job.',
    ],
    video: {
      from: '0:46',
      to: '1:13',
      text: 'In the reference video: the scope changes port, two retractors hold the upper and middle lobes back and the pleura over the SVC is cleared bluntly.',
    },
    portLabel: CAMERA_PORT,
    pendingReview: true,
  },
  {
    step: 3,
    title: 'Middle lobe vein (V4/V5)',
    caption:
      'A closer view of the superior pulmonary vein. Find the middle lobe branches (V4/V5), make a passage behind them and divide them, leaving the upper lobe drainage alone.',
    points: [
      'The superior pulmonary vein drains both the upper and middle lobes. Follow each branch into its lobe before deciding what to divide.',
      'Divide only the middle lobe branches. Narrowing the upper lobe vein risks a clot and loss of blood supply to the upper lobe.',
      'Venous patterns vary: check them on the CT before surgery and again in theatre. The upper lobe vein joins the same trunk, so protect it.',
      'Pass a blunt angled clamp all the way around the vein first, so the stapler anvil follows a track already proven to be open.',
      'The pulmonary artery lies just behind the vein. Keep the clamp tip hugging the vein and pointed away from the artery.',
    ],
    video: {
      from: '1:13',
      to: '2:17',
      text: 'In the reference video: two vein branches are freed, retraction moves to the access incision and a curved-tip stapler divides both branches in one fire.',
    },
    portLabel: WORKING_PORT,
    note: 'Model limitation: the middle lobe branches run straight into a lobe whose fissure has not been opened, so they look simpler than in a real dissection.',
    pendingReview: true,
  },
  {
    step: 4,
    title: 'Nodes and middle lobe bronchus',
    caption:
      'With the vein divided, the middle lobe bronchus lies just behind it. Clear nodes 11R/12R, encircle the bronchus and prove it is the right airway before stapling.',
    points: [
      'The middle lobe bronchus sits right behind its vein. Its arteries run just above it, so stay close to the upper edge of the bronchus.',
      'Nodes 11R/12R lie between the middle and lower lobe bronchi. Taking them out improves the view; seal the small bronchial arteries beside them.',
      'Before firing: suction the airway, close the clamp, then give a breath. Upper and lower lobes should inflate while the middle lobe stays flat.',
      'Divide the bronchus close to where it leaves the bronchus intermedius, keeping the intermedius and lower lobe bronchus out of the jaws.',
      'Use whichever port gives the straightest line onto the bronchus. In the video that was the access incision.',
    ],
    video: {
      from: '2:17',
      to: '3:41',
      text: 'In the reference video: the upper lobe is pulled to tension the bronchus, a node beside it is removed, then a blunt clamp goes around it and it is stapled.',
    },
    portLabel: ACCESS_INCISION,
    note: 'This guided view is authored with a 44° optic offset; the hands-on scope is a 30° telescope.',
    pendingReview: true,
  },
  {
    step: 5,
    title: 'Middle lobe arteries (A4/A5)',
    caption:
      'Cutting the bronchus brings the one or two middle lobe arteries (A4/A5) into view just above it. Make a passage behind them and staple them, together or one by one.',
    points: [
      'Once the bronchus is divided, the one or two middle lobe artery branches become easy to see just above the bronchial stump.',
      'Artery branches are thin-walled. Avoid pulling on them, and steer the clamp tip away from the main pulmonary artery as it passes.',
      'A long, curving tunnel can be followed with a soft leader on the stapler tip, so the anvil slips through without stretching the tissue.',
      'The branches can be stapled together or one by one; make sure the lower lobe arteries are clear of the jaws before firing.',
      'Retraction is swapped again in the video so the stapler can come through the camera port, which gives the best angle here.',
    ],
    video: {
      from: '3:41',
      to: '5:00',
      text: 'In the reference video: two artery branches appear, a silicone leader guides the stapler through a long tunnel and both branches are divided together.',
    },
    portLabel: ACCESS_INCISION,
    note: 'Model limitation: the artery branches run into the lobe without an opened fissure, so the tunnel looks shorter and cleaner than in the video.',
    pendingReview: true,
  },
  {
    step: 6,
    title: 'Complete the fissures',
    caption:
      'Back at the camera port, the middle lobe is lifted while the upper lobe goes up and the lower lobe down. The remaining horizontal and oblique fissures are stapled last.',
    points: [
      'Doing the fissure last means no searching for arterial branches through fused lung, a smaller raw surface and fewer air leaks.',
      'A short breath shows where the aerated upper and lower lobes meet the flat middle lobe, marking the line to staple along.',
      'View the lobe from above, then flip it and look from below: the cut bronchus must sit above the stapler, not inside the staple line.',
      'Stapling across the fissure usually seals sooner than tearing or burning it apart. Expect about two or three fires.',
      'Keep the bronchus intermedius, the lower lobe bronchus and the lower lobe arteries well clear of the stapler.',
    ],
    video: {
      from: '5:14',
      to: '6:11',
      text: 'In the reference video: the scope returns to the camera port, the lobe is checked from above and below, and stapler fires complete the fissure.',
    },
    portLabel: CAMERA_PORT,
    note: 'Not modelled: the video patient had a middle lobe tumour, so an extra strip of upper lobe was taken with the specimen. Neither is in this model.',
    pendingReview: true,
  },
  {
    step: 7,
    title: 'Lobe out, leak test',
    caption:
      'The middle lobe has been removed and the upper and lower lobes re-inflated. Check the bronchial stump and staple lines under water for air leaks.',
    points: [
      'Put the lobe in a bag before pulling it out through the access incision, so tumour cells are not left behind in the wound.',
      'Fill the chest with warm saline and ventilate at about 20 cmH₂O. Bubbles from the stump or lung surface mean an air leak.',
      'Small surface leaks usually settle on their own. A leaking stump should be re-stapled or sealed before closing.',
      'Finish the node clearance (paratracheal 4R, subcarinal 7), check for bleeding and place one chest drain through the lowest port.',
      'Intercostal nerve blocks can be given under direct vision before closing to help with pain afterwards.',
    ],
    video: {
      from: '6:11',
      to: '6:46',
      text: 'In the reference video: the lobe is bagged and removed, nodes are cleared, a chest tube goes in and the stump is checked under saline while ventilating.',
    },
    portLabel: CAMERA_PORT,
    pendingReview: true,
  },
];

// Short paraphrase of CONTEXT §7.6 for an "About this model" panel.
export const MODEL_LIMITATIONS: readonly string[] = [
  'The middle lobe vessels and bronchus branch inside the lobe; the fissure is not pre-opened in the model.',
  'Wet shine and tissue translucency are added by the renderer, not stored in the model.',
  'Nerve paths, retraction amounts and the mediastinal shift are approximations.',
  'Vessel trees stop just inside the lung, so with the lungs hidden you see the hilar vessels only.',
  'See-through pleura can occasionally draw in the wrong order.',
  'The tumour in the reference video, and the extra upper lobe margin taken for it, are not modelled.',
  'Port positions differ from the video; ports are matched by role (camera port, access incision, anterior working port).',
];
