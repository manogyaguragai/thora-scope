// Central runtime config (CLAUDE.md: config, not magic numbers). Units: metres, ms, Hz.
const base = import.meta.env.BASE_URL;

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
        postFx: { distortion: true, chromaticAberration: false, grain: false, halfRes: true },
        particleCap: 64, // per pool (smoke, blood, bubbles)
        textureDownscale: true,
      },
      medium: {
        maxPixelRatio: 1.25,
        antialias: true,
        postFx: { distortion: true, chromaticAberration: true, grain: true, halfRes: true },
        particleCap: 256,
        textureDownscale: false,
      },
      high: {
        maxPixelRatio: 1.5, // §6.10: adaptive resolution never exceeds min(dpr, 1.5)
        antialias: true,
        postFx: { distortion: true, chromaticAberration: true, grain: true, halfRes: false },
        particleCap: 512,
        textureDownscale: false,
      },
    },
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
    far: 5,
    orbitMinDistance: 0.12, // OrbitControls limits around the thorax centre (m)
    orbitMaxDistance: 1.5,
  },
  // Scope view through the glTF step cameras (§7.5) + scope ⇄ outside transitions.
  scope: {
    near: 0.001, // ≤ 1 mm
    far: 0.6, // tightened vs. the glTF 1 m: the right hemithorax spans < 0.4 m from any step camera
    transitionMs: 1000, // eased pose transition; 0 with prefers-reduced-motion
    // Far-field meshes no step camera can see (behind the mediastinum or outside the parietal pleura):
    // hidden in scope view only, to cut draw calls (§6.10 per-step visibility set). Outside view shows them.
    hidden: [
      'lung_upper_lobe_left',
      'lung_lower_lobe_left',
      'arteries_left_intrapulm',
      'skin',
      'subcutaneous_fat',
      'chest_wall_muscle',
      'scapula_left',
      'scapula_right',
      'clavicula_left',
      'clavicula_right',
      ...Array.from({ length: 12 }, (_, i) => `rib_L${i + 1}`),
    ],
  },
  steps: {
    defaultStep: 1, // ?view=scope without ?step=
    stateMs: 1500, // deflate/retract tween when a step is applied
  },
  pick: {
    hoverHz: 30, // §6.10: hover picking ≤ 30 Hz
  },
  perf: {
    sampleHz: 4, // window.__perf refresh rate
    ringSize: 120, // frame-time samples kept for fps / p95
    p95: 0.95,
  },
  // Temporary outside view (T004); M1 replaces the look.
  viewer: {
    ambientIntensity: 0.35,
    headlightIntensity: 2.5,
    frameMargin: 1.3, // distance multiplier when framing thorax_root
    viewDir: [0, 0.6, 1] as const, // from anterior, slightly from patient's right (+Y)
  },
  debug: {
    axesSize: 0.1,
  },
  // Single combined post-FX pass (§6.10, §8 Optics, ADR-003). Values tuned against docs/REFERENCE_FRAMES.md "Optics".
  postfx: {
    msaaSamples: 4, // HDR scene target samples when the preset has antialias
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
    fogRadius: 0.006, // lens-fog blur tap offset (uv); amount (uFog) driven by M5
    fogColor: [1, 0.86, 0.84] as const, // milky orange-pink veil (06:46)
    // Warm red-magenta grade (frames: mean sRGB ≈ 184/117/125, high saturation, maroon shadows).
    lift: [0.03, 0, 0.012] as const,
    gamma: [1.02, 0.95, 0.97] as const,
    gain: [1.08, 0.95, 1] as const,
    saturation: 1.15,
    autoExposure: {
      hz: 4, // meter renders + async read-backs per second
      size: 16, // meter target is size × size
      key: 0.18, // target scene log-average luminance after exposure
      minLog2: -12, // packed log2-luminance range of the RGBA8 meter
      maxLog2: 4,
      min: 0.25, // auto-exposure clamp
      max: 4,
      adaptMs: 400, // easing time constant
    },
  },
  // Physiology + morph controller (§6.1 Physiology lab, §7.3). HR/RR defaults come from procedure_steps.json.
  physiology: {
    olvMs: 5000, // startOLV: all lobes deflate → 1
    clampMs: 4000, // clamp RML bronchus: RUL, RLL re-inflate → 0
    releaseMs: 4000, // release clamp: RML re-inflates → 0 (only if not divided)
    refHrBpm: 75,
    systoleMsAtRef: 300, // systole ≈ 0.3 s at 75 bpm; fraction of cycle kept constant as HR changes
    inspFraction: 0.4, // inspiration share of the breath cycle
    rightLobeBreathAmp: 0.08, // ventilated right lobe collapse offset at end-expiration
    rightLobeBreathMaxDeflate: 0.2, // offset fades to 0 as deflate → this value; collapsed lobes don't breathe
    retractGate: [0.9, 1] as const, // smoothstep on min(deflate) — retraction morphs authored on collapsed lung
    morphEpsilon: 1e-4, // influence written only when |new − old| exceeds this
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
    warmupFrames: 2, // offscreen frames rendered per camera in the warm-up stage
  },
} as const;
