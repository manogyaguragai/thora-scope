// T851 step-7 fissure guide (docs/FEEDBACK_v8_LIVE.md item 7): the dotted line along the planes dividing the middle
// lobe from the upper (horizontal fissure) and lower (oblique fissure) lobes, fired segment by segment with the
// powered stapler. Pending clinician review (segment counts follow the book's 2–3 fires per fissure, rounded down).
export const fissureGuideConfig = {
  lobe: 'lung_middle_lobe_right',
  /** Procedure step that shows the guide (its scope pose is the "eye" the line is traced for). */
  step: 7,
  /** Fire order: horizontal fissure first, then the oblique one; `segments` stapler fires each. The total is
   *  config.finish.fissureFiresRequired (finish.ts) and the step-7 fire actions in practice_actions.json. */
  fissures: [
    // T872 (R8): the horizontal line is traced from the inferior camera port (the walkthrough's step-7 lens) over
    // the band points it can see, so every fire lies on the camera-facing side (approximation until the refined model).
    { neighbour: 'lung_upper_lobe_right', segments: 2, visibleFrom: 'port_camera_8ICS' },
    { neighbour: 'lung_lower_lobe_right', segments: 2 },
  ] as readonly { neighbour: string; segments: number; visibleFrom?: string }[],
  /** `visibleFrom` eye: this far in from the port's pleura point toward the middle lobe (the walkthrough's step-7
   *  lens sits ≈ 2 cm in, looking at the lobe). */
  eyeDepthM: 0.02,
  eyeClearM: 0.005, // … and at least this short of the first lobe along that axis
  /** Lobes that may hide a band point from that eye (step-7 pose), and the slack at the point itself. */
  occluders: ['lung_upper_lobe_right', 'lung_middle_lobe_right', 'lung_lower_lobe_right'],
  occlusionSlackM: 0.002,
  /** Visible-side band half-widths tried in turn (rest pose, m) until at least `minVisible` points are in view;
   *  none: the contact band traced as for the other fissure. */
  visibleBandsM: [0.004, 0.008, 0.012, 0.018, 0.025],
  minVisible: 12,
  /** Contact band: middle-lobe vertices this close to the neighbour in the rest (un-morphed) pose. */
  bandM: 0.004,
  /** Path resolution: band points binned along the fissure's long axis (as seen from the step-7 scope). */
  bins: 20,
  dot: {
    spacingM: 0.0032, // centre to centre along the path
    radiusM: 0.0009,
    refDepthM: 0.09, // nearer to the lens than this a dot keeps its screen size (the far fissure's, step-7 lens)
    liftM: 0.0012, // toward the scope, so the dots sit on (not in) the surface
    // Per fissure, in fire order (sRGB, unlit): guide yellow horizontal; T893a: cyan oblique so the two lines differ.
    colors: ['#ffd23f', '#3fd8ff'] as const,
    segmentGapM: 0.0035, // dot-free gap marking where one fire ends and the next begins
  },
  /** T884 (critic S3): each fired staple snaps onto its lobe's surface (step-7 pose, nearest point within snapM),
   *  liftM proud of it along the face normal: the straight segment chord floated off the curved lobe. */
  staples: { snapM: 0.01, liftM: 0.0003 },
  /** All segments fired: the free lobe drifts a little with the grasper (eased morph). */
  drift: { key: 'retract_RML_lateral', to: 0.35, ms: 1500 },
} as const;

/** Stapler fires needed to free the lobe (one per segment). */
export const FISSURE_SEGMENTS = fissureGuideConfig.fissures.reduce((n, f) => n + f.segments, 0);
