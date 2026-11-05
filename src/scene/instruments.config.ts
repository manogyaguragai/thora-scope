// Procedural instrument config (CONTEXT §6.4, §8 Instruments). Lengths in metres, angles in radians, colours sRGB hex.
// Appearance matched by eye to ref-frames 01:25 (right-angle clamp), 02:04 (curved-tip stapler), 04:29 (leader).
// Local frame of every tool: +Z along the shaft toward the tip, tip at the origin (shaft lies on −Z).

const deg = Math.PI / 180;

export const instrumentLook = {
  shaft: { color: '#141416', roughness: 0.62, metalness: 0 }, // matte black insulated shaft
  // Satin steel (needs env for reflections). 01:25 / 02:04 / 02:36: clamp, ring-clamp, peanut, retractor and stapler
  // shafts are all steel, so the clamp-style stems use it too (only the clip applier keeps the black shaft).
  // T806: roughness 0.18 → 0.28 widens the headlight glint into the frames' long line highlight; envMapIntensity
  // 1.6 → 5 for the dim warm cavity env (lights.ts) that replaced the bright RoomEnvironment.
  // T807c: 0.2 / 8 + metalness 0.85 (headlit grey diffuse): the shafts read maroon (cavity env) with no glints.
  steel: { color: '#d6d4d0', roughness: 0.2, metalness: 0.85, envMapIntensity: 8 },
  cauteryShaft: { color: '#e8e6e0', roughness: 0.4, metalness: 0 }, // 02:36: white cautery pencil
  accent: { roughness: 0.45, metalness: 0, glowColor: '#ff8a3c' }, // cartridge insert / cautery tip
  gauze: { color: '#e6ded0', roughness: 1, metalness: 0 }, // T806: dull cotton off-white (0:58), not a glossy egg
  // 04:29: the leader reads cream/tan and only slightly see-through.
  silicone: { color: '#dccfa6', roughness: 0.35, metalness: 0, opacity: 0.82 },
  /**
   * Cartridge colour per stapler sub-option (vascular curved-tip · vascular + leader · bronchial · parenchyma).
   * Real-world colour↔staple-height mapping differs by manufacturer — PENDING CLINICIAN REVIEW (docs/ASSET_ISSUES.md).
   */
  cartridge: ['#e6e4de', '#e6e4de', '#2c2a30', '#6c4a8e'],
  cauteryTip: '#8d8f92',
  cauteryGlow: 1.6, // emissive intensity while the cautery is active
} as const;

export const instrumentGeom = {
  radialSegments: 12,
  shaft: { radius: 0.0025, length: 0.33 }, // 5 mm instruments
  hinge: { radius: 0.0025, length: 0.006 }, // T807c: flush with the shaft (its 0.3 mm cap lit as a white ring)
  /** Jawed tools: jaw length, width, thickness; open = total opening angle between the jaws. */
  ringClamp: {
    jawLength: 0.03,
    jawWidth: 0.0022,
    jawThick: 0.0016,
    ringRadius: 0.0055,
    ringTube: 0.12,
    open: 38 * deg,
  },
  /** Curved blade: rises `rise` over `length` toward the tip (shaft sits `rise` below the tip line). */
  retractor: { length: 0.04, rise: 0.012, width: 0.006, thick: 0.0018, segments: 12 },
  gauze: { radius: 0.009 },
  peanut: { jawLength: 0.016, jawWidth: 0.002, jawThick: 0.0016, radius: 0.0045, elongation: 1.6 }, // gauze on a fixed clamp
  cautery: { tipLength: 0.01, tipWidth: 0.0024, tipThick: 0.0006, hook: 0.003 },
  /** Jaws bend 90° toward +Y at the tip; the shaft sits `bendLength` below the tip. */
  rightAngle: { jawLength: 0.022, bendLength: 0.011, jawWidth: 0.0018, jawThick: 0.0016, open: 45 * deg },
  stapler: {
    shaftRadius: 0.006, // 12 mm
    shaftLength: 0.33,
    jointLength: 0.012,
    articulation: 20 * deg, // head articulation about the joint, fixed at build: the jaws angle across the target
    headLength: 0.05,
    jawWidth: 0.0095,
    cartridgeThick: 0.0055,
    anvilThick: 0.004,
    insertInset: 0.0015, // cartridge insert is this much narrower than the jaw on each side
    curvedTipLength: 0.009,
    curvedTipAngle: 35 * deg,
    open: 22 * deg,
    leader: { radius: 0.0016, tubularSegments: 24, radialSegments: 8 },
    /** Silicone leader centre-line, local to the anvil tip (+Z forward), a gentle preset curve. */
    leaderCurve: [
      [0, 0, 0],
      [0, 0.004, 0.02],
      [0, 0.014, 0.045],
      [0, 0.03, 0.065],
    ] as readonly (readonly [number, number, number])[],
  },
  clip: {
    jawLength: 0.012,
    jawWidth: 0.0026,
    jawThick: 0.0014,
    open: 30 * deg,
    clipLength: 0.008,
    clipWidth: 0.0012,
    clipThick: 0.0005,
  },
  sucker: {
    radius: 0.0025,
    holes: 4,
    holeSpacing: 0.004,
    holeRadius: 0.0006,
    tipLength: 0.006,
    tipRadius: 0.0018,
  },
} as const;

/** Rates for the control layer's animations (jaw open/close, cautery glow ramp), per second of 0..1 travel. */
export const instrumentAnim = { jawPerSecond: 4, glowPerSecond: 8 } as const;
