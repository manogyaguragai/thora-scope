# Prompt for Claude Desktop (Blender): refine the ThoraScope hilum model

Paste everything below the line into Claude Desktop with the Blender connection enabled. Attach the starting
`.blend`/`.glb` and the reference images (e.g. the frames in `ref-frames/`).

---

You are a senior medical 3D artist working in Blender through the Blender tools. You are refining an anatomical model for **ThoraScope**, a browser-based (three.js) simulator of a **VATS right middle lobectomy, anterior approach**. Trainees view the anatomy through a simulated 30° thoracoscope, so it has to look like the real thing at close range: wet, glistening, smooth, with clear 3D separation between vessels, bronchus and nodes.

## Inputs I'm giving you
1. **A starting model** of the right-lung hilum, lymph node stations and lobes, with views of the lung grasped and retracted.
2. **Real reference images** from a VATS right middle lobectomy video. Study them before you touch the mesh. Match these:
   - **Colours:** blue-grey pulmonary artery, darker plum-blue veins, ivory ringed bronchus, grey-brown nodes with black anthracotic flecks, yellow lobulated fat, pink-grey visceral pleura with a polygonal lobule pattern.
   - **Wetness:** sharp specular highlights.
   - **Proportions and arrangement:** how the structures sit and branch.

## Your job
1. **Inspect first, then plan.** List every object with its name, triangle count, modifiers, shape keys and materials. Compare it with the references and with the anatomy below. Write a short plan of what you'll fix, then work through it.
2. **Smooth and refine the geometry so it reads as real organs:**
   - Vessels and bronchi: smooth round tubes, consistent wall thickness, natural tapering, and smooth branch junctions (fillets, not sharp T-joints). No lumpy or faceted surfaces, no long thin triangles.
   - Branches: each branch runs 3–5 mm into its parent vessel or lobe, so no open ends float in space.
   - Bronchus: visible cartilage rings (geometry, or at least a normal map) and a flatter membranous back wall.
   - Lymph nodes: irregular, lobulated, slightly flattened ovoids, 5–15 mm, nestled in fat between the bronchi and vessels. Not spheres.
   - Lobes: smooth parenchyma, clean horizontal and oblique fissure faces, and a soft rounded lung edge. No jagged slabs or stair-steps.
   - Soft tissue that wraps the hilum and hides every seam:
     - a thin translucent mediastinal pleura sheet over the hilum, which the surgeon opens;
     - loose areolar connective tissue around the vessels;
     - lobulated fat.
     Real hilar anatomy is wrapped like this, and it is what makes the separate parts read as one body.
   - Retopologise or remesh where needed, then add a subdivision or smooth pass. Apply modifiers before export.
3. **Anatomy to get right** (right lung, patient in **left lateral decubitus**, right side up):
   - **Pulmonary artery:** the right main PA gives off the truncus anterior to the upper lobe, then continues as the interlobar PA in the fissure. The **middle lobe arteries A4 (lateral) and A5 (medial)** come off the interlobar PA facing the middle lobe, roughly opposite A6 to the superior segment of the lower lobe.
   - **Veins:** the **superior pulmonary vein** drains the upper lobe (V1–V3) **and the middle lobe (V4/V5, joining as the RML vein)**. It is the most anterior hilar structure and the first one the surgeon divides. The inferior pulmonary vein drains the lower lobe.
   - **Airway:** the right main bronchus gives off the RUL bronchus, then continues as the bronchus intermedius. That splits into the **middle lobe bronchus (B4/B5)**, anteriorly, and the lower lobe bronchus.
   - **Lymph nodes:**
     - 4R: right lower paratracheal.
     - 7: subcarinal.
     - 10R: hilar, at the main bronchus.
     - 11R: interlobar, between the RML and RLL bronchi.
     - 12R: lobar, at the RML bronchus.
   - **Nerves:** the phrenic nerve runs over the pericardium in front of the hilum, with the pericardiophrenic vessels. The vagus runs behind the hilum.
   - **Mediastinum:** the azygos arches over the right main bronchus into the SVC. The pericardium is a separate thin shell over the heart.
4. **Materials, in a form the glTF export can carry:**
   - PBR metallic-roughness only, using a Principled BSDF with image textures.
   - **Bake any procedural nodes to images** (Base Color, Normal, Roughness), because glTF can't carry Blender procedural nodes.
   - Texture size: 2K for large organs, 1K for small parts. Keep texel density consistent across everything.
   - UVs unwrapped without stretching. Don't bake lighting or AO into Base Color.
   - Wet tissue roughness: about 0.15–0.35 for the vessels, pleura and lung. Fat is slightly rougher.
5. **Shape keys** are the "views" the simulator plays.
   - **Rules:**
     - Keep the **exact names** below.
     - Every structure inside a lobe (its vessels, bronchi and nodes) gets the **same** shape keys as that lobe, with the same values, so they move together and never separate.
     - Build the shape keys with all attached structures present.
     - Never change vertex count or order after adding shape keys.
   - **The keys:**
     - `collapse_RUL`, `collapse_RML`, `collapse_RLL`: the lobe deflated under one-lung ventilation, about 40–60 % of its volume.
     - `mediastinal_shift`: about a 1 cm shift towards the ventilated side.
     - `retract_posterior`: the collapsed lung pushed back to expose the anterior hilum (superior pulmonary vein, V4/V5, phrenic nerve).
     - `retract_fissure`: RUL up, RLL down and RML lifted, opening the fissure to expose the interlobar PA, A4/A5 and A6.
     - **New, `grasp_RML_lateral`:** the middle lobe pulled laterally and anteriorly by a lung grasper, putting the hilum under tension.
     - `heartbeat`: the heart and great vessels in systole.
     - `breath_left`: the left lung inspiring.
6. **Naming. Exact object names are required: the simulator finds structures by name.**
   - **Keep every existing name from the starting model unchanged**, including the ports and the step cameras below. Use these for the hilum:
     - **Artery:**
       - Existing: `tree_pulm_artery_base`, `A_RML_common`, `A4_lateral`, `A5_medial`, `A_RML_accessory_1`, `A_RML_accessory_2`, `A_RML_extra_1`, `pa_left`.
       - New: `pa_trunk`, `pa_right_main`, `truncus_anterior`, `pa_interlobar`, `A6_superior_segment`.
     - **Vein:**
       - Existing: `tree_pulm_vein_base`, `V_RML_common`, `V4_lateral`, `V5_medial`, `V_RML_accessory_1`, `V_RML_accessory_2`.
       - New: `V_superior_right`, `V_inferior_right`.
     - **Airway:**
       - Existing: `tree_airway_base`, `B_RML_common`, `B4_lateral`, `B5_medial`.
       - New: `bronchus_intermedius`.
     - **Nodes:** `LN_4R`, `LN_7`, `LN_10R`, `LN_11R`, `LN_12R`.
     - **Soft tissue:**
       - Existing: `mediastinal_fat`, `mediastinal_fat_window`, `hilar_connective_tissue`, `hilar_connective_tissue_window`, `pericardium`, `inferior_pulmonary_ligament`.
       - New: `mediastinal_pleura_hilum`.
     - **Lobes:** `lung_upper_lobe_right`, `lung_middle_lobe_right`, `lung_lower_lobe_right`, `lung_upper_lobe_left`, `lung_lower_lobe_left`.
     - **Mediastinum:** `phrenic_nerve_right`, `vagus_nerve_right`, `azygos_vein`, `superior_vena_cava`, `inferior_vena_cava`, `aorta`, `heart_rest`, `esophagus`, `diaphragm`.
     - **Incomplete fissures,** if present, as separate objects: `fissure_bridge_horizontal`, `fissure_bridge_oblique`.
   - **Don't touch:**
     - Cameras `cam_1_inspection` … `cam_7_reinflation`.
     - The port objects `port_camera_8ICS`, `port_retraction_8ICS`, `port_utility_5ICS`, and their custom properties `skin_point`, `pleura_point`, `axis_into_chest`.
     - The `thorax_root` parent and its transform.
     - The patient's position.
   - If you need to move anatomy, move it inside `thorax_root`. Never move the root or the cameras.
7. **Budgets:**
   - Major vessels and the bronchus: about 20–40k triangles each.
   - Nodes: 2–6k each.
   - Lobes: 60–100k each.
   - Whole file: about 1.5 M triangles at most, and about 60 MB .glb at most.

## Export (glTF 2.0)
- File > Export > glTF 2.0, **.glb**, with Include: Cameras and Custom Properties.
- Transform: **+Y Up**.
- Mesh: Apply Modifiers, UVs, Normals.
- Shape Keys: on, **with Shape Key Normals**. The previous model exported positions only, and the retracted lung rendered with dark stripes.
- Compression: off. The simulator's own pipeline compresses it.
- Name the file `thorax_sim_v4.glb`. Also save the `.blend`.

## Before you finish, verify and report
- [ ] A table of objects: name, triangles, shape keys, material, and texture sizes.
- [ ] Every name from section 6 is present and spelled exactly; nothing existing was renamed or deleted.
- [ ] Every structure inside a lobe has the same shape key names as its lobe.
- [ ] No open vessel or bronchus ends, no visible gaps at junctions, and no organs passing through each other in the rest pose **and** with each shape key at 1. Check the retraction keys especially.
- [ ] Renders, in Eevee or Cycles with one light near the camera like a scope: the step camera views `cam_2`, `cam_3`, `cam_5` and `cam_6`, with `retract_posterior` = 1 for cam_2/3 and `retract_fissure` = 1 for cam_5/6. Put each next to the closest reference image and say honestly what still differs.
- [ ] Any anatomy you weren't sure about, flagged for clinician review.

Work in small steps and show me renders as you go. Prioritise, in order:
1. A4/A5, V4/V5 and B4/B5 being clearly distinct and correctly arranged.
2. Smooth junctions, with tissue wrapping hiding the seams.
3. The retraction views exposing the hilum.
4. Wet, real-looking materials.
