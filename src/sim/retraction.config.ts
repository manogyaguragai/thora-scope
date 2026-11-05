// Multi-instrument retraction (T820, user feedback 2026-11-05): a lung grasper / sponge-stick holds a lobe from one
// port while another tool works through a second port. Pending clinician review (ports per step are approximations;
// the model's port positions differ from the video, ADR-004).
export const retractionConfig = {
  /** Instruments that may be held at once (plus the active tool in the hand). */
  maxHeld: 2,
  /** Tools whose retraction can be held (G); ring forceps stay on node removal. */
  holdable: ['grasper', 'sponge'] as readonly string[],
  /** Release (Shift+G): the morph eases back to this value over releaseMs. */
  releaseTo: 0,
  releaseMs: 700,
  /** Guided steps 2–6: a static held grasper whose tip rides the `target` vertex nearest `at` (un-morphed world
   *  point on the lobe face the step camera sees), shaft through `port` (never the step's scope port). T821: picked
   *  by ray-casting each step camera for a visible lobe vertex with an unoccluded shaft (the anterior working port's
   *  shaft runs behind hilar tissue in 3–5, so 3 and 5 use the camera port). Step 2's camera sees no lobe and step
   *  4's lobe lies against the lens: there only the shaft edge shows. */
  guided: {
    2: { port: 'port_retraction_8ICS', target: 'lung_upper_lobe_right', at: [-0.0258, 0.0577, 0.0712] },
    3: { port: 'port_camera_8ICS', target: 'lung_middle_lobe_right', at: [-0.0222, 0.0393, 0.0593] },
    4: { port: 'port_camera_8ICS', target: 'lung_middle_lobe_right', at: [-0.0222, 0.0393, 0.0593] },
    5: { port: 'port_camera_8ICS', target: 'lung_middle_lobe_right', at: [-0.0201, 0.0617, 0.0527] },
    6: { port: 'port_utility_5ICS', target: 'lung_middle_lobe_right', at: [-0.0491, 0.1057, 0.0203] },
  } as Readonly<
    Record<
      number,
      { readonly port: string; readonly target: string; readonly at: readonly [number, number, number] }
    >
  >,
} as const;
