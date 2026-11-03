# Tasks — VATS RML Simulator (ThoraScope)
Legend: [ ] todo · [~] in progress · [q] awaiting QA · [x] done (QA passed) · [!] blocked · [>] deferred

## M0 Scaffold & pipeline — module gate: [ ]
- [~] T000 Reference docs: REFERENCE_FRAMES.md (all 31 frames + sampled hex colours + optics), VIDEO_STEP_MAP.md (frame→timeline→step→action, port mapping, conflicts, practice sequence), BOOK_NOTES.md (paraphrased, page refs) | AC: every file in assets_src/ref-frames listed in both docs; port mapping + conflicts sections present | files: docs/REFERENCE_FRAMES.md, docs/VIDEO_STEP_MAP.md, docs/BOOK_NOTES.md | QA: —
- [ ] T001 Vite+TS strict scaffold, pinned three@0.187.0 + three-mesh-bvh@0.9.18, ESLint+Prettier, Vitest, Playwright (Chromium, SwiftShader args), all npm scripts (dev/build/preview/lint/test/test:e2e/perf:probe/assets:optimize/check) as working stubs, folder layout per CLAUDE.md, tokens.css, minimal index.html shell | AC: `npm run lint && npm test && npm run build` exit 0; `npm run test:e2e` runs ≥1 smoke test exit 0 | files: package.json, vite.config.ts, tsconfig.json, eslint.config.js, playwright.config.ts, index.html, src/main.ts, src/ui/tokens.css, tests/unit/smoke.test.ts, tests/e2e/smoke.spec.ts | QA: —
- [ ] T002 Asset inspection script → docs/ASSETS.md (node names, mesh-vs-node name mismatches, triangles per mesh, morph targets per mesh, cameras, port extras converted to glTF coords, textures/sizes, axis verification right-lung centroid Y > heart centroid Y) | AC: `node scripts/inspect-assets.mjs assets_src/thorax_sim_v3.glb` exit 0; ASSETS.md has all those sections | files: scripts/inspect-assets.mjs, docs/ASSETS.md | QA: —
- [ ] T003 `npm run assets:optimize` with @gltf-transform: Draco→meshopt, prune/dedup/weld keeping node names, textures re-encoded (KTX2 UASTC normals / ETC1S colour if toktx obtainable, else WebP resize + ADR), → public/models/thorax_sim.opt.glb ≤ 12 MB; decoders copied to public/decoders; automated verify script (node names, morph target names per mesh, extras, cameras survive) | AC: optimize + verify exit 0; glb ≤ 12 MB; before/after recorded in ASSETS.md | files: scripts/optimize-assets.mjs, scripts/verify-assets.mjs, public/models/*, public/decoders/*, docs/ASSETS.md | QA: —
- [ ] T004 Minimal viewer + `?debug` overlay: load opt glb (meshopt/KTX2 decoders from public/decoders), orbit view, axes helper, hover node-name label (throttled), console log of axis check; `window.__perf` skeleton (programs, draw calls, triangles) + `ready` flag | AC: e2e loads app, waits `window.__perf.ready`, `?debug` screenshot to qa/screenshots/debug.png; build exit 0 | files: src/main.ts, src/scene/loader.ts, src/core/perf.ts, tests/e2e/smoke.spec.ts | QA: —
- [ ] T005 perf:probe skeleton + bundle-size test: Playwright script builds/loads preview, waits ready, records programs/drawcalls/triangles/heap, asserts program count unchanged after scripted orbit, writes qa/perf.json + appends to docs/PERF.md; vitest test fails if initial JS gzip > 250 KB; `npm run check` chains all | AC: `npm run check` exit 0 | files: scripts/perf-probe.mjs, tests/unit/bundle-size.test.ts, package.json | QA: —

## M1 Loading screen, viewer, realism renderer & physiology — module gate: [ ]
## M2 Guided procedure — module gate: [ ]
## M3 Scope & viewing controls + hotbar shell — module gate: [ ]
## M4 Instruments, hands, ports & actions — module gate: [ ]
## M5 Practice mode, complications & scoring — module gate: [ ]
## M6 Content & quiz — module gate: [ ]
## M7 Performance hardening — module gate: [ ]
## M8 Polish & local release — module gate: [ ]

## Deferred

## Blocked
