# Prompt for Claude Code + Blender MCP: refine RML anatomy v7 → v8

Paste everything below the line into a fresh Claude Code chat that has the Blender MCP connected. Open
`RML_lobectomy_anatomy_v7.blend` in Blender first. Give the chat `HANDOVER_v7_RML_anatomy.md` too.

---

You are a senior medical 3D artist and technical artist working in Blender through the Blender MCP tools. You are refining **v7 → v8** of the right-lung hilum model for **ThoraScope**: a browser (three.js) simulator of a **VATS right middle lobectomy, anterior approach**. Trainees view it through a simulated 30° thoracoscope, close up.

**v8 must be a drop-in replacement for v7.** The simulator reads object names, shape key names and world coordinates from a manifest, and needs no code changes if you keep the contract below. **Do not rename, add or remove objects or shape keys** unless this brief says so.

## 1. Files
- **Input:** `F:\Thoracic Simulator Website Project\RML_lobectomy_anatomy_v7.blend`. Save as `RML_lobectomy_anatomy_v8.blend` and never overwrite v7.
- **Read first:** `HANDOVER_v7_RML_anatomy.md`. It describes how v7 was built (analytic shape-key fields, hilum anchor weights, calibre scaling).
- **Visual references:** STS "VATS Lobectomy Illustrated" (Blackmon/de la Flor), RML section 6:50–9:10, plus any real VATS frames the user attaches.

## 2. Contract (unchanged from v7)
- **Coordinates:** Blender world coordinates of the existing simulator scene, in metres, with every object transform identity.
  - **Axes:** +X = cranial, −Y = anterior, +Z = patient right (lateral, the "up" side, because the patient lies in left lateral decubitus).
  - **Export:** glTF +Y up overlays the simulator's chest wall exactly. Never move, rotate or scale objects. Edit vertices instead.
- **Objects (27, keep all):**
  - **Lobes:** `lung_upper_lobe_right`, `lung_middle_lobe_right`, `lung_lower_lobe_right`.
  - **Trees:** `pulmonary_artery_tree`, `pulmonary_vein_tree`, `bronchial_tree`.
  - **Middle lobe artery:** `middle_lobe_artery`, `_A4`, `_A5`. **Middle lobe vein:** `middle_lobe_vein`, `_V4`, `_V5`. **Middle lobe bronchus:** `middle_lobe_bronchus`, `_B4`, `_B5`. These are divided in the simulator, which hides each one, so they must stay separate objects.
  - **Lymph nodes:** `LN_4R`, `LN_7`, `LN_10R`, `LN_11R`, `LN_12R`.
  - **Soft tissue:** `mediastinal_pleura_hilum`, `hilar_connective_tissue` (the simulator's cautery dissects both), and `mediastinal_fat` (the simulator hides it, but keep it).
  - **Mediastinum:** `pericardium`, `phrenic_nerve_right`, `superior_vena_cava`, `azygos_vein`.
  - **Camera:** `cam_anterior_hilum`, unchanged.
- **Shape keys (6, relative to Basis):** `collapse_RUL`, `collapse_RML`, `collapse_RLL`, `retract_hilum`, `retract_RML_lateral`, `retract_fissure`.
  - **Basis:** the ventilated, inflated lung.
  - **Combination:** additive. The simulator uses all three collapse keys at 1 plus one retract key, and also the clamp test (`collapse_RML` 1 only).
  - **Hilum anchor:** stays within 1 mm of the Basis in every key. v7 achieves 0.000 mm; keep it.
  - **Which objects carry keys:** every lung, hilar and soft-tissue object carries all six keys. The four mediastinum objects carry none.
- **Materials:** flat `v7_*` (or `v8_*`) Principled materials, with no textures and no UVs needed. The simulator applies its own procedural textures.

## 3. What the simulator team measured in v7 (fix these)
These come from an automated check on `RML_v7.glb`: BVH inside/outside tests on sampled vertices, plus minimum distances.

| # | Problem | Measured | Fix |
|---|---|---|---|
| 1 | **Clamp-test overlap.** With `collapse_RML` 1 and RUL/RLL inflated, the collapsed RML moves into the inflated RLL. | 31 % of RML vertices are inside the RLL, up to **9.3 mm** deep. The RLL is inside the RML up to 7.7 mm. The overlap box is around x −100…−14, y 22…84, z −12…60 mm, centred near (−58, 58, 19). | Change `collapse_RML` so the RML collapses **towards its own hilum and away from the RLL**: less posterior drift, more anterior and medial, flattening against the anterior chest. Verify 0 % overlap (or under 0.5 mm) in the clamp pose **and** in OLV. Do the same check for `collapse_RUL` alone and `collapse_RLL` alone against the inflated neighbours. |
| 2 | **Vein tree passes through the artery tree** at the central hilum. | 1.9 % of `pulmonary_vein_tree` vertices are inside `pulmonary_artery_tree`, up to **2.4 mm** deep, in a region around x −15…−5, y −3…27, z 9…19 mm. This is probably where the superior PV crosses in front of the PA, after the v7 calibre increase. | Separate them by at least 0.5 mm, the vein in front (anterior) of the artery, and keep the anatomy. Check Basis and every pose. |
| 3 | Minor contact between the RML bronchus and the PA tree. | `middle_lobe_bronchus` is inside `pulmonary_artery_tree` up to 0.8 mm (3.6 % of vertices). `bronchial_tree` is inside the PA tree up to 0.4 mm. | Leave at least 0.5 mm of clearance. The interlobar PA lies on the bronchus intermedius, so touching is anatomically correct, but the surfaces must not pass through each other. |
| 4 | **Vessels at full `retract_hilum` still read long and straight** (v7 handover Problem 2). | The lobes travel about 65 mm. | Reduce the lobe travel to about 40–45 mm (just enough to open the anterior window from `cam_anterior_hilum`). Give the hilar trunks more S-curve and slack: short, curved trunks as in the STS drawings. Partial values must stay smooth. |
| 5 | **The lungs don't collapse nearly enough** (user, live check). The collapse also looks like uniform scaling (×0.82 / ×0.70 with soft folds). | v7 RUL: max displacement **30 mm**, bounding-box volume ratio **0.49**. The previous v3 model (which the user preferred): max **50 mm**, ratio **0.20**. | Collapse each lobe as deeply as v3: bounding-box volume ratio about **0.20–0.25**, max displacement about 45–55 mm towards its hilum and the posterior-medial gutter. A deflated lung looks flattened and flabby, with thin edges, a wrinkled visceral pleura and a soft sag, not shrunken. Use a cloth or softbody bake, or sculpted corrective deltas, baked into the same key names. The vessels and bronchi inside each lobe must follow, with no tearing. Re-check all §5 intersections (the deeper collapse changes them). |
| 5b | **Middle lobe arteries "flying in the air, disconnected"** (user, live check, steps 5–6 with `retract_fissure` or `retract_hilum` and collapse at 1). | — | Make sure `middle_lobe_artery`, `_A4` and `_A5` stay **continuously connected**: to the interlobar PA at the root, and into the middle lobe parenchyma at the far end, in **every** pose and partial value. The far ends must run inside the lobe, never ending in open air. Give A4/A5 a natural course along the fissure into the lobe. The simulator team also checks for a code-side cause. |
| 6 | **Fissure faces** come straight from the remeshed CT lobes (v7 handover Problem 6). | — | Make the horizontal and oblique fissure faces smooth and gently concave so they read clearly when `retract_fissure` opens them. Lobe-to-lobe clearance at Basis should be 0.2–0.5 mm, with no overlap. |
| 7 | **Left PA connection** not verified (v6/v7 handover Problem 4). | — | Check that the left PA start of `pulmonary_artery_tree` meets the simulator's existing left-lung vessels: about x −74, y −64 mm at the trimmed main PA. Tidy the cut end into a clean rounded edge where it disappears into the pericardium. |
| 8 | **Internal faces** in the connective strands and fat pads (v7 handover Problem 5). | — | Remove internal or duplicate faces. Make the strands proper tubes (0.2–0.4 mm) that blend into the vessel adventitia at both ends. |
| 9 | **File size:** 45 MB uncompressed. | — | Fine (the simulator compresses it). Don't increase the triangle count above about 650k. Lower it on the lower lobe (102k, rarely seen close up) if you need room for the hilum. |


**The simulator runs the collapse keys at a gain of 1.5 for v7** (manifest `collapseGain`). For v8 with the deeper collapse, the simulator sets it back to 1. So author the full collapse depth into the keys themselves.

**Not needed (the simulator now does these in code):**
- **Stump caps** at divided segments: the simulator generates the stump and staple line where each segment meets its parent. Just keep the segments overlapping their parents slightly (flared roots), as in v7.
- **Heartbeat:** a code-driven pulse on the PA tree and pericardium.
- **Textures, rings in texture form, and colour:** procedural in the simulator.

## 4. Optional: the heart
If the user has a revamped heart model, import it as one object named `heart`, inside `pericardium`, with no shape keys, and with no intersection with the pericardium (at least 0.5 mm gap). If there isn't one, skip this and say so.

## 5. Working method
1. **Inspect** the v7 objects and keys through the MCP. Write a short plan and fix §3 in order, problems 1 and 2 first.
2. **Write and run an intersection check script in Blender** (Python, mathutils BVHTree). For each pose below, report the percentage and depth of vertices inside each listed pair:
   - **Poses:** Basis; OLV; OLV + each retract key at 0.5 and at 1; the clamp test; and `collapse_RUL` alone and `collapse_RLL` alone with the others inflated.
   - **Pairs:** lobe–lobe; PV tree–PA tree; bronchus–PA; the RML vein/bronchus/artery mutually.

   The target is 0 % overlap deeper than 0.5 mm everywhere. Include the table in the handover.
3. **Measure the hilum anchor** for each key; it must be 1 mm or less.
4. **Render** from `cam_anterior_hilum` and from a lateral fissure view:
   - Basis, OLV, and OLV + `retract_hilum` at 0.5 and 1
   - OLV + `retract_RML_lateral` 1, OLV + `retract_fissure` 1
   - the clamp test

   Use one light near the camera, like a scope. Compare honestly with the STS frames.
5. **If anything is anatomically doubtful, stop and ask the user.**

## 6. Export (same as v7)
- **Format:** glTF 2.0 `.glb`.
- **Include:** Cameras on, Custom Properties on.
- **Transform:** +Y up.
- **Mesh:** Apply Modifiers, Normals.
- **Shape Keys:** on, with **Shape Key Normals on**.
- **Compression:** **off**.
- **File:** `RML_v8.glb`.
- **Verify:** re-import into an empty scene and check that the 27 objects, 6 keys and the camera are present and the transforms are identity.

## 7. Report: `HANDOVER_v8_RML_anatomy.md`
Use the same structure as v7, plus:
- the intersection table from §5 step 2, before (v7) and after (v8);
- the anchor displacement per key;
- what changed for each §3 item, and any item not done, with the reason;
- a list of the render files.
