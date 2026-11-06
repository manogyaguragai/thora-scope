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
  /** Guided steps 2–7: a static held grasper whose tip rides the `target` vertex nearest `at` (un-morphed world
   *  point), shaft through `port` (never the step's scope port). T832: re-picked on the v7 lobes by ray-casting each
   *  step view (procedure_steps.json scope ports, after the step's retract tween) for a visible lobe vertex whose shaft
   *  from `port` is unoccluded, about halfway out from the view centre. The middle lobe itself is out of view (step 4,
   *  retract_RML_lateral) or behind the lower lobe from every free port (5–6), so those steps hold a neighbour. */
  guided: {
    2: { port: 'port_camera_8ICS', target: 'lung_upper_lobe_right', at: [0.0142, -0.0084, 0.0619] },
    3: { port: 'port_camera_8ICS', target: 'lung_upper_lobe_right', at: [0.0099, -0.0051, 0.0612] },
    // T844 9-step list: 4 nodes + 5 bronchus share the old bronchus-step grasp; 6 arteries, 7 fissures.
    4: { port: 'port_camera_8ICS', target: 'lung_upper_lobe_right', at: [-0.0068, 0.0007, 0.0682] },
    5: { port: 'port_camera_8ICS', target: 'lung_upper_lobe_right', at: [-0.0068, 0.0007, 0.0682] },
    6: { port: 'port_retraction_8ICS', target: 'lung_lower_lobe_right', at: [-0.015, 0.0804, -0.0077] },
    7: { port: 'port_retraction_8ICS', target: 'lung_lower_lobe_right', at: [-0.1133, 0.1039, 0.0577] },
  } as Readonly<
    Record<
      number,
      { readonly port: string; readonly target: string; readonly at: readonly [number, number, number] }
    >
  >,
} as const;
