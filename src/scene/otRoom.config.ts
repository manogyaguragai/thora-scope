// Static thoracic operating theatre around the patient (T813, src/scene/otRoom.ts). Metres in world axes (§7.1:
// +X head, +Y up = patient's right, +Z anterior); offsets are relative to the patient's skin bounds unless noted.
// Colours are sRGB hex; lighting is baked into vertex colours at load (no new lights, §6.10).
export const OT_ROOM = {
  room: {
    halfX: 4, // walls around the patient centre (orbit limits in config.camera keep the camera inside)
    halfZ: 3.8,
    height: 3.4, // floor → ceiling
    segments: 10, // wall/floor subdivisions (baked light gradient resolution)
    floor: '#4f5c61',
    wall: '#86aa9e', // theatre green
    ceiling: '#d3d9d7',
    /** Emissive laminar-flow ceiling panel above the table: [sizeX, sizeZ], colour, HDR multiplier. */
    panel: { size: [2.4, 1.6] as const, color: '#eef3ff', glow: 1.6 },
    /** Back (−Z) wall fittings: steel cabinet + backlit X-ray viewer: [sizeX, sizeY, sizeZ, offsetX, heightAboveFloor]. */
    cabinet: { box: [1.2, 1.9, 0.4, -1.4, 0] as const, color: '#8e989b' },
    viewer: { box: [1.0, 0.6, 0.04, 0.9, 1.3] as const, color: '#f4f8ff', glow: 1.4 },
  },
  table: {
    height: 0.95, // floor → mattress top
    sink: 0.012, // mattress top above the skin's lowest point (patient sinks into the gel pad)
    halfWidth: 0.27, // mattress half-width (Z) about the patient centre
    mattressT: 0.07,
    frameT: 0.05,
    headExt: 0.42, // table beyond the skin's head end (+X)
    footExt: 1.25, // table beyond the skin's lower end (−X)
    column: [0.28, 0.24] as const, // pedestal [X, Z]
    base: [0.95, 0.08, 0.55] as const, // floor base [X, Y, Z]
    mattress: '#23282e',
    steel: '#9ea6ab',
  },
  drape: {
    color: '#2b6a9c', // sterile blue
    thickness: 0.008, // lift over the body envelope / mattress
    hang: 0.42, // drop over the table edges
    /** Body envelope = superellipse over the skin cross-section: × [half-depth Z, height above mattress], exponent. */
    tent: [1.25, 1.0] as const,
    power: 3,
    overlapHead: 0.045, // drapes reach this far onto the model to hide its cut ends (camera port is ~6 cm from
    overlapFoot: 0.025, // the lower end, so that side stays short)
    /** [x offset beyond the end (m), envelope height scale, depth scale] stations, interpolated linearly. */
    headStations: [
      [-0.045, 1, 1],
      [0.04, 0.95, 0.95],
      [0.1, 0.62, 0.7],
      [0.3, 0.6, 0.72],
      [0.42, 0.12, 0.55],
    ] as const,
    footStations: [
      [-0.025, 1, 1],
      [0.2, 0.92, 0.95],
      [0.42, 0.95, 1.05], // hip (highest point in the lateral position)
      [0.75, 0.72, 0.95],
      [1.05, 0.5, 0.9],
      [1.25, 0.12, 0.7],
    ] as const,
    /** Side strips along the operative window cover the flanks up to this fraction of the envelope height. */
    windowFrac: 0.2,
    rowsPerM: 70, // sweep rows per metre along X
    topCols: 36,
    hangCols: 7,
    folds: { topAmp: 0.005, topWave: 0.21, hangAmp: 0.022, hangWave: 0.16 },
    /** Anaesthesia screen: drape on a bar across the neck, [gap beyond the head end, height above mattress]. */
    screen: { gap: 0.06, height: 0.5, overhang: 0.12, foldAmp: 0.025, foldWave: 0.14, cols: 28, rows: 14 },
  },
  lamps: {
    /** Heads: [dx, dz from patient centre, height above mattress, radius]. */
    heads: [
      [0.02, 0.12, 1.05, 0.3],
      [-0.62, -0.38, 1.2, 0.24],
    ] as const,
    mount: [-0.3, -0.55] as const, // ceiling mount [dx, dz]
    depth: 0.1,
    housing: '#a9b0b3',
    face: '#fff6e8',
    glow: 7, // HDR multiplier on the emissive face (bloom-free "lit" look after ACES)
    armRadius: 0.025,
  },
  anaesthesia: {
    /** Machine beyond the table head: [sizeX, sizeY, sizeZ], dz from the patient centre, gap after the table. */
    box: [0.55, 1.25, 0.62] as const,
    dz: -0.3,
    gap: 0.25,
    color: '#a7aeb2',
    panel: '#3b4248',
  },
  monitor: {
    size: [0.5, 0.36, 0.06] as const, // bezel [W, H, D]
    screen: [0.45, 0.3] as const,
    heightAboveMattress: 0.72, // monitor centre
    poleRadius: 0.02,
    bezel: '#2a2f34',
    canvas: [512, 340] as const, // vitals mirror canvas (px)
    background: '#04080a',
    trace: '#39d98a',
  },
  mayo: {
    /** Instrument (Mayo) tray on the anterior side: [dx from patient centre, dz beyond the table edge], tray, height. */
    at: [-0.85, 0.32] as const,
    tray: [0.5, 0.03, 0.36] as const,
    heightAboveMattress: 0.22,
  },
  /** Baked lighting: ambient + one key from the main lamp head (|n·l|, inverse-square-ish falloff). */
  bake: { ambient: 0.22, key: 0.45, falloffM: 1.7 }, // dim enough that auto-exposure keeps the patient bright
} as const;
