// Vitals monitor + pulse beep (T814). Simulated teaching values, NOT clinical: they follow the sim state only.
export const vitalsConfig = {
  spo2: {
    basePct: 98, // two-lung ventilation
    olvPct: 94, // one-lung ventilation: lerped by max(deflate_RUL, deflate_RML, deflate_RLL)
  },
  nibp: {
    sysMmHg: 118,
    diaMmHg: 72,
    refHrBpm: 75, // shift is 0 at this HR
    sysPerBpm: 0.3, // mmHg per bpm above/below refHrBpm
    diaPerBpm: 0.15,
  },
  etco2MmHg: 35,
  beep: {
    // Pulse-oximeter pitch tracks SpO2 (higher saturation = higher tone).
    hzAt100: 880,
    hzPerPct: 20, // drop per % below 100
    minHz: 300,
    lengthMs: 70,
    attackMs: 5,
    releaseMs: 15,
    volume: 0.12, // GainNode peak (0..1)
    storageKey: 'thorascope.vitalsSound', // localStorage '1' | '0'; default off
  },
  /** T821: collapse toggle, persisted (localStorage '1' collapsed | '0'; default expanded). */
  collapseStorageKey: 'thorascope.vitalsCollapsed',
  /** Numeric text refresh (§6.7: DOM writes ≤ 4 Hz). */
  textHz: 4,
  /** Mirror canvases (OT-room 3D monitor texture): traces left, numerics right. */
  mirror: {
    hz: 15, // redraw rate
    traceShare: 0.6, // width share of the traces
    fontRowShare: 0.7, // numeric font size as a share of one row (height / 5)
    padRowShare: 0.3, // left padding of the numerics, in rows
  },
  trace: {
    cssWidth: 176, // canvas CSS px (ECG top half, pleth bottom half)
    cssHeight: 100,
    maxDpr: 2, // backing store scale cap (fixed at mount)
    sweepPxPerS: 44, // CSS px per second (176 px ≈ 4 s on screen)
    samplePx: 0.5, // waveform sampled every half CSS px so the narrow QRS is never skipped
    eraseBarPx: 10, // blank gap ahead of the sweep
    lineWidthPx: 1.5,
    maxStepMs: 1000, // longer gaps (tab hidden, held render) restart the sweep segment instead of drawing a ramp
    ecgBase: 0.68, // baseline, fraction of the ECG band height from its top
    ecgAmp: 0.55, // R wave height, fraction of the band
    plethBase: 0.9,
    plethAmp: 0.75,
  },
  /** Waveform shapes; phases are fractions of the cardiac cycle, heartPhase 0 = R wave = beep. */
  wave: {
    ecgShift: 0.2, // e = heartPhase + ecgShift: R wave sits at e = 0.2
    // PQRST as gaussians [centre e, amplitude, width]
    ecg: [
      [0.08, 0.12, 0.03], // P
      [0.183, -0.12, 0.01], // Q
      [0.2, 1, 0.016], // R
      [0.218, -0.22, 0.012], // S
      [0.45, 0.28, 0.05], // T
    ],
    plethDelay: 0.18, // pulse reaches the finger after the R wave
    plethRise: 0.15, // upstroke share of the cycle
    plethDecay: 3, // exponential run-off rate after the peak
    plethNotch: [0.38, 0.12, 0.05], // dicrotic notch bump [centre, amplitude, width]
  },
  /** Diathermy interference on the ECG while the cautery is energised (T817): irregular high-frequency noise in
   *  R-wave units, added per trace sample (sampled every trace.samplePx). */
  interference: {
    amp: 0.45, // ± random component
    ripple: 0.2, // ± sinusoidal component
    rippleRad: 2.1, // ripple phase step per sample (rad)
    period: 4096, // sample counter wrap (keeps the hash argument small)
  },
  /** Monitor palette (OT convention, not app tokens): ECG green, SpO2 cyan, NIBP red, RR yellow, EtCO2 white. */
  colors: {
    bg: '#000000',
    ecg: '#33ff66',
    pleth: '#33e0ff',
    nibp: '#ff5a5a',
    rr: '#ffe14d',
    etco2: '#e8e8e8',
  },
} as const;
