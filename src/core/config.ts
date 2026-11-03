// Central runtime config (CLAUDE.md: config, not magic numbers). Units: metres, ms, Hz.
const base = import.meta.env.BASE_URL;

export const config = {
  modelUrl: `${base}models/thorax_sim.opt.glb`,
  decoderPath: `${base}decoders/`,
  renderer: {
    toneMappingExposure: 1, // antialias + pixel-ratio cap come from the quality preset
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
  camera: {
    fovDeg: 45,
    near: 0.001, // §7.5: ≤ 1 mm
    far: 5,
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
