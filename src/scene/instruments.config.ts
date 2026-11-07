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
    // T890 (critic r2 C2): #dcdad6 blew the stapler knuckle / jaws out white by the lens; T893a (r3): #c2c0bc still did
    color: '#a4a29e',
    // T884 (critic S6): 0.16 glared white on the stapler collar close up; T893a (r3): 0.35 still blew the stapler head
    // out under the co-located headlight (specular peak ∝ 1/roughness⁴). T825 × streak map 0.75 … 1
    roughness: 0.5,
    metalness: 0.85,
    envMapIntensity: 1.2, // T890 (critic r2 C2): 2 blew the stapler jaws out white close up
  },
  white: { color: '#e8e6e0', roughness: 0.45, metalness: 0 }, // depth bands, cautery collar, handle buttons
  accent: { roughness: 0.45, metalness: 0, glowColor: '#ff8a3c' }, // cartridge insert / cautery tip
  gauze: { color: '#e6ded0', roughness: 1, metalness: 0, envMapIntensity: 0.6 }, // T806: dull cotton (0:58); T825 env 0.6
  // 04:29: the leader reads cream/tan and only slightly see-through.
  silicone: { color: '#dccfa6', roughness: 0.35, metalness: 0, opacity: 0.82 },
  /**
   * Reload colour per stapler sub-option (vascular curved-tip · vascular + leader · bronchial · parenchyma). T841:
   * blue for vessels / bronchus, tan-white for parenchyma (user's reference photos). Real-world colour↔staple-height
   * mapping differs by manufacturer — PENDING CLINICIAN REVIEW (docs/ASSET_ISSUES.md).
   */
  // T884 (critic S6, ref 05:50 grey green-tinted reload): #2f6fc4 read as flat pastel-blue plastic.
  // T890 (C2): parenchyma grey-green too (05:50), not cream. Matte under the headlight: lighter washed out to grey.
  cartridge: ['#4a5c50', '#4a5c50', '#4a5c50', '#5a6a5c'],
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
    steel: { color: '#4a2e28', amount: 0.03 }, // faint smudges near the tips by default (T884: 0.12 dark-red blotches)
    gauze: { color: '#d89a90', amount: 0.3 }, // default slight pink soak
    edge: 0.15, // mask → coverage ramp width
    roughness: 0.35,
    /** T825b (wireM4): live soiling per second of contact, capped; reset to the defaults above on step / mode
     *  change. Steel: energised tip on tissue or a grasp. Gauze: sponge / peanut pressed on an active bleed. */
    rise: { steelPerS: 0.03, steelMax: 0.05, gauzePerS: 0.2, gauzeMax: 0.85 }, // T884: steelMax 0.4 blotched the stapler; T890: 0.15 still left dark-red blotches
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
    /** Powered stapler pistol (white, T841): fluted rotation knob, body, grip + trigger outlines in the (−Y, −Z)
     *  plane, `thick` across X, a dark fire button on the grip. */
    pistol: {
      bodyRadius: 0.016,
      bodyLength: 0.095,
      thick: 0.026,
      knob: { radius: 0.012, length: 0.016, flutes: 8 },
      button: 0.004,
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
  // T893a (critic r3): a 1.8 mm steel blade read as a thin cream cable when held → a dark ~5 mm insulated blade.
  retractor: { length: 0.04, rise: 0.012, width: 0.006, thick: 0.005, segments: 20 },
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
  /** T841 right-angle vascular / bronchial clamp: two fine nested jaws run `reach` along the shaft from the hinge,
   *  bend 90° (radius `bendRadius`) toward +Y and run on `bendLength` to the tip, which sits at the origin. They open
   *  in the bend plane (about X at the hinge), so the bent tips hook behind a vessel and close across it. */
  rightAngle: {
    reach: 0.012,
    bendRadius: 0.005,
    bendLength: 0.009, // straight bent part after the curve
    // T884 (critic S9, ref 03:18 blunt curved clamp): 1.7 × 1.3 mm jaws tapering to 0.4 read as two thin wires.
    // T890 (critic r2 C9): still read as thin bars → thicker, blunter polished jaws.
    jawWidth: 0.0042, // across X
    jawThick: 0.0028, // each jaw, in the bend plane
    taper: 0.8, // tip radius × base radius (a blunt rounded tip)
    serrations: 16,
    serrationDepth: 0.08, // × local radius, inner face only
    segments: 40,
    open: 40 * deg,
  },
  /** T841 powered vascular stapler (user's reference photos): long round brushed-steel shaft, dark ridged
   *  articulation knuckle, long jaws = steel anvil with a curved tapered tip over a channel holding a coloured reload
   *  (staple-pocket deck, printed depth marks), white pistol handle. */
  stapler: {
    shaftRadius: 0.006, // 12 mm
    shaftLength: 0.3,
    jointLength: 0.016, // articulation knuckle
    knuckleRidges: 4,
    articulation: 0, // rest articulation; jawPose (staple.ts) articulates the head across an engaged structure
    maxArticulation: 45 * deg,
    headLength: 0.05,
    jawWidth: 0.0085,
    cartridgeThick: 0.0055,
    channelThick: 0.0012, // steel channel under the reload
    anvilThick: 0.0035,
    insertInset: 0.0015, // cartridge insert is this much narrower than the jaw on each side
    knifeSlot: 0.0008, // gap down the middle of the cartridge insert
    corner: 0.0012, // jaw cross-section corner radius
    anvilWidth: 0.88, // × jawWidth: the anvil is a little narrower than the cartridge
    jawGap: 0.0005, // visible gap between insert and anvil when closed
    nose: 0.004, // rounded cartridge nose length
    curvedTipLength: 0.011,
    curvedTipAngle: 40 * deg,
    open: 22 * deg,
    /** Printed depth marks on both reload sides: every `pitch` from the hinge, long ticks every `longEvery`. */
    marks: { pitch: 0.005, longEvery: 2, width: 0.00035, short: 0.0012, long: 0.0024, lift: 0.00005 },
    /** Knife (rides the sled heel → tip while firing): thin steel blade between the staple rows. */
    knife: { thick: 0.0003, height: 0.0028, length: 0.003 },
    leader: { radius: 0.0016, tubularSegments: 24, radialSegments: 8 },
    /** Silicone leader centre-line, local to the anvil tip (+Z forward), a gentle preset curve. */
    leaderCurve: [
      [0, 0, 0],
      [0, 0.004, 0.02],
      [0, 0.014, 0.045],
      [0, 0.03, 0.065],
    ] as readonly (readonly [number, number, number])[],
  },
  /** Clip applier: slim tapered jaws with a groove each holding one leg of a loaded titanium clip (shown while loaded). */
  clip: {
    jawLength: 0.014,
    jawWidth: 0.0026,
    jawThick: 0.0012,
    groove: 0.0004, // groove depth along each jaw's inner face, where the clip leg sits
    open: 30 * deg,
    clipLength: 0.009,
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

/** T872 retrieval bag (step 8, ref 06:23): a pale translucent pouch hanging from a steel hoop in front of a shaft,
 *  brought in through the access incision; `play(t)` phases are fractions of t (0 → 1). Metres. */
export const retrievalBag = {
  shaft: { radius: 0.005, length: 0.3 }, // 10 mm introducer
  // T893a (critic r3): 22 mm hoop × 50 mm pouch shrank the lobe to a 2 cm ball (fitScale); lobe-sized now (06:23)
  hoop: { radius: 0.04, tube: 0.0008 }, // open mouth, in the plane through the shaft
  pouch: { depth: 0.09, rings: 10 }, // depth below the hoop (quarter-ellipse profile)
  segments: { round: 32, tube: 8, hoop: 48 }, // shaft / pouch around, hoop wire around, hoop along
  // T890 (critic r2 C7): opaque white pouch (06:20); at 0.8 it read as a clear ring. Silicone program, uniforms only.
  look: { color: '#f0ece8', opacity: 0.97, roughness: 0.45 },
  standoffM: 0.01, // the open pouch waits this far port-side of the lobe's centre
  /** Phase ends: shaft in + hoop opens · lobe in · mouth closes · bag out (to 1). */
  phase: { open: 0.25, lobeIn: 0.6, close: 0.72 },
  openFrom: 0.4, // the hoop starts opening at this share of the shaft's way in
  lobeDepth: 0.45, // the lobe's centre sits this share of the pouch depth below the hoop
  folded: 0.12, // head scale inside the shaft before it opens
  closed: 0.3, // mouth width share once cinched
  fit: 0.7, // lobe radius share of the hoop radius once inside
  outM: 0.04, // the bag ends this far outside the port (pleura)
} as const;

/** Rates for the control layer's animations (jaw open/close, cautery glow ramp), per second of 0..1 travel. */
export const instrumentAnim = {
  jawPerSecond: 4,
  glowPerSecond: 8,
  /** T841 stapler fire (fractions of config.staple.fireMs): compression pause, staples form heel → tip, knife. */
  staplerFire: { compress: 0.2, form: 0.65 },
  /** T841 jaws engaged on a structure (staple.ts jawPose / closedJawFor). */
  engage: {
    clearance: 1.2, // stapler: anvil gap at full opening ≥ this × the structure's diameter where it sits
    staplerSpan: [0.25, 0.8] as const, // … between these fractions of the jaw length from the hinge
    compress: 0.4, // closed jaws squeeze the structure to this × its diameter
    clampHold: 0.55, // clamp: the structure sits this far (× bent part) down from the tip …
    clampHoldR: 1.3, // … and at least this × its radius
    clipHold: 0.5, // clip: at this fraction of the clip leg from its tip
    clipGapM: 0.004, // the two clips sit ± half this from the cut
    divideDelayMs: 250, // after the second clip, the vessel divides between the clips
    fallbackRadiusM: 0.003, // structure radius without a stump split
    iterations: 3, // pose refinement (the shaft re-aims through the port after each tip move)
  },
} as const;
