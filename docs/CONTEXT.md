# CONTEXT — ThoraScope: VATS Right Middle Lobectomy Simulator

Authoritative product spec. Sections copied verbatim from the kickoff prompt (§6, §7, §8, §9, §7.6, §13).
Section numbers are kept so briefs can say "CONTEXT §6.4".

---

## 6. Product requirements
**Audience:** medical students / junior surgical trainees. **Patient:** left lateral decubitus (right side up), one-lung ventilation.
**Learning goals:** (1) RML hilar anatomy: middle lobe vein (V4/V5), bronchus (B4/B5), arteries (A4/A5), nodes 4R/7/10R/11R/12R, phrenic & vagus nerves, azygos, SVC, fissures. (2) Anterior-approach sequence (book ch. 32 and video §13 agree): inspect → retract upper+middle lobes, clear mediastinal pleura bluntly, protect phrenic → isolate the middle lobe vein branches and divide them (preserve upper lobe vein) → tension the bronchus, peanut dissection, open interlobar fissure pleura with cautery, remove node beside the bronchus → blunt clamp around bronchus, test ventilation, staple via a port with good angle → expose and divide the 1–2 middle lobe artery branches (leader-guided stapler or individually) → complete minor/major fissure with stapler, flipping the lobe to keep the residual bronchus above the stapler → bag and remove via access incision → (optional) paratracheal/subcarinal node clearance, chest tube → water test of the bronchial stump at ~20 cmH₂O. (3) OLV, the bronchus clamp/test-ventilation check, and why port/retraction choice matters.
**Content source:** Wells & Coonar, ch. 2 (VATS fundamentals, ports, 30° scope, anterior approach, phrenic protection, venous-anatomy caution, patency check before stapling, fissure-last), ch. 31.4 and ch. 32, plus §13. Read the chapters from the PDF in `assets_src/`. **Paraphrase only; never copy sentences or figures** (or transcript lines) into the app. All teaching text shows a "Pending clinician review" badge.

### 6.1 Modes (MANDATORY)
1. **Guided procedure** (default): steps 1–7, Next/Prev + keyboard, ~1.5 s eased transitions (camera pose, morphs, fades), caption + 3–5 learning points per step; each step shows "In the reference video: …" with the §13 timestamp.
2. **Practice (hands-on)**: trainee performs the operation with instruments; progression only when the correct action is done on the correct structure (§6.4). Scoring + debrief.
3. **Free exploration**: orbit/dolly/pan outside the body, layer panel, cut-away plane.
4. **Physiology lab**: per-lobe deflate sliders; "Start one-lung ventilation" (all → 1 over 5 s); "Clamp RML bronchus + re-inflate" (RUL, RLL → 0 over 4 s, RML stays 1); "Release clamp"; heartbeat/breathing toggles and rates.

### 6.2 Camera / thoracoscope controls (MANDATORY) — active when Hands (slot 1) is selected
- Scope pivots about its port's entry point (remote centre of motion = `pleura_point`); insert/withdraw along shaft (wheel); pan = pivot (fulcrum: view moves opposite to the hand) via left-drag.
- 30° optic: rotate the optic's view direction around the shaft (light-post rotation, `Z`/`X`) independently of camera-head roll; **horizon lock** toggle (`H`).
- Digital zoom (`+`/`-`); port switching (`P` cycles ports; the video moves the scope between the camera port and the anterior working port — support any port), active port shown in UI; "snap to step view" (`V`), "reset view" (`R`).
- Outside view (`O` toggles): free orbit with clipping plane; smooth transition between outside and scope views.
- On-screen help overlay (`?`) listing every binding. Bindings live in one config file.

### 6.3 Tool hotbar (MANDATORY) — game-style dock
- A dock centred at the bottom of the viewport (Minecraft-hotbar style): 9 square slots, each with the tool icon, its key number in the corner, and a tooltip with name + current sub-option. Active slot has an accent outline and slight lift; selection change animates 150 ms. Keys `1`–`9` select; `Q`/`E` cycle previous/next; pressing the active tool's key again cycles its sub-option. Caption bar sits above the dock; dock is keyboard-focusable and screen-reader labelled.
- Slots:
  1. **Hands (default)** — controls the thoracoscope (§6.2); no instrument in the chest.
  2. **Grasper / retractor** — sub-options: lung retractor · ring clamp (lymph nodes)
  3. **Sponge-stick** (atraumatic lung retraction/pressure)
  4. **Peanut dissector**
  5. **Energy / cautery** (incise pleura, seal small vessels)
  6. **Blunt / right-angle clamp** (create passage behind vessels, encircle bronchus)
  7. **Endostapler** — sub-options: vascular curved-tip · vascular + silicone leader · bronchial · parenchyma
  8. **Clip applier**
  9. **Sucker** — sub-options: suction · irrigation
  Context actions (not slots): extraction bag `B`, ask anaesthetist to ventilate `A`, hand retraction to assistant / hold `G`, chest tube `T` (step 7, optional).
- Icons: simple monochrome SVG silhouettes drawn in-house in the token palette, inlined as a single SVG sprite (no external icon sets for instruments).

### 6.4 Instruments & surgical actions (MANDATORY)
- **No external models.** Build instruments procedurally in three.js (low poly, shared geometries/materials): 5 mm shafts (matte black insulated), satin/brushed steel jaws and tips with env-map reflections, animated jaws, tool-specific heads (lung retractor, ring clamp, sponge-stick gauze, peanut swab, cautery tip, curved-tip stapler with coloured cartridge, flexible silicone leader, right-angle tip, clip applier with titanium clip, sucker tip). Match appearance to instruments in the ref-frames. All instrument meshes are built once at load and reused (show/hide, never re-created).
- **Gloved hands:** procedural surgical-glove hands (latex/nitrile with sheen and slight translucency) holding the scope and instrument handles, visible **only in outside view** and in a small picture-in-picture "surgeon's view" inset (toggle `I`, low resolution, rendered at reduced rate e.g. every 2nd–3rd frame) in scope mode. Never render hands inside the thoracoscope view. If procedural hands look poor after 2 visual rounds, fall back to a simpler stylised glove and log it in Deferred.
- **Control — snap on click + manual:**
  - *Snap:* with a tool selected, left-click a structure → the tool animates in through its port (fulcrum-constrained path) and its tip snaps to the nearest valid action point on that structure (config radius); invalid targets show a short reason toast.
  - *Manual:* hold right mouse to steer the tip freely (pivoting about the port's `pleura_point`, mirrored motion like a real instrument); wheel = insert/withdraw depth; left-click/hold = close jaws / fire / activate; `Esc` withdraws the tool to the port.
  - Picking uses a precomputed BVH (`three-mesh-bvh`) or simplified proxy meshes, never brute-force raycasts against full-res meshes.
- **Ports, occupancy & retraction swap (from the video):** model each port's occupant (scope, held retractor, active tool). Ports: `port_camera_8ICS`, `port_utility_5ICS` (= access incision), `port_retraction_8ICS`; label them in UI with video-style names (camera/"former camera" port, access incision, anterior working port) via config — document the mapping in `docs/VIDEO_STEP_MAP.md`. A retraction can be held (`G`) so it stays while you change tool; held retractions occupy their port. The stapler needs a free port whose approach angle to the target is within a config threshold; if the only good-angle port is occupied, the trainee must transfer the retraction to a clamp via another port (the video's "retraction swap"). Poor angle → warning, no fire.
- **Grasp & retract:** retractor/sponge-stick on a right lobe maps drag to `retract_posterior` / `retract_fissure` (clamped 0–1; optional spring-back) + local grasp-and-pull vertex-shader offset around the grasp point (uniform-driven, capped, relaxes on release). No physics engine.
- **Dissect:** peanut/cautery on `hilar_connective_tissue` / `mediastinal_fat` / fissure pleura near the target fades to `_window` variants over a short "dissection progress" (hold). Cautery emits smoke and brief lens fog that clears; sucker clears smoke/fluid.
- **Encircle:** blunt/right-angle clamp passed behind the vein branches / bronchus / artery branches before stapling (shows a "tunnel"/lasso). For the artery tunnel, the curved-tip or leader-guided stapler is required unless branches are taken individually with clips/staples.
- **Staple-divide:** stapler jaws placed across the target with the correct cartridge; firing animates, then the structure is divided with **per-material clipping planes** (proximal stump remains, distal part stays with the lobe) and a procedural **staple-line cap** (instanced tiny metallic staples, 2–3 rows) at the cut. Clipping planes are allocated at load (fixed count per material, parked far away until used) so no shader recompiles happen at fire time. Fallback if clipping looks wrong for a mesh: hide it as `procedure_steps.json` does, plus the cap.
- **Clips:** clip applier places small titanium clips (one preallocated InstancedMesh) on small branches/accessory vessels.
- **Bronchus test (MANDATORY before firing on the bronchus):** after clamping B_RML_common, trainee presses `A`: RUL + RLL inflate, RML stays collapsed → firing allowed. Firing without the test = error.
- **Lymph nodes:** ring clamp + dissection removes LN_11R/12R beside the bronchus (improves exposure); optional end-of-case 4R (paratracheal) and 7 (subcarinal) clearance. Removed nodes go to a specimen tray.
- **Fissure completion:** parenchyma cartridge via the anterior working port with `retract_fissure`; trainee must view the lobe from underneath (flip via retraction) and confirm the residual bronchus stump lies above the stapler before the final fire.
- **Extraction & finish:** bag (`B`) + drag the freed lobe into it → removed via access incision; RUL/RLL re-inflate. Optional: chest tube (`T`) placed under vision. **Water test:** sucker irrigation fills fluid over the stump, ventilation at 20 cmH₂O shown; no bubbles if the stump is correct.
- **Complications:** stapling/cautery on a wrong or "danger" structure (any `tree_*_base`, `phrenic_nerve_right`, `vagus_nerve_right`, `azygos_vein`, `superior_vena_cava`, upper-lobe venous drainage zone, bronchus intermedius zone) triggers an event. Vascular hit: bleeding from that point (glossy dark-red decal growing + pooled particle ooze + view reddening), vitals warning; sucker + sponge-stick pressure control it. Over-traction on artery branches during passage (distance/force threshold) → minor bleed. Other hits: error toast. Logged for the debrief.
- **Practice progression & scoring:** action table in `src/content/practice_actions.json`, built from `docs/VIDEO_STEP_MAP.md` and aligned to the 7 steps of `procedure_steps.json` (tool, sub-option, port, target, prerequisite, resulting state, video timestamp). Debrief: time, order, errors, complications, bronchus test done, upper lobe vein preserved, port/angle choices, retraction swaps. Uncertain clinical mappings flagged in `docs/ASSET_ISSUES.md` for clinician review.

### 6.5 Viewing aids (MANDATORY)
Per-group/per-structure show/hide + opacity (from `layer_groups`), X-ray mode, movable clipping plane, click-to-label in Hands mode (name + one-line description), toggle all labels (`L`). X-ray/opacity use pre-compiled transparent material variants created at load (swap materials, never flip `transparent`/defines at runtime).

### 6.6 Quiz (P4)
"Identify the structure" (click it) and "What is the next step?" (sequence from §13/book) — local only; lazy-loaded chunk.

### 6.7 UI & visual direction
Dark, premium, restrained. Tokens in one CSS file (§9). Full-bleed viewport; scope view with circular mask; collapsible left rail (steps), right inspector (layers/physiology/ports), bottom: caption bar above the tool hotbar. Port status chips (occupant per port) near the hotbar. Self-hosted Inter via `@fontsource/inter` (latin subset, woff2, `font-display: swap`, preloaded); UI icons via `lucide` per-icon imports. Keyboard operable, visible focus rings, WCAG AA contrast, `prefers-reduced-motion` respected. UI updates are event-driven (no per-frame DOM writes except a throttled HUD ≤ 4 Hz); use CSS transforms/opacity only for UI animation.

### 6.8 Non-functional
Desktop Chrome/Edge/Firefox/Safari latest. Static site, no backend, no analytics, no external network calls at runtime. No patient identifiers anywhere.

### 6.9 Loading screen (MANDATORY, in theme)
- First paint < 1 s on localhost: a tiny app shell (inline critical CSS, no framework needed) shows the loading screen immediately while the main bundle and assets stream in.
- Look: dark token background, a circular "scope lens" motif (thin teal progress ring around a softly vignetted circle), product name in Inter, a one-line status, a rotating anatomy/procedure tip (from `src/content`, paraphrased), and a small "Pending clinician review" note. Subtle 150–250 ms motion only; respects `prefers-reduced-motion`.
- Real, honest progress across weighted stages: (1) download (bytes via streamed fetch / LoadingManager), (2) decode (Draco/Meshopt/KTX2), (3) GPU texture upload (`renderer.initTexture` for every texture), (4) shader compilation (`renderer.compileAsync` on the full scene incl. all instrument, effect, X-ray, clipping and hands variants), (5) warm-up (render 2–3 offscreen frames of each step camera + outside view, prime particle pools and post-FX targets). Show stage name + percentage.
- Only when all stages complete: fade/iris the lens ring open into the scope view (~600 ms). The "Enter" interaction is instant afterwards.
- Failure handling: WebGL2 unavailable or load error → in-theme error card with a retry and a "Low quality" option. Device check at start picks the default quality preset (GPU tier heuristic via renderer/WEBGL_debug_renderer_info where available + `navigator.hardwareConcurrency`/`deviceMemory`).
- Repeat visits: hashed assets cached by the browser (long-cache headers documented in deploy notes); optional Cache Storage for the .glb via a minimal hand-written service worker (no external libs) — implement only if it stays simple, else defer.

### 6.10 Performance & optimisation (MANDATORY — smoothness is a core requirement)
**Budgets** (record measured values in `docs/PERF.md` at each gate):
| Metric | Budget |
|---|---|
| Initial JS (gzip, before lazy chunks) | ≤ 250 KB |
| Total first-load transfer | ≤ ~14 MB (glb ≤ ~12 MB) |
| Loading-screen first paint (localhost) | < 1 s |
| Load to interactive (localhost, mid laptop) | report; target < 8 s |
| Frame rate, 1080p, mid-range iGPU, Medium | ≥ 45 fps sustained; target 60 |
| Long frames after "ready" (> 50 ms) during scripted run | 0 (headed/real GPU); headless: report only |
| New shader programs after "ready" (`renderer.info.programs.length`) | **0** (mechanical, checked in headless too) |
| Draw calls, scope view / outside view | ≤ 250 / ≤ 400 |
| Triangles rendered, scope view | ≤ ~1.5 M |
| GPU texture memory (estimate) | ≤ ~300 MB on Medium |
| JS heap growth over 3 full practice runs | < 10 % (no leaks) |
**Rules:**
- Build once at load, reuse forever: geometries, materials, instruments, InstancedMeshes (staples, clips), particle pools (smoke, blood, bubbles) with fixed capacity, decal pool, render targets. Nothing created or disposed in the frame loop or during actions.
- No runtime shader recompiles: never toggle `material.transparent`, `defines`, `side`, texture presence, clipping-plane count, or light count after load. Use material variants compiled during loading and swap them; drive effects with uniforms.
- No per-frame allocations: reuse module-level `Vector3/Quaternion/Matrix4` temps; no closures/arrays created per frame; no `console.log` in the loop.
- Morphs: compute app state once per frame and write influences only when changed (dirty flags); skip updates for invisible meshes.
- Rendering: `frustumCulled` on; static objects `matrixAutoUpdate = false` + manual updates; merge static chest-wall/bone meshes where it doesn't break picking/layers (keep a name→submesh map); hide what the scope can't see (e.g. left lung, distant bones) in scope view via a per-step visibility set; sort transparent objects minimally; shadow maps OFF by default (scope headlight is co-axial, so shadows are barely visible) — fake contact darkening in shader if needed.
- Post-FX: one combined full-screen pass for distortion + mask + vignette + chromatic aberration + grain + grade (single ShaderPass, no chain of many passes); half-res effects where possible; tone mapping in the same pass.
- Adaptive quality: dynamic resolution (pixel ratio scales between 0.6 and min(devicePixelRatio, 1.5) to hold the fps target, with hysteresis); preset auto-downgrade if sustained < 40 fps for 3 s; user can override in settings.
- Loading: assets via Meshopt + KTX2 (UASTC for normals / ETC1S for colour where quality allows), mip-mapped, sizes capped by preset; decoders in Web Workers; code-split non-critical modules (quiz, debrief, physiology lab UI, help overlay) with dynamic `import()`; preload the glb and critical font with `<link rel="preload">`.
- Picking/collision: BVH on load (built during loading stage 2/3), throttled hover picking (≤ 30 Hz), full picking only on click.
- Pause rendering when the tab is hidden; render on demand in static UI screens (debrief/menus) instead of a continuous loop.
- Tooling: `npm run perf:probe` = Playwright script that loads the production build, waits for "ready", records `renderer.info.programs.length`, runs the scripted Guided walk + Practice run + X-ray toggle + a complication, then asserts **program count unchanged**, reports draw calls/triangles per step, heap before/after, long-frame count (flagged as non-representative in headless), and writes results to `qa/perf.json` + appends a summary to `docs/PERF.md`. Expose `window.__perf` (fps, frame-time p95, draw calls, triangles, programs, textures) and a `?perf` on-screen overlay.
- Bundle check: `npm run build` prints gzip sizes; a test fails if initial JS > budget.
- Run WebGL in Chromium with `--use-angle=swiftshader` (or `--enable-unsafe-swiftshader`) if no GPU; never present headless fps as real fps. In the final report, give the exact steps for the user to measure fps on their own laptop (`?perf` overlay).

---

## 7. Data contracts (authoritative)
### 7.1 Coordinates
Metres, adult scale, origin ≈ tracheal carina; all meshes children of empty `thorax_root`. glTF axes: **+X = head (superior), +Y = patient's right = up toward the ceiling, +Z = anterior**; gravity −Y. `asset_manifest.json`'s `up_axis` text is a placeholder; this section wins. Verify at load (right lung centroid Y > heart centroid Y) and log the result.
### 7.2 Naming
- Use glTF **node** names, not mesh-data names. Differences: node `tree_airway_base` has mesh `tree_airway_RMLdivided` (same pattern for `tree_pulm_artery_base`, `tree_pulm_vein_base`); node `port_utility_5ICS` has mesh `port_utility_5ICS.001`. `procedure_steps.json` uses node names.
- Lobes: `lung_upper_lobe_right`, `lung_middle_lobe_right`, `lung_lower_lobe_right`, `lung_upper_lobe_left`, `lung_lower_lobe_left`.
- Hilar trees: `tree_pulm_artery_base`, `tree_pulm_vein_base`, `tree_airway_base`.
- RML structures: `V_RML_common`, `V4_lateral`, `V5_medial`, `V_RML_accessory_1/2`; `A_RML_common`, `A4_lateral`, `A5_medial`, `A_RML_accessory_1/2`, `A_RML_extra_1`; `B_RML_common`, `B4_lateral`, `B5_medial`.
- Soft tissue: `mediastinal_fat`, `mediastinal_fat_window`, `hilar_connective_tissue`, `hilar_connective_tissue_window`, `pericardium`, `inferior_pulmonary_ligament`, `LN_4R`, `LN_7`, `LN_10R`, `LN_11R`, `LN_12R`.
- Mediastinum: `phrenic_nerve_right`, `vagus_nerve_right`, `azygos_vein`, `superior_vena_cava`, `inferior_vena_cava`, `aorta`, `heart_rest`, `left_atrium_provisional`, `esophagus`, `diaphragm`, brachiocephalic vessels, `pa_left`.
- Chest wall (outer→inner): `skin`, `subcutaneous_fat`, `chest_wall_muscle`, `intercostal_muscles`, `parietal_pleura_wall`; bones `rib_R1..R12`, `rib_L1..L12`, `spine`, `sternum`, `scapula_left/right`, `clavicula_left/right`, `costal_cartilages`.
- Ports: `port_camera_8ICS`, `port_utility_5ICS`, `port_retraction_8ICS`; glTF `extras`: `skin_point`, `pleura_point`, `axis_into_chest` in Blender world coords (Z-up) → convert glTF = (x, z, −y).
- `rib_R5` + `rib_R6` are two halves of anatomical rib 5, so `rib_R7..R12` = anatomical ribs 6–11. Never label ribs from mesh names without this correction.
### 7.3 Morph targets ↔ app state
Single app state; every frame write influence for each morph name on EVERY mesh that has it (via `morphTargetDictionary`), only when the value changed.
| State (0–1) | Morph | Meaning |
|---|---|---|
| deflate_RUL/RML/RLL | collapse_RUL/RML/RLL | lobe collapse; structures inside each lobe carry the same morph |
| — | mediastinal_shift = max(deflate_RUL, deflate_RML, deflate_RLL) | 1 cm shift |
| retract_posterior | retract_posterior | collapsed lung retracted posteriorly + lifted |
| retract_fissure | retract_fissure | RUL up, RLL down, RML lifted |
| heartbeat (0 diastole→1 systole) | heartbeat | heart/great-vessel pulse + transmitted motion |
| breath (0 exp→1 insp) | breath_left | left-lung ventilation + left hemidiaphragm |
Retraction morphs were authored on the collapsed lung — apply only when relevant deflate ≈ 1. Defaults: HR 75 bpm (systole ≈ 0.3 s), RR 15/min (inspiration 40 %). A ventilated right lobe (deflate < 0.2) may oscillate 0↔0.08 with breathing; a collapsed lobe does not breathe.
### 7.4 `procedure_steps.json` schema
```
{ "version":"v3","fps":24,"heart_rate_bpm":75,"resp_rate_per_min":15,
  "state_to_morph":{...},"default_hidden":["hilar_connective_tissue_window","mediastinal_fat_window"],
  "physiology_timeline":[{"frame":1,"label":"Two-lung ventilation"},...],
  "steps":[{"step":1,"label":"Step 1 - Inspect ...","start_frame":721,"camera":"cam_1_inspection",
    "lens_mm":18,"sensor_width_mm":36,"port":"port_camera_8ICS","scope_angle_deg":29.7,
    "state":{"deflate_RUL":1,"deflate_RML":1,"deflate_RLL":1,"retract_posterior":0,"retract_fissure":0},
    "hidden":[...]},...7 steps],
  "layer_groups":{"Lobes":[...],"RML_hilum":[...],"Lymph_nodes":[...],"Hilar_vessels_airway":[...],
    "Mediastinum":[...],"ChestWall":[...],"Bones":[...],"Soft_tissue":[...],"Ports":[...],...} }
```
Steps: 1 inspect · 2 retract posteriorly (anterior hilum, phrenic, superior pulmonary vein) · 3 middle lobe vein · 4 vein divided (nodes 11R/12R, RML bronchus) · 5 bronchus divided (A4/A5) · 6 fissure completion · 7 lobe removed, RUL/RLL re-inflated, stump check. Step 4 camera uses a 44° optic offset; steps 3/5 use a different port than the camera port — show the active port.
### 7.5 Cameras
glTF cameras `cam_1_inspection` … `cam_7_reinflation`. Add a spot light ("scope headlight") attached to the active camera. Near plane ≤ 1 mm (use logarithmic depth only if z-fighting appears and perf allows; otherwise tighten far plane per view).
### 7.6 Known model limitations (show honestly; work around in config/code, never edit the glb)
RML branches lie inside the lobe without an opened fissure; wet gloss/subsurface do not bake (handled at runtime, §8); nerve paths, retraction amounts and the 1 cm shift are approximations; vessel trees are trimmed inside the lung (outside view with lungs hidden → label "hilar vessels only"); semi-transparent pleura may show sorting artefacts; ~19.6 MB glb (optimise in pipeline); the video patient had a tumour and an extra upper-lobe margin was taken — NOT modelled (mention in Guided step 6 as a note); port positions differ from the video (map by role, §6.4). Log asset defects in `docs/ASSET_ISSUES.md`.

---

## 8. Look spec — "reads as the real footage" (MANDATORY, within §6.10 budgets)
Primary reference: `assets_src/ref-frames/*` as catalogued in `docs/REFERENCE_FRAMES.md` / `docs/VIDEO_STEP_MAP.md`. Where a frame contradicts the text below, **the frame wins**. Optional secondary: `assets_src/video/*.mp4` (extract stills with ffmpeg if available). Keep the baked colour/normal maps; enhance at runtime via material overrides (`onBeforeCompile` or `MeshPhysicalMaterial`); all values in `src/scene/materials.config.ts`. Sample representative tissue colours from the ref-frames (write the hex values into `docs/REFERENCE_FRAMES.md`) and tune base colour/tint to match. Prefer cheap techniques (uniform tweaks, shared procedural noise texture) over extra passes or lights.
- **Optics:** wide angle from the glb camera; barrel distortion (subtle, k1 ≈ 0.1–0.2), scope mask matching the frames' crop with soft edge, mild vignette, very slight chromatic aberration at the rim, subtle sensor noise, large depth of field — all in ONE post pass. Colour grade matched to the frames; cheap auto-exposure (luminance from a tiny downsampled target, updated a few times per second).
- **Lighting:** the scope headlight is THE light source: co-located with the lens, inverse-square falloff (near tissue bright, far cavity dark), soft-edged cone; low ambient; low-intensity prefiltered env map only for reflections. ACES/AgX tone mapping, sRGB output.
- **Wetness:** clearcoat high (≈0.7–1.0), clearcoat roughness low (≈0.05–0.15); sharp specular highlights that move with the scope; one shared tiling micro-normal texture for a liquid film; fresnel rim.
- **Per-tissue appearance** (verify against frames):
  - Collapsed right lung: dusky pink-grey/purplish, lobular pattern, black anthracotic speckling (procedural mask from the shared noise texture), thin glossy pleura.
  - Ventilated lung: brighter salmon-pink, smoother.
  - Mediastinal fat: rich yellow, lobulated, very glossy, slight translucency (wrap lighting).
  - Pulmonary veins: dark purple-blue, thin-walled.
  - Pulmonary artery: pale pinkish-white, thicker wall.
  - Bronchus: pale cream-white, subtle cartilage ring ridges.
  - Nerves: thin white glistening cords with a small accompanying vessel.
  - Lymph nodes: grey-black/anthracotic.
  - SVC: bluish, thin-walled.
  - Parietal pleura/chest wall: glossy, rib ridges, fine intercostal vessels.
  - Pericardium: bluish-white sheen with transmitted heartbeat.
- **Subsurface approximation:** wrap lighting + red-shifted back-scatter term on lung, fat and heart in the material shader; no extra passes.
- **Motion:** heartbeat transmitted to hilum/mediastinum; ventilated lobes breathe; local deformation on instrument contact; tissue stretch under retraction.
- **Instruments:** matte black shafts, satin steel tips with crisp highlights from the headlight, stapler cartridge colours per sub-option, translucent silicone leader; matched to the ref-frames.
- **Gloved hands (outside view / inset only):** surgical-glove material (matte latex/nitrile sheen, subtle translucency at fingertips; cream latex or blue nitrile — config option), relaxed natural grip on handles.
- **Effects (pooled, preset-scaled):** cautery smoke wisps, brief lens fog (uniform in the post pass), blood decal + ooze, staple-line caps, clips, irrigation fluid surface with bubbles only on leak.

---

## 9. Design tokens
background `#0A0C0F`, surface `#12161B`, elevated `#181D24`, border `#232A33`, text `#E7EAEE`, muted `#8B95A3`, accent surgical teal `#38B2AC`, warning amber. 8-px spacing scale; 12–16 px radii; 1-px borders; no gradients except one soft vignette; motion 150–250 ms ease-out. Hotbar slots: elevated surface, 1-px border, accent outline when active, key number in muted text top-left. Loading screen uses the same tokens.

---

## 13. Reference video timeline (paraphrased from auto-captions; caption errors corrected; treat as operative flow reference)
- **0:26–0:39** Anterior working port created; ~4 cm access incision placed as for an upper lobectomy, in an upper-mid intercostal space (exact space garbled in captions — use asset ports).
- **0:46–0:56** Two retractors manipulate the upper and middle lobes; view improves with retractors through the former camera port (camera moved). A tumour is present in the middle lobe (not modelled).
- **0:59–1:13** Retractors hold upper and middle lobes to stretch the tissue over the SVC; mediastinal pleura cleared bluntly; two middle lobe vein branches appear.
- **1:24–2:17** Passage created behind both vein branches. The stapler must come through the former camera port where the retractors sit → retraction transferred to a clamp through the access incision ("retraction swap"). A curved-tip vascular stapler hooks behind both veins, anvil through the tunnel; both branches divided together.
- **2:17–2:52** Retractors back through the former camera port; upper lobe pulled to tension the middle lobe bronchus; peanut sponge dissection; cautery incises pleura to open part of the interlobar fissure; a ring clamp extracts a lymph node beside the bronchus (removing lymphatic tissue improves visualisation).
- **3:09–3:41** Large blunt clamp passed safely around the bronchus; any working incision can pass the stapler — here the access incision had the right angle; bronchus divided.
- **3:41–5:00** Division of the bronchus exposes the two middle lobe artery branches. Part of the incomplete fissure divided to ease stapler passage; retraction swapped again; tunnel behind the arteries is long and serpentine → a silicone leader attached to the stapler tip guides the anvil through without over-dilating; tissue put on stretch; both artery branches divided together (alternative: individually).
- **5:14–6:11** Scope returned to the original camera port for a better view of the minor fissure; lobe positioned; (extra upper-lobe margin taken because of tumour — not modelled); stapler via the anterior working port; lobe viewed from above, then flipped and viewed from underneath to keep the residual bronchus above the stapler; an additional fire completes the fissure.
- **6:11–6:29** Specimen extraction sack inserted, lobe placed in it and removed via the access incision; intercostal nerve block performed.
- **6:34–6:45** Right paratracheal space and subcarinal space inspected and lymph nodes dissected.
- **6:45–end** Viewing through the anterior working port, chest tube inserted; under saline, scope inspects the bronchial stump while ventilating at ~20 cmH₂O (leak test).

---

## Project-specific notes
- Project name: **ThoraScope — VATS RML Lobectomy Simulator** (package `thorascope`).
- Input assets were found in `~/Downloads/surgery-docs/` and copied unchanged into `assets_src/` (gitignored).
- Env: Linux, Node 22, Intel Iris Plus (Ice Lake) iGPU, no ffmpeg; no video/transcript/tex inputs supplied.
