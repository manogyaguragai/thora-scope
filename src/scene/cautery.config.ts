// Electrocautery (T817, T822 user feedback 2026-11-05): energy only acts where the tip touches tissue. Contact on a
// soft overlying layer opens it (shader openings with a coagulated rim, materials.ts); on lung / other tissue it
// leaves a thin seared line (char decals along the path); energised contact near a small bleed seals it. T842: smoke
// accumulates with energy time, the sucker clears it; node-bed ooze. Smoke pool
// size/colour/life stay in config.effects.smoke; these are the cautery-specific numbers. Pending clinician review.
export const cauteryConfig = {
  /** Contact gating: the tip's nearest visible surface (BVH) within distM, sampled sampleHz while energised. */
  contact: {
    distM: 0.0025,
    sampleHz: 30, // ≤ §6.10 hover rate; also the sweep re-aim rate (pointer drag while energised)
    /** T880: energise re-seats the tip onto its layer's morphed surface only within this (stale-BVH error, T860c);
     *  farther = free space, the tip stays put. */
    reseatMaxM: 0.005,
  },
  smoke: {
    ratePerSec: 40, // wisps/s at the contact point while energised in contact + one perPuff burst on touch-down
  },
  /** T842 persistent dissection: a per-vertex "opened" field on each dissectable layer (attribute built at load,
   *  only ever raised until a step / mode reset). Field = 1 − d / (falloff × radius): discarded above 1 − 1/falloff. */
  dissect: {
    spacingM: 0.0014, // the tip within this of the stroke anchor = dwell (the opening widens)
    // T884 (critic S7): 1.6 / 3.4 mm openings barely nicked the strands over a guided sweep; wider cuts so the
    // strands / pleura visibly part along the stroke.
    startRadiusM: 0.0026,
    maxRadiusM: 0.0048, // dwell on one spot widens the opening up to this
    growPerSec: 0.0012,
    edgeFactor: 0.75, // coarse layers (chest-wall pleura ≈ 7 mm edges): radius ≥ this × the layer's mean edge
    falloff: 2, // field reaches 0 at falloff × radius (the rim band lives in between)
    rimWidth: 0.6, // coagulated rim outside the opening, share of its radius
    burnWidth: 0.15, // thin browned edge right at the opening, share of its radius
    rimRgb: [0.6, 0.47, 0.33] as const, // pale tan coagulum (linear albedo)
    burnRgb: [0.14, 0.08, 0.045] as const, // browned edge (linear albedo)
    rimRoughness: 0.32, // slightly glossy
    /** T852 peanut blunt dissection: same field, a little wider; a soft moist torn fringe instead of the rim. */
    blunt: {
      radiusScale: 1.35,
      tornRgb: [0.42, 0.16, 0.13] as const, // raw areolar tissue under the torn pleura (linear albedo)
      tornMix: 0.35, // share of tornRgb at the opening's edge
      tornThin: 0.45, // the torn fringe thins (alpha) toward the opening
      tornRoughness: 0.25, // moist
    },
  },
  /** Char / sear marks (one InstancedMesh, ring-buffer slots, capacity = round(preset.particleCap × capScale)).
   *  Subtle and secondary: a thin dark centre, pinkish-white coagulated edge; laid along the path on lung etc. */
  char: {
    capScale: 1 / 8,
    segments: 20,
    textureSize: 64, // px, procedural radial texture built once at load
    coreRgb: [86, 52, 40] as const, // thin dark-brown centre line
    rimRgb: [150, 98, 90] as const, // T893a: muted brown coagulated edge ([236,214,206] read as white rings)
    coreEnd: 0.3, // radius share where the core starts blending into the rim
    rimPeak: 0.5, // radius share where the rim is palest
    edgeStart: 0.45, // T893a: 0.62 drew a ring per mark; softer edge lets marks join into a seared line
    // (was 0.62) // radius share where the decal fades out to the tissue
    coreAlpha: 0.72, // < 1: tissue texture shows through
    mottle: 0.25, // ± brightness noise in the core (0 = flat)
    roughness: 0.6,
    startRadiusM: 0.0009, // on touch-down
    maxRadiusM: 0.0018, // after growSec of dwell on one spot
    growSec: 2,
    spacingM: 0.0009, // next mark along a sweep (overlapping → a continuous seared line)
    joinMaxM: 0.006, // T893a: a sample gap up to this is filled with marks (larger = a lift / jump, not a sweep)
    normalOffset: 0.0003, // m, lift off the surface (plus polygon offset)
  },
  /** Coagulation of bleeding (complications.ts): energised contact within radiusM of an active bleed. */
  coag: {
    radiusM: 0.008,
    sec: 1.5, // continuous contact to seal a minor bleed (ooze falls off linearly meanwhile); major: never
  },
  /** T842 smoke density in the closed cavity (post-FX uFog): cumulative energised-contact time builds it and it
   *  stays (slow passive clearing) until the sucker aspirates it. */
  haze: {
    max: 0.7, // murky view after ~30 s of cumulative energy
    riseRate: 0.018, // per second of energised tissue contact (T890 C4: 0.025 left the walkthrough grey; ≥ 0.017 keeps
    // practice murky after 30 s, effects.test)
    // T893a (critic r3): 0.002 left a milky veil across beats (black floor 67–87); clears a short stroke in ~2 s and
    // stays < 0.5 s-share of a 30 s practice build-up (effects.test).
    decayRate: 0.045, // per second, passive (port leak)
    /** Drifting smoke in the cavity around the last contact point; spawn rate ∝ density / max. */
    particles: {
      capScale: 0.5,
      color: [0.8, 0.79, 0.76] as const,
      size: 0.012, // m, size-attenuated (T890 C4: 20 mm read as white balls near the lens)
      opacity: 0.08, // T893a: 0.18 read as a milky veil
      lifeSec: 4,
      ratePerSec: 24, // at max density
      radiusM: 0.035, // spawn sphere around the field
      driftSpeed: 0.003, // m/s random
    },
  },
  /** T842 sucker held (sub-option Suction): aspirates smoke, saline and pooled blood near the tip. */
  suction: {
    hazeClearPerSec: 0.2, // uFog units per second
    radiusM: 0.03, // particles within this flow to the tip
    flowSpeed: 0.05, // m/s toward the tip
    swirl: 0.025, // m/s tangential (small vortex round the tip)
    captureM: 0.003, // aspirated within this
    bloodShrinkPerSec: 0.004, // m of decal radius per second within radiusM
    bloodMinShare: 0.3, // a still-bleeding decal keeps this share of its size
  },
  /** T842 lymph-node bed ooze (startOoze; T861 look: config.effects.bed); energised contact seals it (coag rule). */
  nodeBed: {
    max: 4, // simultaneous node-bed oozes (fixed slots)
  },
} as const;
