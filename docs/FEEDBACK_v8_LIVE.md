# User live-check feedback on v8 (2026-11-06): spec for T850–T852

Read this together with `docs/FEEDBACK_v7_LIVE.md`, `docs/MODEL_INTEGRATION.md` and `src/content/anatomy.json` (the manifest).

## T850: instrument interaction (owner of `src/app/wireM4.ts`)
1. **Choosing the port.** "How can I select the port from which I need an instrument inserted? All instruments are being inserted from the same port." Picking a tool must let the user choose the port explicitly:
   - a compact **"Insert via: Camera port · Anterior port · Access incision"** picker appears next to the port chips (or on the hotbar slot), with a keyboard path;
   - full or not-allowed ports are greyed out, with the reason;
   - the tool then enters through that port.

   Plain P (with an instrument) still moves it to the next port. Clicking an instrument's port chip re-inserts it there. Keep the one-per-port rule, with two in the access incision and the realistic inventory limits.
2. **Right click parks the instrument.** The instrument stays exactly where it is (holding whatever it holds) and the cursor is freed. Picking that instrument again (hotbar or its port chip) resumes cursor control.
3. **No tissue penetration, by tissue type.** The tip of every instrument stops at tissue surfaces, with a BVH check along the shaft and at the tip, throttled.
   - **Chest wall, mediastinum, vessels, heart, bronchus:** the tip never goes past the surface.
   - **Lung:** the instrument pushes the lung. A local indent (pre-built uniform-driven vertex push on the lung tissue classes, compiled at load) deepens as the tip presses, with a cap and an eased spring-back.
   - **Dissectable soft tissue** (hilar pleura, connective strands): contact is allowed. Cautery and peanut dissect it (T852).
4. **Lymph node sample.** After grasping LN_11R/LN_12R and pulling it out, the node sticks to the instrument forever. When a node is held and withdrawn, show **"Record sample: Station 11R"** (button and key). It records the sample (toast; listed in the practice debrief), removes the node from the instrument and hides it. Withdrawing also records it automatically, with the same toast.

## T851: guided demonstrations (owner of `src/app/guidedDemo.ts`, guided content)
5. **Guided must start at step 1.** Today it auto-starts at step 2.
6. **"Show me" doesn't work.** The camera zooms out and shows the outside of the lung. Rewrite it as a real **cinematic demonstration per step**, which the user then repeats:
   1. reset to that step's scope view (camera rig tween);
   2. animate each instrument **inserted through its correct port along the port axis**: visible shaft sliding in, tip approaching the target;
   3. perform the action visibly (grasp and lift, sweep cautery opening tissue, peanut sweep, clamp close, stapler close and fire, bag);
   4. move the camera as a surgeon would to keep the action in view;
   5. withdraw or leave instruments as the next step needs.

   **Example, steps 1–2:** the camera is inserted from the camera port and pans across all three lobes, the fissures and the phrenic nerve. A grasper comes in from one port, grasps the lung and lifts it. The camera adjusts to the hilum. The cautery comes in and dissects the hilar pleura over the vein. Then on through all 9 steps (see the step list in `FEEDBACK_v7_LIVE.md`).

   Each demo is replayable and skippable. At the end the scene is left in that step's start state so the user can play around.
7. **Middle lobe division (step 7) must be shown and guided.** When the user reaches step 7, draw a **dotted guide line** along the plane that divides the middle lobe from the upper and lower lobes (the fissures). It is computed at load from geometry: the contact or proximity band between `lung_middle_lobe_right` and the other two lobes, in the step pose.
   - The user fires the powered stapler **segment by segment** along it. Each fire turns that segment of the dotted line into a staple line and divides that part of the parenchyma.
   - Once all segments are fired, the middle lobe is **free**: it drifts slightly with the grasper, and the step completes.
   - The demo shows exactly this sequence. Step 8 bags and removes the lobe.

## T852: suction and peanut dissection (owner of `src/scene/effects.ts`, `src/scene/water.ts`, `src/sim/actions/dissect.ts`)
8. **The sucker doesn't remove smoke** (and the haze doesn't clear). Fix it in the real cursor-driven flow: holding the sucker near the field clears smoke and haze at the config rate.
9. **The sucker doesn't remove water either.** Holding the sucker in the irrigated field lowers the water level until it is dry.
10. **The peanut dissects the hilar fascia.** Running the peanut over `mediastinal_pleura_hilum` / `hilar_connective_tissue` clears it (blunt dissection), using the same persistent opened-tissue attribute as cautery, with no char and no smoke.
    - Progress counts towards the dissect steps.
    - Its opening is a little wider and softer than cautery's, with no coagulated rim.

## Already working (user observation, keep it)
- The blood spillage after lymph node removal is visible.
