# PROGRESS (append-only)

- 2026-11-03 Pre-checks: node v22.23.4, npm 10.9.9, git 2.56.0, claude 2.1.317 — OK. GPU: Intel Iris Plus G1 (Ice Lake) iGPU. ffmpeg: not installed (optional). PDF tools: pdftotext/pdfimages; python3 PIL 9.0.1.
- 2026-11-03 assets_src/ was empty in the project dir; inputs found at ~/Downloads/surgery-docs/ and copied unchanged into assets_src/ (gitignored). Contents: thorax_sim_v3.glb (18.7 MiB = 19.58 MB, Draco + clearcoat + WebP textures, 87 meshes, 51 materials, 117 textures, 7 cameras), asset_manifest.json, procedure_steps.json, Wells & Coonar PDF (+ a compressed copy), MASTER_PROMPT_claude_ai_VATS_simulator.md, ref-frames/ (31 PNGs).
- Ref-frames (31): 0:28, 0:39, 0:42, 0:54, 0:58, 01:01, 01:13, 01:17, 01:25, 02:04, 02:14, 02:24, 02:36, 02:44, 03:04, 03:18, 03:36, "03:52 branches of middle lobe artery", 04:17, 04:29, 04:41, 05:06, 05:21, 05:50, 06:03, 06:12, 06:16, 06:20, 06:23, 06:29, 06:46.
- Optional inputs absent: video-transcript.txt, tex/, video/*.mp4.
- Playwright Chromium (headless shell 156.0.8078.4) installed OK via `npx playwright install chromium`.
- toktx/KTX-Software not installed (needed for KTX2 encode; T003 handles).
- 2026-11-03 T001 scaffold PASS (c4df56f). QA notes for M1: drop legacy .woff from @fontsource (woff2 only); move inline title style to a class.
- 2026-11-03 T000 reference docs done: 31/31 frames catalogued; 32-row practice sequence PA01–PA32; 14 conflicts resolved. ADR-003 (5:4 rounded-rect mask), ADR-004 (port roles), ADR-005 (order).
- 2026-11-03 T002 asset inspection PASS (4e97c1b): 767k tris, 8 morph names, axis check PASS, 0 missing names; ports+cameras sit outside thorax_root (logged).
- 2026-11-03 T003 built (db7f8b6): opt glb 11.07 MB (8.6 MiB gz), KTX2 + meshopt, verify PASS; awaiting QA. Renumbered duplicate ADR-003 (pipeline) → ADR-006. Note for T004+: mesh node transforms carry meshopt dequant scale/offset → use port extras, not node positions.
- 2026-11-03 T003 QA PASS: opt glb byte-reproducible (sha1 7c59006d), 11,071,400 B, verify PASS.
- 2026-11-03 T004 viewer PASS (3315a00): headless ready ~1.6–3.9 s, 21 programs, 93 draw calls, 821k tris, initial JS 193 KB gz (budget 250 — keep later UI lazy). M1 planned (T101–T109).
