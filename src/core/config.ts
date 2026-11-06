// Central runtime config (CLAUDE.md: config, not magic numbers). Units: metres, ms, Hz.
// Hilum names come from the model manifest (src/content/anatomy.json via anatomy.ts), never literals here.
import { ANATOMY, structuresWhere } from '../content/anatomy';
import { FISSURE_SEGMENTS } from '../scene/fissureGuide.config';
const base = import.meta.env.BASE_URL;
// One step transition window: rig camera move, deflate/retract tweens and guided visibility fades stay in sync.
const STEP_TRANSITION_MS = 1500;

export const config = {
  modelUrl: `${base}models/thorax_sim.opt.glb`,
  decoderPath: `${base}decoders/`,
  renderer: {
    toneMappingExposure: 1, // read by the post pass's ACES; pixel-ratio cap + MSAA come from the quality preset
  },
  // Quality presets (§6.9 device check, §6.10). Default picked by core/quality.ts; `?quality=` overrides.
  quality: {
    presets: {
      low: {
        maxPixelRatio: 1,
        antialias: false,
        postFx: { distortion: true, chromaticAberration: false, grain: false, sceneScale: 0.5 },
        particleCap: 64, // per pool (smoke, blood, bubbles)
        textureDownscale: true,
      },
      medium: {
        maxPixelRatio: 1.25,
        antialias: true,
        postFx: { distortion: true, chromaticAberration: true, grain: true, sceneScale: 0.75 },
        particleCap: 256,
        textureDownscale: false,
      },
      high: {
        maxPixelRatio: 1.5, // §6.10: adaptive resolution never exceeds min(dpr, 1.5)
        antialias: true,
        postFx: { distortion: true, chromaticAberration: true, grain: true, sceneScale: 1 },
        particleCap: 512,
        textureDownscale: false,
      },
    },
    order: ['low', 'medium', 'high'], // lowest → highest; auto-downgrade walks down this list
    storageKey: 'thorascope.quality', // localStorage: { preset, locked } user override
    device: {
      lowMaxCores: 2, // ≤ this many logical cores → low
      lowMaxMemoryGB: 2, // navigator.deviceMemory ≤ this → low
      highMinCores: 4, // discrete GPU still drops to medium below these
      highMinMemoryGB: 4,
    },
  },
  // Outside (orbit) camera.
  camera: {
    fovDeg: 45,
    near: 0.001, // §7.5: ≤ 1 mm
    far: 8, // T813: the OT room walls are up to ~6 m from the orbit camera
    orbitMinDistance: 0.12, // OrbitControls limits around the thorax centre (m)
    // T813: target radius + max distance stays inside the OT room walls/ceiling (src/scene/otRoom.config.ts) …
    orbitMaxDistance: 3,
    orbitMaxTargetRadius: 0.3, // pan limit around the thorax centre (m)
    orbitMinPolarRad: 0.9, // … and the polar range keeps it below the ceiling and above the floor
    orbitMaxPolarRad: 1.75,
    // T843: the orbit camera never enters the body: it stays this far outside the last crossing of these layers
    // on the line from the orbit target (deeper layers cover the skin's operative window and port holes).
    orbitGuard: {
      meshes: ['skin', 'subcutaneous_fat', 'chest_wall_muscle', 'parietal_pleura_wall'] as readonly string[],
      marginM: 0.03,
    },
  },
  // Scope view through the glTF step cameras (§7.5) + scope ⇄ outside transitions.
  scope: {
    near: 0.001, // ≤ 1 mm
    far: 0.6, // tightened vs. the glTF 1 m: the right hemithorax spans < 0.4 m from any step camera
    transitionMs: STEP_TRANSITION_MS, // eased pose transition (also scope ⇄ outside); 0 with prefers-reduced-motion
    // Step-camera re-aims (world m, lookAt with world-up), e.g. { camera, position, target }. Other steps with
    // `aimAtHilum` (procedure_steps.json: 2–6) are aimed from their port by portAim below.
    // T844 step 9 (leak test, v8): lens 11 mm in from the camera-port pleura (−0.163, 0.0842, 0.0136) toward the
    // bronchial stump, y ≈ 0.080 = ≥ 5 mm above the capped water top (waterConfig.maxTopY), looking down over the hilum.
    // T846b v8: the collapsed middle lobe covers the hilum on the portAim axis of steps 2–4 and 6 (retract_hilum
    // leaves it in place). Lenses re-picked by a sweep from the step port (port_utility_5ICS, shaft clear, optic
    // ≤ 55°) for the most STEP_FOCUS pixels; target = a focus structure's centroid. They override portAim (cameras.ts).
    poseFix: [
      { camera: 'cam_7_reinflation', position: [-0.1528, 0.0803, 0.0127], target: [-0.0285, 0.0326, 0.0013] },
      {
        camera: 'cam_2_anterior_hilum',
        position: [-0.0376, 0.0548, 0.0574],
        target: [-0.0181, 0.0213, 0.0172],
      },
      {
        camera: 'cam_3_RML_vein_zoom',
        position: [-0.0759, 0.0449, 0.0437],
        target: [-0.0448, 0.0528, 0.0154],
      },
      {
        camera: 'cam_4_bronchus_nodes',
        position: [-0.0686, 0.0279, 0.0198],
        target: [-0.0368, 0.029, -0.0134],
      },
      {
        camera: 'cam_5_RML_arteries',
        position: [-0.0707, 0.069, 0.0215],
        target: [-0.0353, 0.0375, -0.0036],
      },
    ] as readonly { camera: string; position: readonly number[]; target: readonly number[] }[],
    // T830 port-aimed step views (steps with `aimAtHilum`): the reference camera's (anatomy.json referenceCameras[0])
    // view axis is raycast into the hilum, in the step's morph pose, against these manifest structures; the scope
    // then aims from the step's port at that point (ScopeRig.aimPose) with the reference camera's image up.
    portAim: {
      reference: ANATOMY.referenceCameras[0] ?? '',
      /** Ray targets: the hilum proper (not the lobes, not the soft-tissue sheets that cover it). */
      targets: structuresWhere((s) => s.group !== 'lungs' && !s.dissectable && !s.hidden),
      fallbackM: 0.12, // no hit: target this far along the reference view axis
      /** Per step: target moved fraction `k` toward the AABB centre (in the step's pose) of the structures the
       *  manifest divides / clears in step `of`, so V4/V5, 11R/12R, B4/B5 and A4/A5 are framed in turn while the
       *  hilar framing is kept. T844. */
      toward: {
        3: { k: 0.5, of: 3 },
        4: { k: 0.6, of: 4 },
        5: { k: 0.6, of: 5 },
        6: { k: 1, of: 6 },
      } as Readonly<Record<number, { k: number; of: number }>>,
      // Lens further in than a port switch (scopeRig.aimDepthFrac / depthM.default): the hilum fills the view
      // instead of the chest wall beside the access incision.
      depthFrac: 0.6,
      maxDepthM: 0.08,
    },
    // Far-field meshes no step camera can see (behind the mediastinum or outside the parietal pleura):
    // hidden in scope view only, to cut draw calls (§6.10 per-step visibility set). Outside view shows them.
    hidden: [
      'lung_upper_lobe_left',
      'lung_lower_lobe_left',
      'arteries_left_intrapulm',
      'skin',
      'subcutaneous_fat',
      'chest_wall_muscle',
      'intercostal_muscles', // behind the now-opaque pleura; only its poke-through showed (crimson blotches, T111)
      'scapula_left',
      'scapula_right',
      'clavicula_left',
      'clavicula_right',
      // T702: drawn in every step but no ray of a 120×72 grid hit them in any step view (behind pleura/mediastinum)
      'spine',
      'sternum',
      ...Array.from({ length: 12 }, (_, i) => `rib_L${i + 1}`),
      // T807c: the right ribs float bare in front of the dark cavity (steps 1/6); the opaque pleura is the chest wall
      ...Array.from({ length: 12 }, (_, i) => `rib_R${i + 1}`),
      'costal_cartilages', // pokes through the pleura (step 3 streaky band) and floats like the ribs (steps 1/6)
    ],
    // T807: per-step scope-only occluders: in front of the step's STEP_FOCUS targets (pick-ray grid from the step
    // pose, tests/e2e/closeup.spec.ts) and not used by that step's actions. Outside view still shows them.
    stepHidden: {
      2: ['heart_rest', 'inferior_vena_cava'], // bulge through the pericardium over the SPV
    } as Readonly<Record<number, readonly string[]>>,
  },
  steps: {
    defaultStep: 1, // ?view=scope without ?step=
    stateMs: STEP_TRANSITION_MS, // deflate/retract tween when a step is applied
  },
  // Guided controller (§6.1 item 1): visibility fades through the pre-compiled transparent variants.
  guided: {
    transitionMs: STEP_TRANSITION_MS, // fade window
    fadeSlots: 32, // max meshes fading per transition (step 7 swaps ~20); overflow switches instantly
    fadeCeil: 0.99, // fade < 1 keeps the transparent variant (fade 1 swaps back to opaque)
  },
  pick: {
    hoverHz: 30, // §6.10: hover picking ≤ 30 Hz
    excludePrefixes: ['port_'] as readonly string[], // node-name prefixes never picked (port markers)
    // T843: never hover / click-labelled (still solid for scope collision): the kept v3 CT fat sits over the
    // inferior lung surface and stole its labels.
    skipNames: ['mediastinal_fat_ct'] as readonly string[],
    clickSlopPx: 4, // pointer travel below this between down and up counts as a click (pick), not a drag
  },
  // Fulcrum thoracoscope rig (§6.2, src/sim/scopeRig.ts) + its input mapping.
  scopeRig: {
    defaultPort: 'port_camera_8ICS',
    depthM: { min: 0.01, max: 0.16, default: 0.05 }, // step cameras sit 4–13 cm past the pleura
    coneDeg: 100, // shaft vs. port axis; the authored cam_6 is ~95° off its port axis (asset limitation, §7.6)
    // T843: user pivots can't tilt the shaft further than this off the port axis (it would leave the chest through
    // the wall); a pose already beyond it (authored cam_6) may still pivot back in.
    pivotConeDeg: 80,
    // T843: the lens stays this far short of the first surface along the shaft (BVH ray from the port's pleura
    // point; hits closer than nearM to it are the pierced chest wall itself). Insert clamps; pivots slide back.
    // T847a: 5 mm filled the 55° view with one flat patch of the surface ahead (read as "inside the organ"); 15 mm
    // keeps context. The lens also keeps clearM (> the 1 mm near plane's half-diagonal) from any surface beside the
    // shaft (the 30° optic looks sideways): backs off along the shaft in clearStepM steps.
    collision: { marginM: 0.015, nearM: 0.003, clearM: 0.002, clearStepM: 0.004 },
    dragRadPerPx: 0.003, // shaft-tip swing per pointer pixel
    opticDefaultDeg: 30,
    opticMaxDeg: 70,
    fovDeg: 55, // vertical; snapTo adopts the step camera's fov
    zoom: { min: 1, max: 3 }, // digital zoom = fov divisor
    degenerateDot: 0.999, // |cos| above which two directions count as parallel
    wheelMetersPerPx: 0.0001, // insert/withdraw per wheel deltaY pixel (one notch ≈ 100 px ≈ 1 cm)
    opticStepDeg: 15, // light-post rotation per Z/X press
    zoomStep: 1.15, // zoom factor per +/− press
    aimDepthFrac: 0.5, // port switch: lens at most this fraction of the fulcrum→focus distance in (T808)
    arrowRadPerS: 0.5, // T816: shaft swing rate while an arrow key is held (screen-space pivot about the port)
    arrowMaxDtMs: 100, // T816: longest frame step applied to a held arrow (no jump after a stall / hidden tab)
    levelOnStepSnap: true, // T816: step / V snaps keep the authored view direction but level it (H restores the roll)
  },
  // Viewing aids (§6.5): layers panel + 3D labels.
  viewing: {
    opacityStep: 0.05,
    cutawayStepM: 0.001, // cut-away slider resolution (m)
    labelHz: 15, // 3D label position updates per second (max)
    labelMaxCount: 12, // toggle-all name tags shown at once: step focus first, then nearest the view centre
    labelGapPx: 2, // declutter: min gap between tags
    labelNudges: 1, // declutter: rows tried above/below an overlapping tag before it is skipped
    compassHz: 10, // T816: orientation compass DOM updates per second (max)
    // T843: patient axes in glTF world space (left lateral decubitus, right side up): +X cranial, +Z anterior
    // (+Y = patient right, up). Checked against the heart / spine / lobe centroids in tests/unit/compass.test.ts.
    compassAxes: { head: [1, 0, 0], anterior: [0, 0, 1] } as const,
    labelAvoid: '.shell-top, .guided-caption, .scope-compass', // T806: tags never land under these (rects measured on resize/toggle)
    labelAvoidMax: 4, // at most this many labelAvoid rects
    focusLabelModes: ['guided'] as readonly string[], // T807: L shows only the step-focus structures' tags here
  },
  perf: {
    sampleHz: 4, // window.__perf refresh rate
    ringSize: 120, // frame-time samples kept for fps / p95
    p95: 0.95,
    overlayHz: 4, // `?perf` overlay DOM writes per second
    probeSettleFrames: 3, // perf:probe script: frames rendered per settle (plus ≥ one sample period)
    probeOpacity: 0.5, // perf:probe script: layer opacity for the variant-swap phase
    probeDragPx: 80, // perf:probe script: scope-rig phase pivot (px, both axes)
    probeHoldMs: 1200, // perf:probe script: cautery hold (smoke + lens fog) in the M4 phase
    probeAimM: 0.045, // probe / e2e placeTool: lens this far short of the placed tip, scope aimed at it …
    probeAimDeg: 25, // … viewing at least this far off the tool shaft (tip seen from the side, not end-on)
    // T806: when that view is blocked (lens inside / behind tissue), search for a clear line of sight to the tip:
    probeAimDistsM: [0.045, 0.035, 0.06, 0.025] as readonly number[], // lens distances tried, in order
    probeAimDegs: [25, 40, 55, 70] as readonly number[], // angles off the shaft tried
    probeAimAzimuths: 12, // directions around the shaft per angle (from the scope port's side outward)
    probeAimClearM: 0.004, // a hit closer than this to the tip counts as the tip itself
    probeReachTries: 48, // placeTool: surface vertices tested for a straight, clear path from the tool's port …
    probeReachTopFrac: 0.5, // … spread over this port-facing fraction of the vertices (ranked by angle to the axis)
    // Adaptive resolution + preset auto-downgrade (§6.10). Units: ms, fps, pixel ratio.
    adaptive: {
      minRatio: 0.6, // §6.10 floor
      maxRatio: 1.5, // §6.10 ceiling; the preset's maxPixelRatio and devicePixelRatio cap it further
      step: 0.1, // pixel-ratio change per adjustment
      precision: 100, // ratios rounded to 1/precision (no float drift from repeated ± step)
      windowMs: 500, // frame times are judged per window of this much frame time
      windowCapacity: 256, // max frames per window (evaluated early when full); fixed ring, no allocations
      percentile: 0.9, // p90 frame time per window drives step down/up
      downBelowFps: 45, // window p90 slower than this → slow (§6.10 sustained budget)
      upAboveFps: 57, // window p90 faster than this → headroom (near vsync at 60 Hz; gap = hysteresis band)
      downHoldMs: 1000, // slow this long → step down
      upHoldMs: 4000, // headroom this long → step up (probe)
      upHoldMaxMs: 32000, // a probe that fails doubles upHoldMs up to this (stops up/down flicker)
      probeFailMs: 3000, // a step down within this long after a step up counts as a failed probe
      cooldownMs: 1000, // after any change, ignore windows this long (new size settles)
      downgradeFps: 40, // §6.10: mean fps below this …
      downgradeHoldMs: 3000, // … for this long at minRatio → request the next lower preset
      gapMs: 1000, // frame times above this are tab-switch / breakpoint gaps, ignored
    },
  },
  // Outside-view framing (lights live in src/scene/lights.ts).
  viewer: {
    // T813: walking into theatre: table, drapes, lamps and the anaesthesia monitor in frame (zoom in to explore).
    distance: 2.7, // orbit camera → thorax centre (m)
    viewDir: [-0.35, 0.75, 1] as const, // from anterior, above (patient's right, +Y), slightly from the foot end
  },
  debug: {
    axesSize: 0.1,
  },
  // Clipping (§6.4 staple-divide, §6.5 cut-away). Plane count per realism material is fixed at load (§6.10).
  clipping: {
    divisionPlanes: 2, // local division planes per mesh (proximal/distal cut), after the shared cut-away plane
    parkConstant: 1e4, // parked plane: n·p + c > 0 for every point in the scene (m) → clips nothing
  },
  // Single combined post-FX pass (§6.10, §8 Optics, ADR-003). Values tuned against docs/REFERENCE_FRAMES.md "Optics".
  postfx: {
    msaaSamples: 4, // HDR scene target samples when the preset has antialias
    // HDR scene target size vs. the drawing buffer = the preset's postFx.sceneScale (T806: medium 0.5 → 0.75).
    // Cheap edge AA in the combined pass (FXAA-style: 4 luma taps → 2 taps along the edge), all presets, both views.
    edgeAA: {
      amount: 1, // blend toward the along-edge average at full contrast
      threshold: 0.03, // local luma range (tone-compressed) below this = not an edge
      relThreshold: 0.15, // … or below this fraction of the local max
      spanTexels: 1.0, // along-edge tap distance, scene texels
    },
    // Wet-glint shoulder (T806): HDR min channel (after exposure, before ACES) in [lo, hi] fades toward white. White
    // speculars lift all channels, saturated pink diffuse doesn't, so peaks read as the frames' small white glints
    // without lifting the mids (step 1/3/5 near-white 0.13/0.86/0.24 % → 0.14/2.0/0.78 %; refs 0.1–3.4 %).
    glint: { lo: 0.5, hi: 1.5, amount: 0.9 },
    exposure: 1, // base exposure (× auto-exposure)
    barrelK1: 0.15, // frames: k1 ≈ 0.12–0.18
    barrelK2: 0.03,
    maskAspect: 1.25, // 5:4 scope image (ADR-003)
    maskFill: 1, // mask height as a fraction of the letterboxed fit
    maskCornerRadius: 0.035, // fraction of mask height
    maskFeather: 0.01, // soft edge width, fraction of mask height
    vignette: 0.18, // ≤ 0.2; the headlight falloff does the rest
    vignetteStart: 0.6, // normalised rect radius (corner = √2) where darkening begins
    chromaticAberration: 0.006, // uv offset at the rim (× r²); frames show next to none
    grain: 0.012, // near-zero; frames are soft, not noisy
    grainPeriodS: 60, // grain time seed wraps to keep float precision
    fogColor: [1, 0.86, 0.84] as const, // milky orange-pink veil (06:46)
    // Warm red-magenta grade (frames: mean sRGB ≈ 184/117/125, high saturation, maroon shadows).
    lift: [0.01, 0, 0.012] as const, // T111: maroon-violet shadows; T807c: halved (steel shafts read maroon)
    gamma: [1.0, 0.91, 0.96] as const, // T806: less green → the frames' saturated red-magenta
    gain: [1.0, 0.96, 1.02] as const,
    saturation: 1.1, // frames' mean HSV S ≈ 0.39–0.48 in the 5:4 crop (T806: 0.9 read pastel)
    autoExposure: {
      hz: 4, // meter renders + async read-backs per second
      size: 16, // meter target is size × size
      key: 0.22, // target log-average luminance after exposure (T801: 0.22 → step 1 mean 178/123/133, R≥250 0.01 %)
      minLog2: -12, // packed log2-luminance range of the RGBA8 meter
      maxLog2: 4,
      min: 0.25, // auto-exposure clamp
      max: 4,
      adaptMs: 400, // easing time constant
    },
  },
  // Reflection environment (T806, src/scene/lights.ts): a warm cavity built once at load via PMREM instead of the
  // neutral RoomEnvironment (its white boxes mirrored as grey/silver bands on steel and wet tissue).
  cavityEnv: {
    surround: '#5d2f3d', // REFERENCE_FRAMES "Dark cavity background" (01:25)
    surroundIntensity: 3,
    spot: '#fff4ea', // warm lamp patch toward the ports (+Y = patient's right, up; §7.1), seen in steel
    spotIntensity: 36, // T810: sharper steel glints (was 12)
    spotRadius: 0.12, // T810 (was 0.3): sphere radius at distance 1
    spotDir: [0, 1, 0.35] as const,
  },
  // Physiology + morph controller (§6.1 Physiology lab, §7.3). HR/RR defaults come from procedure_steps.json.
  physiology: {
    olvMs: 5000, // startOLV: all lobes deflate → 1
    clampMs: 4000, // clamp RML bronchus: RUL, RLL re-inflate → 0
    releaseMs: 4000, // release clamp: RML re-inflates → 0 (only if not divided)
    // T843 topbar ventilation switch (guided / practice / explore): two-lung re-inflates every undivided right lobe
    // over reinflateMs; the switch reads "Two-lung" while RUL and RLL head below twoLungBelow (collapse).
    ventilation: { reinflateMs: 4000, twoLungBelow: 0.5 },
    refHrBpm: 75,
    systoleMsAtRef: 300, // systole ≈ 0.3 s at 75 bpm; fraction of cycle kept constant as HR changes
    inspFraction: 0.4, // inspiration share of the breath cycle
    rightLobeBreathAmp: 0.08, // ventilated right lobe collapse offset at end-expiration
    rightLobeBreathMaxDeflate: 0.2, // offset fades to 0 as deflate → this value; collapsed lobes don't breathe
    morphEpsilon: 1e-4, // influence written only when |new − old| exceeds this
    // Physiology lab panel inputs.
    limits: {
      hr: { min: 40, max: 180 }, // bpm
      rr: { min: 6, max: 30 }, // breaths/min
      syncMs: 250, // slider sync ≤ 4 Hz (§6.7)
      sliderStep: 0.01,
    },
  },
  // Loading screen (§6.9).
  loading: {
    irisMs: 600, // lens iris-open on ready
    tipMs: 5000, // tip rotation period
    tipFadeMs: 200, // tip cross-fade (motion token range 150–250 ms)
    holdFraction: 0.4, // ?holdload freezes the download stage here
    // Five weighted stages (sum 1) in order; the ring shows the weighted total.
    stages: {
      download: { label: 'Downloading model', weight: 0.6 },
      decode: { label: 'Decoding', weight: 0.1 },
      upload: { label: 'Uploading textures', weight: 0.1 },
      compile: { label: 'Compiling shaders', weight: 0.15 },
      warmup: { label: 'Warming up', weight: 0.05 },
    },
    uploadYieldEvery: 4, // textures uploaded between event-loop yields (lets the ring repaint)
    // Warm-up frames per camera: rendered the runtime way (scene → post-FX target, post pass → the canvas), hidden
    // behind the opaque loading screen, not to a separate offscreen target (ADR-008).
    warmupFrames: 2,
  },
  // ── M4 instruments & surgical actions (§6.4). Placeholders pending visual tuning / clinician review. ──
  // Instrument control (src/sim/instrumentControl.ts).
  instrumentControl: {
    snapRadiusM: 0.02, // clicked point → nearest valid action point
    snapDurationMs: 700,
    withdrawDurationMs: 450,
    depthM: { min: 0.04, max: 0.22 }, // tip past the pleura; parked tip sits at min ("just inside")
    coneDeg: 75, // shaft vs. port axis (intercostal space limits the pivot)
    steerRadPerPx: 0.003, // shaft swing per pointer pixel
    jawPerS: 8, // jaw close/open rate, fraction per second
    wheelMetersPerPx: 0.0001, // insert/withdraw per wheel deltaY pixel
  },
  // Port occupancy + stapler approach angle (src/sim/portOccupancy.ts, ADR-004).
  ports: {
    /** Max deviation (deg) of the stapler shaft (pleura → target) from perpendicular to the target axis. With the
     *  asset's geometry 45° lets the vein/artery staplers through the camera port but not the access incision
     *  (≈84°/77°), which is what forces the video's retraction swap. Pending clinician review. */
    maxApproachDeg: 45,
    /** VIDEO_STEP_MAP (b): access incision carries up to 3 instruments, 1 cm ports one. */
    capacity: { port_camera_8ICS: 1, port_utility_5ICS: 3, port_retraction_8ICS: 1 } as Readonly<
      Record<string, number>
    >,
    defaultCapacity: 1,
    toolDefault: 'port_utility_5ICS', // a newly selected tool waits here (access incision) until it snaps
  },
  // Effect pools (src/scene/effects.ts). Pool capacity = round(preset.particleCap × capScale), at least 1.
  effects: {
    spriteSize: 32, // px, soft radial sprite shared by all point pools
    smoke: {
      capScale: 1,
      color: [0.86, 0.86, 0.84] as const,
      size: 0.012, // m, point size (size-attenuated); T410: 0.008 read too thin
      opacity: 0.5, // T817: 0.35 was faint against pink tissue
      lifeSec: 1.6,
      riseSpeed: 0.012, // m/s along +Y (gravity is −Y, §7.1)
      jitter: 0.004, // m/s random lateral/vertical velocity
      perPuff: 8, // wisps per cautery emit() call
    },
    ooze: {
      capScale: 0.5,
      color: [0.32, 0.02, 0.03] as const,
      size: 0.003,
      opacity: 0.9,
      lifeSec: 2.5,
      fallSpeed: 0.006, // m/s along −Y
      jitter: 0.0015,
      ratePerSec: 8, // particles per second per active bleed
    },
    bubbles: {
      capScale: 0.5,
      color: [0.9, 0.95, 1] as const,
      size: 0.0025,
      opacity: 0.6,
      lifeSec: 1.2,
      riseSpeed: 0.02,
      jitter: 0.003,
      perBurst: 10,
    },
    decal: {
      capScale: 1 / 8, // low 8, medium 32, high 64 (one instanced draw)
      color: 0xe8402c, // T810: tonemaps to ≈#8b0010; fresh blood red (ref 01:25 / 02:44); T807c: 0x9a1410 read as a dark blob
      roughness: 0.08, // glossy fresh blood
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      segments: 20,
      maxRadius: 0.03, // m
      radiusPerCameraM: 0.12, // T807c: final radius ≤ this × camera distance (≈ 1/6 of the view height at 70°)
      growSec: 4, // time to reach maxRadius
      normalOffset: 0.0004, // m, lift off the surface
      normalPickTolM: 0.01, // T806: bleed point re-picked from the camera; a hit this close lends its surface normal
    },
  },
  // Encircle + staple-divide logic (src/sim/actions/staple.ts).
  staple: {
    /** Fire sequence (ms): jaws close across the target → fire (staples + knife) → jaws open. */
    closeMs: 400,
    fireMs: 900,
    openMs: 400,
    /** Tissue each cartridge (stapler sub-option, SUB_IDS order) is loaded for. Pending clinician review. */
    cartridgeTissue: {
      'vascular-curved': 'vessel',
      'vascular-leader': 'vessel',
      bronchial: 'airway',
      parenchyma: 'parenchyma',
    } as Readonly<Record<string, string>>,
    /** Stump side = toward this point (the carina, CONTEXT §7.1 origin).
     *  ponytail: one hilar reference for every target; per-target proximal points if a cut keeps the wrong side. */
    proximalRef: [0, 0, 0] as const,
    /** 'clip' = division clipping planes; 'hide' = hide the divided meshes + cap (procedure_steps.json fallback). */
    mode: 'clip' as 'clip' | 'hide',
    /** Targets whose clipping looks wrong on the asset → hide + cap even in 'clip' mode. */
    hideAndCap: [] as readonly string[],
  },
  // Staple-line caps + clips (src/scene/staples.ts).
  staples: {
    rows: 3, // staple rows per cap (§6.4: 2–3)
    perRow: 8, // pitch = line width / perRow
    rowGap: 0.0009, // row spacing along the stump axis, first row this far beyond the cut (m)
    lineWidth: 0.012, // default staple-line width without a measured diameter (m)
    crown: 0.0028, // staple crown length along the line (m)
    wire: 0.0005, // wire thickness (m)
    maxLines: 12, // caps alive (vein, bronchus, artery, fissure fires + branches)
    maxClips: 8,
    cutGap: 0.0015, // gap between the cut plane and the kept tissue (m)
    look: { color: '#d4d7dc', roughness: 0.18, metalness: 1 }, // titanium (sRGB hex)
  },
  // Finish phase (src/sim/actions/finish.ts, PA14–PA32).
  finish: {
    testVentilationMs: 4000, // PA18: RUL/RLL inflated during the bronchus test, then collapse again
    inflateMs: 4000, // tween duration for test inflation and final re-inflation
    recollapseMs: 2000, // after the test the right lobes go back down (OLV resumes)
    waterTestCmH2O: 20, // video: stump check at ~20 cmH2O (VIDEO_STEP_MAP decision 13)
    fissureFiresRequired: FISSURE_SEGMENTS, // T851: one fire per fissure-guide segment (fissureGuide.config.ts)
    minFissureRetract: 0.9, // retract_fissure needed to fire on / flip the lobe
    irrigationLevel: 1, // fluid level (0–1) after irrigation
    accessPort: 'port_utility_5ICS', // bag + LN removal (access incision)
    chestTubePort: 'port_camera_8ICS',
    requiredNodes: structuresWhere((s) => s.clearStep !== undefined),
    optionalNodes: ['LN_4R', 'LN_7'], // end of case, after extraction
    lobe: structuresWhere((s) => s.removedAfterStep !== undefined)[0] ?? '',
    stump: structuresWhere((s) => s.group === 'airway' && s.danger === 'major')[0] ?? '', // parent airway tree
    // Non-empty by the manifest contract (verify-assets checks every structure is in the glb).
    bronchus: structuresWhere((s) => s.group === 'airway' && s.divideStep !== undefined) as [
      string,
      ...string[],
    ],
  },
  // Gloved hands + PiP inset (src/scene/hands.ts, src/ui/pip.ts).
  hands: {
    /** T819: the procedural gloves read as unrealistic, so they are never drawn (scope, outside or PiP); the
     *  instrument handles and the scope body carry the outside view. Gloves still follow their targets. */
    showGloves: false as boolean,
    glove: 'nitrile' as 'latex' | 'nitrile', // selected at load; setGlove() swaps colour uniforms only
    gloves: {
      latex: { color: '#e8d6b4', sheenColor: '#fff4e0' }, // cream latex
      nitrile: { color: '#86a6d8', sheenColor: '#cfe2ff' }, // blue nitrile
    },
    look: {
      roughness: 0.55,
      metalness: 0,
      sheen: 0.35,
      sheenRoughness: 0.4,
      clearcoat: 0.15,
      clearcoatRoughness: 0.5,
    },
    segments: { radial: 8, cap: 3 },
    /** Shared hand proportions, metres. */
    hand: {
      palm: { thick: 0.021, length: 0.09, width: 0.085, drop: 0.3 }, // drop = palm centre below the handle, × length
      finger: {
        radius: 0.0072,
        spacing: 0.021,
        startDeg: 35,
        phalanges: 3,
        lengths: [1, 0.95, 0.85, 0.7],
        radii: [1, 1, 0.95, 0.85],
      }, // index → little, × curl / × radius
      thumb: { radius: 0.0105, startDeg: -20, curlDeg: -110, phalanges: 2, z: 0.04 },
      cuff: { radius: 0.03, flatten: 0.75, length: 0.11 },
    },
    /** Per grip: handle radius (fingers wrap at radius + finger radius) and total finger curl. */
    grips: {
      scope: { handleRadius: 0.017, curlDeg: 200 }, // camera head
      tool: { handleRadius: 0.012, curlDeg: 220 }, // instrument handle
    },
    /** Thoracoscope body under the scope hand (outside view / PiP only): 10 mm shaft from the lens out to the camera
     *  head, which sits in the scope grip (hands.scope.position). Lens frame: origin, +Z into the chest. */
    scopeBody: {
      shaftRadius: 0.005,
      headRadius: 0.016, // inside the scope grip's handle radius
      headLength: 0.08,
      look: { color: '#2b2c30', roughness: 0.35, metalness: 0.6 },
    },
    /** Hands in target-local space (tip at origin, +Z toward the tip): grip centre, roll/tilt, mirror = left hand. */
    hands: {
      scope: { grip: 'scope', mirror: true, position: [0, 0, -0.36], rotDeg: [0, 0, 90] },
      tool: { grip: 'tool', mirror: false, position: [0, 0, -0.35], rotDeg: [0, 0, -90] },
    },
    /** PiP "surgeon's view" inset (src/ui/pip.ts). */
    pip: {
      width: 256, // render-target pixels (low-res)
      height: 160,
      cssWidth: 240, // on-screen inset width, CSS px (height follows the target aspect)
      marginPx: 16, // from the bottom-right corner
      everyNthFrame: 2, // 2–3 per §6.4
      camera: { fovDeg: 50, near: 0.01, far: 5 },
      backM: 0.55, // surgeon's eye: this far out from the ports' mean skin point, against the mean port axis
      upM: 0.25, // … and this far up (+Y)
    },
  },
  // Grasp & retract (src/sim/actions/retract.ts, §7.3).
  retract: {
    dragPerPx: 1 / 250, // morph influence per pixel of drag (direction blend: src/sim/actions/retract.ts)
    minDeflate: 0.9, // §7.3: retraction morphs were authored on the collapsed lung; all right lobes must be ≥ this
    springBack: false as boolean, // default; the Retract constructor can override (optional spring-back, §6.4)
    springPerSec: 1.5, // influence per second back to the pre-grasp value on release (spring-back on, not held)
    pull: {
      perPx: 0.00004, // m of offset per px of drag
      max: 0.006, // m, cap on the offset length
      radius: 0.02, // m, falloff radius around the grasp point
      relaxPerSec: 6, // exponential decay rate after release
      epsilon: 0.00001, // m, below this the offset snaps to 0 (shader skips the branch)
    },
  },
  // Dissection progress (src/sim/actions/dissect.ts).
  dissect: {
    /** Progress per second of hold. Pending clinician review (video: ~10–15 s of sweeping per window). */
    ratePerSec: { peanut: 0.25, cautery: 0.4 } as Readonly<Record<'peanut' | 'cautery', number>>,
    fadeTo: 0.35, // fade multiplier reached just before the window swap
    /** Target → pre-built window variant (CONTEXT §7.2). The v7+ model has none: its soft tissue
     *  (anatomy.json `dissectable`) opens locally under cautery instead. */
    windows: {} as Readonly<Record<string, string>>,
    windowSuffix: '_window',
  },
  // M4 wiring (src/app/wireM4.ts).
  actions: {
    toastMs: 2600, // reason / result toast on screen
    pendingTweens: 8, // delayed state tweens in flight (bronchus-test re-collapse); fixed pool
    headRollStepDeg: 15, // camera-head roll per , / . press
    maxDtMs: 100, // frame-time cap for action updates (a stalled frame must not jump a tween / fire)
  },
  // M5 practice engine (src/sim/practice.ts) + wiring (src/app/wireM5.ts).
  practice: {
    hintMaxChars: 72, // hint = table note, cut at a word boundary beyond this length
    maxHints: 3, // next available actions listed per hint request
    maxLogEvents: 1000, // event log cap (oldest dropped)
    resultTweenMs: STEP_TRANSITION_MS, // accepted action → its table `result.state` tween
    debriefDelayMs: 1500, // case complete → debrief (the last effect stays visible briefly)
    pressureRadiusM: 0.06, // sponge-stick tip within this of the bleed counts as pressure on it
    // Grade gain (uGain) at full view reddening; 1 = none. B below G keeps pink tissue from reading magenta. No new program.
    reddenR: 1.08,
    reddenG: 0.62,
    reddenB: 0.38,
  },
  // Practice scoring (src/sim/scoring.ts). All weights / limits pending clinician review.
  scoring: {
    /** Component weights (sum 100). */
    weights: {
      order: 35,
      errors: 10,
      complications: 15,
      time: 10,
      bronchusTest: 10,
      veinPreserved: 10,
      portAngle: 5,
      swaps: 5,
    },
    /** Full time marks up to `targetSec`, falling linearly to 0 at `maxSec`. */
    targetSec: 900,
    maxSec: 3600,
    /** Score lost per error (non-port errors) / per wrong-port or poor-angle attempt. */
    perError: 0.1,
    perPortError: 0.25,
    /** Score lost per complication, by severity. */
    severityPenalty: { minor: 0.25, major: 0.6 },
    /** Complications on the same structure within this many seconds are one injury (highest severity counts). */
    dedupeWindowSec: 1,
    /** Retraction swaps the reference sequence needs (tests/unit/practice.test.ts SCRIPT); extra ones cost `perSwap`. */
    expectedSwaps: 1, // v7 reference run: one swap (T832)
    perSwap: 0.25,
    /** Upper-lobe venous drainage lives in this node (src/content/targets.ts DANGER_STRUCTURES note). */
    upperLobeVein: structuresWhere((s) => s.group === 'veins' && s.danger === 'major')[0] ?? '',
  },
  // Complications (src/sim/complications.ts). Clinical thresholds / rates are placeholders, pending clinician review.
  complications: {
    /** Fixed episode pool; a further bleed reuses the oldest slot. */
    maxBleeds: 4,
    /** Pooled-blood growth per second per active bleed (pool is 0..1 = fully obscured view). */
    oozeRate: { major: 0.08, minor: 0.025 },
    /** Pool removed per second while the sucker is on. */
    suctionRate: 0.2,
    /** Sponge-stick pressure must be held continuously this long to stop an episode's ooze. */
    pressureSec: { major: 4, minor: 2 },
    /** Pressure only counts once the sucker has cleared the pool to at most this (you must see the bleed). */
    pressureMaxPool: 0.3,
    /** View reddening uniform = pool × this, clamped 0..1. */
    reddenGain: 1,
    /** retract_* value above which pulling while an artery is encircled tears it (minor bleed). */
    overTractionRetract: 0.75,
    /** Log cap (oldest dropped), as practice.maxLogEvents. */
    maxLogEvents: 1000,
  },
} as const;
