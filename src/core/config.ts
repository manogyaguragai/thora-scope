// Central runtime config (CLAUDE.md: config, not magic numbers). Units: metres, ms, Hz.
const base = import.meta.env.BASE_URL;

export const config = {
  modelUrl: `${base}models/thorax_sim.opt.glb`,
  decoderPath: `${base}decoders/`,
  renderer: {
    antialias: true,
    maxPixelRatio: 1.5,
    toneMappingExposure: 1,
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
  // Loading screen (§6.9). T102 replaces the two placeholder stages with the five weighted ones.
  loading: {
    irisMs: 600, // lens iris-open on ready
    tipMs: 5000, // tip rotation period
    tipFadeMs: 200, // tip cross-fade (motion token range 150–250 ms)
    downloadWeight: 0.8, // share of the ring filled by the download stage
    holdFraction: 0.4, // ?holdload freezes the download stage here
  },
} as const;
