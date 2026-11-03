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
  // Temporary outside view (T004). T104: placeholder lights off — the look's lights live in src/scene/lights.ts.
  // ponytail: zeroed (not removed) to keep main.ts untouched during the T102 merge; delete both lights afterwards.
  viewer: {
    ambientIntensity: 0,
    headlightIntensity: 0,
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
  // Loading screen (§6.9). T102 replaces the two placeholder stages with the five weighted ones.
  loading: {
    irisMs: 600, // lens iris-open on ready
    tipMs: 5000, // tip rotation period
    tipFadeMs: 200, // tip cross-fade (motion token range 150–250 ms)
    downloadWeight: 0.8, // share of the ring filled by the download stage
    holdFraction: 0.4, // ?holdload freezes the download stage here
  },
} as const;
