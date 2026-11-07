# Video ↔ simulator step map

Sources: frames in `assets_src/ref-frames/` (see `REFERENCE_FRAMES.md`), timeline CONTEXT §13, steps/ports from `assets_src/procedure_steps.json`, book notes in `BOOK_NOTES.md`. Port names use the mapping in (b). Tool notation = `slot:sub-option` (CONTEXT §6.3).

## Frame table
| Frame | §13 event | Sim step | Practice action | Conf. |
|---|---|---|---|---|
| 0:28 | 0:26–0:39 posterior port created (video calls it the "anterior working port") | 1 | hands: inspect from port_camera_8ICS (ports pre-placed in sim) | high |
| 0:39 | 0:26–0:39 access incision made | 1 | hands: inspect; access incision = port_utility_5ICS | high |
| 0:42 | lead-in to 0:46–0:56 (retractors on lung) | 1→2 | grasper:lung retractor on lung_upper_lobe_right, retract_posterior | med |
| 0:54 | 0:46–0:56 camera moved; retractors via former camera port | 2 | hands: P → scope to port_retraction_8ICS; grasper:lung retractor via port_camera_8ICS, hold G | high |
| 0:58 | 0:59–1:13 mediastinal pleura cleared bluntly | 2 | peanut on mediastinal_fat via port_utility_5ICS | high |
| 01:01 | 0:59–1:13 anterior hilum exposed | 2 | peanut sweep phrenic_nerve_right anteriorly; hands: identify V_RML_common | med |
| 01:13 | 0:59–1:13 two middle lobe vein branches appear | 3 | peanut on hilar_connective_tissue via port_utility_5ICS | high |
| 01:17 | same | 3 | peanut on hilar_connective_tissue (V4_lateral/V5_medial isolated) | high |
| 01:25 | 1:24–2:17 passage behind both vein branches | 3 | blunt clamp encircle V_RML_common via port_utility_5ICS | high |
| 02:04 | 1:24–2:17 retraction swap; curved-tip stapler | 3 | grasper:lung retractor hold via port_utility_5ICS; stapler:vascular curved-tip on V_RML_common via port_camera_8ICS | high |
| 02:14 | 1:24–2:17 both branches divided | 4 | (result) vein stumps; hands inspect | high |
| 02:24 | 2:17–2:52 retractors back; upper lobe tensions bronchus | 4 | grasper:lung retractor on lung_upper_lobe_right via port_camera_8ICS, hold | med |
| 02:36 | 2:17–2:52 cautery opens interlobar pleura | 4 | cautery on hilar_connective_tissue via port_utility_5ICS | high |
| 02:44 | 2:17–2:52 ring clamp extracts node beside bronchus | 4 | grasper:ring clamp on LN_11R via port_utility_5ICS | med |
| 03:04 | end of node removal / bronchus cleared | 4 | grasper:ring clamp on LN_12R via port_utility_5ICS | med |
| 03:18 | 3:09–3:41 blunt clamp around bronchus | 4 | blunt clamp encircle B_RML_common via port_utility_5ICS | high |
| 03:36 | 3:09–3:41 bronchus stapled via access incision | 4→5 | stapler:bronchial on B_RML_common via port_utility_5ICS (after A test) | high |
| 03:52 | 3:41–5:00 two artery branches exposed | 5 | hands: identify A4_lateral, A5_medial | high |
| 04:17 | 3:41–5:00 retraction swapped again; tunnel behind arteries | 5 | grasper:lung retractor hold via port_utility_5ICS; blunt clamp on A_RML_common | med |
| 04:29 | 3:41–5:00 silicone leader through long tunnel | 5 | stapler:vascular + silicone leader on A_RML_common (leader threaded) | high |
| 04:41 | same — leader on stapler tip | 5 | stapler:vascular + silicone leader via port_camera_8ICS | high |
| 05:06 | same — both branches divided together | 5 | stapler fire on A_RML_common | high |
| 05:21 | 5:14–6:11 scope back to original camera port | 6 | hands: P → scope to port_camera_8ICS; grasper:lung retractor retract_fissure | high |
| 05:50 | 5:14–6:11 stapler via posterior port (video: "anterior working port") (+ tumour margin, not modelled) | 6 | stapler:parenchyma on lung_middle_lobe_right via port_retraction_8ICS | high |
| 06:03 | 5:14–6:11 view from underneath, stump above stapler | 6 | hands: underside check; stapler:parenchyma second fire | med |
| 06:12 | 5:14–6:11 additional fire completes fissure | 6 | stapler:parenchyma final fire | high |
| 06:16 | 6:11 lobe free | 6→7 | (result) lobe detached | high |
| 06:20 | 6:11–6:29 lobe placed in sack | 7 | B (bag) on lung_middle_lobe_right | high |
| 06:23 | 6:11–6:29 sack removed via access incision | 7 | B via port_utility_5ICS; RUL/RLL re-inflate | high |
| 06:29 | 6:11–6:29 intercostal nerve block | 7 | none (not simulated; caption only) | high |
| 06:46 | 6:45–end chest tube + water test at ~20 cmH₂O | 7 | T via port_camera_8ICS (scope in port_retraction_8ICS); sucker:irrigation + A on tree_airway_base stump | high |

All 31 frames placed; none unplaceable.

## (a) §13 events with no frame
- **6:34–6:45** right paratracheal (4R) and subcarinal (7) node dissection — no frame (optional sim action PA30).
- **Bronchus test ventilation** — not shown or captioned in 3:09–3:41; required by book (p7, p131) and CONTEXT §6.4 → sim row PA18.
- **Partial division of incomplete fissure before the artery stapler** (3:41–5:00) — implied at 04:17 but no clear frame.
- **Extra upper-lobe margin for tumour** (5:14–6:11) — tumour visible at 05:50; not modelled.

## (b) Port mapping
Asset geometry (glTF, from glb `extras`; +X head, +Y up/right side, +Z anterior — the same frame as the orientation compass `config.viewing.compassAxes` and the ASSETS.md axis checks):
| Asset port | Skin point (x, y, z) m | Position | Book name (p6) | Video role / UI label | Video evidence |
|---|---|---|---|---|---|
| `port_camera_8ICS` | (−0.163, 0.138, 0.033) | most caudal, lateral, just anterior | camera port (~8th ICS, behind ant. axillary line) | **Inferior camera port** — scope at start & 5:14–6:29; retractors 0:46–5:00; vein + artery staplers; chest tube | inset camera icon low at 0:28–0:42, 05:21–06:29; stapler arrows from low port at 02:04, 04:17–05:06; tube from low port at 06:46 |
| `port_utility_5ICS` | (−0.095, 0.097, 0.099) | cranial, anterior | utility incision (2–5 cm, ~5th ICS) | **Anterior access incision (5th space)** — peanut, cautery, clamps, ring clamp, bronchus stapler, held retraction during swaps, bag removal | inset instruments enter upper-anterior at 01:13–06:23; gloved hand pulls bag there at 06:23 |
| `port_retraction_8ICS` | (−0.084, 0.053, −0.102) | mid-level, **posterior** | retraction port (midscapular line) | **Posterior port** — the video's third (working) port by role: scope 0:46–5:00 & 6:45; fissure stapler, bag, block needle 5:50–6:29 | inset camera icon anterior at 0:54–05:06 and 06:46; horizontal instrument there at 05:50–06:29 |

**Geometry check (T863, 2026-11-06; shipped `public/models/thorax_sim.opt.glb`, Blender (x, y, z) → glTF (x, z, −y)):**
| Port id | Skin | Pleura | Axis into chest | Anatomical reading | Label (ADR-004) |
|---|---|---|---|---|---|
| `port_utility_5ICS` | (−0.0950, 0.0969, 0.0992) | (−0.0950, 0.0833, 0.0856) | (0, −0.707, −0.707) | most anterior skin point (z +0.099); enters from the front, heading medial + backwards | Anterior access incision (5th space) |
| `port_camera_8ICS` | (−0.1630, 0.1380, 0.0332) | (−0.1630, 0.0842, 0.0136) | (0, −0.940, −0.342) | most caudal by 68–79 mm (x −0.163), most lateral (y 0.138), near the coronal midline; enters medially from the side, low | Inferior camera port |
| `port_retraction_8ICS` | (−0.0840, 0.0535, −0.1020) | (−0.0840, 0.0345, −0.0749) | (0, −0.574, +0.819) | most posterior skin point (z −0.102); axis points anteriorly = enters from the back | Posterior port |

Agrees with the user's report (FEEDBACK_GUIDED_v1 §2.2): the access incision is anterior, the camera port inferior, and the former "anterior working port" posterior. The compass (head = +X, anterior = +Z) uses the same axes, so its Ant/Post marks agree. Note: `port_retraction_8ICS` sits level with the access incision (x −0.084 vs −0.095), not in a lower space, so its label states no space number (the id's "8ICS" is kept only as a stable id).

Reasoning: `procedure_steps.json` puts the step-3 scope in `port_retraction_8ICS` (video: scope in the third working port while retractors fill the former camera port) and steps 1/2/6/7 in `port_camera_8ICS` (video: original camera port). The access incision is unambiguous. The video's third port is anterior; this asset's (book layout) is posterior — map by role (CONTEXT §7.6), name by position; stapler-angle thresholds must be computed from the real asset geometry.
**Capacity:** the access incision carries 2–3 instruments at once in the video (03:04, 04:17, 06:03) → configure `port_utility_5ICS` capacity 3, the 1 cm ports capacity 1.

## (c) Conflicts and resolutions
| # | Conflict | Resolution |
|---|---|---|
| 1 | Third port: book p6 = posterior midscapular "retraction" port (asset follows it); video = anterior working port that hosts the scope. | Keep asset geometry; `port_retraction_8ICS` plays the video role but is labelled "Posterior port" by position (T863); log in ASSET_ISSUES. |
| 2 | Retractors: book implies retraction port; video uses the former camera port (scope moved out). | Practice follows video: scope → `port_retraction_8ICS`, retractors → `port_camera_8ICS`. |
| 3 | Scope port steps 4/5: asset cams use `port_utility_5ICS`; video keeps scope in anterior working port and uses access incision for instruments. | Guided mode uses glb cams as authored (view only). Practice: scope stays in `port_retraction_8ICS`; utility capacity 3 so either works. |
| 4 | Order: book p7 generic fissure-last = vein → accessible PA branches → bronchus → remaining PA → fissure; ch.32 (p134), video and procedure_steps = vein → nodes/bronchus → arteries → fissure. | Score the RML order (vein → bronchus → arteries → fissure); show the generic order as a teaching note. |
| 5 | Bronchus test: book p7/p131 require airway suction + test ventilation before stapling; video does not show it. | Mandatory in practice (PA17–PA18); firing without it = error. |
| 6 | Scope angle: book p5 30° standard; asset step 4 `scope_angle_deg` 44.3 (others 26–30.6); video optic angle unknown (~30° look). | Sim optic is 30°; step-4 44° kept only as the authored guided snap view; flag. |
| 7 | Node stations: book p7 prefers early systematic dissection (2,4,7,8,9,10 right); video removes the node beside the bronchus mid-case and 4R/7 at the end. | Required: LN_11R/LN_12R in step 4 (exposure); optional LN_4R/LN_7 in step 7; mention book's early-dissection preference. |
| 8 | Which node at 02:44 (11R vs 12R) is not identifiable; book p133 places enlarged nodes between RML and lower-lobe bronchi (≈11R). | Require both, either order. |
| 9 | Vein: video staples both branches together; book p133 warns not to narrow the upper-lobe vein. Asset has `V_RML_common` + `V4_lateral`/`V5_medial`. | Target `V_RML_common` (accept V4+V5 individually); stapling in the upper-lobe drainage zone = complication. |
| 10 | Video divides part of the incomplete fissure before the artery stapler; procedure_steps has fissure only in step 6. | Optional cautery/parenchyma action in step 5, not scored. |
| 11 | Fissure: book p131 usually 2–3 fires; video 2 fires + extra upper-lobe margin (not modelled). | Require ≥2 parenchyma fires; margin noted in Guided step 6. |
| 12 | Chest tube: book p134 via lowest port; video via low (camera) port while viewing from anterior port; asset cam_7 is in `port_camera_8ICS`. | Practice: tube occupies `port_camera_8ICS`, scope moves to `port_retraction_8ICS`; guided keeps cam_7. |
| 13 | Water test: video ~20 cmH₂O stump check; book p6/p131 water washout + stump/leak check without a pressure figure. | Use 20 cmH₂O (video). |
| 14 | Phrenic: book p7 clips not diathermy near phrenic; video doesn't show. | Cautery within config radius of `phrenic_nerve_right` → warning; on it → complication. |

## (d) Practice action sequence
State keys: morph states from §7.3 plus flags. "Held" = retraction held with `G` (occupies its port). Divided structures use clipping + staple cap (§6.4).
| id | step | tool | sub-option | port | target | prereq | resulting state change | video |
|---|---|---|---|---|---|---|---|---|
| PA01 | 1 | hands | — | port_camera_8ICS | lung_middle_lobe_right | — | `inspected`; confirm deflate_RUL/RML/RLL = 1 | 0:28–0:42 |
| PA02 | 2 | hands (P) | — | port_retraction_8ICS | — | PA01 | scope moved; port_camera_8ICS free | 0:46–0:54 |
| PA03 | 2 | grasper | lung retractor (held G) | port_camera_8ICS | lung_upper_lobe_right | PA02 | retract_posterior 0→1; port_camera_8ICS occupied | 0:46–0:56 |
| PA04 | 2 | peanut | — | port_utility_5ICS | mediastinal_fat | PA03 | mediastinal_fat → mediastinal_fat_window | 0:58–1:13 |
| PA05 | 2 | peanut | — | port_utility_5ICS | phrenic_nerve_right | PA04 | `phrenic_protected` (sweep anteriorly; cautery here = complication) | 1:01 |
| PA06 | 3 | peanut | — | port_utility_5ICS | hilar_connective_tissue | PA04 | hilar_connective_tissue → _window; V4_lateral/V5_medial exposed | 1:13–1:24 |
| PA07 | 3 | hands | click-label | — | V_RML_common, tree_pulm_vein_base | PA06 | `vein_anatomy_checked` (upper-lobe vein preserved) | 1:13 |
| PA08 | 3 | blunt clamp | — | port_utility_5ICS | V_RML_common | PA06 | `tunnel_V` | 1:24–1:40 |
| PA09 | 3 | grasper | lung retractor (held G) | port_utility_5ICS | lung_upper_lobe_right | PA08 | retraction swap #1: retract_posterior stays 1; port_camera_8ICS free | ~1:40–2:00 |
| PA10 | 3 | stapler | vascular curved-tip | port_camera_8ICS | V_RML_common | PA07, PA08, PA09 | V_RML_common, V4_lateral, V5_medial, V_RML_accessory_1/2 divided → step 4 | 2:04–2:17 |
| PA11 | 4 | grasper | lung retractor (held G) | port_camera_8ICS | lung_upper_lobe_right | PA10 | retraction back to camera port; utility hold released; bronchus tensioned | 2:17–2:24 |
| PA12 | 4 | peanut | — | port_utility_5ICS | hilar_connective_tissue | PA11 | B_RML_common exposed | 2:24–2:36 |
| PA13 | 4 | cautery | — | port_utility_5ICS | hilar_connective_tissue | PA12 | interlobar pleura opened (smoke, lens fog) | 2:36 |
| PA14 | 4 | grasper | ring clamp | port_utility_5ICS | LN_11R | PA12 | LN_11R → specimen tray | 2:44 |
| PA15 | 4 | grasper | ring clamp | port_utility_5ICS | LN_12R | PA12 | LN_12R → specimen tray | 2:44–3:04 |
| PA16 | 4 | blunt clamp | — | port_utility_5ICS | B_RML_common | PA14, PA15 | `tunnel_B` | 3:09–3:18 |
| PA17 | 4 | stapler | bronchial (close, no fire) | port_utility_5ICS | B_RML_common | PA16 | `bronchus_clamped` | 3:18–3:36 |
| PA18 | 4 | context A | ventilate | — | B_RML_common | PA17 | deflate_RUL, deflate_RLL → 0 (4 s), RML stays 1 → `bronchus_test_passed`; then back to 1 | — (book p7, p131) |
| PA19 | 4 | stapler | bronchial (fire) | port_utility_5ICS | B_RML_common | PA18 | B_RML_common, B4_lateral, B5_medial divided → step 5 | 3:36–3:41 |
| PA20 | 5 | grasper | lung retractor (held G) | port_utility_5ICS | lung_upper_lobe_right | PA19 | retraction swap #2; port_camera_8ICS free | 4:17 |
| PA21 | 5 | blunt clamp | — | port_utility_5ICS | A_RML_common | PA19 | `tunnel_A`; over-traction → minor bleed | 4:17–4:29 |
| PA22 | 5 | stapler | vascular + silicone leader | port_camera_8ICS | A_RML_common | PA20, PA21 | A_RML_common, A4_lateral, A5_medial, A_RML_accessory_1/2, A_RML_extra_1 divided → step 6 (alt: clip applier / curved-tip on A4_lateral and A5_medial separately) | 4:29–5:06 |
| PA23 | 6 | hands (P) | — | port_camera_8ICS | — | PA22 | scope back to camera port (stapler withdrawn) | 5:14–5:21 |
| PA24 | 6 | grasper | lung retractor (held G) | port_utility_5ICS | lung_middle_lobe_right | PA23 | retract_posterior → 0, retract_fissure 0→1 | 5:21 |
| PA25 | 6 | stapler | parenchyma | port_retraction_8ICS | lung_middle_lobe_right | PA24 | horizontal fissure fire 1 | 5:50–6:03 |
| PA26 | 6 | hands | underside check | port_camera_8ICS | tree_airway_base | PA25 | `stump_above_stapler_confirmed` (view from below after flip) | 6:03 |
| PA27 | 6 | stapler | parenchyma | port_retraction_8ICS | lung_middle_lobe_right | PA26 | final fire; lobe free → step 7 | 6:12–6:16 |
| PA28 | 7 | context B | bag | port_utility_5ICS | lung_middle_lobe_right | PA27 | lung_middle_lobe_right hidden (removed); deflate_RUL, deflate_RLL → 0 | 6:20–6:23 |
| PA29 | 7 | hands (P) | — | port_retraction_8ICS | — | PA28 | scope to anterior working port; port_camera_8ICS free | 6:45 |
| PA30 | 7 | grasper (optional) | ring clamp | port_utility_5ICS | LN_4R, LN_7 | PA28 | nodes → specimen tray (not scored for progression) | 6:34–6:45 |
| PA31 | 7 | context T | chest tube | port_camera_8ICS | — | PA29 | chest tube placed | 6:45 |
| PA32 | 7 | sucker | irrigation (+ A at 20 cmH₂O) | port_utility_5ICS | tree_airway_base | PA31 | fluid over stump; no bubbles → `case_complete` | 6:46 |
