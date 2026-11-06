# Model integration: RML hilum + lobes (v7 now, v8 next) — 2026-11-05

Source: `assets_src/RML_v7.glb` (user copies it there; agents never write to assets_src). Handover: `~/Downloads/surgery-docs/HANDOVER_v7_RML_anatomy.md`. **Everything model-specific lives in `src/content/anatomy.json` (the manifest): source path, removed-from-base list, morph keys, and per-structure tissue / lobe / group / divideStep / dissectStep / danger / pulse / hidden. Code reads the manifest — never hard-code hilum names elsewhere — so v8 (same names, docs/BLENDER_PROMPT_v8.md) is a drop-in: copy the file, bump `source`, `npm run assets:optimize`.**

## User decisions (2026-11-05)
1. **Morphs (v7 has all six keys):** `collapse_RUL/RML/RLL` (OLV, Physiology lab, clamp test — now visible), `retract_hilum` (whole lung lifted, anterior hilar window; guided steps 2–5), `retract_RML_lateral` (grasper on the middle lobe), `retract_fissure` (fissure opened; step 6 + grasper in the fissure). Additive deltas from the inflated Basis; surgery = all collapse at 1 + a retract key. The old `retract_posterior` / `mediastinal_shift` names are gone; the left lung keeps `breath_left`, `heart_rest` keeps `heartbeat`. Heartbeat pulse on the PA tree / RML arteries / pericardium is done in code (manifest `pulse` weights).
2. **Soft tissue:** v7 made `mediastinal_pleura_hilum` (0.4 mm translucent sheet) and `hilar_connective_tissue` (≈45 strands): cautery dissection is BACK on these two (manifest `dissectable`, `dissectStep`). `mediastinal_fat` stays hidden (user: "no need of hilar fat"). Parietal pleura stays dissectable.
3. **Camera:** steps 2–5 keep the scope in a real port, aimed at the hilar target of `cam_anterior_hilum` (reference only) with its framing (cranial right, caudal left, medial down) as far as the port allows.
4. **Colours:** Realistic + procedural textures default; Teaching palette = STS (artery blue, vein red, bronchus ivory, nerve yellow).
5. **Code fixes for v7 model defects:** rounded stump + staple line generated at load at each divided segment's junction with its parent (v7 has no stump caps); everything else model-side goes to v8.

## Coordinates
v7 geometry (like v6) is already in glTF **world** space of the existing scene, and every transform is identity. Bounds were checked against v3: nodes, SVC, azygos, phrenic and pericardium match within 1–2 mm, and the lobes sit 3–7 mm inside the old ones.
- Add the model nodes at the **scene root**, never under `thorax_root` (whose scale is 1.3).
- Do not transform them.

## Build
`npm run assets:optimize` merges the two files into the shipped `public/models/thorax_sim.opt.glb`:
- **Base:** `assets_src/thorax_sim_v3.glb` minus the "removed" list below.
- **Added:** `anatomy.json` `source` (v7), every node except reference cameras. That camera may be kept as a non-step camera, for reference only.

One runtime file, one loader path.

## Name map (old v3 → new, v6/v7/v8 names)
| Old (v3) | New (v6) |
|---|---|
| `lung_upper_lobe_right`, `lung_middle_lobe_right`, `lung_lower_lobe_right` | same names (v6 meshes) |
| `tree_pulm_artery_base`, `pa_left` | `pulmonary_artery_tree` |
| `A_RML_common`, `A4_lateral`, `A5_medial` | `middle_lobe_artery`, `middle_lobe_artery_A4`, `middle_lobe_artery_A5` |
| `A_RML_accessory_1`, `A_RML_accessory_2`, `A_RML_extra_1` | removed |
| `tree_pulm_vein_base` | `pulmonary_vein_tree` |
| `V_RML_common`, `V4_lateral`, `V5_medial` | `middle_lobe_vein`, `middle_lobe_vein_V4`, `middle_lobe_vein_V5` |
| `V_RML_accessory_1`, `V_RML_accessory_2` | removed |
| `tree_airway_base` | `bronchial_tree` |
| `B_RML_common`, `B4_lateral`, `B5_medial` | `middle_lobe_bronchus`, `middle_lobe_bronchus_B4`, `middle_lobe_bronchus_B5` |
| `LN_4R`, `LN_7`, `LN_10R`, `LN_11R`, `LN_12R` | same names (v6 meshes) |
| `phrenic_nerve_right`, `superior_vena_cava`, `azygos_vein`, `pericardium` | same names (v6 meshes) |

**Removed from v3 in the merge:**
- the old meshes of every same-name object above;
- every old name in the left column;
- `hilar_connective_tissue`, `hilar_connective_tissue_window`, `mediastinal_fat`, `mediastinal_fat_window`, `left_atrium_provisional`;
- `inferior_pulmonary_ligament`, which was CT-derived and attached to the old lower lobe. Flag it in the report if anything needs it.

**Kept from v3:**
- **Chest wall and bones:** skin, subcutaneous fat, chest wall muscle, intercostals, `parietal_pleura_wall`, ribs, spine, sternum, scapulae, clavicles, costal cartilages, diaphragm.
- **Lungs, heart and vessels:** left lung (`lung_upper_lobe_left`, `lung_lower_lobe_left`, `arteries_left_intrapulm`), `heart_rest`, aorta, IVC, esophagus, `vagus_nerve_right`, brachiocephalic vessels.
- **Ports and cameras:** the ports (`port_*` + extras), `thorax_root`, and the step cameras `cam_1..cam_7`.
- **CT fat:** v3 `mediastinal_fat` is kept as `mediastinal_fat_ct` (manifest `renamedFromBase`) and trimmed at build time (manifest `trimFromBase`, T846c): triangles within `clearanceM` of any hilar structure (rest + OLV/retract_hilum poses) and islands below `minIslandTris` are dropped, so only the anterior-mediastinum fill remains.

## Steps (9, T844 — docs/FEEDBACK_v7_LIVE.md; all collapse_* = 1 from step 1 — OLV)
| Step | Title | Retract keys | Hidden after its step (manifest) | Port view |
|---|---|---|---|---|
| 1 | Inspect the chest (one- / two-lung ventilation switch) | none | `mediastinal_fat` always | camera port (cam_1) |
| 2 | Expose the hilum: grasper retracts, cautery opens `mediastinal_pleura_hilum` (phrenic protected) | `retract_hilum` 1 | pleura (`dissectStep` 2) | access incision, aimed at the cam_anterior_hilum target |
| 3 | Middle lobe vein: strands, peanut passage, staple | `retract_hilum` 1 | `hilar_connective_tissue`, `middle_lobe_vein*` (`divideStep` 3) | same, toward V4/V5 |
| 4 | Nodes 11R/12R: grasp + remove, cauterise the bed ooze | `retract_hilum` 1 | `LN_11R`, `LN_12R` (`clearStep` 4) | same, toward the nodes |
| 5 | Middle lobe bronchus: clamp, test ventilation, staple | `retract_hilum` 1 + `retract_RML_lateral` 1 | `middle_lobe_bronchus*` (`divideStep` 5) | same (virtual `cam_5_RML_bronchus`) |
| 6 | Middle lobe arteries A4/A5: peanut passage, staple | `retract_fissure` 1 | `middle_lobe_artery*` (`divideStep` 6) | same, toward A4/A5 |
| 7 | Complete the fissures: grasper pulls the RML, stapler across | `retract_fissure` 1 | — | camera port (cam_6) |
| 8 | Lobe out in a bag | `retract_RML_lateral` 1 | `lung_middle_lobe_right` (`removedAfterStep` 8) | camera port (cam_6) |
| 9 | Irrigate, leak test, suction (RUL/RLL re-inflated) | `retract_hilum` 1; collapse_RUL/RLL → 0 | as step 8 | camera port, `config.scope.poseFix` cam_7: lens above the capped water |

Step captions and learning points are paraphrased (no verbatim text), and there is no review badge.
