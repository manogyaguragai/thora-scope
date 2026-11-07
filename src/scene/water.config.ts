// T842 irrigation leak test (docs/FEEDBACK_v7_LIVE.md item 14): warm saline fills the right hemithorax until the
// hilum and the stumps are under; ventilation then shows bubbles only at a failed staple line. Gravity is −Y (§7.1,
// left lateral decubitus: the hilum lies low). Look + rates here; water.ts builds everything at load.
// Pending clinician review.
export const waterConfig = {
  /** "Irrigate the field" (context strip button on the final step + this key). */
  key: 'KeyW',
  keyLabel: 'W',
  /** Level 0 sits this far below the lowest hilar target, level 1 this far above the highest (all submerged). */
  bottomMarginM: 0.01,
  submergeMarginM: 0.012,
  /** World-Y cap on the full level: below the lowest scope-port pleura point (camera port ≈ 0.084 m) so the lens
   *  stays above the water. T844 (v8, step-9 pose): stump junctions vein 0.012, bronchus 0.028, artery 0.0665 m;
   *  0.074 also covers the artery stump cap. The step-9 lens (config.scope.poseFix) sits at 0.080. */
  maxTopY: 0.074,
  radiusM: 0.11, // surface disc round the hilum (the chest wall hides the rest)
  segments: 64,
  fillPerSec: 0.15, // level units per second while filling
  drainPerSec: 0.12, // level units per second while the sucker aspirates
  suctionReachM: 0.03, // T852: the held sucker drains while its tip is under the surface or this far above it
  dryY: -1000, // tissue-shader water level when dry (no fragment is below it)
  surface: {
    // T890 (critic r2 C8): softer, warmer surface toward 06:46's orange-pink haze (the grey grazing bands went)
    color: '#e8b0a0',
    opacity: 0.16, // face-on; grazing views reach edgeOpacity (fresnel)
    edgeOpacity: 0.35,
    envIntensity: 0.12, // reflections of the room environment (glints, not a white sheet)
    roughness: 0.03,
    metalness: 0,
    rippleAmp: 0.06, // normal tilt of the gentle ripples (T890: 0.18 → hard banding at grazing angles)
    rippleFreq: 260, // rad per metre
    rippleSpeed: 1.6, // rad per second
  },
  /** Body-wall / outside / left-chest meshes never get wet (the saline stays in the right pleural cavity). */
  dryMeshes:
    /^(skin|subcutaneous_fat|chest_wall_muscle|intercostal_muscles|rib_|spine|sternum|scapula|clavicula|costal_cartilages|port_)|_left$/,
  /** Seen through the water (tissue shader): inside the surface disc's cylinder, along the view ray's wet path. */
  under: {
    tint: [0.9, 0.62, 0.55] as const, // linear colour multiplier after a long wet path (T890: warm haze, 06:46)
    attenPerM: 22, // exp(−wet path × this) toward the tint
    causticScale: 550, // rad per metre: the net repeats every 2π / this (≈ 11 mm)
    causticSpeed: 0.5,
    causticSharp: 8, // pow() of the net: thin bright lines
    causticStrength: 0.45, // × lit colour (T890: 1.1 drew hard white streaks)
    causticFadeM: 0.004, // caustics fade in over this depth below the surface
  },
  /** setLeak(point): bubbles stream from a failed staple line while it is under water. */
  leak: { ratePerSec: 14, jitterM: 0.002 },
} as const;
