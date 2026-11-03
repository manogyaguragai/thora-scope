# ASSET ISSUES & clinician-review items

| # | Item | Type (asset defect / clinical uncertainty) | Workaround | Status |
|---|---|---|---|---|
| 1 | Port nodes `port_camera_8ICS`, `port_retraction_8ICS`, `port_utility_5ICS` (and all 7 `cam_*`) are scene roots, not children of `thorax_root` (CONTEXT §7.1 says all meshes are). `thorax_root` carries a 180° rotation + uniform scale 1.3 that ports/cameras do not inherit. | asset defect | Use glTF world-space transforms for ports/cameras; never re-parent or assume root-local coords. Port extras verified self-consistent (see docs/ASSETS.md). | open |
| 2 | Morph target order differs between meshes (`tree_*` meshes list names alphabetically, others in authoring order). | asset defect (minor) | Always resolve morphs by name via `morphTargetDictionary`, never by index (already the §7.3 rule). | open |
| 3 | RML branch meshes (`A_RML_*`, `A4_lateral`, `A5_medial`) have no `heartbeat` morph, while parent `tree_pulm_artery_base` does → possible visible seam at branch junctions when heartbeat plays. | asset defect (minor) / clinical uncertainty | Keep heartbeat amplitude subtle; check junctions in M3 visual review. | open |
