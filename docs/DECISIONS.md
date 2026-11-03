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
- Per-preset caps: one glb serves all presets. KTX2 cannot be cheaply downscaled at load, and ~40 MB already fits Low. If a smaller tier is ever needed, emit a second glb from this script with a lower resize cap.
- Runtime: KTX2Loader needs `public/decoders/basis_transcoder.{js,wasm}` (copied from the pinned three by the script). The meshopt decoder is bundled from `three/examples/jsm/libs/meshopt_decoder.module.js`. No Draco decoder is needed.
- quantize puts the dequantisation transform into each mesh node's local matrix, so mesh-node TRS differs from the source but world-space geometry does not. Ports must be read from `extras` (CONTEXT §7.2).
