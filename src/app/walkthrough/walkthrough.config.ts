// T860 guided walkthrough engine (FEEDBACK_GUIDED_v1 §2.1, R1, R3): timings, shot sizes and the framing contract.
// Engine durations are engine-clock ms (× timeScale); m4's own animations (stapler fire, jaw) run in real time.
// Pending visual tuning.
import { config } from '../../core/config';
import { instrumentGeom } from '../../scene/instruments.config';

const RIG = config.scopeRig;

export const walkthroughConfig = {
  /** R6: nodes hidden (visibility only) for the whole Guided walkthrough, restored on leaving it. */
  // T888: heart_rest lies inside the closed pericardium but pokes through it in spots while the pericardium's
  // heartbeat push (T831) is low: the bright red "decal" patches beside the node bed (s04 end, s05 tlv). Not BloodPool.
  hidden: ['mediastinal_fat_ct', 'heart_rest'] as readonly string[],
  /** T874 Beat.ghost: opacity of the ghosted occluders (transparent variant; faded over reducedMs like the glow). */
  ghostOpacity: 0.25,
  /** T876 Beat.inset 'lungs': the PiP inset renders only these nodes (+ the highlight overlays) from outside the chest.
   *  T877: its own render target `px` (sets the aspect: taller than the PiP, the dock's full width); a lateral view
   *  (`from`, screen `up` = head) tilted by `tilt` toward the beat's glow subject, the lobes' projected extents (as
   *  posed; + their inflated shape on a ventilate beat) filling `fit` of each axis. */
  inset: {
    label: 'Outside view',
    keep: [
      'lung_upper_lobe_right',
      'lung_middle_lobe_right',
      'lung_lower_lobe_right',
      'bronchial_tree',
    ] as readonly string[],
    lobes: ['lung_upper_lobe_right', 'lung_middle_lobe_right', 'lung_lower_lobe_right'] as readonly string[],
    px: [320, 272] as readonly [number, number],
    /** Flex-shrink of the inset frame in the dock (the step text's is 1): on a short dock the inset gives way first,
     *  its image letterboxed, down to `minPx` tall (1024×640: a small inset + about three lines of step text). */
    yield: 10,
    minPx: 90,
    from: [0, 1, 1] as readonly [number, number, number], // +Y patient right, +Z anterior: antero-lateral
    up: config.viewing.compassAxes.head as readonly [number, number, number], // head up, anterior to the right
    tilt: 0.3,
    /** Per glow subject (framing subjectKey): a fixed `from` instead of the tilt, e.g. the oblique band lies on the
     *  middle lobe's lower-back edge: seen from feet-lateral it is a stripe between the middle and lower lobes. */
    // T885a: both fissures from the step-1 lateral camera (no tilt), only the band glowing.
    // T888: the horizontal band lies on the faces across the RUL / RML gap, edge-on from the lateral camera: seen a
    // little from the feet side (-X) the RUL's under face shows.
    views: { 'fissure:oblique': [0, 1, 1], 'fissure:horizontal': [-0.45, 1, 1] } as Readonly<
      Record<string, readonly [number, number, number]>
    >,
    fit: 0.88,
    /** Every Nth lobe vertex measured for the fit (event time). */
    stride: 4,
    gain: 3, // linear HDR target, no tone-mapping exposure: brighten the inset quad
    /** Inset-only glow, written to the highlight uniforms around the inset render (restored after): colour ×,
     *  rim [fresnel power, strength, face-on fill], outline [soft, strength, shell width m], fissure band strength. */
    glow: {
      color: 2,
      rim: [2.5, 0.6, 0.04] as readonly [number, number, number],
      outline: [0.35, 0.6, 0.003] as readonly [number, number, number],
      band: 2, // T888: brighter in the inset (0.14 in the scope view); full baked width (highlight insetBandM)
    },
  },
  /** Minimum beat length when a beat gives none. */
  beatMs: 2200,
  /** Camera framing move (§2.1-9: 1.5–3 s). */
  camMs: 2000,
  /** T888 cam 'wide': a lens that cannot back off by the beat's `back` (already at the shallowest clear depth) widens
   *  the optic's view (vertical fov, degrees) to this instead; a wide beat never narrows the view it starts from. */
  wideFovDeg: 72,
  /** cam 'step' fallback when the authored view is outside the rig's pivot cone: aim at this far along its view. */
  stepLookM: 0.06,
  /** Reduced motion: every camera / instrument move becomes this short (same beat order). */
  reducedMs: 300,
  /** Longest engine frame step (a stalled frame must not jump a move); real ms before × timeScale. */
  maxDtMs: 100,
  /** seek(step, beat): earlier beats of the step run at this speed (no captions). */
  fastForward: 1000,
  /** Real-time ceiling for waits on m4 (division, fire, placement). */
  waitMs: 12000,
  /** Insertion shot (§2.1-5): pull back to the port's pleural entry, follow the tip in, push to the working pose. */
  insert: {
    pullMs: 1200,
    tipMs: 1800,
    pushMs: 1500,
    /** Entry point looked at: this far past the port's pleura point along its axis. */
    entryM: 0.012,
    /** Pull-back lens depths tried (m past the scope's pleura point), deepest first; first with the entry in view. */
    pullDepthsM: [0.04, 0.03, 0.02, RIG.depthM.min] as readonly number[],
    /** T871: the pull aims this far (fraction) from the entry toward the tip's goal; the first aim that shows the
     *  entry unoccluded AND the goal in the aperture wins (the tip is seen all the way in); 0 = the entry alone. */
    pullAims: [0.5, 0.35, 0.2, 0] as readonly number[],
    /** Withdrawal: shorter mirror (fraction of the insertion times). */
    withdrawFrac: 0.6,
    /** T883 E4: entry hidden from the scope → keep the tip's end point and this much shaft behind it in view, aimed
     *  this far (fraction) from the tip toward that shaft point. */
    shaftM: 0.03,
    shaftAims: [0.5, 0.3, 0] as readonly number[],
    /** T888 release (E4): the camera follows the leaving holding grasper, aimed at its tip at this many points along
     *  its way out to the port (each pose lens-clear; a blocked one keeps the previous aim). */
    followKeys: 4,
  },
  /** Scope port change (R1): lens out to the port, re-enter through the new one. */
  scopePort: { outMs: 1200, inMs: 1800 },
  /** Cautery / peanut sweep: back-and-forth strokes along the target's surface. */
  /** T887: the strokes cover the target layer's area seen from the port round the beat's subject (radiusM): a
   *  zig-zag of rows `rowM` apart (≤ 2 × the cautery opening radius) across its long axis, `maxRows` at most, each
   *  row sampled every `stepM`, snapped to the surface and smoothed (`smooth` passes); `strokes` passes over it.
   *  Up to `tries` vertices are ray-tested for visibility. */
  sweep: {
    ms: 6000,
    strokes: 2,
    radiusM: 0.018,
    rowM: 0.0045,
    maxRows: 7,
    stepM: 0.002,
    smooth: 2,
    tries: 1200,
    /** A vertex whose shaft line is blocked only this close to it still counts as reached (beside a vessel). */
    reachTolM: 0.004,
    /** T891 G6: a dissectable layer opens (cautery openings, one disc per point `openStepM` apart, < 2 × the opening
     *  radius) everywhere within openRadiusM of the beat's subject, following the stroke. */
    openRadiusM: 0.03,
    openStepM: 0.003,
  },
  /** Grasp: retract key tween length when the beat gives none. */
  graspMs: 2500,
  /** T874 step-7 segment: after each fire the open stapler backs off this far along its shaft (eased), so the new
   *  staple row is visible at the beat's end. */
  segmentBackoffM: 0.01,
  segmentBackoffMs: 800,
  /** Ring clamp: tug toward the port, then carried out to the port's pleura (the node leaves the frame). */
  node: { tugM: 0.012, tugMs: 1200, carryMs: 3600 }, // T883 E3: slow enough for a mid frame of the carry
  /** Lung counted as reflected (WalkState.reflected) at this retract key value. */
  reflectedMin: 0.5,
  /** Release (step 8): reflection eases back over this long. */
  releaseMs: 1500,
  /** Bag (step 8): the lobe shrinks into the bag and leaves through the access incision, this far outside it. */
  bag: { ms: 2200, outM: 0.03, scale: 0.35, playMs: 4500 }, // playMs: T872 retrieval bag run (m4.fx.bag.play)
  /** m4's own animations (stapler, jaws, instrument moves) follow timeScale up to this rate (fast-forward too). */
  maxRate: 20,
  /** Reach point on a target from a port (as the T851 demo): up to `tries` vertices nearest in angle. */
  reach: { tries: 48, topFrac: 0.5, beyondM: 0.002 },
  /** Framing contract (R3). Coverage = projected bbox area / aperture area. */
  framing: {
    offsetMax: 0.12,
    /** T870: no useless close-ups — the lens stays at least this far from the subject and from whatever is straight
     *  ahead, and at most this fraction of the subject's unclipped bbox lies outside the aperture (or behind the lens). */
    minDistM: 0.025,
    spillMax: 0.25,
    /** T871: no surface within this of the lens (the rig collision's nearest-surface test; 1 cm in from the access
     *  incision the chest wall is 8 mm away and renders as dark facets). */
    lensClearM: 0.012,
    /** T891 G5: the lens stays this far above the saline surface (every framing, pull-back and follow pose). */
    waterClearM: 0.005,
    /** T883 E7: a camera move is checked at this many points along its eased path (lens clear, minDistM ahead); a
     *  blocked path detours through a shallower lens depth (framing.depthsM). */
    pathChecks: 8,
    /** T883 E1: while a grasper holds the lobe, the search prefers its jaws inside this fraction of the aperture. */
    heldInner: 0.92,
    /** … the subject may sit this far off centre when it is seen (heldVisible), and the search also aims
     *  these fractions of the way from the subject toward the jaws. */
    heldOffsetMax: 0.3,
    heldAims: [0, 0.2, 0.35] as readonly number[],
    /** The jaws: tip … this far back along the shaft (the retractor blade), checked at heldSteps + 1 points; any one
     *  in view counts (heldInside). */
    heldJawsM: instrumentGeom.retractor.length,
    heldSteps: 2,
    /** T888 heldVisible: points from the holding tip this far back along its shaft (blade + distal shaft), every
     *  heldSeenM / heldSeenSteps, ray-tested from the lens; a hit within heldTolM of the point (the tissue the jaws
     *  press on) does not hide it. Among passing poses one showing any of it wins. */
    heldSeenM: instrumentGeom.retractor.length + 0.04,
    heldSeenSteps: 8,
    heldTolM: 0.003,
    /** T883 E5: a big instrument in hand (jaws `jawsM` back from the tip): the coverage band / aim apply to the
     *  bbox of subject + jaws, so the instrument does not swamp the frame (ref 02:04, 03:36: stapler ≈ half). */
    big: {
      jawsM: {
        stapler: instrumentGeom.stapler.headLength + instrumentGeom.stapler.jointLength,
        clamp: 0.03,
      } as Readonly<Record<string, number>>,
      coverage: { min: 0.15, max: 0.45 },
      aim: 0.35,
      /** T891 G9: shaft radius per big instrument; its diameter at the nearest point to the lens may fill at most
       *  `widthMax` of the aperture height (ref: the stapler ≈ half the frame), in framed poses and along moves. */
      radiusM: { stapler: instrumentGeom.stapler.shaftRadius } as Readonly<Record<string, number>>,
      widthMax: 0.45,
    },
    /** T871 { bed: true }: sample points this far round the bed point recorded at the node's removal. */
    bedRadiusM: 0.004,
    coverage: { min: 0.1, max: 0.5 },
    unoccludedMin: 0.6,
    /** Per-subject overrides: whole lobes may fill more, thin structures may cover less; unoccludedMin per subject. */
    overrides: {
      lung_upper_lobe_right: { max: 0.7 },
      lung_middle_lobe_right: { max: 0.75 }, // T864: the low-port view of the middle lobe (step 2) fills 73 %
      lung_lower_lobe_right: { max: 0.7 },
      // T888: the middle lobe overlaps the lower nerve from every port (0.53 unoccluded): realistic, model unchanged.
      phrenic_nerve_right: { min: 0.04, unoccludedMin: 0.5 },
      middle_lobe_artery: { min: 0.04 },
      middle_lobe_vein: { min: 0.04 },
      'fissure:horizontal': { min: 0.04, max: 0.6 }, // T864: whole band in view from the access incision
      'fissure:oblique': { min: 0.04 },
      segment: { min: 0.04 },
      bed: { min: 0.04 },
    } as Readonly<
      Record<string, { readonly min?: number; readonly max?: number; readonly unoccludedMin?: number }>
    >,
    /** T888 per-beat contract overrides, 'sNN:beatId' (owner rule: screenshots decide; a metric threshold changed for one
     *  beat only with its reason). min / max replace the coverage band (also the big-instrument band), unoccludedMin
     *  the unoccluded minimum, held: false drops the holding-jaws requirement. */
    beatOverrides: {
      // Clamp test: the lobes inflate over the hilum (0.53 unoccluded) and cover the holding jaws; the beat is judged
      // on the outside-view inset (the middle lobe staying flat), which reads correctly.
      's05:tlv': { unoccludedMin: 0, held: false },
      // Fourth fissure fire: lobe + stump + jaws read well by eye at 0.499 coverage (big band max 0.45).
      's07:seg-4': { max: 0.52 },
      // Cautery push-in onto the bed (an 8 mm subject): at the default band the search zoomed ×2.8 onto the drop
      // (14 % coverage, lens view on the ooze); capped so the bronchus round it stays in view.
      's04:cautery-in': { max: 0.08 },
      // T891 G8: step-1 parts look toward their own (glowing) part from the middle-lobe view (hints `toward`), so the
      // middle lobe sits off centre and partly behind the part looked at (0.38–0.59 unoccluded) by design.
      's01:rul': { offsetMax: 0.5, unoccludedMin: 0.35 },
      's01:rll': { offsetMax: 0.5, unoccludedMin: 0.35 },
      's01:horizontal': { offsetMax: 0.5, unoccludedMin: 0.35 },
      's01:oblique': { offsetMax: 0.5, unoccludedMin: 0.35 },
      // T891 G9: with the stapler capped at widthMax the lens stays back, where the lobe edge overlaps the bronchus
      // (0.56 unoccluded) and the jaws sit left of centre (0.30); jaws, bronchus and the holding grasper read clearly.
      's05:fire': { unoccludedMin: 0.5, offsetMax: 0.35 },
      // T895 v9: the OLV lobes stay in contact (the separated-lobes fix), so the upper/lower lobes overlap the middle
      // lobe's edges (0.41 unoccluded); the wedge in front reads clearly by eye (s01-b01-rml).
      's01:rml': { unoccludedMin: 0.35 },
      // T895 v9: closed stapler + bronchus + inset read well at 0.139 big-band coverage (s05-b06-overview).
      's05:overview': { min: 0.12 },
      // T895 v9: see-through lower lobe, stump clear of the jaws; subject at the 0.12 offset edge (s07-b06-underside).
      's07:underside': { offsetMax: 0.18 },
    } as Readonly<
      Record<
        string,
        {
          readonly min?: number;
          readonly max?: number;
          readonly unoccludedMin?: number;
          readonly held?: boolean;
          readonly offsetMax?: number;
        }
      >
    >,
    /** Sample points per subject (vertex indices cached at load). */
    samples: 32,
    /** A ray to a sample point blocked closer than this to the point counts as the subject itself. */
    occlusionTolM: 0.002,
    /** T874: ghosted surfaces a sample ray may pass through (each lobe: front + back face). */
    ghostPassMax: 6,
    /** Candidate search from the scope's port: lens depths (m) × digital zooms; one re-aim at the bbox centre. */
    depthsM: [0.08, 0.065, 0.05, 0.04, 0.03, 0.02, RIG.depthM.min] as readonly number[],
    zooms: [1, 1.35, 1.8, 2.4, RIG.zoom.max] as readonly number[],
    refine: 2,
    /** Coverage aimed for inside the allowed band (fraction of the band from min). */
    aimFrac: 0.4,
    /** Step authors' framing hints, keyed 'sNN:beatId' (one beat) or a subject key (every beat on it): restrict the
     *  search to these lens depths (m) / zooms, or aim at a fixed world point [x, y, z]. One line per hint, e.g.
     *  's04:nodes': { depthsM: [0.03], zooms: [2] }. Port choice stays in the step data (cam scopePort).
     *  T891: `toward` = aim this fraction from the subject toward the beat's glow subject (no re-aim); `as` = search
     *  the pose that frames these nodes instead (the beat's subject is still measured). */
    hints: {
      's01:rml': { depthsM: [0.02] }, // T864: camera-port view of the whole middle lobe (spill under 25 %)
      // T891 G8: the other parts turn from the rml view toward their own glowing part (each its own move).
      's01:rul': { depthsM: [0.02], toward: 0.45 }, // T877: the upper lobe hides behind the RML; inset shows it
      's01:oblique': { depthsM: [0.025], toward: 0.5 }, // T877: the middle lobe's edge on the lower lobe
      's01:horizontal': { depthsM: [0.03], toward: 0.4 }, // T885a: the band glows in the inset
      's01:rll': { depthsM: [0.02], toward: 0.45 }, // T885a: the lower lobe, the large lobe left of the RML
      // T891 G7: the s02 hilum pose (the reflected lobe kept off the hilum), the vein + lobe measured from there.
      's03:hold': {
        as: ['middle_lobe_vein', 'middle_lobe_artery', 'middle_lobe_bronchus'] as readonly string[],
      },
      's08:scope-back': { depthsM: [RIG.depthM.min] }, // T868: camera port lens high, as the step-9 saline view
      's04:nodes': { depthsM: [0.05, 0.045, 0.04, 0.03] }, // T885a: nodes + bronchus with context
      's04:grasp-11r': { depthsM: [0.05, 0.045, 0.04, 0.03] }, // T885a
      's04:grasp-12r': { depthsM: [0.05, 0.045, 0.04, 0.03] }, // T885a
      's04:ooze': { depthsM: [0.05, 0.045, 0.04, 0.03] }, // T885a
      's04:coagulate': { depthsM: [0.05, 0.045, 0.04, 0.03] }, // T885a
      's03:stumps': { depthsM: [0.04, 0.045, 0.05], zooms: [1] }, // T892a: pulled back, both stumps in context
      // T885b: in on the jaws, so the overview can ease back; T891 G9: deeper options keep the stapler ≤ widthMax.
      's05:close': { depthsM: [0.0225, 0.03, 0.04], zooms: [1] },
      's05:fire': { depthsM: [0.0225, 0.03, 0.04], zooms: [1] }, // T892b: the close view's options (centred there)
      's07:seg-2': { depthsM: [0.02, 0.015, 0.01, 0.03], zooms: [1] }, // T893b: unzoomed, the lobe in context
      's07:seg-3': { depthsM: [0.02, 0.015, 0.01, 0.03], zooms: [1] }, // T885b: lobe + stump + jaws
      's07:underside': { depthsM: [0.02, 0.015, RIG.depthM.min] }, // T892b: lens short of the see-through lower lobe
      's07:look-under': { depthsM: [RIG.depthM.min] }, // T892b: shallow before the move under the ghosted lobe
    } as Readonly<
      Record<
        string,
        {
          readonly depthsM?: readonly number[];
          readonly zooms?: readonly number[];
          readonly aim?: readonly [number, number, number];
          readonly toward?: number;
          readonly as?: readonly string[];
        }
      >
    >,
  },
  /** Narration (voice.ts): one clip per beat, `<dir><sNN>_<beat id>.mp3`, started with the beat's caption; the beat
   *  holds until its clip ends. Off under automation (navigator.webdriver) and at timeScale ≠ 1. */
  voice: {
    dir: `${import.meta.env.BASE_URL}audio/narration/`,
    /** Beats that share one clip (same caption). */
    alias: { 's08_olv-upper': 's08_olv', 's08_olv-lower': 's08_olv' } as Readonly<Record<string, string>>,
    volume: 1,
    storageKey: 'thorascope.voice', // localStorage: '0' = muted
  },
} as const;
