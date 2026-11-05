// Electrocautery (T817, T822 user feedback 2026-11-05): energy only acts where the tip touches tissue. Contact on a
// soft overlying layer opens it (shader openings with a coagulated rim, materials.ts); on lung / other tissue it
// leaves a thin seared line (char decals along the path); energised contact near a small bleed seals it. Smoke pool
// size/colour/life stay in config.effects.smoke; these are the cautery-specific numbers. Pending clinician review.
export const cauteryConfig = {
  /** Contact gating: the tip's nearest visible surface (BVH) within distM, sampled sampleHz while energised. */
  contact: {
    distM: 0.0025,
    sampleHz: 30, // ≤ §6.10 hover rate; also the sweep re-aim rate (pointer drag while energised)
  },
  smoke: {
    ratePerSec: 40, // wisps/s at the contact point while energised in contact + one perPuff burst on touch-down
  },
  /** Dissection openings (one shared ring buffer of world spheres, uniform array in every tissue program). */
  dissect: {
    maxPoints: 48, // GLSL array length, fixed at load (§6.10: never resized)
    spacingM: 0.0014, // a new opening once the tip moved this far from the newest one
    maxStepsPerSample: 6, // fast sweeps: openings interpolated along the jump, at most this many per sample
    startRadiusM: 0.0016,
    maxRadiusM: 0.0034, // dwell on one spot widens the newest opening up to this
    growPerSec: 0.0012,
    rimWidth: 0.6, // coagulated rim outside the opening, share of its radius
    burnWidth: 0.15, // thin browned edge right at the opening, share of its radius
    rimRgb: [0.6, 0.47, 0.33] as const, // pale tan coagulum (linear albedo)
    burnRgb: [0.14, 0.08, 0.045] as const, // browned edge (linear albedo)
    rimRoughness: 0.32, // slightly glossy
  },
  /** Char / sear marks (one InstancedMesh, ring-buffer slots, capacity = round(preset.particleCap × capScale)).
   *  Subtle and secondary: a thin dark centre, pinkish-white coagulated edge; laid along the path on lung etc. */
  char: {
    capScale: 1 / 8,
    segments: 20,
    textureSize: 64, // px, procedural radial texture built once at load
    coreRgb: [86, 52, 40] as const, // thin dark-brown centre line
    rimRgb: [236, 214, 206] as const, // pinkish-white coagulated edge
    coreEnd: 0.22, // radius share where the core starts blending into the rim
    rimPeak: 0.5, // radius share where the rim is palest
    edgeStart: 0.62, // radius share where the decal fades out to the tissue
    coreAlpha: 0.72, // < 1: tissue texture shows through
    mottle: 0.25, // ± brightness noise in the core (0 = flat)
    roughness: 0.6,
    startRadiusM: 0.0009, // on touch-down
    maxRadiusM: 0.0018, // after growSec of dwell on one spot
    growSec: 2,
    spacingM: 0.0009, // next mark along a sweep (overlapping → a continuous seared line)
    normalOffset: 0.0003, // m, lift off the surface (plus polygon offset)
  },
  /** Coagulation of bleeding (complications.ts): energised contact within radiusM of an active bleed. */
  coag: {
    radiusM: 0.008,
    sec: 1.5, // continuous contact to seal a minor bleed (ooze falls off linearly meanwhile); major: never
  },
  /** Smoke haze in the post-FX pass (uFog): builds slowly while energy touches tissue, clears slowly after. */
  haze: {
    max: 0.16,
    riseRate: 0.05, // per second while active
    decayRate: 0.04, // per second after release (the sucker clears it at once)
  },
} as const;
