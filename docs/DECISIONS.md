# DECISIONS (ADR-lite)

## ADR-001 Project name
ThoraScope — VATS RML Lobectomy Simulator; npm package `thorascope`.

## ADR-002 Asset location
Inputs copied unchanged from ~/Downloads/surgery-docs/ into assets_src/ (gitignored, read-only).

## ADR-003 Scope mask shape (frame wins over text)
Ref-frames show a hard-edged 5:4 rectangular scope image (YouTube capture), not a circle. §8 says the mask must match the
frames' crop and that frames win → post pass uses a 5:4 rounded-rectangle mask with a soft edge (corner radius + feather
in config), letterboxed in the viewport. The loading screen keeps the circular "lens" motif (§6.9 is branding, not optics).

## ADR-004 Port role mapping (see docs/VIDEO_STEP_MAP.md (b))
port_camera_8ICS = camera / "former camera" port; port_utility_5ICS = access incision (capacity up to 3 instruments);
port_retraction_8ICS = anterior working port (scope sits here for most of Practice). Guided mode uses the authored
glTF cameras/ports from procedure_steps.json unchanged.

## ADR-005 Procedure order
Scored Practice order follows ch.32 + video + procedure_steps: vein → bronchus (with mandatory ventilation test) →
arteries → fissure → extraction → optional 4R/7 → water test. Both LN_11R and LN_12R required, any order.
Pericardium colour follows frames (lavender-mauve), not the §8 text (bluish-white).

## ADR-006 Asset pipeline: meshopt + KTX2, normals capped at 512
`npm run assets:optimize` builds `public/models/thorax_sim.opt.glb` (Draco → meshopt + KHR_mesh_quantization, morph deltas included; no simplification — 11.07 MB vs the 12 MB budget, 767k tris unchanged).
Textures go to KTX2 per CONTEXT §6.10: UASTC (level 2, zstd 18) for normal maps, ETC1S (q128) for colour and roughness, all mipmapped. `ktx`/`toktx` come from the pinned KTX-Software 4.4.2 Linux tarball, fetched once into `.cache/ktx` (sha1-checked, gitignored, no sudo).
- Size: KTX2 is larger on the wire than the source WebP (3.39 MiB vs 1.55 MiB). UASTC normals at 1024 put the glb at ~12.9 MB, so normals are capped at 512 (the source normal maps are low-frequency: 110 KB of WebP for 12 MP). Colour/roughness keep their source sizes (max 1024).
- GPU memory estimate: 30.3 MP of KTX2 transcoded to BC7/ASTC (≤ 1 B/px) × 1.33 mips ≈ 40 MB, vs ≈ 195 MB if the WebP stayed (36.6 MP × 4 B × 1.33). Budget is 300 MB on Medium.
- Per-preset caps: one glb serves all presets; Low drops each texture's top mip at load (T704, half size), ~40 MB already fits Medium. If a smaller tier is ever needed, emit a second glb from this script with a lower resize cap.
- Runtime: KTX2Loader needs `public/decoders/basis_transcoder.{js,wasm}` (copied from the pinned three by the script). The meshopt decoder is bundled from `three/examples/jsm/libs/meshopt_decoder.module.js`. No Draco decoder is needed.
- quantize puts the dequantisation transform into each mesh node's local matrix, so mesh-node TRS differs from the source but world-space geometry does not. Ports must be read from `extras` (CONTEXT §7.2).

## ADR-007 UI = plain TypeScript DOM components (no framework)
UI is hand-written TS over plain DOM (no Preact/React/lit). The initial-JS budget is 250 KB gzip and three.js alone takes
most of it; a framework buys little for a handful of panels with event-driven updates (§6.7: no per-frame DOM writes).
The loading screen markup + critical CSS live in `index.html` so it paints before the bundle runs; `src/ui/loadingScreen.ts`
only drives it. Revisit if panel count/complexity makes manual DOM updates error-prone.

## ADR-008 Warm-up renders to the (hidden) canvas
Stage 5 renders 2 frames per glTF camera + outside view to the default framebuffer behind the opaque loading screen,
because rendering to a render target compiles different programs (no tone mapping/linear output) and would not warm
the on-screen ones. Post-FX targets warm via `registerWarmupHook`.

## ADR-009 Chest tube (PA31) is optional in practice scoring
- Context: VIDEO_STEP_MAP (d) chains PA32 water test after PA31 chest tube; CONTEXT §6.3/§6.4 call the chest tube optional.
- Decision: PA31 optional, weight 0; PA32 depends on PA29. Rule: a required action never depends on an optional one (enforced by src/sim/practiceActions.ts).
- Status: pending clinician review (as are all weights and the 45° approach limit in PORT_CONFIG).

## ADR-010 Muted text + overlay tokens lifted for WCAG AA over the scope
- Context: T802 a11y.spec measured muted UI text over the bright scope image at 3.59–4.36:1 (below AA 4.5:1).
- Decision: `--color-muted` #8b95a3 → #939dab and `--color-surface-overlay` 82 % → 88 % (src/ui/tokens.css). This deviates from the CONTEXT §9 muted value; the spec value is superseded by this ADR.
- Status: measured mechanically (tests/e2e/a11y.spec.ts tests darkest + brightest scope pixel under each element).

## ADR-011 Live step-3 scope snaps through the access incision (port_utility_5ICS)
- Context: the step-3 authored view (RML vein, after poseFix) needs a ~95° optic from port_retraction_8ICS, but the rig clamps the optic at 70°, so the live step-3 view showed only chest wall (ASSET_ISSUES L3). From the access incision it needs ~72°.
- Decision: src/content/procedure_steps.json step 3 scope port → port_utility_5ICS, matching steps 4–5 (VIDEO_STEP_MAP conflict 3). Practice mode still chooses ports per action (practice_actions.json), unaffected.
- Status: pending clinician review (port choice per step vs the reference video).

## ADR-012 Teaching colour convention for hilar structures (clarity over footage fidelity)
- Context: user feedback 2026-11-05: zoomed views were unreadable (vessels/bronchus indistinguishable). In the footage, pulmonary arteries and veins look similar (pink/plum).
- Decision (T807): atlas-style classes: pulmonary arteries blue-violet, pulmonary veins dark plum, bronchus ivory with cartilage rings, nodes grey-brown, nerves pale yellow, pericardium lavender; a per-step focus glow (Layers → "Highlight step structures", on in Guided); per-step scope occluder hiding. This departs from CONTEXT §8 "reads as the real footage" for these classes on purpose.
- Status: pending clinician review (colour choices, and whether a "footage-true" toggle is wanted).

## ADR-013 Realistic palette by default, Teaching palette optional (supersedes ADR-012's default)
- Context: user feedback 2026-11-05: the ADR-012 atlas colours (blue arteries, purple veins, yellow nerves) read cartoonish next to the real frames; the user wants the scope view hyperrealistic and the anatomy still clear.
- Decision (T826): two palettes. Realistic (default): footage-true colours from docs/REFERENCE_FRAMES.md (artery pale grey-pink, vein dark plum-maroon, bronchus ivory-pink, nodes grey-brown anthracotic, nerves white-cream, fat rich yellow, pericardium/pleura pink-lavender, lung dusky pink-grey). Teaching: the ADR-012 colours. Only colour / retint / rim differ (`REALISTIC` overrides in materials.config.ts); `setPalette` writes material.color and existing uniforms, so switching compiles nothing. Layers → "Colours: Realistic / Teaching", persisted in localStorage; `?palette=` overrides (tests). In Realistic, clarity comes from shape, gloss, luminance contrast (vein darkest) and the step-focus highlight, which works in both.
- Status: pending clinician review (realistic targets, and whether Teaching should be the Guided default).
