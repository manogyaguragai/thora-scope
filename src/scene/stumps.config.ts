// T834 division stumps (src/scene/stumps.ts): junction fitting + stump shape. Metres unless noted.
export const STUMPS = {
  /** `<common>_<X><n>` sub-branch → its common segment is the parent (e.g. middle_lobe_vein_V4 → middle_lobe_vein). */
  subBranch: /_[A-Z]\d+$/,
  /** Segment vertices this close to the parent surface form the junction ring. */
  ringTolM: 0.0008,
  /** Two distance-from-parent bands (outside the parent); their centroids give the branch axis. */
  band1M: [0.001, 0.003] as const,
  band2M: [0.003, 0.006] as const,
  /** Band vertices further than this from the ring centroid are ignored (segment running alongside the parent). */
  reachM: 0.012,
  /** Stump length beyond the parent surface = radius × this (at least the staple zone + ramp). */
  lengthR: 1.4,
  /** Tube start inside the parent (× radius), so it sits flush with no gap. */
  embedR: 0.8,
  /** Stapled end: thickness scale (pinched) and width scale (spread) of the cross-section. */
  pinch: 0.5,
  widen: 1.15,
  /** Superellipse exponent of the stapled cross-section (2 = ellipse, higher = flatter faces for the staples). */
  flatExp: 4,
  /** Pinch ramp length (× radius) before the flat stapled zone. */
  rampR: 0.9,
  /** Extra flat length beyond the staple rows. */
  flatMarginM: 0.0004,
  /** Staple rows per stump (both faces) and the share of the end width they span. */
  rows: 2,
  lineSpan: 0.7,
  /** Staple pitch along a row = crown × this (sets staples per row). */
  pitchK: 1.0,
  /** Staples sit this far proud of the flat face. */
  liftM: 0.0001,
  /** Staple-line direction reference (projected ⟂ the stump axis); +X = cranial. */
  acrossRef: [1, 0, 0] as const,
  /** Tessellation: around, tube rings, dome rings. */
  radial: 24,
  tubeRings: 10,
  domeRings: 4,
  /** T841 two-stump division: each manifest segment is split at load at its cut (geodesic distance from the
   *  junction) into a proximal + a distal piece; the logical segment mesh (picking, visibility, material) stays but
   *  draws on `layer`, which no camera renders. */
  split: {
    /** Pose the targets.ts points were measured in (manifest morph → influence; steps 3–5, OLV + retract_hilum). */
    pose: { collapse_RUL: 1, collapse_RML: 1, collapse_RLL: 1, retract_hilum: 1 } as Readonly<
      Record<string, number>
    >,
    weldM: 0.00001, // positions this close share a graph node (glTF seams)
    minDistalM: 0.004, // the distal piece keeps at least this much length
    marginM: 0.001, // the proximal piece reaches this far past the T834 stump
    bandR: 0.35, // ring band half-width (× radius) for the cut-ring centroid / radius
    axisR: 1.2, // cut axis = centroid offset over ± this × radius
    layer: 30,
    patchSlack: 1.5, // live-axis patch (rest pose) reaches this × the PCA radius: morphs may slide it a little
  },
  /** Distal stump cap: a short pinched end on the specimen side (overrides of the stump shape above). */
  cap: { lengthR: 0.7, embedR: 0.25, radiusK: 1.04, rampR: 0.5 },
  /** Clip division (T841): one titanium clip baked across each pinched end instead of the staple rows. */
  clip: { spanK: 1.05, heel: true },
  /** Live cut-axis PCA (staples.ts localAxis): vertices within this radius of the contact point. */
  pcaRadiusM: 0.006,
  pcaRadiusR: 3, // … and at least this × the structure's radius (long axis dominates the cross-section)
  pcaIterations: 24,
};
