// T840 instrument interaction (docs/FEEDBACK_v7_LIVE.md 1–5): cursor-driven tips, instruments left in their ports,
// inventory caps, the clamp and lymph-node removal. Pending clinician review (caps and port capacities follow the
// user's description of a real anterior VATS set-up).

/** Inventory kind of a hotbar tool + sub-option id (the ring forceps share the grasper slot). */
export const invKind = (tool: string, sub: string | null): string =>
  tool === 'grasper' && sub === 'ring' ? 'ring' : tool;

export const interactionConfig = {
  /** Instruments of each kind in the chest at once (the scope is the one camera). */
  inventory: {
    grasper: 2,
    ring: 1,
    sponge: 1,
    peanut: 2,
    cautery: 1,
    clamp: 1,
    stapler: 1,
    clip: 1,
    sucker: 1,
  } as Readonly<Record<string, number>>,
  /** Short names for port chips / tooltips, per inventory kind. */
  names: {
    grasper: 'Lung grasper',
    ring: 'Ring forceps',
    sponge: 'Sponge-stick',
    peanut: 'Peanut',
    cautery: 'Cautery',
    clamp: 'Clamp',
    stapler: 'Stapler',
    clip: 'Clip applier',
    sucker: 'Sucker',
  } as Readonly<Record<string, string>>,
  /** Positions per port (scope included): the 4 cm access incision takes two, the 1 cm ports one. */
  capacity: { port_utility_5ICS: 2 } as Readonly<Record<string, number>>,
  defaultCapacity: 1,
  /** Instruments left in their ports at once (= every position but the scope's). */
  maxLeft: 3,
  /** Cursor-driven tip: pointer picks at most `hz` a second; the tip eases there (exp. rate per s), stopping `backM`
   *  short of the surface along the shaft. A click within `instantM` of the tip lands and acts at once (else the
   *  tip is snapped in and a second click acts). */
  follow: { hz: 30, ratePerS: 14, backM: 0.001, epsM: 1e-5, instantM: 0.03 },
  /** Clamp jaws closed on a structure: it flattens by `squeeze` across the jaws, eased at `perS`. */
  clamp: { squeeze: 0.12, perS: 6 },
  /** T847b lens exclusion: the scope lens stays `clearM` off each instrument's jaws (far from the stapler's: its 5 cm
   *  jaws filled the 45° view at 3 cm) and `defaultClearM` off every shaft (2026-11-10: the stapler's whole shaft at
   *  4.5 cm pushed the scope out of the chest from the access incision; near-plane clear of the slim ones). Shafts count
   *  from `portSkipM` inside their pleura point (two in the access incision share it); the scope's depth limit is
   *  sampled every `stepM`, settled at follow.hz. */
  /** T850 "Insert via" picker order (inferior camera port · posterior port · anterior access incision); keys K.insertVia1–3. */
  insertOrder: ['port_camera_8ICS', 'port_retraction_8ICS', 'port_utility_5ICS'] as readonly string[],
  /** T850 tissue-aware tip: a ray along the shaft (from `skipM` past the pleura, ≤ follow.hz) stops the tip `marginM`
   *  short of chest wall / mediastinum / vessels / heart / bronchus / nodes (unless it is within `anchorTolM` of the
   *  point the tip was aimed at: modelled layers overlap the vessels a little); manifest-dissectable layers are passed
   *  (re-cast `passStepM` beyond, ≤ `passMax` times; cautery / peanut open them); a lung lobe yields: the tip presses
   *  up to `push.capM` past its surface, indenting it over `push.radiusM` (instant in, eased back at `push.perS`). */
  collide: {
    skipM: 0.01,
    marginM: 0.0015,
    anchorTolM: 0.003,
    passStepM: 0.0005,
    passMax: 3,
    push: { capM: 0.012, radiusM: 0.025, perS: 8, epsM: 1e-5 },
    /** T853: these tips aimed (cursor) at a visible dissectable layer push a lobe in the shaft path aside. */
    lungYieldsFor: ['peanut', 'cautery'] as readonly string[],
  },
  lens: {
    clearM: { stapler: 0.045 } as Readonly<Record<string, number>>,
    defaultClearM: 0.008,
    portSkipM: 0.03,
    stepM: 0.002,
  },
} as const;
