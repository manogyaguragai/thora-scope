// Procedural instrument config (CONTEXT §6.4, §8 Instruments). Lengths in metres, angles in radians, colours sRGB hex.
// Appearance matched by eye to ref-frames 01:25 (right-angle clamp), 02:04 (curved-tip stapler), 02:36 (fenestrated
// ring clamp, serrated rim), 03:36 (endostapler: textured grey jaws, black shaft), 04:29 (leader).
// T819: VATS look — matte black insulated shafts with white laser-etched depth bands, brushed-steel tips, proper
// handles (the procedural gloves are hidden, see hands.ts). T825: per-family textures (instrumentTex) bound to the
// same three slots of every opaque material → still one opaque program.
// Local frame of every tool: +Z along the shaft toward the tip, tip at the origin (shaft lies on −Z).

const deg = Math.PI / 180;

export const instrumentLook = {
  // Matte black insulation; the brushed map (× roughness) gives it a faint uneven sheen. T821: metalness 1 with a
  // near-black colour = no diffuse and F0 ≈ 0.005, so the inverse-square headlight can't wash a shaft passing close
  // to the lens grey (dielectric F0 0.04 + diffuse did); only a soft stripe + grazing env rims remain.
  shaft: { color: '#0e0e10', roughness: 0.8, metalness: 1, envMapIntensity: 1 },
  // Satin steel (needs env for reflections). T807c: metalness 0.85 + high env intensity so the tips glint in the dim
  // warm cavity env instead of reading maroon. T819: roughness × brushed map (min … 1) streaks, and
  // metalness 0.7: the near headlight then spreads into the frames' broad silver highlight (0.12 read dark brown).
  // T821: envMapIntensity only counts since the instruments got their own neutral env (env below); 8 then blew out.
  steel: {
    color: '#dcdad6',
    roughness: 0.16, // T823: 0.4 read matte grey plastic; T825 × streak map 0.75 … 1
    metalness: 0.85,
    envMapIntensity: 2,
  },
  white: { color: '#e8e6e0', roughness: 0.45, metalness: 0 }, // depth bands, cautery collar, handle buttons
  accent: { roughness: 0.45, metalness: 0, glowColor: '#ff8a3c' }, // cartridge insert / cautery tip
  gauze: { color: '#e6ded0', roughness: 1, metalness: 0, envMapIntensity: 0.6 }, // T806: dull cotton (0:58); T825 env 0.6
  // 04:29: the leader reads cream/tan and only slightly see-through.
  silicone: { color: '#dccfa6', roughness: 0.35, metalness: 0, opacity: 0.82 },
  /**
   * Cartridge colour per stapler sub-option (vascular curved-tip · vascular + leader · bronchial · parenchyma).
   * Real-world colour↔staple-height mapping differs by manufacturer — PENDING CLINICIAN REVIEW (docs/ASSET_ISSUES.md).
   */
  cartridge: ['#e6e4de', '#e6e4de', '#2c2a30', '#6c4a8e'],
  cauteryTip: '#8d8f92',
  cauteryGlow: 1.6, // emissive intensity while the cautery is active
  /** T821: neutral grey reflection env for every instrument material (lights.ts; same shape as config.cavityEnv):
   *  the warm maroon cavity env + grade turned the black shafts grey-mauve and the steel brown. */
  env: {
    // T825: a large soft bright cap over a dark surround → cylinders show a bright/dark split (chrome horizon line)
    // in most orientations; the small T823 spot (60 · 0.08) only lit a few, the rest read matte gunmetal.
    surround: '#1e1e22',
    surroundIntensity: 1,
    spot: '#ffffff',
    spotIntensity: 5,
    spotRadius: 0.42, // < 0.5: the PMREM camera must stay outside the cap sphere (lights.ts places it at 1 − r)
    spotDir: [0, 1, 0.35] as const,
  },
  /** T825: polished L-hook wire (steel texture set, glow via emissive). */
  cauteryWire: { roughness: 0.25, metalness: 0.8 },
  /** T825: soil (blood/tissue) mix per material, driven by a uniform: amount 0 … 1 grows over the map's alpha mask
   *  (setSoil). Soiled texels turn dielectric and wet (roughness → `roughness`). */
  soil: {
    steel: { color: '#3a0806', amount: 0.12 }, // faint smudges near the tips by default
    gauze: { color: '#d89a90', amount: 0.3 }, // default slight pink soak
    edge: 0.15, // mask → coverage ramp width
    roughness: 0.35,
    /** T825b (wireM4): live soiling per second of contact, capped; reset to the defaults above on step / mode
     *  change. Steel: energised tip on tissue or a grasp. Gauze: sponge / peanut pressed on an active bleed. */
    rise: { steelPerS: 0.03, steelMax: 0.4, gauzePerS: 0.2, gauzeMax: 0.85 },
  },
} as const;

/** T825: procedural instrument textures (instrumentTextures.ts), generated once at load. UV unit = 1 / uvPerMetre m.
 *  Sizes in texels; heights are relative, `normal` = height → normal gain. */
export const instrumentTex = {
  uvPerMetre: 50, // one texture repeat per 2 cm of steel / insulation
  anisotropy: 8,
  seed: 0x5eed,
  /** Brushed steel: streak ridges across u (min … 1 roughness), fine ridges, scratches. */
  steel: {
    size: 256,
    min: 0.75,
    jitter: 0.06,
    fine: 0.6,
    wave: 0.8,
    mottle: 0.06,
    scratches: 40,
    scratchDepth: 0.3,
    scratchCurl: 0.03,
    scratchRough: 0.1,
    normal: 0.9,
  },
  shaft: {
    size: 128,
    grainCells: 32,
    grain: 0.12,
    scuffs: 10,
    scuffSpread: 0.3,
    scuffDepth: 0.4,
    normal: 0.6,
  },
  /** Woven gauze: `threads` per repeat, open gaps at `gap` albedo, loose fibres; texture repeat on top of the UVs. */
  gauze: {
    size: 128,
    threads: 16,
    threadWidth: 0.7,
    threadShade: 0.25,
    gap: 0.72,
    fibres: 40,
    fibreCurl: 0.6,
    normal: 0.7,
    repeat: 3,
  },
  /** Cartridge insert: `rows` staggered staple pockets across one strip, one pocket pitch per texture repeat. */
  cartridge: {
    width: 32,
    length: 64,
    rows: 3,
    pocketWidth: 0.17,
    pocketLength: 0.7,
    pocketShade: 0.35,
    pitch: 0.0035, // metres per pocket (texture repeat along the strip)
    grain: 0.05,
    normal: 2,
  },
} as const;

export const instrumentGeom = {
  radialSegments: 16,
  shaft: { radius: 0.0025, length: 0.33 }, // 5 mm instruments
  /** Laser-etched depth bands: [distance behind the shaft's distal end, band width]; the 5 cm band is wider. */
  bands: [
    [0.02, 0.0006],
    [0.03, 0.0006],
    [0.04, 0.0006],
    [0.05, 0.0015],
    [0.06, 0.0006],
    [0.07, 0.0006],
  ] as readonly (readonly [number, number])[],
  bandLift: 0.00004, // bands sit this far proud of the shaft (no z-fight)
  /** Steel ferrule between shaft and jaws: tapers from the shaft radius to `nose` at the hinge (T807c: flush). */
  hinge: { radius: 0.0025, length: 0.006, nose: 0.0017, pin: 0.0005 },
  bevel: 0.0002, // edge bevel on every extruded steel part
  /** Handles (outside view / PiP), behind the shaft's proximal end. */
  handle: {
    knob: { radius: 0.008, length: 0.014, flutes: 10 }, // fluted rotation knob
    body: { radius: 0.007, length: 0.045 },
    /** Laparoscopic ring handle: two shanks drop (−Y) from the body to finger/thumb rings. */
    ring: { radius: 0.011, tube: 0.0026, drop: 0.07, rake: 0.02, spread: 0.022, rod: 0.0035 },
    /** Ring forceps (sponge / peanut, all steel): scissor shanks out to ±X rings. */
    scissor: { length: 0.12, spread: 0.03, ring: 0.012, tube: 0.0024, rod: 0.0025 },
    pencil: { radius: 0.0055, length: 0.12, buttons: [0.025, 0.04], button: 0.0018 },
    /** Stapler pistol: body + grip + trigger outlines in the (−Y, −Z) plane, `thick` across X. */
    pistol: {
      bodyRadius: 0.013,
      bodyLength: 0.1,
      thick: 0.024,
      grip: [
        [0, -0.02],
        [0, -0.07],
        [-0.11, -0.1],
        [-0.12, -0.075],
        [-0.02, -0.045],
      ] as readonly (readonly [number, number])[],
      trigger: [
        [0, -0.005],
        [0, -0.02],
        [-0.085, -0.04],
        [-0.09, -0.025],
      ] as readonly (readonly [number, number])[],
    },
  },
  /** Ring clamp (02:36): bar shanks ending in smooth oval loops (flattened round wire); fine transverse serrations on
   *  the clamping face only (T825: the toothed hole read as a gear). */
  ringClamp: {
    jawLength: 0.03,
    jawWidth: 0.0022,
    jawThick: 0.0013,
    ringRadius: 0.0055, // ring half-length along Z (outer); half-width = ringRadius × ringAspect
    ringAspect: 0.72,
    rim: 0.0016, // loop band width
    teeth: 36, // serrations round the loop (2 rings each; ≤ 6k tris per tool)
    toothDepth: 0.00012,
    radial: 8, // loop cross-section segments
    open: 38 * deg,
  },
  /** Curved blade: rises `rise` over `length` toward the tip (shaft sits `rise` below the tip line). */
  retractor: { length: 0.04, rise: 0.012, width: 0.006, thick: 0.0018, segments: 20 },
  /** Folded gauze swab: welded sphere, squashed by `shape`, displaced by lumps + fold creases (× radius). */
  gauze: {
    radius: 0.006, // T823: 9 mm read as oversized blobs
    shape: [1, 0.78, 1.15] as const, // x, y, z scale: a folded pad, not a ball
    crumple: 0.09,
    folds: 0.06,
    segments: 32,
  },
  /** Peanut (kittner): ≈ 7 mm × 11 mm (radius × elongation = half-length). */
  peanut: {
    jawLength: 0.016,
    jawWidth: 0.002,
    jawThick: 0.0012,
    radius: 0.0035,
    elongation: 1.55,
    crumple: 0.05,
  },
  /** L-hook: white insulating collar tapers to a thin sheath (step), then the bare wire runs on and bends 90° up to
   *  `hook`; the wire ends in a polished ball. */
  cautery: {
    tipLength: 0.01,
    wire: 0.00042,
    hook: 0.003,
    bend: 0.0011,
    collar: 0.006,
    collarNose: 0.0012,
    sheath: 0.0008, // sheath radius (the step down from the collar nose)
    sheathLength: 0.003,
  },
  /** Jaws bend 90° toward +Y at the tip; the shaft sits `bendLength` below the tip. Tapered, serrated (Maryland). */
  rightAngle: {
    jawLength: 0.022,
    bendLength: 0.011,
    jawWidth: 0.0018,
    jawThick: 0.0022,
    bendRadius: 0.006,
    taper: 0.45, // tip radius × base radius
    serrations: 14,
    serrationDepth: 0.18, // × local radius, inner face only
    open: 45 * deg,
  },
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
    knifeSlot: 0.0008, // gap down the middle of the cartridge insert
    corner: 0.0012, // jaw cross-section corner radius
    anvilWidth: 0.88, // × jawWidth: the anvil is a little narrower than the cartridge
    jawGap: 0.0005, // visible gap between insert and anvil when closed
    nose: 0.004, // rounded cartridge nose length
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
    lumen: 0.6, // inner radius × tip radius
  },
} as const;

/** Rates for the control layer's animations (jaw open/close, cautery glow ramp), per second of 0..1 travel. */
export const instrumentAnim = { jawPerSecond: 4, glowPerSecond: 8 } as const;
