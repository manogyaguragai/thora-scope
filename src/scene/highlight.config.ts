// T861 walkthrough highlight (docs/FEEDBACK_GUIDED_v1.md §2.1-7): soft additive glow on the current subject —
// a fresnel rim on its surface + a soft inflated back-face outline — pulsing slowly; fissures glow as a band along
// the gap between the lobes. Colours are linear-HDR additions before the post-FX grade (src/scene/postfx.ts).
export const highlightConfig = {
  color: '#a8f0ff', // pale cyan-white: reads apart from the red-magenta tissue grade without a cartoon hue
  periodMs: 2000, // eased pulse period (§2.1-7: ≈ 2 s)
  /** Glow = fade × (base + amp × pulse), pulse 0…1 (cosine-eased). */
  base: 0.35, // T884 (critic S1): 0.6 + amp clipped the bronchus / artery to flat white
  amp: 0.3,
  /** Switching subjects: the previous one fades out over this share of the new fade time, then the new one in. */
  switchShare: 0.5,
  rim: {
    power: 3.5, // fresnel exponent: higher = thinner rim
    strength: 0.3, // at grazing angles
    fill: 0, // T884: no face-on lift (0.02 washed the whole subject white); the glow is a rim + outline only
    liftM: 0.0007, // along the normal, above the T831 heartbeat push (0.6 mm) so it never sinks into the tissue
  },
  outline: {
    widthM: 0.0015, // inflated back-face shell beyond the silhouette
    strength: 0.07, // T884: 0.14 read as a white halo
    soft: 0.35, // |n·v| at which the shell reaches full strength (0 at its outer edge: soft falloff outward)
  },
  fissure: {
    bandM: 0.003, // half-width of the glowing strip round the guide path (step-7 pose), soft to its edge
    /** T888: the weight is baked this wide; the scope view thresholds it back to bandM (uShape.x), the outside-view
     *  inset (walkthrough inset.glow.band) shows all of it, so the fissure line reads at inset scale. */
    insetBandM: 0.006,
    strength: 0.14, // T872: 0.4 read as a near-opaque wash; a soft glow along the gap
    liftM: 0.0007,
  },
} as const;
