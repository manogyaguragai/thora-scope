# MODEL_SPEC — 3D models that would take ThoraScope to the next level

Written 2026-11-05 for the user, who will create or source the models.
Put the deliverables in `assets_src/` (read-only to agents) and the pipeline (`npm run assets:optimize`) takes over.

## Global rules (all files)
- glTF 2.0 binary (`.glb`), **real scale in metres**, Blender Z-up export with "+Y up" ticked (the app expects glTF Y-up; CONTEXT §7.1).
- **The patient is in left lateral decubitus, right side up.** The anatomy must sit in one shared world frame across all files.
- One **mesh per anatomical structure**. Node names must be exactly the names below (CONTEXT §7.2). New structures use the same `snake_case` style.
- **PBR metallic-roughness materials.** Per structure: albedo + normal + roughness at 2K, or 1K for small parts. UVs must be unwrapped without stretching. No baked lighting.
- **Clean, watertight, quad-dominant topology.** Smooth tubes need consistent wall thickness; avoid long thin triangles, since morphs stretch them.
- **Morph targets:** the same vertex count and order as the base mesh, and names exactly as listed. A structure inside a lobe carries that lobe's morphs too, so it moves with the lobe.
- **Budget before optimisation:** about 1.5 M triangles and about 60 MB source in total. The pipeline compresses to about 12 MB.
- **Licence:** state the source and licence (CC0, CC-BY or own work). CC-BY-SA material (BodyParts3D, Z-Anatomy) needs attribution and share-alike, so check that it fits.

## 1. Right-lung hilum + lobes — highest impact (fixes "vessels/bronchus confusing, distorted")
This replaces today's low-detail vessels, which are tubes of about 6k triangles each. Model it from a real chest CT if possible. One route is TotalSegmentator (lobes, pulmonary artery/vein, airway) on a public CT, then retopologise and sculpt in Blender.

| Group | Node names | Notes |
|---|---|---|
| Pulmonary artery | `pa_trunk`, `pa_right_main`, `truncus_anterior`, `pa_interlobar`, `A_RML_common`, `A4_lateral`, `A5_medial`, `A6_superior_segment`, `A_RLL_basal`, `A_RUL_posterior_ascending`, `pa_left` | 20–40k tris per major vessel. A4/A5 come off the interlobar PA in the fissure, opposite A6. Vessel wall albedo is blue-grey with a slight sheen. |
| Pulmonary veins | `V_superior_right`, `V1_apical`, `V2_posterior`, `V3_anterior`, `V_RML_common`, `V4_lateral`, `V5_medial`, `V_inferior_right`, `left_atrium` | The RML vein (V4/V5) drains into the **superior** pulmonary vein, the key danger point. Darker, plum-blue albedo. |
| Airway | `trachea`, `bronchus_right_main`, `bronchus_RUL`, `bronchus_intermedius`, `B_RML_common`, `B4_lateral`, `B5_medial`, `bronchus_RLL` | **Cartilage rings** as real geometry, or at least a normal map; pale ivory; membranous posterior wall. |
| Lymph nodes | `LN_2R`, `LN_4R`, `LN_7`, `LN_10R`, `LN_11R`, `LN_12R` | Irregular lobulated shapes, 2–6k tris each; grey-brown with anthracotic black flecks. 11R sits between the RML and RLL bronchi and must be reachable from the anterior view. |
| Nerves | `phrenic_nerve_right` (on the pericardium, anterior to the hilum, with pericardiophrenic vessels), `vagus_nerve_right` (posterior) | Thin cords with a slight fibre texture. |
| Mediastinum | `superior_vena_cava`, `azygos_vein` (arch over the right main bronchus), `inferior_vena_cava`, `aorta`, `heart_rest`, `pericardium`, `esophagus` | The pericardium is a separate thin shell over the heart. |
| Soft tissue layers | `mediastinal_pleura_hilum` (thin translucent sheet over the hilum, which the cautery opens), `hilar_connective_tissue` (areolar tissue around vessels), `mediastinal_fat` (lobulated yellow fat) | These layers are what make dissection look real: tissue is peeled to reveal the vessel. |
| Lobes | `lung_upper_lobe_right`, `lung_middle_lobe_right`, `lung_lower_lobe_right`, `lung_upper_lobe_left`, `lung_lower_lobe_left` | 60–100k tris each. Real **horizontal + oblique fissures** with smooth fissure faces. Any incomplete fissure is a separate mesh `fissure_bridge_horizontal` / `fissure_bridge_oblique`. Textures: pink-grey visceral pleura, polygonal lobule pattern, anthracotic speckle. |

**Lobe morph targets (most important):**
- `collapse_RUL`, `collapse_RML`, `collapse_RLL`: deflated lobe under one-lung ventilation, 40–60 % volume.
- `retract_posterior`: collapsed lung pushed posteriorly, exposing the anterior hilum (step 2–3 view).
- `retract_fissure`: RUL up, RLL down, RML lifted, opening the fissure to expose the interlobar PA, A4/A5 and A6 (step 5–6 view).
- **New, `grasp_RML_lateral`:** the RML pulled laterally/anteriorly by a grasper, to put the hilum under tension (step 3–4 view).
- `breath_left`, `heartbeat` (heart and great vessels), `mediastinal_shift`.
- Every vessel, bronchus and node inside a lobe carries the same morph names.

## 2. Chest wall interior (what the scope sees around the field)
- `parietal_pleura_wall` (inner surface) with **visible rib ridges and intercostal grooves**, glossy and thin, with fat showing through.
- `endothoracic_fat`, `internal_mammary_vessels`, `sympathetic_chain` (over the rib heads), `intercostal_vessels`, `diaphragm` (dome, with tendon centre).
- Ports as real openings in the wall: `port_camera_8ICS`, `port_retraction_8ICS`, `port_utility_5ICS`. Keep the `extras` `skin_point` / `pleura_point` / `axis_into_chest`. The utility port has a **soft wound protector** ring, `wound_protector_utility`.

## 3. Instruments — separate `instruments.glb` (fixes "instruments look horrible")
Each instrument is its own root node. Pivots are empties at the hinge, with jaw nodes parented to the pivot. Each instrument has a **tip** (≤ 10k tris, seen in the scope) and a **handle** (≤ 10k, seen outside). Steel is brushed (roughness 0.2–0.35); shafts are matte black insulation with white depth bands.

| Node | Real reference |
|---|---|
| `inst_thoracoscope_30` | 10 mm, 30° angled tip, light post, camera head with cable |
| `inst_lung_grasper` | VATS fenestrated lung grasper (oval/triangular ring jaws), double-hinged long shaft, ring handles; jaws `jaw_upper` / `jaw_lower` |
| `inst_maryland` | Curved Maryland dissector, fine serrated jaws |
| `inst_ring_forceps` | Curved VATS ring / sponge-holding forceps (also holds the peanut swab, `swab_peanut`) |
| `inst_hook_cautery` | L-hook diathermy: thin wire hook, insulated sheath, coloured handle with buttons |
| `inst_endostapler` | Endoscopic stapler (Endo GIA / Signia style): articulating knuckle `stapler_knuckle`, `stapler_anvil`, `stapler_cartridge` with separate cartridge colour materials (white/tan/purple/black), handle with rotation knob |
| `inst_suction` | Yankauer-style VATS suction tip |
| `inst_clip_applier` | Optional: Hem-o-lok clip applier + `clip_hemolok` |
| `inst_specimen_bag` | Optional: retrieval bag on its introducer, for step 7 |

## 4. Operating theatre (optional; only the outside view benefits)
- **Patient:** a full-body patient in **left lateral decubitus** on the table, with arm boards and axillary roll. Sterile drapes as their own meshes, leaving an incise-drape window over the right chest.
- **Room:** an operating table with a kidney break, anaesthesia machine + monitor (with a flat `monitor_screen` plane for the live vitals texture), two ceiling lamps, a Mayo stand, scrub nurse trolley, and the video tower.
- **Gloved hands:** only if you want an outside-view hands animation. Two hands in surgical gloves gripping an instrument handle, rigged (wrist + finger bones). A surgeon never sees hands through the scope.

## Priority if time is short
1. **Section 1 hilum + lobes with morphs.** This alone fixes most of the "distorted / unclear anatomy".
2. **Section 3 instruments:** lung grasper, hook cautery, endostapler, ring forceps, thoracoscope.
3. **Section 2 chest wall interior.**
4. **Section 4 theatre:** the patient model, then the rest.
