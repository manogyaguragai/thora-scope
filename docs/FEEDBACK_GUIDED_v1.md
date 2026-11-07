# FEEDBACK_GUIDED_v1 — Guided walkthrough rebuild (user live feedback 2026-11-06) — spec of record (T860–T869)

Scope: **Guided walkthrough mode only.** Practice mode is NOT changed by this spec (user: "the current specs … are only
for guided walkthrough mode; for practice mode I will give an enhancing prompt after this"). Practice must keep passing
practice.spec unchanged (click-to-label, retraction swaps, PA actions all stay).

## 0. Resolutions (user answers 2026-11-06 — these OVERRIDE the text in §2 where they differ)
- **R1 Ports follow the video.** The walkthrough teaches the ideal scope / instrument / port placement per step as in
  `docs/VIDEO_STEP_MAP.md` (a)+(b): the scope changes port when the video does (e.g. scope to the posterior port
  0:46–5:00, back to the camera port 5:14), retractors change port (retraction swaps 1:40, 2:24, 4:17), staplers come
  from the port the video uses. §2.1-4 becomes: **the reflection is never relaxed** — a retraction change is shown as
  a hand-off (the new grasper takes the lung BEFORE the old one withdraws, both visible), never hidden/reset on
  Next/Prev/rail. A scope port change is shown as a scope withdraw + reinsert shot. The physics and logic must match
  (one instrument per 1 cm port; the access incision may carry a held retractor plus one working instrument, as the
  video shows at 03:04 / 04:17 / 06:03). Conflicts with the video map are flagged in PROGRESS, not guessed.
- **R2 Hover labels in the walkthrough** (no click). Practice keeps click-to-label (PA06 unchanged).
- **R3 Framing contract measurement:** coverage = projected **bounding-box** area of the subject inside the aperture;
  default 10–50 %, per-subject overrides in config (whole lobes may go to ~70 %, thin subjects — phrenic nerve, fissure
  band, A4/A5, V4/V5 — minimum ~4 %). The ≥ 60 % unoccluded raycast counts anatomy only (instruments excluded). Goal
  (user): everything clearly visible and realistic.
- **R4 Extra beats:** no phrenic sweep. DO show the cautery opening of the mediastinal pleura (step 2, after the
  reflection, or step 3 before the strands) and the blunt-clamp passage around the bronchus before the bronchus
  stapler (step 5).
- **R5 Layout:** captions / step text / toasts / messages dock in the empty space left and right OUTSIDE the surgical
  field, **above the vitals monitor**. Never over the scope image (layout spec: zero overlap with the central 85 % of
  the aperture at 1920×1080, 1280×720, 1024×640; at narrow widths the scope may shrink to make room).

- **R6 CT fat (owner 2026-11-07):** `mediastinal_fat_ct` is hidden for the whole Guided walkthrough (visibility only; kept in Practice/Explore).
- **R7 Step 1 lung state (owner):** step 1 shows the lobes partly deflated (~60–70 %) so all three lobes and both fissures are visible; full collapse completes at the start of step 2.
- **R7 outcome (orchestrator 2026-11-07, measured):** partial inflation made step 1 worse (72 views: lobes fill the cavity, lens in tissue; upper lobe ≤ 38 % unoccluded), so step 1 stays at full collapse. Parts the scope physically cannot see (upper lobe, horizontal and oblique fissures) ghost the occluding lobes (pre-compiled transparent variant, ~25 % opacity) for that beat so the subject shows through in the normal scope view. Model request for v9: collapsed upper lobe and fissures should face a port.
- **R8 Horizontal fissure (owner):** the step-7 horizontal guide + staple line are generated on the camera-facing side so every fire is visible (approximation until the refined model).
- **R9 Port chain (orchestrator, per owner guidance "view ideal for the step, physics/logic match"; geometry measured by T864–T868):** steps 2–7 keep the scope in the inferior camera port and the retractor held through the anterior access incision (+ one working instrument there); staplers come through the port that is square to the structure (vein + bronchus: posterior 3–10°; artery: access incision 15°; fissure: posterior). The video's posterior-port scope views are blocked by the collapsed/reflected lobes on this model (unoccluded 0–0.19). Step 1 inspects from the access incision; steps 8–9 per T868. No scope jumps between steps: each step starts where the previous one ended.

## 2. Spec (copied from the user's prompt)

### 2.1 Global walkthrough rules (apply to every step)
1. **Non-interactive.** In walkthrough mode, disable:
   - hotbar
   - tool activation
   - scope drag, arrows and wheel
   - port switching
   - physiology controls

   Still allowed:
   - Next / Prev / step rail
   - Replay step
   - Pause / Play
   - hover labels (2.3)
   - switching mode
2. **Timeline per step.**
   - Each step is a list of beats (camera move, instrument move, tissue change, caption, highlight).
   - A step auto-plays when entered and ends holding its final pose.
   - Next goes to the next step. Step 1 is the exception (see below).
   - Each beat's caption appears when that beat starts.
3. **Instrument lifecycle.**
   - One instrument per port.
   - A new instrument enters a port only after the previous one has visibly withdrawn out of that port. The withdrawal is shown on screen.
4. **Persistent grasper.** *(superseded by R1: reflection never relaxes; hand-offs shown)*
   - The grasper inserted in step 2 through the **posterior port** keeps holding the reflected RML through every later step until lobe extraction (step 8).
   - Never hide it, reset it, or relax the reflection between beats, on Next/Prev, or on rail jumps.
   - The lung stays reflected and the hilum stays exposed.
5. **Insertion shot** (one reusable primitive, used for EVERY instrument introduction in steps 2–9):
   - The scope smoothly pulls back, within the fulcrum rig, far enough to show the port's pleural entry point.
   - The instrument tip enters along the port axis; the camera follows the tip in.
   - The camera then pushes back in to the working pose.
   - Withdrawal uses a shorter mirror of the same shot.
   - Rig rules still apply: no piercing tissue, no leaving the chest (T843/T847).
6. **Framing contract.** At every working beat the subject is centred in the scope aperture: *(measurement per R3)*
   - projected bounding-box centre within ±12 % of the aperture centre
   - subject covers 10–50 % of the aperture area
   - ≥ 60 % of sample points on the subject are unoccluded (raycast)
   - the active instrument tip is inside the aperture
7. **Highlight.**
   - The current subject gets a soft glow outline plus rim, pulsing slowly (≈ 2 s period, eased).
   - It fades in at beat start and fades out at beat end. Only the current subject glows.
   - Built and compiled at load, driven by uniforms only, 0 new programs.
8. **Deterministic cumulative state.**
   - Entering step N via the rail, Prev, or `?step=N` instantly rebuilds the end-state of steps 1…N-1, then plays step N. That end-state includes: grasper holding, divided structures with stumps, node removed, bed coagulated, and so on.
   - Prev replays from the start of the previous step.
9. **Smoothness.**
   - Eased camera moves (typically 1.5–3 s), no snaps or cuts.
   - Morphs, jaw open/close, stapler articulation and fire, and dissection progress are all tweened.
   - No per-frame allocations.
   - Reduced motion: short cross-fades instead of long moves, same beat order.
10. **Test hooks.**
    - `window.__sim.walkthrough` exposes `seek(step, beat)`, `timeScale`, `state()` and `currentBeat()`.
    - Specs fast-forward with these instead of waiting in real time (SwiftShader is slow).

### 2.2 Port naming correction
The user reports that the labels are wrong. Today:
- the port labelled **"Access incision (5th space)"** is anatomically **anterior**
- the **camera port** is the **inferior** one
- the port called **"anterior (working) port"** actually enters from the **back**, so it is the **posterior** port

What to do:
- Verify this against the glTF port extras (skin_point / pleura_point / axis_into_chest) and the patient's anatomical axes.
- Also check the orientation compass (T843) agrees.
- Relabel everywhere: ports.ts, steps.ts, the active-port chip, help overlay, toasts, practice_actions.json display text, README, tests.
  - Keep internal ids stable unless they are themselves misleading. If renaming an id, migrate it everywhere and keep practice.spec green.
- Labels should state the location: "Anterior access incision (5th space)", "Inferior camera port", "Posterior port".
- Use the space numbers already in the data. Do not invent intercostal spaces.
- If the geometry contradicts the user, STOP that sub-task and report the numbers instead of guessing.
- Then align scripts/perf-probe.mjs with the practice.spec helpers (T855).

### 2.3 UI
- Rename the mode to "Guided walkthrough" everywhere (mode button, rail header, help, README, tests).
- Remove the **"Show me"** button and its separate code path. The cinematic timeline (guidedDemo) BECOMES the default playback. "Try it" becomes "Practice this step", which switches to Practice at this step. Drop it if it adds complexity.
- **Captions and all text panels go off the scope image.** Today the caption box sits bottom-centre and covers the view. *(placement per R5)*
  - Dock the caption panel (and step text, toasts, the "sent as sample" / clamp-test messages, the practice bar) in the empty side space beside the 5:4 scope aperture.
  - Panels are collapsible.
  - Add an e2e layout spec at 1920×1080, 1280×720 and 1024×640 asserting zero overlap between any text panel and the central 85 % of the aperture.
- **Hover labels in all modes.** *(R2: walkthrough; practice keeps click)*
  - Hovering a structure shows its name in a small tooltip near the cursor.
  - Use the existing BVH hover pick, ≤ 30 Hz.
  - No click needed. Hidden over instruments and when the pointer leaves the canvas.
  - Long-press fallback on touch.
  - The click-to-label behaviour goes away.

### 2.4 Loading
- The user sees another loading screen when reaching step 3/4. Find the root cause and remove it. Candidates: lazy chunk, guidedDemo import, decode, compile of stapler/stump/cut/effect variants.
  *(Orchestrator finding: `reloadInto()` in src/app/guidedDemo.ts does `location.assign()` whenever the case has an
  irreversible change (vein divided, nodes out) → full page reload → loading screen. Fix = §2.1-8 in-place rebuild.)*
- Everything any step needs (walkthrough and practice) is fetched, decoded, compiled, and warm-up rendered **during the initial loading screen**, including from each beat's key camera pose. This covers:
  - lazy chunks
  - all instruments and sub-options
  - stumps and staple lines
  - highlight materials
  - effect pools, fluid, bleed
- Load progress stays honest. A longer initial load is acceptable.
- Keep the initial-JS budget by importing those chunks during a loading stage. They stay separate chunks.
- e2e assertions: during a full walkthrough 1→9 after `ready`, no loading UI appears, no app-asset network requests occur, and 0 new programs are created.

### 2.5 Per-step choreography

**Step 1 — Inspect (sub-steps advanced by Next).**
- Starts directly in the scope view of the right chest. No Show-me button.
- Parts, in order:
  1. upper lobe
  2. middle lobe
  3. lower lobe
  4. horizontal fissure
  5. oblique fissure
  6. phrenic nerve
- For each part:
  - smooth camera move until the part is centred (framing contract)
  - pulsing glow on that part
  - caption describes that part (reuse/adapt the current text)
- Next moves to the next part. Prev moves back. After the phrenic nerve, Next goes to step 2.
- The rail shows sub-progress (e.g. 3/6).
- Fissures: the lobes currently separate on collapse. Highlight the fissure as a glowing line/band along the gap; the step-7 dotted guide geometry can be reused.
- Today parts are sometimes out of frame or at a bad angle. Every part must pass the framing contract.

**Step 2 — Expose the hilum.** *(ports per R1; pleura opening per R4)*
1. Insertion shot: grasper through the **posterior port**.
2. Camera moves in to the right middle lobe, which is highlighted.
3. The grasper opens, grasps the RML, and reflects the lung (retract_hilum tweened ≈ 2.5 s, jaws following the tissue).
4. Camera settles on the exposed hilum: centred, with the hilar structures outlined and pulsing.

The lung stays in this reflected position, held by the grasper, for all later steps (2.1-4). Visually confirm the hilum is centred and readable.

**Step 3 — Middle lobe vein (V4/V5).**
Today the lung is not reflected and the hilum is not in view at this step. Fix that first.
1. Hold: lung reflected, grasper visible, hilum centred.
2. Insertion shot: electrocautery through its port (the port VIDEO_STEP_MAP assigns; flag conflicts).
3. Push-in to the same working pose. The cautery divides strands of hilar tissue / mediastinal pleura over V4/V5:
   - smooth short strokes along a path
   - progressive dissection, light smoke
   - no jitter
4. Withdraw cautery (shown). Insertion shot: peanut. Blunt dissection frees the vein from its surrounding fascia, with the vein highlighted.
5. Withdraw peanut (shown). Insertion shot: vascular stapler. Anvil passes behind the vein; jaws clamp; fire animation; division into two stumps with staple lines.
6. Withdraw stapler.

All working beats are centred.

**Step 4 — Lymph nodes 11R/12R.**
1. The scope repositions over the middle lobe bronchus, with the overlying nodes centred and highlighted.
2. Insertion shot: ring clamp. It approaches the node, grasps it, and pulls it free.
3. The ring clamp withdraws out through its port carrying the node. The node visibly leaves the frame in the current view.
4. Message: "Lymph node 11R sent for pathology" (repeat for 12R if both are modelled).
5. Bleeding from the node bed:
   - **Remove the orange expanding circle entirely.**
   - Replace the spray-like red with a real ooze: dark glossy blood (≈ #5a0a0a–#8a1414 after the grade) slowly welling from the exact bed point, a thin rivulet following gravity, and a small pool at the low point.
   - No flying particles.
6. Insertion shot: cautery. It coagulates that exact point; the ooze stops and darkens to a coagulum.
7. Withdraw.

**Step 5 — Bronchus + clamp test.** *(blunt-clamp passage first per R4)*
1. Insertion shot: stapler, using the cartridge the content assigns to the bronchus. Flag it if the content assigns a vascular cartridge.
2. The middle lobe bronchus is clamped, NOT divided, centred in the frame.
3. Clamp test:
   - Switch to two-lung ventilation, with a clear on-screen message ("Two-lung ventilation ON — clamp test").
   - Camera eases back enough to show the upper and lower lobes inflating while the middle lobe stays collapsed (RML highlighted).
   - Confirmation message.
4. Only after the confirmation: return to one-lung ventilation, then fire, divide, show stumps.
5. Withdraw.

The grasper is still holding throughout.

**Step 6 — Middle lobe arteries (A4/A5).**
1. Smooth pan until the arteries are centred and highlighted. The current camera does not show them properly; fix it.
2. Insertion shot: peanut. It dissects the fascia around the artery and creates a visible passage behind it.
3. Withdraw peanut. Insertion shot: vascular stapler. It articulates to the correct perpendicular approach, clamps, fires, and divides, leaving stumps.
4. Withdraw.

**Step 7 — Fissures.**
Keep the current content. The lobes separate on collapse in this model, and a refined model comes later. Apply only the global rules: insertion/withdraw shots, side captions, highlights, persistent grasper.

**Steps 8–9 — Lobe out; irrigate/leak test/suction.**
Content unchanged. Add proper insertion/withdraw shots for every instrument and apply the global rules.

## 4. Visual verification (mandatory)
**Owner rule (2026-11-06): screenshots decide.** A beat passes only if its frames, opened and looked at, show the
named structure recognisably at a working distance with context and the action visible. A framing-metric pass on
a useless frame (e.g. lens touching the lobe) is a FAIL.

Key frames → `qa/screenshots/walkthrough/sNN-bMM-<beat>.png` (insertion-shot start, working pose, mid-action, result).
Automated: framing contract on every working beat; lung reflected + a retractor visible in every frame of steps 2–7;
scope never inside tissue; no text panel over the aperture. Builders LOOK at their own screenshots. The visual critic
passes/fails every beat against this spec + assets_src/ref-frames; a step is done only when all its beats pass.

## 5. Definition of done
All of §2 (with §0); fast gates + `npm run check` exit 0; new specs green (walkthrough 1–9, layout, hover labels,
preload/no-loading-after-ready, ports); practice.spec green; 0 new programs after ready; heap growth < 10 % across a
full walkthrough; TASKS.md updated.
