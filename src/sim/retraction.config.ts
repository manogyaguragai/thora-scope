// Multi-instrument retraction (T820, user feedback 2026-11-05): a lung grasper / sponge-stick holds a lobe from one
// port while another tool works through a second port. Pending clinician review (ports per step are approximations;
// the model's port positions differ from the video, ADR-004).
export type RetractKey = 'retract_hilum' | 'retract_RML_lateral' | 'retract_fissure';

export const retractionConfig = {
  /** T840 any-direction retraction: the drag (screen px) is projected on the screen image of each retract key's
   *  world direction for the grasped lobe and blended (several grasps add up, clamped 0..1). Directions = the lobe's
   *  mean morph delta per key, measured at load (wireM4); `fallbackDirs` (world, §7.1: +X head, +Y up/lateral,
   *  +Z anterior) apply when a lobe carries no morph data. Pending visual tuning. */
  grasp: {
    fallbackDirs: {
      RUL: { retract_hilum: [0, 0.5, -1], retract_fissure: [1, 0, 0] },
      RML: { retract_RML_lateral: [0, 1, 0] },
      RLL: { retract_hilum: [0, 0.5, -1], retract_fissure: [-1, 0, -0.6] },
    } as Readonly<Record<string, Readonly<Partial<Record<RetractKey, readonly [number, number, number]>>>>>,
    /** Keys whose screen image is shorter than this (unit world direction) are not driven by the drag. */
    minScreen: 0.15,
  },
  /** Grasps tracked at once (in hand + left in ports + easing back). */
  slots: 6,
  /** Tools whose retraction can be held (G) / left in a port; ring forceps stay on node removal. */
  holdable: ['grasper', 'sponge', 'peanut'] as readonly string[],
  /** A let-go grasp eases its whole contribution back over this long. */
  releaseMs: 700,
} as const;
