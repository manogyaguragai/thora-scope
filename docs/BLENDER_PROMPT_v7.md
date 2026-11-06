# Prompt for Claude Code + Blender MCP: build RML anatomy v7

Paste everything below the line into a fresh Claude Code chat that has the Blender MCP connected. Open
`RML_lobectomy_anatomy_v6.blend` in Blender first.

---

You are a senior medical 3D artist and technical artist working in Blender through the Blender MCP tools. Your job is to turn the **v6** right-lung hilum model into **v7** for **ThoraScope**: a browser (three.js) simulator of a **VATS right middle lobectomy, anterior approach**. Trainees look through a simulated 30° thoracoscope, so anatomy must read clearly and correctly at close range. The simulator team (another Claude Code session) consumes your `.glb` export directly. **Object names, shape key names and coordinates are a contract. Follow them exactly.**

## 1. Where things are
- **Working file:** `F:\Thoracic Simulator Website Project\RML_lobectomy_anatomy_v6.blend`. Save your result as `RML_lobectomy_anatomy_v7.blend` and never overwrite v6.
- **Previous handover (v6):** `HANDOVER_v6_RML_anatomy.md`, in the same project folder or the user's `surgery-docs` folder. Read it first.
- **Visual reference:** STS "VATS Lobectomy Illustrated" (Blackmon/de la Flor), RML section 6:50–9:10, plus any real VATS frames the user attaches.

## 2. Coordinate contract (do not break)
- **Geometry space:** all geometry is in Blender **world coordinates of the existing simulator scene**, in metres, and every object transform is identity.
  - **Axes:** +X = cranial, −Y = anterior, +Z = patient right (lateral, the "up" side, because the patient lies in left lateral decubitus).
  - **Export:** a standard glTF export (+Y up) must overlay the simulator's existing chest wall, ribs and ports exactly.
- **What not to move:**
  - Never move, rotate or scale objects, and never apply a parent transform.
  - If you must shift anatomy, edit vertices.
  - Never move the hilum anchor region (see §4).
- **Camera:** keep the camera `cam_anterior_hilum` exactly as it is.

## 3. Objects (v6 names, keep all of them unchanged)
- **Lobes:** `lung_upper_lobe_right`, `lung_middle_lobe_right`, `lung_lower_lobe_right`.
- **Main vessel and airway trees:** `pulmonary_artery_tree` (blue), `pulmonary_vein_tree` (red), `bronchial_tree` (ivory).
- **Middle lobe artery:** `middle_lobe_artery`, `middle_lobe_artery_A4`, `middle_lobe_artery_A5`. Divided in the artery step.
- **Middle lobe vein:** `middle_lobe_vein`, `middle_lobe_vein_V4`, `middle_lobe_vein_V5`. Divided in the vein step.
- **Middle lobe bronchus:** `middle_lobe_bronchus`, `middle_lobe_bronchus_B4`, `middle_lobe_bronchus_B5`. Divided in the bronchus step.
- **Lymph nodes:** `LN_4R`, `LN_7`, `LN_10R`, `LN_11R`, `LN_12R`.
- **Mediastinum:** `pericardium`, `phrenic_nerve_right`, `superior_vena_cava`, `azygos_vein`.

Every object in the step lists above must stay a **separate object**, because the simulator hides each one when it is divided.

## 4. What to fix and add (in priority order)

### 4.1 Shape keys (the simulator's lung behaviour; the most important part)
The simulator plays these shape keys as glTF morph targets, which are **additive deltas from the Basis**. It sets several of them at once.

**Rest pose (Basis):** the ventilated, inflated right lung, before one-lung ventilation.

**Keys to provide (exact names):**
| Key | Pose |
|---|---|
| `collapse_RUL` | Upper lobe deflated under one-lung ventilation. |
| `collapse_RML` | Middle lobe deflated. |
| `collapse_RLL` | Lower lobe deflated. |
| `retract_hilum` | **Keep from v6.** The whole collapsed lung lifted lateral and posterior to open the anterior hilar window. Used for steps 2–6. |
| `retract_RML_lateral` | **New.** Only the middle lobe pulled lateral and anterior by a lung grasper, putting the RML hilum under tension. The upper and lower lobes stay put. |
| `retract_fissure` | **New.** Upper lobe lifted cranially, lower lobe pushed caudally and posteriorly, and the middle lobe lifted, so the horizontal and oblique fissures open. This exposes the interlobar artery with A4/A5 and the A6 origin. |

- **Collapse:** about 40–60 % of the lobe's volume. The lobe flattens and falls back towards the hilum and posteriorly, with soft surface folds. It should not look like a balloon shrinking evenly. A cloth or shrinkwrap pass, or careful sculpting, is fine.
- **Hilum anchor:** vertices of the vessels and bronchi within about 10 mm of the hilum (where the PA, PV and bronchus trees leave the mediastinum) must stay within 1 mm of the Basis in **every** key. The mediastinal structures have no keys. The four mediastinum objects (`pericardium`, `phrenic_nerve_right`, `superior_vena_cava`, `azygos_vein`) get **no shape keys**.

**How the keys combine:**
- **Shared keys:** every lobe **and every vessel, bronchus and node segment inside or attached to it** must carry the same key names, so nothing detaches. Give every lung, hilar vessel, bronchus and lymph-node object the full set of six keys. Where a key doesn't move an object, its delta is zero.
- **Combinations used:**
  - **OLV:** `collapse_RUL` = `collapse_RML` = `collapse_RLL` = 1.
  - **Surgery steps:** all three collapse keys at 1, plus `retract_hilum` = 1 (or `retract_RML_lateral`, or `retract_fissure`).
  - **Clamp test:** `collapse_RML` = 1 with `collapse_RUL` = `collapse_RLL` = 0 (the other lobes re-inflated).
- **Rule: author each retract_* key so that "Basis + all three collapse deltas + that retract delta" gives the intended collapsed-and-retracted pose.**
  - **One way:** set the collapse keys to 1, then add a New Shape from Mix. Sculpt the retraction. Then store only the retraction delta (subtract the collapse deltas), so the key's relative key is the Basis.
  - **Check:** with every key's Relative Key = Basis, setting collapse × 3 = 1 and the retract key = 1 must show the correct pose. Setting only that retract key (collapse at 0) may look odd; that is acceptable.
- **Partial values must look natural.** `retract_hilum`, `retract_RML_lateral` and `retract_fissure` are dragged continuously from 0 to 1 by the user's grasper.
  - Check them at 0.25, 0.5 and 0.75.
  - If vessels bend or kink oddly mid-way, fix the delta so the motion follows a smooth arc. glTF can't carry Blender in-between keys, so bake the arc into the single key's shape.

### 4.2 Vessel shape at full retraction (v6 known issue)
- **Problem:** at `retract_hilum` = 1, the v6 vessels stretch into long, fairly straight strands.
- **Fix:** shape the retracted pose so the hilar vessels read as **short, curved trunks with natural slack and branching angles**, like the STS illustrations. The lung moves less relative to the vessels, and the vessels curve rather than stretch.
- **Check:** compare against the STS frames.

### 4.3 Calibre and anatomy (v6 known issue: vessels too thin)
- **Calibre:** match the illustration:
  - main PA about 25–30 mm, right PA about 18–20 mm, interlobar PA about 12–15 mm, A4/A5 about 3–5 mm;
  - superior PV about 12–15 mm, V4/V5 about 4–6 mm;
  - bronchus intermedius about 12 mm, RML bronchus about 8 mm.
- **Arrangement:**
  - The RML vein (V4/V5) drains into the **superior** pulmonary vein and is the most anterior structure.
  - The RML bronchus sits posterior to the vein.
  - A4/A5 come off the interlobar PA in the fissure, opposite A6.
  - Node 11R sits between the RML and RLL bronchi, node 12R at the RML bronchus, and node 10R at the main bronchus.
- **Junctions:** smooth filleted branch junctions with no gaps. Each divided segment (for example `middle_lobe_vein`) must meet its parent tree **flush**, so that hiding it after division leaves a clean stump end. Cap the parent side with a rounded end.
- **Left pulmonary artery:** check that the start of the left PA still meets the existing scene's left-lung vessels (the v6 handover asked for this).

### 4.4 Surface detail on the meshes
- **Bronchus:** cartilage rings on `bronchial_tree` and `middle_lobe_bronchus*` as gentle geometry ridges, with the membranous posterior wall flatter.
- **Lymph nodes:** lobulated, slightly flattened.
- **Lung:** keep the remeshed lobes smooth. Fissure faces should be clean and slightly concave where the lobes meet, with no gaps or overlaps between lobes in Basis, in collapse, or in any retract key.
- **Topology:** clean, mostly quads, no long thin triangles, normals consistent, no non-manifold edges.
- **Budget:** about 600–900k triangles for the whole file. Use more on the RML hilar vessels (seen up close) and less elsewhere.

### 4.5 Soft-tissue layers: none
Do **not** add hilar fat, connective tissue or a hilar pleura sheet. The simulator dropped the "dissect around the vessel" step (user decision, 2026-11-05).

### 4.6 Heart (only if the user has revamped it)
If the scene has a revamped heart, export it as `heart` inside the pericardium, with no shape keys (the simulator drives the heartbeat in code). If there is no heart object, skip this item and say so.

### 4.7 Materials
- **Keep it simple:** one flat Principled BSDF per tissue, named `v7_<tissue>` (`v7_lung`, `v7_pulmonary_artery`, `v7_pulmonary_vein`, `v7_bronchus`, `v7_lymph_node`, `v7_pericardium`, `v7_nerve`, `v7_systemic_vein`).
- **Colours:** artery blue, vein red, bronchus ivory, nerve yellow.
- **No image textures and no baking.** The simulator applies its own procedural wet-tissue textures, projected so they need no UVs.

## 5. Working method
1. **Inspect first.** Through the MCP, list every object with its name, triangle count, shape keys, material and bounding box. Write a short plan, then work through §4 in order.
2. **Render as you go.** After each major change, render from `cam_anterior_hilum`, and from one view looking into the fissure, with key values set as in §4.1:
   - Basis
   - OLV
   - OLV + `retract_hilum` 1
   - OLV + `retract_RML_lateral` 1
   - OLV + `retract_fissure` 1
   - the clamp test
   - OLV + `retract_hilum` 0.5

   Use a single light near the camera, like a scope. Show the renders and compare them honestly with the STS references.
3. **Check intersections and gaps** in each pose above, especially lobe-to-lobe, vessel-to-lobe and vessel-to-vessel at the hilum.
4. **Measure the hilum anchor:** report the largest displacement of anchor-region vertices for each key. It should be 1 mm or less.
5. **If something in this brief is anatomically doubtful, or impossible without breaking the contract, stop and ask the user. Don't guess.**

## 6. Export
- **Command:** File > Export > glTF 2.0 (`.glb`).
- **Include:** Selected Objects off (export all), Cameras **on**, Custom Properties on.
- **Transform:** +Y Up.
- **Data > Mesh:** Apply Modifiers, Normals.
- **Data > Shape Keys:** **on**, Shape Key Normals **on**.
- **Compression:** **off**.
- **File name:** `RML_v7.glb`, next to the `.blend`.
- **Before you finish:** re-import the glb into an empty Blender scene. Check that every shape key and camera survived, and that object transforms are still identity.

## 7. Report back: write `HANDOVER_v7_RML_anatomy.md`
Use the same structure as the v6 handover:
- **Objects:** a table of every object with its name, triangles, shape keys and material.
- **Changes since v6:** what changed, mapped to §4.1–4.7.
- **Combination check:** results of the §4.1 key combinations, including the anchor displacement per key.
- **Renders:** list the files; save them as PNGs next to the glb.
- **Problems:** known remaining issues, and anything you couldn't do, with the reason.

The user will pass the glb and the handover to the simulator team, who will integrate them.
