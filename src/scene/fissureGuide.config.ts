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
    { neighbour: 'lung_upper_lobe_right', segments: 2 },
    { neighbour: 'lung_lower_lobe_right', segments: 2 },
  ],
  /** Contact band: middle-lobe vertices this close to the neighbour in the rest (un-morphed) pose. */
  bandM: 0.004,
  /** Path resolution: band points binned along the fissure's long axis (as seen from the step-7 scope). */
  bins: 20,
  dot: {
    spacingM: 0.0032, // centre to centre along the path
    radiusM: 0.0009,
    refDepthM: 0.09, // nearer to the lens than this a dot keeps its screen size (the far fissure's, step-7 lens)
    liftM: 0.0012, // toward the scope, so the dots sit on (not in) the surface
    color: '#ffd23f', // guide yellow (sRGB), unlit
    segmentGapM: 0.0035, // dot-free gap marking where one fire ends and the next begins
  },
  /** All segments fired: the free lobe drifts a little with the grasper (eased morph). */
  drift: { key: 'retract_RML_lateral', to: 0.35, ms: 1500 },
} as const;

/** Stapler fires needed to free the lobe (one per segment). */
export const FISSURE_SEGMENTS = fissureGuideConfig.fissures.reduce((n, f) => n + f.segments, 0);
