# User live-check feedback on v7 (2026-11-05, evening): spec for T840–T845

The user tested v7 in the browser. Each item below has its owner task. Read `docs/MODEL_INTEGRATION.md` and `src/content/anatomy.json` (the manifest) too. Everything model-specific stays manifest-driven, so that v8 is a drop-in.

## Interaction (T840)
1. **Cursor-driven instruments.** Every instrument follows the cursor: the tip goes to the surface under the cursor, constrained by the instrument's port pivot. A left click fires or acts: grasp, cautery on while held, stapler fire, clamp close, clip apply, suction while held.
2. **Several instruments at once, one per port.**
   - **Capacity:** each port holds one instrument. The 4 cm access incision (utility port) takes **two**, as in real anterior VATS; the scope also occupies one position.
   - **Persistence:** an instrument left in a port **stays in place** (still holding or retracting) when the user switches to another instrument in another port.
   - **Realistic inventory (max simultaneously):** 1 camera/scope, 2 lung graspers, 2 peanuts, 1 cautery, 1 powered stapler, 1 clamp, 1 suction, 1 ring forceps.
3. **Retraction in any direction.** A grasper or peanut on a lung segment reflects it in **any** drag direction (not only one way), enough to reach the hila. Blend the manifest retract keys (`retract_hilum`, `retract_RML_lateral`, `retract_fissure`) plus collapse from the 2D drag vector and the grasped lobe. Hold keeps that pose until released.
4. **Bronchus or vessel clamp.** The clamp closes on the structure and **stays on until the user releases it**, with realistic animation: the jaws close around the structure, which is compressed slightly.
5. **Lymph node removal.** The grasper or ring forceps grasps `LN_11R` / `LN_12R` and pulls it out: the node follows the tip, then disappears on withdrawal. This leaves a **small bleed that needs cautery**. T842 handles the bleed visuals; the hook is in complications.

## Stapler, clamp, division and stumps (T841)
6. **Powered vascular stapler.** Shape it after the user's reference photos (no brand names, ever):
   - long round steel shaft with an articulating knuckle;
   - long jaws: a steel anvil with a **curved tapered tip** and a cartridge jaw with a **coloured reload** (blue for vascular/bronchus, white or tan for parenchyma) and depth marks;
   - a white pistol-grip handle with a rotation knob, seen outside.
7. **Alignment.** The stapler and clamp jaws must cross the vessel or bronchus **perpendicular to its course**, at the right angle. Derive the local axis at the contact point from the structure's geometry (for example PCA of nearby vertices) or from `targets.ts` axes. The jaws close around it, not into it.
8. **Firing animation.** The jaws close, a short compression pause follows, then staples form along both rows progressively, and a knife-line divides the structure. No staples or clips "appear out of nowhere".
9. **Division leaves two stumps.**
   - **Proximal stump:** on the parent tree (T834 stump, staple line).
   - **Distal stump:** the specimen side of the segment, staying attached to the lobe until the lobe is removed, with its own staple line.
   - **Implementation:** split each divided segment at load at its cut position into proximal and distal pieces (copy the morph deltas). At division, hide the proximal piece and show both caps.
   - Clips on vessels or lung likewise divide and leave two stumps.
10. **Stumps and clips pulse** with the heartbeat: they ride their parent's pulse.
11. **Middle lobe arteries "flying in the air, disconnected".** Investigate at steps 5–6 poses (`retract_fissure` / `retract_hilum`, collapse at 1): is it the model (v7 geometry, a v8 item) or code (morph mapping, hidden parent, collapse gain)? Fix code causes. Report model causes for the v8 prompt.

## Cautery, smoke, water, pulse (T842)
12. **Dissection is persistent.** Today the 48-point ring buffer recycles, so dissected tissue reappears as cautery continues. Replace it with a **per-vertex dissected attribute**, pre-allocated at load and written only on contact, with discard where it is open. There must be no limit and no reappearing, and it resets on step or mode change.
13. **Smoke.** Excessive cautery fills the field with smoke: haze builds with cumulative energy time, so the view degrades. **Suction** clears it while held near the smoke.
14. **Irrigation and leak test.** At the end, "Irrigate the field" fills the right hemithorax with saline:
    - a water volume or surface rising until the hilum and the stumps are **submerged**;
    - wet refraction or tint, and caustic-like sparkle;
    - no bubbles, so no air leak. If a staple line failed, show bubbles.
    - **Suction** then removes the water as the level falls.
15. **Heartbeat transmitted** to all hilar vessels (PA tree strongest, veins subtle), the stumps, and the pericardium.
16. **Lymph node bed bleed:** a small ooze that cautery stops (reuse the coagulation logic).

## Camera, orientation, ventilation, labels, collapse (T843)
17. **No piercing organs, and no leaving the body.**
    - **Scope:** the tip can't enter any organ mesh. Clamp insertion and pivot so the tip stays outside surfaces: a BVH ray from the port along the shaft, with a margin. The scope also can't exit through the chest wall.
    - **Outside orbit:** the camera can't go inside the body.
18. **Orientation compass:** anterior and posterior are inverted. In this right-side-up (left lateral decubitus) position the **heart is anterior**. Use glTF world axes (+X cranial, +Z anterior, +Y lateral/up), not `thorax_root`'s local frame, and verify against the heart's position.
19. **Ventilation switch** in guided, practice and explore (not only the Physiology lab): **One-lung ventilation / Two-lung ventilation**. Two-lung ventilation re-inflates the right lung, which gets in the way, as in real life.
20. **Labels:** clicking the inferior surface of the lung says "mediastinal fat". The kept v3 CT fat (`mediastinal_fat_ct`) catches picks. Make it non-pickable, and make sure the lung surface labels correctly everywhere.
21. **Lungs don't collapse enough** (compared with the previous model). As a code mitigation, add a config gain on the `collapse_*` morph influences (about 1.4–1.6). The v7 collapse is analytic, so extrapolating stays connected. Check that nothing tears. The v8 prompt asks for a deeper collapse in the model.

## Guided steps, demonstration, practice alignment (T844)
22. **New step: lymph nodes.** Before the current bronchus step, add a step that grasps and removes the lymph nodes 11R/12R, to better visualise the anatomy, with a small bleed that is cauterised.
23. **Fissure completion and lobectomy demonstration** in guided and explore. The grasper holds and pulls the middle lobe, the powered stapler is passed across the fissure and fired (completing the horizontal and oblique fissures), the lobe is divided, and then the lobe is removed in a bag. Animate it as a scripted demonstration using the instrument API.
24. **Final step: irrigation leak test + suction** (see 14).
25. **Practice mirrors guided one to one:**
    - **Same steps, same order, same instruments.**
    - **First step clearly explained:** what to do, with which instrument, and where.
    - **Correct instrument roles:** peanut or grasper (not the clamp) to make the passage around a vessel; the clamp only to clamp a vessel or bronchus; the stapler to divide.

### New step list (9 steps)
1. Inspect the chest (two-lung or one-lung ventilation choice).
2. Expose the hilum: graspers retract, cautery opens the hilar pleura.
3. Middle lobe vein: dissect, make the passage with a peanut or grasper, staple.
4. **Lymph nodes 11R/12R:** grasp and remove, cauterise the bleed.
5. Middle lobe bronchus: clamp, test ventilation, staple.
6. Middle lobe arteries A4/A5: passage, staple.
7. **Complete the fissures:** grasp and pull the middle lobe, stapler across the fissures.
8. Remove the lobe: bag, retrieve.
9. **Irrigate and leak test**, then suction.

Manifest `divideStep` / `clearStep` / `dissectStep` / `removedAfterStep` are renumbered to match (T844 owns `anatomy.json`).

## v8 model items (orchestrator, docs/BLENDER_PROMPT_v8.md)
- Deeper collapse, like the previous v3 model.
- RML arteries connected (if the cause is model-side).
- Fissure geometry for stapling.
- Everything in the existing v8 prompt.
