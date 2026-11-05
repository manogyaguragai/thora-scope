// Electrocautery look (T817, user feedback 2026-11-05): a smoke plume at the tip while energy is on, a char/singe
// mark that grows at the contact point, and a slow smoke haze (never a warp). Smoke pool size/colour/life stay in
// config.effects.smoke; these are the cautery-specific numbers. Pending clinician review.
export const cauteryConfig = {
  smoke: {
    ratePerSec: 40, // wisps/s at the tip while energised (≈ 64 alive over smoke.lifeSec) + one perPuff burst on contact
  },
  /** Char / singe decals: one InstancedMesh, ring-buffer slots (capacity = round(preset.particleCap × capScale)). */
  char: {
    capScale: 1 / 8,
    segments: 20,
    textureSize: 64, // px, procedural radial char texture built once at load
    coreRgb: [30, 18, 12] as const, // dark brown-black eschar
    rimRgb: [222, 204, 178] as const, // pale coagulated rim
    coreEnd: 0.42, // radius share where the core starts blending into the rim
    rimPeak: 0.68, // radius share where the rim is palest
    edgeStart: 0.78, // radius share where the decal fades out to the tissue
    coreAlpha: 0.9, // < 1: tissue texture shows through slightly
    mottle: 0.35, // ± brightness noise in the core (0 = flat)
    roughness: 0.9, // dry
    startRadiusM: 0.0012, // on contact
    maxRadiusM: 0.0045, // after growSec of hold
    growSec: 3,
    normalOffset: 0.0003, // m, lift off the surface (plus polygon offset)
  },
  /** Smoke haze in the post-FX pass (uFog): builds slowly while energy is on, clears slowly after release. */
  haze: {
    max: 0.16,
    riseRate: 0.05, // per second while active
    decayRate: 0.04, // per second after release (the sucker clears it at once)
  },
} as const;
