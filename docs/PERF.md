# PERF — budgets and measurements

Single record of performance against the CONTEXT §6.10 budgets. Current as of the M7 gate (T705, 2026-11-05).

**Environment (honest caveat).** "Measured" numbers come from `npm run perf:probe` (`qa/perf.json`, run
2026-11-05T02:40Z) and `npm run build`: headless Chromium on this machine's Intel UHD Graphics (ICL GT1) through
ANGLE/Vulkan, 1280×720, Medium preset, localhost `vite preview`. That is a real GPU, not SwiftShader, but it is
**not** the "mid-range iGPU at 1080p" of the budget, and the run is driven by a test script (page.evaluate
round-trips, forced GC). Sizes, shader programs, draw calls, triangles, texture memory and heap are
hardware-independent and trustworthy; fps, frame times and long frames are **indicative only**. Real fps is the
"User measured" column (steps below). Older SwiftShader entries in the probe log are software GL: ignore their times.

| Metric | Budget | Measured | How measured | Date | User measured |
|---|---|---|---|---|---|
| Initial JS (gzip, before lazy chunks) | ≤ 250 KB | 233 KB (entry 73.5 + three 84.3 + keybindings 71.8 + config 3.5) | `npm run build` gzip sizes of the entry + modulepreloads; guarded by `tests/unit/bundle-size.test.ts` | 2026-11-05 | — |
| Total first-load transfer | ≤ ~14 MB (glb ≤ ~12 MB) | 11.4 MB; glb 11.07 MB (10.6 MiB) | perf:probe network sum; file size of `public/models/thorax_sim.opt.glb` | 2026-11-05 | |
| Loading-screen first paint (localhost) | < 1 s | 156 ms (loading.spec: 128 ms) | perf:probe FCP; `tests/e2e/loading.spec.ts` | 2026-11-05 | |
| Load to interactive (localhost, mid laptop) | report; target < 8 s | 2.9 s medium (loading.spec, low: 2.0–2.9 s over 5 runs) | perf:probe `readyMs` (sum of the five loading stages) | 2026-11-05 | |
| Frame rate, 1080p, mid-range iGPU, Medium | ≥ 45 fps sustained; target 60 | indicative only: 50.4 fps avg, p95 16.7 ms (vsync-bound) at 1280×720 under automation | perf:probe; **user to measure** on real hardware with `?perf` | 2026-11-05 | user to measure |
| Long frames after "ready" (> 50 ms), scripted run | 0 headed/real GPU; headless: report only | main script 1 (max 67 ms, opacity cut-away); practice 4 per run (max 150 ms) | perf:probe (headless, test-driven: report only) | 2026-11-05 | |
| New shader programs after "ready" | **0** | 0: 32 → 32 (medium, main script and all 3 practice runs); low preset 33 → 33 (viewer.spec) | `renderer.info.programs.length` at ready vs end; viewer.spec asserts equality | 2026-11-05 | |
| Draw calls, scope / outside | ≤ 250 / ≤ 400 | scope: guided steps ≤ 60, free rig 34, practice 68, with instruments + effects (M4) peak 132; outside 92 (101 with hands) | perf:probe phases | 2026-11-05 | |
| Triangles rendered, scope | ≤ ~1.5 M | guided steps ≤ 479k, practice 490k, M4 instruments peak 964k; (outside 741k) | perf:probe phases | 2026-11-05 | |
| GPU texture memory (estimate) | ≤ ~300 MB on Medium | ≈ 107 MB (169 textures; RGBA8 × mips, excl. render targets) | perf:probe estimate | 2026-11-05 | |
| JS heap growth over 3 practice runs | < 10 % | 0 % (run 1 end 11.4 MB → run 3 end 11.4 MB) | perf:probe `practice` block, after CDP GC; see notes | 2026-11-05 | |

## Notes
- Texture size cap per preset: `quality.presets.*.textureDownscale` (true on low) makes the loader drop the top mip of every mipmapped KTX2 texture before upload (`src/scene/loader.ts`, T704): half resolution, about a quarter of the GPU memory. Medium/high keep full size; ≈107 MB measured is well under the 300 MB budget.
- Heap: the gate compares run-1 end vs run-3 end (0 %). Per-run growth (+15–17 %) is start → debrief closed and includes first-use lazy chunks (debrief, wireM5) and DOM; it is informational, not a steady-state leak signal.
- **Programs at ready: 32 on Medium, 33 on Low.** The M4 instrument, staple, effect and hands variants are compiled
  and warmed during loading (stages 4–5), so the count at ready is higher than M1's 26 (low). The invariant is
  0 new programs after ready, checked on every probe and in `viewer.spec`.
- **Scope-hidden names.** `spine`, `sternum` and `pa_left` are in `config.scope.hidden` (T702: drawn every step but
  never seen). The hidden set applies to the whole scope view, so they are also hidden in the free scope rig and in
  X-ray mode inside the scope. The outside view still shows them.
- **Mesh merging skipped.** Draw calls are far under budget (≤ 132 / 101 vs 250 / 400) and merging static meshes
  would break per-name picking, the layers panel, per-step hidden sets and per-mesh tissue variants. Revisit only if
  a budget is hit.
- **Known:** the bleeding decal is a camera-facing quad (not projected onto the surface; T506 open item).
- **Deferred:** service worker / offline glb cache (T704, `[>]`); HTTP long-cache headers in
  `docs/DEPLOY_HOSTINGER_KVM.md` cover repeat visits.
- **Heap method.** Re-entering practice reloads the page (wireM5 restart), so heap is read after GC at the same
  points of 3 reloaded runs (practice ready, debrief closed). The gate is run-3 end vs run-1 end; the per-run
  +15–17 % (lazy debrief chunk + run log) is informational.
- Low and Medium render the scene at half resolution (`config.postfx.halfResScale`), the combined pass upsamples.
  `PERF_QUALITY=low|medium|high npm run perf:probe` forces a preset. perf:probe rebuilds `dist/` on every run;
  `PERF_NO_BUILD=1` reuses an existing build.

## Measure on your own laptop
1. `npm run build && npm run preview`, then open `http://localhost:4173/?perf` in Chrome or Edge, full screen at
   1080p, on mains power. Optional: `&quality=medium` pins the Medium preset (the budget's preset).
2. Wait for the scene, then read the overlay (fps, p95 frame time, draw calls, triangles, programs, pixel ratio, preset).
3. Do a full Guided walk (steps 1–7, both scope and outside view), then one Practice run to the debrief.
4. Record in the "User measured" column above: sustained fps and p95 during each, draw calls in scope/outside,
   programs at ready vs at the end (must be equal), and any visible hitches. Note the machine, GPU and browser.

## Detail: load path (T704, 2026-11-05)
Measured with `tests/e2e/loading.spec.ts` (Chromium, real GPU via Vulkan, localhost preview, low preset):
- FCP 128 ms (budget < 1 s). Ready (sum of the five stages) 2.0–2.9 s: download 44–89 · decode 0.9–1.7 s ·
  upload 141–280 · compile 68–138 · warmup 408–658 ms (5 runs; spread is machine load from parallel agents).
- Preloads: glb (`as=fetch crossorigin`, matches the loader's default-mode `fetch`) and Inter 400 woff2
  (`as=font crossorigin`, Vite rewrites the href to the hashed asset). The spec asserts one request each and no
  "preloaded but not used" console warning.
- Decoders: KTX2 transcode runs in three's KTX2Loader WorkerPool (4 blob workers); meshopt was on the main thread
  (MeshoptDecoder never had `useWorkers` called) and now uses a worker pool of the same size for the parse, torn
  down after. Decode wall time is unchanged within noise (A/B 0.89–1.14 s either way); the main thread is freed.
- Texture caps: `textureDownscale` (low) drops mip 0 of each mipmapped KTX2 texture at load (half size, ~¼ memory);
  medium/high keep the glb sizes (colour/rough ≤ 1024, normals 512, ADR-006). Needs main.ts to pass the flag (WIRING T704).
- dist: three's bundled `basis_transcoder.{js,wasm}` copy (571 KB) no longer emitted into assets/ (vite.config.ts
  plugin; app uses decoders/). dist 13.22 MB → 12.63 MB (includes other concurrent edits).

## Detail: render-cost audit (T702, 2026-11-05)
Numbers as of T702 (before M4 wiring; current values are in the table at the top). perf:probe, Chromium real GPU (ANGLE/Vulkan), medium preset, 1280×720. "Before" = tree at task start (incl. T111's
`intercostal_muscles` scope-hide); after = this task. Frame-time p95 (now in the probe output) is vsync-bound here.
| View | before calls / tris | after calls / tris |
|---|---|---|
| scope step 1 / 2 / 3 / 4 | 60/520k · 39/469k · 55/496k · 47/457k | 56/478k · 39/451k · 53/467k · 44/415k |
| scope step 5 / 6 / 7 / rig | 43/441k · 43/443k · 39/382k · 31/386k | 41/412k · 40/414k · 37/353k · 30/335k |
| outside | 86/738k | 86/738k (unchanged; outside shows everything) |
| frame-time p95 / programs | 16.8 ms / 25→25 | 16.8 ms / 25→25 |
- Static transforms: already in place (loader `freezeStatic`): every glb node `matrixAutoUpdate=false`, one
  `updateMatrixWorld` at load, root `matrixWorldAutoUpdate=false`. Nothing in the glb moves (morphs only); instruments,
  hands, staples, fluid and effects are separate objects with their own matrix handling.
- frustumCulled: on for all 87 glb meshes (none skinned/instanced). Off only for effects points/meshes (bounds change
  every frame, small pools). Morphed meshes (48) keep culling on with a load-time conservative sphere
  (`morphSafeBounds`): GLTFLoader's bounds assume morph weights sum to ≤ 1, the lobes combine collapse + shift + retract.
- Scope visibility: audited per step by hooking `onBeforeRender` (what is drawn) and a 120×72 pick-ray grid (what is
  seen). Left lung, left ribs, scapulae, clavicles, skin/fat/chest-wall muscle were already hidden; `spine`, `sternum`
  and `pa_left` were drawn in every step but never hit, so they joined `config.scope.hidden`. The vessel/airway trees,
  heart, aorta, oesophagus etc. are also unhit from the step poses but stay (mediastinal anatomy for X-ray in the
  scope and for the free scope rig). Ribs R1–R5 and costal cartilages are hit (poke through the pleura), so they stay.
- Static mesh merging: skipped. Draw calls are ≤ 56 scope / 86 outside against 250 / 400, and merging would break the
  per-name picking, layers panel, per-step hidden sets and per-mesh tissue variants. Revisit only if a budget is hit.

## Probe log (history)
Appended by every perf:probe run (newest last). Kept for trend history only; the table above is current.
SwiftShader entries are software GL: their times are meaningless.

### 2026-11-03T06:36:47.755Z (headless SwiftShader, script: orbit)
- FCP 132 ms · ready 3928 ms · transfer 11.29 MB
- programs 20 → 20 · textures 166
- ready: 92 draw calls, 821385 tris
- orbit: 92 draw calls, 821385 tris
- heap 5.6 → 5.9 MB
- long frames 64 (max 2733 ms), fps 1.4 — NOT representative (headless)

### 2026-11-03T06:40:00.061Z (headless SwiftShader, script: orbit)
- FCP 136 ms · ready 1383 ms · transfer 11.29 MB
- programs 20 → 20 · textures 166
- ready: 92 draw calls, 821385 tris
- orbit: 92 draw calls, 821385 tris
- heap 5.6 → 5.9 MB
- long frames 62 (max 3167 ms), fps 1.4 — NOT representative (headless)

### 2026-11-03T06:47:50.367Z (headless SwiftShader, script: orbit)
- FCP 128 ms · ready 3745 ms · transfer 11.31 MB
- programs 20 → 20 · textures 166
- ready: 92 draw calls, 821385 tris
- orbit: 92 draw calls, 821385 tris
- heap 5.7 → 6 MB
- long frames 62 (max 2500 ms), fps 1.5 — NOT representative (headless)

### 2026-11-03T07:29:13.216Z PASS (headless SwiftShader, script: orbit)
- FCP 148 ms · ready 6167 ms · transfer 11.31 MB
- programs 20 → 20 · textures 166
- orbit: 92 draw calls, 821385 tris
- heap 5.7 → 6 MB
- long frames 59 (max 10333 ms), fps 1 — NOT representative (headless)

### 2026-11-03T07:30:35.764Z PASS (headless SwiftShader, script: orbit)
- FCP 132 ms · ready 11163 ms · transfer 11.31 MB
- programs 20 → 20 · textures 166
- orbit: 92 draw calls, 821385 tris
- heap 5.7 → 6.1 MB
- long frames 58 (max 6333 ms), fps 1.1 — NOT representative (headless)

### 2026-11-03T07:47:50.411Z PASS (headless SwiftShader, script: orbit)
- FCP 156 ms · ready 12287 ms · transfer 11.32 MB
- programs 22 → 22 · textures 168
- orbit: 94 draw calls, 821387 tris
- heap 5.7 → 6.1 MB
- long frames 62 (max 8850 ms), fps 1.1 — NOT representative (headless)

### 2026-11-03T08:42:44.801Z PASS (headless SwiftShader, script: orbit)
- FCP 144 ms · ready 25038 ms · transfer 11.32 MB
- programs 22 → 22 · textures 168
- orbit: 91 draw calls, 785960 tris
- scope-step1: 65 draw calls, 600256 tris
- scope-step2: 44 draw calls, 549176 tris
- scope-step3: 53 draw calls, 546482 tris
- scope-step4: 51 draw calls, 530047 tris
- scope-step5: 47 draw calls, 513754 tris
- scope-step6: 48 draw calls, 516233 tris
- scope-step7: 43 draw calls, 455096 tris
- heap 5.7 → 6.2 MB
- long frames 73 (max 4916 ms), fps 1.3 — NOT representative (headless)

### 2026-11-03T09:00:51.461Z PASS (headless SwiftShader, script: orbit)
- FCP 140 ms · ready 49148 ms · transfer 11.32 MB
- programs 25 → 25 · textures 170
- orbit: 87 draw calls, 738378 tris
- scope-step1: 86 draw calls, 738377 tris
- scope-step3: 40 draw calls, 501594 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 44 draw calls, 473450 tris
- scope-step6: 44 draw calls, 473450 tris
- scope-step7: 40 draw calls, 414792 tris
- heap 7.9 → 8.1 MB
- long frames 56 (max 32465 ms), fps 0.4 — NOT representative (headless)

### 2026-11-04T18:05:11.729Z PASS (headless SwiftShader, script: orbit)
- FCP 156 ms · ready 89038 ms · transfer 11.32 MB
- programs 25 → 25 · textures 170
- orbit: 87 draw calls, 738378 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 44 draw calls, 473450 tris
- scope-step7: 40 draw calls, 414792 tris
- heap 7.9 → 8.2 MB
- long frames 64 (max 15983 ms), fps 0.4 — NOT representative (headless)

### 2026-11-04T18:37:55.238Z PASS (headless SwiftShader, script: orbit)
- FCP 128 ms · ready 46972 ms · transfer 11.33 MB
- programs 25 → 25 · textures 170
- orbit: 87 draw calls, 738378 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 50 draw calls, 506178 tris
- scope-step4: 50 draw calls, 506178 tris
- scope-step5: 48 draw calls, 489743 tris
- scope-step6: 44 draw calls, 475877 tris
- scope-step7: 40 draw calls, 414792 tris
- heap 8.1 → 8.4 MB
- long frames 63 (max 40248 ms), fps 0.5 — NOT representative (headless)

### 2026-11-04T20:14:02.585Z PASS (headless SwiftShader, script: orbit)
- FCP 148 ms · ready 58610 ms · transfer 11.33 MB
- programs 25 → 25 · textures 170
- orbit: 87 draw calls, 738378 tris
- scope-step1: 86 draw calls, 738377 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 50 draw calls, 506178 tris
- scope-step4: 50 draw calls, 506178 tris
- scope-step5: 48 draw calls, 489743 tris
- scope-step6: 44 draw calls, 473450 tris
- scope-step7: 40 draw calls, 414792 tris
- heap 8 → 8.3 MB
- long frames 60 (max 17299 ms), fps 0.4 — NOT representative (headless)

### 2026-11-04T21:43:37.250Z PASS (headless SwiftShader, script: orbit)
- FCP 116 ms · ready 93151 ms · transfer 11.33 MB
- programs 25 → 25 · textures 170
- orbit: 87 draw calls, 738378 tris
- scope-step1: 86 draw calls, 738377 tris
- scope-step2: 61 draw calls, 552674 tris
- scope-step3: 51 draw calls, 506179 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 48 draw calls, 489743 tris
- scope-step6: 44 draw calls, 473450 tris
- scope-step7: 44 draw calls, 475877 tris
- heap 8.1 → 8.3 MB
- long frames 67 (max 13733 ms), fps 0.5 — NOT representative (headless)

### 2026-11-04T22:19:23.341Z PASS (headless SwiftShader, preset low, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 120 ms · ready 12491 ms · transfer 11.33 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- orbit: 87 draw calls, 738378 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 51 draw calls, 506179 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 44 draw calls, 473450 tris
- scope-step6: 45 draw calls, 475878 tris
- scope-step7: 40 draw calls, 414792 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 86 draw calls, 738377 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.1 → 8.6 MB
- long frames 98 (max 12933 ms), fps 1.8 — NOT representative (headless)

### 2026-11-04T22:22:31.413Z PASS (headless SwiftShader, preset low, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 124 ms · ready 14123 ms · transfer 11.33 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- orbit: 87 draw calls, 738378 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 41 draw calls, 501595 tris
- scope-step3: 50 draw calls, 506178 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 45 draw calls, 473451 tris
- scope-step6: 44 draw calls, 475877 tris
- scope-step7: 40 draw calls, 414792 tris
- outside: 87 draw calls, 738378 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 87 draw calls, 738378 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.1 → 8.5 MB
- long frames 89 (max 10600 ms), fps 1 — NOT representative (headless)

### 2026-11-04T22:28:42.604Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 120 ms · ready 31114 ms · transfer 11.33 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- orbit: 86 draw calls, 738377 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 50 draw calls, 506178 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 44 draw calls, 473450 tris
- scope-step6: 44 draw calls, 475877 tris
- scope-step7: 41 draw calls, 414793 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 87 draw calls, 738378 tris
- xray: 86 draw calls, 738377 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8 → 8.4 MB
- long frames 84 (max 18133 ms), fps 0.4 — NOT representative (headless)

### 2026-11-05T00:15:56.616Z PASS (headless SwiftShader, preset low, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 148 ms · ready 19355 ms · transfer 11.33 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- orbit: 87 draw calls, 738378 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 50 draw calls, 506178 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 44 draw calls, 473450 tris
- scope-step6: 45 draw calls, 475878 tris
- scope-step7: 40 draw calls, 414792 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 86 draw calls, 738377 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.1 → 8.6 MB
- long frames 94 (max 10683 ms), fps 1.8 — NOT representative (headless)

### 2026-11-05T00:28:24.142Z PASS (headless SwiftShader, preset low, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 128 ms · ready 20838 ms · transfer 11.33 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- orbit: 87 draw calls, 738378 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 51 draw calls, 506179 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 44 draw calls, 473450 tris
- scope-step6: 44 draw calls, 475877 tris
- scope-step7: 40 draw calls, 414792 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 86 draw calls, 738377 tris
- opacity-cutaway: 87 draw calls, 738378 tris
- heap 8 → 8.6 MB
- long frames 96 (max 10550 ms), fps 1.8 — NOT representative (headless)

### 2026-11-05T00:31:28.010Z PASS (headless SwiftShader, preset low, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 116 ms · ready 12591 ms · transfer 11.33 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- orbit: 87 draw calls, 738378 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 41 draw calls, 501595 tris
- scope-step3: 50 draw calls, 506178 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 45 draw calls, 473451 tris
- scope-step6: 44 draw calls, 475877 tris
- scope-step7: 40 draw calls, 414792 tris
- outside: 87 draw calls, 738378 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 87 draw calls, 738378 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8 → 8.5 MB
- long frames 88 (max 9550 ms), fps 1 — NOT representative (headless)

### 2026-11-05T00:37:48.327Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 132 ms · ready 29391 ms · transfer 11.33 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- orbit: 87 draw calls, 738378 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 50 draw calls, 506178 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 44 draw calls, 473450 tris
- scope-step6: 44 draw calls, 475877 tris
- scope-step7: 40 draw calls, 414792 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 86 draw calls, 738377 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.1 → 8.4 MB
- long frames 91 (max 11433 ms), fps 0.4 — NOT representative (headless)

### 2026-11-05T00:50:55.781Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 116 ms · ready 3588 ms · transfer 11.36 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 50 draw calls, 506178 tris
- scope-step4: 49 draw calls, 489744 tris
- scope-step5: 44 draw calls, 473450 tris
- scope-step6: 44 draw calls, 475877 tris
- scope-step7: 40 draw calls, 414792 tris
- outside: 86 draw calls, 738377 tris
- olv: 87 draw calls, 738378 tris
- clamp: 87 draw calls, 738378 tris
- xray: 87 draw calls, 738378 tris
- opacity-cutaway: 87 draw calls, 738378 tris
- heap 8.7 → 9.4 MB
- long frames 1 (max 133 ms), fps 36 — NOT representative (headless)

### 2026-11-05T00:53:12.001Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 196 ms · ready 3607 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 50 draw calls, 506178 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 45 draw calls, 473451 tris
- scope-step6: 45 draw calls, 475878 tris
- scope-step7: 40 draw calls, 414792 tris
- scope-rig: 31 draw calls, 385684 tris
- outside: 86 draw calls, 738377 tris
- olv: 87 draw calls, 738378 tris
- clamp: 87 draw calls, 738378 tris
- xray: 87 draw calls, 738378 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.7 → 9.5 MB
- long frames 1 (max 200 ms), fps 59.5 — NOT representative (headless)

### 2026-11-05T01:12:26.107Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 148 ms · ready 3319 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 56 draw calls, 529178 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 44 draw calls, 473450 tris
- scope-step6: 44 draw calls, 475877 tris
- scope-step7: 40 draw calls, 414792 tris
- scope-rig: 31 draw calls, 385684 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 87 draw calls, 738378 tris
- opacity-cutaway: 87 draw calls, 738378 tris
- heap 8.7 → 9.5 MB
- long frames 1 (max 67 ms), fps 46.8 — NOT representative (headless)

### 2026-11-05T01:16:43.083Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 124 ms · ready 2446 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 56 draw calls, 529178 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 44 draw calls, 473450 tris
- scope-step6: 44 draw calls, 475877 tris
- scope-step7: 40 draw calls, 414792 tris
- scope-rig: 31 draw calls, 385684 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 86 draw calls, 738377 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.7 → 9.5 MB
- long frames 0 (max 17 ms), fps 59.5 — NOT representative (headless)

### 2026-11-05T01:17:48.631Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 116 ms · ready 2548 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 56 draw calls, 529178 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 44 draw calls, 473450 tris
- scope-step6: 44 draw calls, 475877 tris
- scope-step7: 40 draw calls, 414792 tris
- scope-rig: 31 draw calls, 385684 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 86 draw calls, 738377 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.7 → 9.5 MB
- long frames 0 (max 17 ms), fps 59.5 — NOT representative (headless)

### 2026-11-05T01:18:13.994Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 96 ms · ready 2378 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 56 draw calls, 529178 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 44 draw calls, 473450 tris
- scope-step6: 44 draw calls, 475877 tris
- scope-step7: 40 draw calls, 414792 tris
- scope-rig: 31 draw calls, 385684 tris
- outside: 86 draw calls, 738377 tris
- olv: 87 draw calls, 738378 tris
- clamp: 87 draw calls, 738378 tris
- xray: 87 draw calls, 738378 tris
- opacity-cutaway: 87 draw calls, 738378 tris
- heap 8.7 → 9.5 MB
- long frames 0 (max 17 ms), fps 59.5 — NOT representative (headless)

### 2026-11-05T01:18:39.600Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 132 ms · ready 2471 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 61 draw calls, 552674 tris
- scope-step2: 40 draw calls, 501594 tris
- scope-step3: 56 draw calls, 529178 tris
- scope-step4: 48 draw calls, 489743 tris
- scope-step5: 44 draw calls, 473450 tris
- scope-step6: 44 draw calls, 475877 tris
- scope-step7: 40 draw calls, 414792 tris
- scope-rig: 31 draw calls, 385684 tris
- outside: 86 draw calls, 738377 tris
- olv: 87 draw calls, 738378 tris
- clamp: 87 draw calls, 738378 tris
- xray: 87 draw calls, 738378 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.7 → 9.5 MB
- long frames 0 (max 33 ms), fps 59.5 — NOT representative (headless)

### 2026-11-05T01:23:09.953Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 144 ms · ready 3265 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 60 draw calls, 519906 tris
- scope-step2: 39 draw calls, 468826 tris
- scope-step3: 55 draw calls, 496410 tris
- scope-step4: 47 draw calls, 456975 tris
- scope-step5: 43 draw calls, 440682 tris
- scope-step6: 43 draw calls, 443109 tris
- scope-step7: 39 draw calls, 382024 tris
- scope-rig: 30 draw calls, 352916 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 86 draw calls, 738377 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.7 → 9.5 MB
- long frames 0 (max 17 ms), fps 59.5 — NOT representative (headless)

### 2026-11-05T01:23:42.919Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 132 ms · ready 3231 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 60 draw calls, 519906 tris
- scope-step2: 39 draw calls, 468826 tris
- scope-step3: 55 draw calls, 496410 tris
- scope-step4: 47 draw calls, 456975 tris
- scope-step5: 43 draw calls, 440682 tris
- scope-step6: 43 draw calls, 443109 tris
- scope-step7: 43 draw calls, 443109 tris
- scope-rig: 30 draw calls, 352916 tris
- outside: 86 draw calls, 738377 tris
- olv: 87 draw calls, 738378 tris
- clamp: 86 draw calls, 738377 tris
- xray: 86 draw calls, 738377 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.6 → 9.5 MB
- long frames 3 (max 150 ms), fps 35, frame p95 83.3 ms — NOT representative (headless)

### 2026-11-05T01:23:59.244Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 560 ms · ready 7520 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 60 draw calls, 519906 tris
- scope-step2: 39 draw calls, 468826 tris
- scope-step3: 55 draw calls, 496410 tris
- scope-step4: 47 draw calls, 456975 tris
- scope-step5: 43 draw calls, 440682 tris
- scope-step6: 43 draw calls, 443109 tris
- scope-step7: 39 draw calls, 382024 tris
- scope-rig: 30 draw calls, 352916 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 87 draw calls, 738378 tris
- xray: 87 draw calls, 738378 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.7 → 9.5 MB
- long frames 11 (max 383 ms), fps 59.5, frame p95 16.8 ms — NOT representative (headless)

### 2026-11-05T01:26:29.114Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 96 ms · ready 2743 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 57 draw calls, 490906 tris
- scope-step2: 40 draw calls, 456814 tris
- scope-step3: 53 draw calls, 467462 tris
- scope-step4: 45 draw calls, 428027 tris
- scope-step5: 41 draw calls, 411734 tris
- scope-step6: 40 draw calls, 414109 tris
- scope-step7: 38 draw calls, 366109 tris
- scope-rig: 31 draw calls, 338104 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 86 draw calls, 738377 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.7 → 9.5 MB
- long frames 0 (max 17 ms), fps 59.5, frame p95 16.8 ms — NOT representative (headless)

### 2026-11-05T01:27:42.043Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 100 ms · ready 2618 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 56 draw calls, 477873 tris
- scope-step2: 39 draw calls, 450814 tris
- scope-step3: 53 draw calls, 467462 tris
- scope-step4: 44 draw calls, 414994 tris
- scope-step5: 41 draw calls, 411734 tris
- scope-step6: 40 draw calls, 414109 tris
- scope-step7: 37 draw calls, 353076 tris
- scope-rig: 30 draw calls, 335104 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 86 draw calls, 738377 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.7 → 9.5 MB
- long frames 0 (max 17 ms), fps 53.3, frame p95 16.7 ms — NOT representative (headless)

### 2026-11-05T01:28:12.752Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 112 ms · ready 2744 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 56 draw calls, 477873 tris
- scope-step2: 39 draw calls, 450814 tris
- scope-step3: 53 draw calls, 467462 tris
- scope-step4: 44 draw calls, 414994 tris
- scope-step5: 41 draw calls, 411734 tris
- scope-step6: 40 draw calls, 414109 tris
- scope-step7: 37 draw calls, 353076 tris
- scope-rig: 30 draw calls, 335104 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 87 draw calls, 738378 tris
- xray: 87 draw calls, 738378 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.7 → 9.5 MB
- long frames 0 (max 17 ms), fps 56.3, frame p95 16.8 ms — NOT representative (headless)

### 2026-11-05T01:28:46.206Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 124 ms · ready 2853 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 56 draw calls, 477873 tris
- scope-step2: 39 draw calls, 450814 tris
- scope-step3: 53 draw calls, 467462 tris
- scope-step4: 44 draw calls, 414994 tris
- scope-step5: 41 draw calls, 411734 tris
- scope-step6: 40 draw calls, 414109 tris
- scope-step7: 37 draw calls, 353076 tris
- scope-rig: 30 draw calls, 335104 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 86 draw calls, 738377 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.7 → 9.5 MB
- long frames 0 (max 17 ms), fps 59.5, frame p95 16.8 ms — NOT representative (headless)

### 2026-11-05T01:29:42.819Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 116 ms · ready 2743 ms · transfer 11.37 MB
- programs 25 → 25 · textures 170 (≈ 115.8 MB)
- ready: 86 draw calls, 738377 tris
- orbit: 86 draw calls, 738377 tris
- scope-step1: 56 draw calls, 477873 tris
- scope-step2: 39 draw calls, 450814 tris
- scope-step3: 53 draw calls, 467462 tris
- scope-step4: 44 draw calls, 414994 tris
- scope-step5: 41 draw calls, 411734 tris
- scope-step6: 40 draw calls, 414109 tris
- scope-step7: 37 draw calls, 353076 tris
- scope-rig: 30 draw calls, 335104 tris
- outside: 86 draw calls, 738377 tris
- olv: 86 draw calls, 738377 tris
- clamp: 86 draw calls, 738377 tris
- xray: 86 draw calls, 738377 tris
- opacity-cutaway: 86 draw calls, 738377 tris
- heap 8.7 → 9.5 MB
- long frames 0 (max 33 ms), fps 60, frame p95 16.7 ms — NOT representative (headless)

### 2026-11-05T01:42:56.209Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 116 ms · ready 2556 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 91 draw calls, 740345 tris
- orbit: 91 draw calls, 740345 tris
- scope-step1: 60 draw calls, 478193 tris
- scope-step2: 43 draw calls, 451134 tris
- scope-step3: 57 draw calls, 467782 tris
- scope-step4: 48 draw calls, 415314 tris
- scope-step5: 45 draw calls, 412054 tris
- scope-step6: 44 draw calls, 414429 tris
- scope-step7: 41 draw calls, 353396 tris
- scope-rig: 34 draw calls, 335424 tris
- outside: 91 draw calls, 740345 tris
- olv: 92 draw calls, 740346 tris
- clamp: 92 draw calls, 740346 tris
- xray: 92 draw calls, 740346 tris
- opacity-cutaway: 91 draw calls, 740345 tris
- m4-scope: 122 draw calls, 957309 tris
- m4-tools: 59 draw calls, 467831 tris
- m4-cautery: 61 draw calls, 467891 tris
- m4-staple: 118 draw calls, 933802 tris
- m4-outside-hands: 99 draw calls, 732986 tris
- heap 9.6 → 10.5 MB
- long frames 0 (max 33 ms), fps 59, frame p95 16.8 ms — NOT representative (headless)

### 2026-11-05T01:43:30.905Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 116 ms · ready 2822 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 91 draw calls, 740345 tris
- orbit: 91 draw calls, 740345 tris
- scope-step1: 60 draw calls, 478193 tris
- scope-step2: 43 draw calls, 451134 tris
- scope-step3: 57 draw calls, 467782 tris
- scope-step4: 48 draw calls, 415314 tris
- scope-step5: 45 draw calls, 412054 tris
- scope-step6: 44 draw calls, 414429 tris
- scope-step7: 41 draw calls, 353396 tris
- scope-rig: 34 draw calls, 335424 tris
- outside: 91 draw calls, 740345 tris
- olv: 91 draw calls, 740345 tris
- clamp: 91 draw calls, 740345 tris
- xray: 91 draw calls, 740345 tris
- opacity-cutaway: 91 draw calls, 740345 tris
- m4-scope: 122 draw calls, 957309 tris
- m4-tools: 130 draw calls, 959581 tris
- m4-cautery: 61 draw calls, 467891 tris
- m4-staple: 118 draw calls, 933802 tris
- m4-outside-hands: 99 draw calls, 732986 tris
- heap 9.6 → 10.5 MB
- long frames 0 (max 50 ms), fps 49.7, frame p95 33.4 ms — NOT representative (headless)

### 2026-11-05T01:44:39.594Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 120 ms · ready 2889 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 91 draw calls, 740345 tris
- orbit: 91 draw calls, 740345 tris
- scope-step1: 60 draw calls, 478193 tris
- scope-step2: 43 draw calls, 451134 tris
- scope-step3: 57 draw calls, 467782 tris
- scope-step4: 48 draw calls, 415314 tris
- scope-step5: 45 draw calls, 412054 tris
- scope-step6: 44 draw calls, 414429 tris
- scope-step7: 42 draw calls, 353397 tris
- scope-rig: 35 draw calls, 335425 tris
- outside: 92 draw calls, 740346 tris
- olv: 92 draw calls, 740346 tris
- clamp: 92 draw calls, 740346 tris
- xray: 92 draw calls, 740346 tris
- opacity-cutaway: 91 draw calls, 740345 tris
- m4-scope: 122 draw calls, 957309 tris
- m4-tools: 130 draw calls, 959581 tris
- m4-cautery: 130 draw calls, 959185 tris
- m4-staple: 118 draw calls, 933802 tris
- m4-outside-hands: 99 draw calls, 732986 tris
- heap 9.6 → 10.5 MB
- long frames 0 (max 50 ms), fps 59.5, frame p95 16.7 ms — NOT representative (headless)

### 2026-11-05T01:49:08.174Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 128 ms · ready 2922 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 91 draw calls, 740345 tris
- orbit: 91 draw calls, 740345 tris
- scope-step1: 60 draw calls, 478193 tris
- scope-step2: 43 draw calls, 451134 tris
- scope-step3: 57 draw calls, 467782 tris
- scope-step4: 48 draw calls, 415314 tris
- scope-step5: 45 draw calls, 412054 tris
- scope-step6: 44 draw calls, 414429 tris
- scope-step7: 41 draw calls, 353396 tris
- scope-rig: 34 draw calls, 335424 tris
- outside: 91 draw calls, 740345 tris
- olv: 91 draw calls, 740345 tris
- clamp: 91 draw calls, 740345 tris
- xray: 91 draw calls, 740345 tris
- opacity-cutaway: 92 draw calls, 740346 tris
- m4-scope: 122 draw calls, 957309 tris
- m4-tools: 130 draw calls, 959581 tris
- m4-cautery: 130 draw calls, 959185 tris
- m4-staple: 118 draw calls, 933802 tris
- m4-outside-hands: 99 draw calls, 732986 tris
- heap 9.6 → 10.5 MB
- long frames 0 (max 33 ms), fps 55.4, frame p95 33.3 ms — NOT representative (headless)

### 2026-11-05T01:53:21.165Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 120 ms · ready 2629 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 91 draw calls, 740345 tris
- orbit: 92 draw calls, 740346 tris
- scope-step1: 61 draw calls, 478194 tris
- scope-step2: 44 draw calls, 451135 tris
- scope-step3: 58 draw calls, 467783 tris
- scope-step4: 49 draw calls, 415315 tris
- scope-step5: 46 draw calls, 412055 tris
- scope-step6: 45 draw calls, 414430 tris
- scope-step7: 42 draw calls, 353397 tris
- scope-rig: 35 draw calls, 335425 tris
- outside: 92 draw calls, 740346 tris
- olv: 92 draw calls, 740346 tris
- clamp: 92 draw calls, 740346 tris
- xray: 92 draw calls, 740346 tris
- opacity-cutaway: 92 draw calls, 740346 tris
- m4-scope: 122 draw calls, 957309 tris
- m4-tools: 59 draw calls, 467831 tris
- m4-cautery: 131 draw calls, 959186 tris
- m4-staple: 118 draw calls, 933802 tris
- m4-outside-hands: 99 draw calls, 732986 tris
- heap 9.6 → 10.5 MB
- long frames 2 (max 67 ms), fps 58.5, frame p95 16.7 ms — NOT representative (headless)

### 2026-11-05T02:11:53.401Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 116 ms · ready 2952 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 91 draw calls, 740345 tris
- orbit: 91 draw calls, 740345 tris
- scope-step1: 60 draw calls, 478193 tris
- scope-step2: 43 draw calls, 451134 tris
- scope-step3: 57 draw calls, 467782 tris
- scope-step4: 48 draw calls, 415314 tris
- scope-step5: 45 draw calls, 412054 tris
- scope-step6: 44 draw calls, 414429 tris
- scope-step7: 41 draw calls, 353396 tris
- scope-rig: 34 draw calls, 335424 tris
- outside: 91 draw calls, 740345 tris
- olv: 91 draw calls, 740345 tris
- clamp: 92 draw calls, 740346 tris
- xray: 92 draw calls, 740346 tris
- opacity-cutaway: 92 draw calls, 740346 tris
- m4-scope: 122 draw calls, 957309 tris
- m4-tools: 60 draw calls, 467832 tris
- m4-cautery: 131 draw calls, 959186 tris
- m4-staple: 46 draw calls, 442196 tris
- m4-outside-hands: 99 draw calls, 732986 tris
- heap 9.6 → 10.5 MB
- long frames 1 (max 350 ms), fps 58.1, frame p95 16.8 ms — NOT representative (headless)

### 2026-11-05T02:16:22.113Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 148 ms · ready 3159 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 91 draw calls, 740345 tris
- orbit: 91 draw calls, 740345 tris
- scope-step1: 60 draw calls, 478193 tris
- scope-step2: 43 draw calls, 451134 tris
- scope-step3: 57 draw calls, 467782 tris
- scope-step4: 48 draw calls, 415314 tris
- scope-step5: 45 draw calls, 412054 tris
- scope-step6: 44 draw calls, 414429 tris
- scope-step7: 41 draw calls, 353396 tris
- scope-rig: 34 draw calls, 335424 tris
- outside: 91 draw calls, 740345 tris
- olv: 92 draw calls, 740346 tris
- clamp: 92 draw calls, 740346 tris
- xray: 92 draw calls, 740346 tris
- opacity-cutaway: 91 draw calls, 740345 tris
- m4-scope: 58 draw calls, 467783 tris
- m4-tools: 131 draw calls, 959582 tris
- m4-cautery: 130 draw calls, 959185 tris
- m4-staple: 46 draw calls, 442196 tris
- m4-outside-hands: 99 draw calls, 732986 tris
- heap 9.6 → 10.6 MB
- long frames 2 (max 67 ms), fps 56.3, frame p95 33.3 ms — NOT representative (headless)

### 2026-11-05T02:19:04.551Z PASS (headless SwiftShader, preset medium, 1280×720, script: orbit + window.__sim.probeScript)
- FCP 108 ms · ready 2620 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 92 draw calls, 740409 tris
- orbit: 92 draw calls, 740409 tris
- scope-step1: 60 draw calls, 478193 tris
- scope-step2: 43 draw calls, 451134 tris
- scope-step3: 57 draw calls, 467782 tris
- scope-step4: 48 draw calls, 415314 tris
- scope-step5: 45 draw calls, 412054 tris
- scope-step6: 44 draw calls, 414429 tris
- scope-step7: 41 draw calls, 353396 tris
- scope-rig: 34 draw calls, 335424 tris
- outside: 92 draw calls, 740409 tris
- olv: 92 draw calls, 740409 tris
- clamp: 93 draw calls, 740410 tris
- xray: 93 draw calls, 740410 tris
- opacity-cutaway: 92 draw calls, 740409 tris
- m4-scope: 123 draw calls, 957373 tris
- m4-tools: 131 draw calls, 959645 tris
- m4-cautery: 64 draw calls, 468783 tris
- m4-staple: 138 draw calls, 959838 tris
- m4-outside-hands: 100 draw calls, 733050 tris
- heap 9.6 → 10.6 MB
- long frames 0 (max 50 ms), fps 55, frame p95 33.3 ms — NOT representative (headless)

### 2026-11-05T02:27:26.715Z FAIL (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 200 ms · ready 4067 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 92 draw calls, 740409 tris, p95 16.7 ms, 0 long
- orbit: 93 draw calls, 740410 tris, p95 33.4 ms, 4 long
- scope-step1: 60 draw calls, 478193 tris, p95 33.3 ms, 1 long
- scope-step2: 44 draw calls, 451135 tris, p95 33.4 ms, 0 long
- scope-step3: 57 draw calls, 467782 tris, p95 16.7 ms, 0 long
- scope-step4: 48 draw calls, 415314 tris, p95 16.7 ms, 0 long
- scope-step5: 46 draw calls, 412055 tris, p95 16.7 ms, 0 long
- scope-step6: 45 draw calls, 414430 tris, p95 16.7 ms, 0 long
- scope-step7: 42 draw calls, 353397 tris, p95 16.7 ms, 0 long
- scope-rig: 35 draw calls, 335425 tris, p95 16.7 ms, 0 long
- outside: 93 draw calls, 740410 tris, p95 16.7 ms, 0 long
- olv: 92 draw calls, 740409 tris, p95 16.7 ms, 0 long
- clamp: 93 draw calls, 740410 tris, p95 16.7 ms, 0 long
- xray: 93 draw calls, 740410 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 92 draw calls, 740409 tris, p95 50 ms, 1 long
- m4-scope: 123 draw calls, 957373 tris, p95 66.6 ms, 2 long
- m4-tools: 131 draw calls, 959645 tris, p95 16.7 ms, 0 long
- m4-cautery: 64 draw calls, 468783 tris, p95 33.4 ms, 0 long
- m4-staple: 64 draw calls, 468167 tris, p95 33.3 ms, 0 long
- m4-outside-hands: 100 draw calls, 733050 tris, p95 33.4 ms, 0 long
- heap 9.6 → 10.6 MB
- long frames 8 (max 100 ms), fps 55, frame p95 33.4 ms — NOT representative (headless, test-driven)
- practice run 1: 50 s · programs 32 → 32 · 68 calls / 491362 tris peak (complication 67 / 482127) · p95 16.8 ms · 11 long (max 333 ms) · heap 9.7 → 11.2 MB (15.2 %)
- practice run 2: 49 s · programs 32 → 32 · 68 calls / 491362 tris peak (complication 67 / 482127) · p95 16.8 ms · 5 long (max 100 ms) · heap 9.9 → 11.2 MB (13.8 %)
- practice run 3: 49 s · programs 32 → 32 · 68 calls / 491362 tris peak (complication 67 / 482127) · p95 16.8 ms · 5 long (max 117 ms) · heap 9.9 → 11.2 MB (14 %)
- practice heap: per run 15.2 / 13.8 / 14 %, run 1 → 3 end 0 % (budget < 10 %; reload per run, see qa/perf.json heapMethod)

### 2026-11-05T02:33:41.805Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 328 ms · ready 5139 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 93 draw calls, 740730 tris, p95 16.7 ms, 1 long
- orbit: 92 draw calls, 740729 tris, p95 33.4 ms, 3 long
- scope-step1: 60 draw calls, 478513 tris, p95 33.4 ms, 0 long
- scope-step2: 43 draw calls, 451454 tris, p95 16.7 ms, 0 long
- scope-step3: 57 draw calls, 468102 tris, p95 16.7 ms, 0 long
- scope-step4: 48 draw calls, 415634 tris, p95 16.7 ms, 0 long
- scope-step5: 45 draw calls, 412374 tris, p95 16.7 ms, 0 long
- scope-step6: 44 draw calls, 414749 tris, p95 16.7 ms, 0 long
- scope-step7: 41 draw calls, 353716 tris, p95 16.7 ms, 0 long
- scope-rig: 35 draw calls, 335745 tris, p95 16.7 ms, 0 long
- outside: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- olv: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- clamp: 93 draw calls, 740730 tris, p95 16.8 ms, 0 long
- xray: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 83.3 ms, 4 long
- m4-scope: 58 draw calls, 468103 tris, p95 66.6 ms, 3 long
- m4-tools: 131 draw calls, 960285 tris, p95 16.7 ms, 0 long
- m4-cautery: 134 draw calls, 960781 tris, p95 33.4 ms, 0 long
- m4-staple: 137 draw calls, 960477 tris, p95 33.2 ms, 0 long
- m4-outside-hands: 100 draw calls, 733370 tris, p95 16.7 ms, 0 long
- heap 9.5 → 10.6 MB
- long frames 11 (max 167 ms), fps 56.3, frame p95 33.4 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 68 calls / 491683 tris peak (complication 68 / 482448) · p95 16.8 ms · 12 long (max 333 ms) · heap 9.7 → 11.4 MB (16.8 %)
- practice run 2: 51 s · programs 32 → 32 · 68 calls / 491682 tris peak (complication 68 / 482448) · p95 16.8 ms · 7 long (max 100 ms) · heap 9.9 → 11.4 MB (15.2 %)
- practice run 3: 51 s · programs 32 → 32 · 68 calls / 491682 tris peak (complication 67 / 482447) · p95 16.8 ms · 8 long (max 83 ms) · heap 9.9 → 11.4 MB (15.3 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 16.8 / 15.2 / 15.3 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T02:40:09.885Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 156 ms · ready 2859 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- orbit: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- scope-step1: 60 draw calls, 478513 tris, p95 16.7 ms, 0 long
- scope-step2: 43 draw calls, 451454 tris, p95 16.7 ms, 0 long
- scope-step3: 57 draw calls, 468102 tris, p95 16.7 ms, 0 long
- scope-step4: 48 draw calls, 415634 tris, p95 16.7 ms, 0 long
- scope-step5: 45 draw calls, 412374 tris, p95 16.7 ms, 0 long
- scope-step6: 44 draw calls, 414749 tris, p95 16.7 ms, 0 long
- scope-step7: 41 draw calls, 353716 tris, p95 16.8 ms, 0 long
- scope-rig: 34 draw calls, 335744 tris, p95 16.7 ms, 0 long
- outside: 92 draw calls, 740729 tris, p95 16.8 ms, 0 long
- olv: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- clamp: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- xray: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 50 ms, 1 long
- m4-scope: 123 draw calls, 958013 tris, p95 50 ms, 0 long
- m4-tools: 131 draw calls, 960285 tris, p95 16.7 ms, 0 long
- m4-cautery: 132 draw calls, 964466 tris, p95 16.8 ms, 0 long
- m4-staple: 67 draw calls, 482400 tris, p95 33.3 ms, 0 long
- m4-outside-hands: 101 draw calls, 733371 tris, p95 33.4 ms, 0 long
- heap 9.6 → 10.6 MB
- long frames 1 (max 67 ms), fps 50.4, frame p95 16.8 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 68 calls / 489561 tris peak (complication 67 / 482447) · p95 16.8 ms · 4 long (max 83 ms) · heap 9.7 → 11.4 MB (16.9 %)
- practice run 2: 51 s · programs 32 → 32 · 68 calls / 489561 tris peak (complication 68 / 482448) · p95 16.8 ms · 4 long (max 150 ms) · heap 9.9 → 11.4 MB (15.3 %)
- practice run 3: 51 s · programs 32 → 32 · 68 calls / 489561 tris peak (complication 67 / 482447) · p95 16.8 ms · 4 long (max 150 ms) · heap 9.9 → 11.4 MB (15.3 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 16.9 / 15.3 / 15.3 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T02:50:47.491Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 128 ms · ready 3174 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 92 draw calls, 740729 tris, p95 16.8 ms, 0 long
- orbit: 92 draw calls, 740729 tris, p95 16.8 ms, 0 long
- scope-step1: 61 draw calls, 478514 tris, p95 16.7 ms, 0 long
- scope-step2: 44 draw calls, 451455 tris, p95 16.8 ms, 0 long
- scope-step3: 60 draw calls, 468983 tris, p95 16.7 ms, 0 long
- scope-step4: 49 draw calls, 415635 tris, p95 16.7 ms, 0 long
- scope-step5: 46 draw calls, 412375 tris, p95 16.7 ms, 0 long
- scope-step6: 45 draw calls, 414750 tris, p95 16.7 ms, 0 long
- scope-step7: 42 draw calls, 353717 tris, p95 16.7 ms, 0 long
- scope-rig: 35 draw calls, 335745 tris, p95 16.7 ms, 0 long
- outside: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- olv: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- clamp: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- xray: 93 draw calls, 740730 tris, p95 33.4 ms, 0 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 50 ms, 1 long
- m4-scope: 126 draw calls, 958894 tris, p95 66.7 ms, 2 long
- m4-tools: 133 draw calls, 961165 tris, p95 16.8 ms, 0 long
- m4-cautery: 130 draw calls, 961026 tris, p95 50 ms, 1 long
- m4-staple: 141 draw calls, 974391 tris, p95 16.7 ms, 0 long
- m4-outside-hands: 100 draw calls, 733370 tris, p95 16.7 ms, 0 long
- heap 9.6 → 10.6 MB
- long frames 4 (max 83 ms), fps 57.1, frame p95 16.8 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 68 calls / 489122 tris peak (complication 67 / 482447) · p95 16.8 ms · 9 long (max 100 ms) · heap 9.7 → 11.4 MB (17.3 %)
- practice run 2: 51 s · programs 32 → 32 · 69 calls / 489122 tris peak (complication 67 / 482447) · p95 16.7 ms · 5 long (max 83 ms) · heap 9.9 → 11.4 MB (15.1 %)
- practice run 3: 51 s · programs 32 → 32 · 68 calls / 489122 tris peak (complication 67 / 482447) · p95 16.8 ms · 4 long (max 83 ms) · heap 9.9 → 11.4 MB (15.4 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 17.3 / 15.1 / 15.4 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T02:54:55.305Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 148 ms · ready 2853 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- orbit: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- scope-step1: 60 draw calls, 478513 tris, p95 16.7 ms, 0 long
- scope-step2: 43 draw calls, 451454 tris, p95 16.7 ms, 0 long
- scope-step3: 59 draw calls, 468982 tris, p95 16.7 ms, 0 long
- scope-step4: 48 draw calls, 415634 tris, p95 16.7 ms, 0 long
- scope-step5: 45 draw calls, 412374 tris, p95 16.7 ms, 0 long
- scope-step6: 44 draw calls, 414749 tris, p95 16.8 ms, 0 long
- scope-step7: 41 draw calls, 353716 tris, p95 16.8 ms, 0 long
- scope-rig: 34 draw calls, 335744 tris, p95 16.8 ms, 0 long
- outside: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- olv: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- clamp: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- xray: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 50 ms, 1 long
- m4-scope: 125 draw calls, 958893 tris, p95 83.3 ms, 2 long
- m4-tools: 133 draw calls, 961165 tris, p95 16.7 ms, 0 long
- m4-cautery: 129 draw calls, 954035 tris, p95 33.3 ms, 1 long
- m4-staple: 136 draw calls, 952477 tris, p95 16.7 ms, 0 long
- m4-outside-hands: 100 draw calls, 733370 tris, p95 50 ms, 0 long
- heap 9.6 → 10.6 MB
- long frames 4 (max 100 ms), fps 52.9, frame p95 16.8 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 66 calls / 479589 tris peak (complication 65 / 469366) · p95 16.8 ms · 8 long (max 117 ms) · heap 9.7 → 11.4 MB (17 %)
- practice run 2: 51 s · programs 32 → 32 · 66 calls / 479589 tris peak (complication 65 / 469366) · p95 16.8 ms · 5 long (max 83 ms) · heap 9.9 → 11.4 MB (15.1 %)
- practice run 3: 51 s · programs 32 → 32 · 67 calls / 479590 tris peak (complication 65 / 469366) · p95 16.8 ms · 12 long (max 167 ms) · heap 9.9 → 11.4 MB (15.4 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 17 / 15.1 / 15.4 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T03:02:18.134Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 156 ms · ready 2877 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- orbit: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- scope-step1: 60 draw calls, 478513 tris, p95 16.7 ms, 0 long
- scope-step2: 43 draw calls, 451454 tris, p95 16.8 ms, 0 long
- scope-step3: 59 draw calls, 468982 tris, p95 16.7 ms, 0 long
- scope-step4: 48 draw calls, 415634 tris, p95 16.7 ms, 0 long
- scope-step5: 45 draw calls, 412374 tris, p95 16.7 ms, 0 long
- scope-step6: 44 draw calls, 414749 tris, p95 16.7 ms, 0 long
- scope-step7: 41 draw calls, 353716 tris, p95 16.8 ms, 0 long
- scope-rig: 34 draw calls, 335744 tris, p95 16.7 ms, 0 long
- outside: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- olv: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- clamp: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- xray: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 66.6 ms, 2 long
- m4-scope: 125 draw calls, 958893 tris, p95 83.3 ms, 2 long
- m4-tools: 133 draw calls, 961165 tris, p95 16.7 ms, 0 long
- m4-cautery: 131 draw calls, 961466 tris, p95 33.3 ms, 0 long
- m4-staple: 138 draw calls, 960917 tris, p95 33.4 ms, 0 long
- m4-outside-hands: 100 draw calls, 733370 tris, p95 33.3 ms, 0 long
- heap 9.6 → 10.6 MB
- long frames 4 (max 100 ms), fps 56.3, frame p95 16.8 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 67 calls / 486029 tris peak (complication 65 / 469366) · p95 16.8 ms · 4 long (max 150 ms) · heap 9.7 → 11.4 MB (16.9 %)
- practice run 2: 51 s · programs 32 → 32 · 68 calls / 486029 tris peak (complication 65 / 469366) · p95 16.7 ms · 5 long (max 250 ms) · heap 9.9 → 11.4 MB (15.3 %)
- practice run 3: 51 s · programs 32 → 32 · 67 calls / 486029 tris peak (complication 66 / 469367) · p95 16.8 ms · 4 long (max 150 ms) · heap 9.9 → 11.4 MB (15.2 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 16.9 / 15.3 / 15.2 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T03:05:45.874Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 144 ms · ready 3319 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- orbit: 92 draw calls, 740729 tris, p95 33.3 ms, 0 long
- scope-step1: 60 draw calls, 478513 tris, p95 33.4 ms, 0 long
- scope-step2: 43 draw calls, 451454 tris, p95 33.4 ms, 0 long
- scope-step3: 60 draw calls, 468983 tris, p95 16.8 ms, 0 long
- scope-step4: 48 draw calls, 415634 tris, p95 16.8 ms, 0 long
- scope-step5: 45 draw calls, 412374 tris, p95 16.7 ms, 0 long
- scope-step6: 44 draw calls, 414749 tris, p95 16.7 ms, 0 long
- scope-step7: 41 draw calls, 353716 tris, p95 16.7 ms, 0 long
- scope-rig: 34 draw calls, 335744 tris, p95 16.8 ms, 0 long
- outside: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- olv: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- clamp: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- xray: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 50 ms, 1 long
- m4-scope: 125 draw calls, 958893 tris, p95 83.3 ms, 2 long
- m4-tools: 134 draw calls, 961166 tris, p95 16.7 ms, 0 long
- m4-cautery: 61 draw calls, 469788 tris, p95 16.7 ms, 0 long
- m4-staple: 65 draw calls, 468927 tris, p95 33.3 ms, 0 long
- m4-outside-hands: 100 draw calls, 733370 tris, p95 33.3 ms, 0 long
- heap 9.6 → 10.6 MB
- long frames 3 (max 100 ms), fps 55.8, frame p95 33.3 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 67 calls / 486030 tris peak (complication 66 / 469367) · p95 16.8 ms · 10 long (max 467 ms) · heap 9.7 → 11.4 MB (17 %)
- practice run 2: 51 s · programs 32 → 32 · 67 calls / 486029 tris peak (complication 66 / 469367) · p95 16.8 ms · 4 long (max 183 ms) · heap 9.9 → 11.4 MB (15.3 %)
- practice run 3: 51 s · programs 32 → 32 · 67 calls / 486030 tris peak (complication 65 / 469366) · p95 16.8 ms · 8 long (max 183 ms) · heap 9.9 → 11.4 MB (15.4 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 17 / 15.3 / 15.4 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T03:14:38.654Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 112 ms · ready 2546 ms · transfer 11.4 MB
- programs 32 → 32 · textures 169 (≈ 106.8 MB)
- ready: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- orbit: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- scope-step1: 60 draw calls, 478513 tris, p95 16.7 ms, 0 long
- scope-step2: 43 draw calls, 451454 tris, p95 16.7 ms, 0 long
- scope-step3: 59 draw calls, 468982 tris, p95 16.7 ms, 0 long
- scope-step4: 48 draw calls, 415634 tris, p95 16.7 ms, 0 long
- scope-step5: 45 draw calls, 412374 tris, p95 16.7 ms, 0 long
- scope-step6: 44 draw calls, 414749 tris, p95 16.7 ms, 0 long
- scope-step7: 41 draw calls, 353716 tris, p95 16.8 ms, 0 long
- scope-rig: 34 draw calls, 335744 tris, p95 16.7 ms, 0 long
- outside: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- olv: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- clamp: 92 draw calls, 740729 tris, p95 16.8 ms, 0 long
- xray: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 50 ms, 1 long
- m4-scope: 60 draw calls, 468983 tris, p95 49.9 ms, 1 long
- m4-tools: 133 draw calls, 961165 tris, p95 16.7 ms, 0 long
- m4-cautery: 61 draw calls, 469788 tris, p95 16.7 ms, 0 long
- m4-staple: 65 draw calls, 468927 tris, p95 16.7 ms, 0 long
- m4-outside-hands: 100 draw calls, 733370 tris, p95 16.8 ms, 0 long
- heap 9.6 → 10.6 MB
- long frames 2 (max 100 ms), fps 54.5, frame p95 16.8 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 67 calls / 486029 tris peak (complication 65 / 469366) · p95 16.8 ms · 7 long (max 183 ms) · heap 9.7 → 11.4 MB (16.9 %)
- practice run 2: 51 s · programs 32 → 32 · 67 calls / 486030 tris peak (complication 66 / 469367) · p95 16.8 ms · 6 long (max 83 ms) · heap 9.9 → 11.4 MB (15.2 %)
- practice run 3: 51 s · programs 32 → 32 · 67 calls / 486029 tris peak (complication 65 / 469366) · p95 16.8 ms · 6 long (max 83 ms) · heap 9.9 → 11.4 MB (15.3 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 16.9 / 15.2 / 15.3 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T04:27:31.199Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 108 ms · ready 3837 ms · transfer 11.4 MB
- programs 32 → 32 · textures 88 (≈ 73.1 MB)
- ready: 92 draw calls, 740729 tris, p95 16.7 ms, 1 long
- orbit: 92 draw calls, 740729 tris, p95 33.3 ms, 4 long
- scope-step1: 60 draw calls, 478513 tris, p95 33.4 ms, 0 long
- scope-step2: 40 draw calls, 415460 tris, p95 33.2 ms, 0 long
- scope-step3: 58 draw calls, 456983 tris, p95 16.7 ms, 0 long
- scope-step4: 48 draw calls, 409635 tris, p95 16.7 ms, 0 long
- scope-step5: 46 draw calls, 412375 tris, p95 16.7 ms, 0 long
- scope-step6: 45 draw calls, 414750 tris, p95 16.7 ms, 0 long
- scope-step7: 41 draw calls, 331862 tris, p95 16.7 ms, 0 long
- scope-rig: 34 draw calls, 313890 tris, p95 16.7 ms, 0 long
- outside: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- olv: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- clamp: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- xray: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 50 ms, 1 long
- m4-scope: 58 draw calls, 456983 tris, p95 50 ms, 1 long
- m4-tools: 129 draw calls, 937165 tris, p95 16.8 ms, 0 long
- m4-cautery: 127 draw calls, 937466 tris, p95 16.7 ms, 0 long
- m4-staple: 134 draw calls, 936917 tris, p95 33.4 ms, 0 long
- m4-outside-hands: 100 draw calls, 733370 tris, p95 16.7 ms, 0 long
- heap 9.5 → 10.5 MB
- long frames 7 (max 117 ms), fps 58.1, frame p95 33.3 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 67 calls / 486030 tris peak (complication 65 / 469366) · p95 16.8 ms · 16 long (max 217 ms) · heap 9.5 → 11.2 MB (17.7 %)
- practice run 2: 51 s · programs 32 → 32 · 67 calls / 486030 tris peak (complication 65 / 469366) · p95 16.8 ms · 9 long (max 117 ms) · heap 9.7 → 11.2 MB (15.7 %)
- practice run 3: 51 s · programs 32 → 32 · 67 calls / 486029 tris peak (complication 65 / 469366) · p95 16.8 ms · 9 long (max 133 ms) · heap 9.7 → 11.2 MB (15.7 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 17.7 / 15.7 / 15.7 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T04:49:49.425Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 104 ms · ready 3533 ms · transfer 11.4 MB
- programs 32 → 32 · textures 88 (≈ 73.1 MB)
- ready: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- orbit: 92 draw calls, 740729 tris, p95 16.8 ms, 0 long
- scope-step1: 60 draw calls, 478513 tris, p95 16.8 ms, 0 long
- scope-step2: 40 draw calls, 415460 tris, p95 16.7 ms, 0 long
- scope-step3: 57 draw calls, 456982 tris, p95 16.7 ms, 0 long
- scope-step4: 46 draw calls, 380696 tris, p95 16.7 ms, 0 long
- scope-step5: 45 draw calls, 412374 tris, p95 16.7 ms, 0 long
- scope-step6: 44 draw calls, 414749 tris, p95 16.8 ms, 0 long
- scope-step7: 38 draw calls, 280739 tris, p95 16.8 ms, 0 long
- scope-rig: 31 draw calls, 262767 tris, p95 16.7 ms, 0 long
- outside: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- olv: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- clamp: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- xray: 93 draw calls, 740730 tris, p95 16.8 ms, 0 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 33.5 ms, 0 long
- m4-scope: 121 draw calls, 934893 tris, p95 49.9 ms, 0 long
- m4-tools: 59 draw calls, 457031 tris, p95 16.7 ms, 0 long
- m4-cautery: 127 draw calls, 937466 tris, p95 16.8 ms, 0 long
- m4-staple: 134 draw calls, 936917 tris, p95 16.7 ms, 0 long
- m4-outside-hands: 101 draw calls, 733371 tris, p95 16.7 ms, 0 long
- heap 9.5 → 10.4 MB
- long frames 0 (max 50 ms), fps 55.4, frame p95 16.8 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 67 calls / 486029 tris peak (complication 66 / 469367) · p95 16.7 ms · 5 long (max 183 ms) · heap 9.6 → 11.3 MB (17.3 %)
- practice run 2: 51 s · programs 32 → 32 · 67 calls / 486029 tris peak (complication 66 / 469367) · p95 16.8 ms · 6 long (max 100 ms) · heap 9.7 → 11.2 MB (15.5 %)
- practice run 3: 51 s · programs 32 → 32 · 67 calls / 486029 tris peak (complication 66 / 469367) · p95 16.8 ms · 6 long (max 83 ms) · heap 9.7 → 11.3 MB (15.6 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 17.3 / 15.5 / 15.6 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T04:58:03.485Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 156 ms · ready 2869 ms · transfer 11.4 MB
- programs 32 → 32 · textures 88 (≈ 73.1 MB)
- ready: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- orbit: 92 draw calls, 740729 tris, p95 16.8 ms, 0 long
- scope-step1: 60 draw calls, 478513 tris, p95 16.7 ms, 0 long
- scope-step2: 40 draw calls, 415460 tris, p95 33.3 ms, 0 long
- scope-step3: 57 draw calls, 456982 tris, p95 16.7 ms, 0 long
- scope-step4: 46 draw calls, 380696 tris, p95 16.7 ms, 0 long
- scope-step5: 45 draw calls, 412374 tris, p95 33.3 ms, 0 long
- scope-step6: 45 draw calls, 414750 tris, p95 16.7 ms, 0 long
- scope-step7: 39 draw calls, 280740 tris, p95 16.7 ms, 0 long
- scope-rig: 32 draw calls, 262768 tris, p95 16.7 ms, 0 long
- outside: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- olv: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- clamp: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- xray: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 83.3 ms, 3 long
- m4-scope: 58 draw calls, 456983 tris, p95 83.3 ms, 2 long
- m4-tools: 129 draw calls, 937165 tris, p95 16.7 ms, 0 long
- m4-cautery: 59 draw calls, 457788 tris, p95 16.8 ms, 0 long
- m4-staple: 134 draw calls, 936917 tris, p95 16.8 ms, 0 long
- m4-outside-hands: 100 draw calls, 733370 tris, p95 16.7 ms, 0 long
- heap 9.5 → 10.5 MB
- long frames 5 (max 100 ms), fps 56.3, frame p95 16.8 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 68 calls / 486029 tris peak (complication 65 / 469366) · p95 16.8 ms · 4 long (max 83 ms) · heap 9.6 → 11.3 MB (17.2 %)
- practice run 2: 51 s · programs 32 → 32 · 67 calls / 486030 tris peak (complication 66 / 469367) · p95 16.7 ms · 5 long (max 83 ms) · heap 9.7 → 11.3 MB (15.5 %)
- practice run 3: 51 s · programs 32 → 32 · 68 calls / 486029 tris peak (complication 66 / 469367) · p95 16.8 ms · 4 long (max 83 ms) · heap 9.7 → 11.3 MB (15.5 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 17.2 / 15.5 / 15.5 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T05:31:46.503Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 124 ms · ready 2757 ms · transfer 11.4 MB
- programs 32 → 32 · textures 88 (≈ 73.1 MB)
- ready: 92 draw calls, 740729 tris, p95 16.8 ms, 0 long
- orbit: 93 draw calls, 740730 tris, p95 33.3 ms, 2 long
- scope-step1: 60 draw calls, 478513 tris, p95 33.3 ms, 0 long
- scope-step2: 40 draw calls, 415460 tris, p95 33.4 ms, 0 long
- scope-step3: 56 draw calls, 450982 tris, p95 16.7 ms, 0 long
- scope-step4: 48 draw calls, 396290 tris, p95 16.7 ms, 0 long
- scope-step5: 46 draw calls, 412375 tris, p95 16.7 ms, 0 long
- scope-step6: 45 draw calls, 414750 tris, p95 16.7 ms, 0 long
- scope-step7: 41 draw calls, 293865 tris, p95 16.8 ms, 0 long
- scope-rig: 30 draw calls, 251860 tris, p95 16.7 ms, 0 long
- outside: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- olv: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- clamp: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- xray: 92 draw calls, 740729 tris, p95 16.8 ms, 1 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 66.6 ms, 2 long
- m4-scope: 57 draw calls, 450983 tris, p95 50 ms, 1 long
- m4-tools: 127 draw calls, 925165 tris, p95 16.7 ms, 0 long
- m4-cautery: 125 draw calls, 925466 tris, p95 33.4 ms, 1 long
- m4-staple: 131 draw calls, 916917 tris, p95 33.4 ms, 0 long
- m4-outside-hands: 100 draw calls, 733370 tris, p95 33.2 ms, 0 long
- heap 9.5 → 10.5 MB
- long frames 7 (max 350 ms), fps 50, frame p95 33.3 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 66 calls / 486029 tris peak (complication 65 / 469366) · p95 33.3 ms · 16 long (max 117 ms) · heap 9.6 → 11.4 MB (18.9 %)
- practice run 2: 51 s · programs 32 → 32 · 66 calls / 486029 tris peak (complication 65 / 469366) · p95 33.3 ms · 14 long (max 117 ms) · heap 9.8 → 11.4 MB (17.2 %)
- practice run 3: 51 s · programs 32 → 32 · 66 calls / 486029 tris peak (complication 65 / 469366) · p95 16.8 ms · 9 long (max 100 ms) · heap 9.7 → 11.4 MB (17.2 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 18.9 / 17.2 / 17.2 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T05:41:01.265Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 132 ms · ready 2544 ms · transfer 11.4 MB
- programs 32 → 32 · textures 88 (≈ 73.1 MB)
- ready: 92 draw calls, 740729 tris, p95 16.8 ms, 1 long
- orbit: 93 draw calls, 740730 tris, p95 33.4 ms, 1 long
- scope-step1: 60 draw calls, 478513 tris, p95 33.4 ms, 0 long
- scope-step2: 40 draw calls, 415460 tris, p95 16.7 ms, 0 long
- scope-step3: 55 draw calls, 442984 tris, p95 16.8 ms, 0 long
- scope-step4: 47 draw calls, 396289 tris, p95 33.3 ms, 0 long
- scope-step5: 45 draw calls, 412374 tris, p95 16.7 ms, 0 long
- scope-step6: 44 draw calls, 414749 tris, p95 16.7 ms, 0 long
- scope-step7: 40 draw calls, 293864 tris, p95 16.7 ms, 0 long
- scope-rig: 29 draw calls, 251859 tris, p95 16.7 ms, 0 long
- outside: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- olv: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- clamp: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- xray: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 66.8 ms, 2 long
- m4-scope: 92 draw calls, 740729 tris, p95 83.3 ms, 3 long
- m4-tools: 125 draw calls, 909169 tris, p95 16.8 ms, 0 long
- m4-cautery: 123 draw calls, 909470 tris, p95 16.7 ms, 0 long
- m4-staple: 129 draw calls, 900921 tris, p95 16.8 ms, 0 long
- m4-outside-hands: 100 draw calls, 733370 tris, p95 33.4 ms, 0 long
- heap 9.5 → 10.5 MB
- long frames 7 (max 150 ms), fps 54.6, frame p95 33.4 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 66 calls / 486030 tris peak (complication 65 / 469366) · p95 16.8 ms · 13 long (max 183 ms) · heap 9.6 → 11.4 MB (19 %)
- practice run 2: 51 s · programs 32 → 32 · 66 calls / 486029 tris peak (complication 65 / 469366) · p95 16.8 ms · 13 long (max 100 ms) · heap 9.7 → 11.4 MB (17.1 %)
- practice run 3: 51 s · programs 32 → 32 · 66 calls / 486029 tris peak (complication 65 / 469366) · p95 33.3 ms · 13 long (max 100 ms) · heap 9.7 → 11.4 MB (17.1 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 19 / 17.1 / 17.1 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T05:48:32.884Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 104 ms · ready 2586 ms · transfer 11.4 MB
- programs 32 → 32 · textures 88 (≈ 73.1 MB)
- ready: 92 draw calls, 740729 tris, p95 16.7 ms, 1 long
- orbit: 92 draw calls, 740729 tris, p95 33.4 ms, 1 long
- scope-step1: 60 draw calls, 478513 tris, p95 33.3 ms, 0 long
- scope-step2: 40 draw calls, 415460 tris, p95 33.4 ms, 0 long
- scope-step3: 55 draw calls, 442984 tris, p95 16.7 ms, 0 long
- scope-step4: 47 draw calls, 396289 tris, p95 16.7 ms, 0 long
- scope-step5: 45 draw calls, 412374 tris, p95 16.7 ms, 0 long
- scope-step6: 44 draw calls, 414749 tris, p95 16.7 ms, 0 long
- scope-step7: 40 draw calls, 293864 tris, p95 16.7 ms, 0 long
- scope-rig: 29 draw calls, 251859 tris, p95 16.7 ms, 0 long
- outside: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- olv: 93 draw calls, 740730 tris, p95 16.7 ms, 0 long
- clamp: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- xray: 93 draw calls, 740730 tris, p95 33.3 ms, 1 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 66.7 ms, 3 long
- m4-scope: 117 draw calls, 906897 tris, p95 116.7 ms, 3 long
- m4-tools: 125 draw calls, 909169 tris, p95 16.7 ms, 0 long
- m4-cautery: 123 draw calls, 909470 tris, p95 33.3 ms, 0 long
- m4-staple: 61 draw calls, 440369 tris, p95 33.2 ms, 0 long
- m4-outside-hands: 100 draw calls, 733370 tris, p95 16.7 ms, 0 long
- heap 9.5 → 10.5 MB
- long frames 9 (max 417 ms), fps 58.1, frame p95 33.4 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 65 calls / 486029 tris peak (complication 65 / 469366) · p95 16.8 ms · 20 long (max 450 ms) · heap 9.6 → 11.4 MB (18.9 %)
- practice run 2: 51 s · programs 32 → 32 · 66 calls / 486030 tris peak (complication 65 / 469366) · p95 16.8 ms · 11 long (max 100 ms) · heap 9.7 → 11.4 MB (17.2 %)
- practice run 3: 51 s · programs 32 → 32 · 66 calls / 486030 tris peak (complication 66 / 469367) · p95 33.3 ms · 13 long (max 117 ms) · heap 9.7 → 11.4 MB (17.1 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 18.9 / 17.2 / 17.1 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T06:15:54.882Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 104 ms · ready 2625 ms · transfer 11.4 MB
- programs 32 → 32 · textures 88 (≈ 73.1 MB)
- ready: 92 draw calls, 740729 tris, p95 16.8 ms, 1 long
- orbit: 92 draw calls, 740729 tris, p95 33.4 ms, 2 long
- scope-step1: 50 draw calls, 440516 tris, p95 16.7 ms, 0 long
- scope-step2: 33 draw calls, 389462 tris, p95 16.7 ms, 0 long
- scope-step3: 45 draw calls, 411849 tris, p95 16.7 ms, 0 long
- scope-step4: 37 draw calls, 361291 tris, p95 33.3 ms, 0 long
- scope-step5: 36 draw calls, 380376 tris, p95 16.7 ms, 0 long
- scope-step6: 33 draw calls, 376751 tris, p95 16.7 ms, 0 long
- scope-step7: 30 draw calls, 263866 tris, p95 16.7 ms, 0 long
- scope-rig: 20 draw calls, 219861 tris, p95 16.7 ms, 0 long
- outside: 92 draw calls, 740729 tris, p95 16.8 ms, 0 long
- olv: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- clamp: 92 draw calls, 740729 tris, p95 16.7 ms, 0 long
- xray: 92 draw calls, 740729 tris, p95 16.7 ms, 1 long
- opacity-cutaway: 92 draw calls, 740729 tris, p95 50 ms, 1 long
- m4-scope: 93 draw calls, 838625 tris, p95 50.1 ms, 2 long
- m4-tools: 101 draw calls, 840897 tris, p95 16.8 ms, 0 long
- m4-cautery: 100 draw calls, 844198 tris, p95 16.7 ms, 0 long
- m4-staple: 107 draw calls, 841089 tris, p95 33.3 ms, 0 long
- m4-outside-hands: 100 draw calls, 733370 tris, p95 16.7 ms, 0 long
- heap 9.5 → 10.5 MB
- long frames 7 (max 233 ms), fps 58.1, frame p95 33.3 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 32 → 32 · 55 calls / 451031 tris peak (complication 54 / 431368) · p95 33.3 ms · 13 long (max 100 ms) · heap 9.6 → 11.4 MB (18.9 %)
- practice run 2: 51 s · programs 32 → 32 · 55 calls / 451032 tris peak (complication 55 / 431369) · p95 33.3 ms · 19 long (max 317 ms) · heap 9.7 → 11.4 MB (17.2 %)
- practice run 3: 51 s · programs 32 → 32 · 54 calls / 451031 tris peak (complication 55 / 431369) · p95 16.8 ms · 11 long (max 267 ms) · heap 9.7 → 11.4 MB (17.3 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 18.9 / 17.2 / 17.3 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T11:17:16.359Z PASS (headless real GPU (ANGLE/Vulkan), preset low, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 328 ms · ready 5695 ms · transfer 11.41 MB
- programs 34 → 34 · textures 89 (≈ 74 MB)
- ready: 94 draw calls, 756983 tris, p95 116.7 ms, 5 long
- orbit: 95 draw calls, 756984 tris, p95 166.6 ms, 59 long
- scope-step1: 50 draw calls, 440516 tris, p95 50 ms, 1 long
- scope-step2: 33 draw calls, 389462 tris, p95 50 ms, 1 long
- scope-step3: 44 draw calls, 411848 tris, p95 16.7 ms, 1 long
- scope-step4: 37 draw calls, 361291 tris, p95 83.4 ms, 2 long
- scope-step5: 36 draw calls, 380376 tris, p95 83.3 ms, 3 long
- scope-step6: 34 draw calls, 376752 tris, p95 66.7 ms, 2 long
- scope-step7: 30 draw calls, 263866 tris, p95 83.3 ms, 3 long
- scope-rig: 20 draw calls, 219861 tris, p95 83.3 ms, 3 long
- outside: 94 draw calls, 756983 tris, p95 133.4 ms, 2 long
- olv: 95 draw calls, 756984 tris, p95 16.7 ms, 0 long
- clamp: 95 draw calls, 756984 tris, p95 16.7 ms, 0 long
- xray: 95 draw calls, 756984 tris, p95 16.8 ms, 0 long
- opacity-cutaway: 95 draw calls, 756984 tris, p95 16.8 ms, 0 long
- m4-scope: 94 draw calls, 838626 tris, p95 16.8 ms, 0 long
- m4-tools: 101 draw calls, 840897 tris, p95 16.7 ms, 0 long
- m4-cautery: 100 draw calls, 844198 tris, p95 50 ms, 1 long
- m4-staple: 105 draw calls, 832649 tris, p95 16.7 ms, 0 long
- m4-outside-hands: 102 draw calls, 749624 tris, p95 16.8 ms, 0 long
- heap 9.7 → 10.8 MB
- long frames 83 (max 417 ms), fps 55.4, frame p95 133.4 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 34 → 34 · 55 calls / 451032 tris peak (complication 54 / 431368) · p95 33.3 ms · 26 long (max 150 ms) · heap 9.9 → 11.7 MB (18.6 %)
- practice run 2: 51 s · programs 34 → 34 · 55 calls / 451032 tris peak (complication 55 / 431369) · p95 33.3 ms · 19 long (max 200 ms) · heap 10 → 11.7 MB (16.8 %)
- practice run 3: 51 s · programs 34 → 34 · 56 calls / 451032 tris peak (complication 54 / 431368) · p95 33.3 ms · 13 long (max 133 ms) · heap 10 → 11.7 MB (16.8 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 18.6 / 16.8 / 16.8 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T11:43:36.979Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 132 ms · ready 4734 ms · transfer 11.42 MB
- programs 36 → 36 · textures 91 (≈ 74 MB)
- ready: 94 draw calls, 755975 tris, p95 16.8 ms, 0 long
- orbit: 95 draw calls, 755976 tris, p95 33.3 ms, 2 long
- scope-step1: 52 draw calls, 454189 tris, p95 16.7 ms, 0 long
- scope-step2: 35 draw calls, 390103 tris, p95 16.7 ms, 0 long
- scope-step3: 46 draw calls, 412489 tris, p95 16.7 ms, 0 long
- scope-step4: 38 draw calls, 361931 tris, p95 33.3 ms, 1 long
- scope-step5: 41 draw calls, 405050 tris, p95 33.4 ms, 0 long
- scope-step6: 34 draw calls, 364359 tris, p95 83.3 ms, 3 long
- scope-step7: 32 draw calls, 264507 tris, p95 16.8 ms, 0 long
- scope-rig: 22 draw calls, 220502 tris, p95 16.8 ms, 0 long
- outside: 95 draw calls, 755976 tris, p95 16.7 ms, 0 long
- olv: 95 draw calls, 755976 tris, p95 16.7 ms, 0 long
- clamp: 94 draw calls, 755975 tris, p95 16.7 ms, 0 long
- xray: 94 draw calls, 755975 tris, p95 16.7 ms, 1 long
- opacity-cutaway: 94 draw calls, 755975 tris, p95 16.8 ms, 0 long
- m4-scope: 94 draw calls, 838257 tris, p95 33.4 ms, 0 long
- m4-tools: 98 draw calls, 839217 tris, p95 33.4 ms, 0 long
- m4-cautery: 97 draw calls, 843318 tris, p95 33.3 ms, 0 long
- m4-staple: 107 draw calls, 843381 tris, p95 33.3 ms, 0 long
- m4-outside-hands: 102 draw calls, 749372 tris, p95 33.4 ms, 0 long
- heap 10.2 → 11.3 MB
- long frames 7 (max 150 ms), fps 46.5, frame p95 33.3 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 36 → 36 · 55 calls / 452956 tris peak (complication 54 / 433912) · p95 33.3 ms · 25 long (max 333 ms) · heap 10.3 → 12.2 MB (17.9 %)
- practice run 2: 51 s · programs 36 → 36 · 54 calls / 452956 tris peak (complication 54 / 433912) · p95 33.3 ms · 18 long (max 183 ms) · heap 10.5 → 12.2 MB (16.4 %)
- practice run 3: 51 s · programs 36 → 36 · 55 calls / 452955 tris peak (complication 55 / 433913) · p95 33.3 ms · 16 long (max 150 ms) · heap 10.5 → 12.2 MB (16.4 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 17.9 / 16.4 / 16.4 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T11:53:47.839Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 124 ms · ready 2972 ms · transfer 11.42 MB
- programs 36 → 36 · textures 91 (≈ 74 MB)
- ready: 94 draw calls, 756039 tris, p95 16.7 ms, 0 long
- orbit: 94 draw calls, 756039 tris, p95 16.7 ms, 0 long
- scope-step1: 51 draw calls, 454188 tris, p95 16.7 ms, 0 long
- scope-step2: 34 draw calls, 390102 tris, p95 16.7 ms, 0 long
- scope-step3: 45 draw calls, 412488 tris, p95 16.7 ms, 0 long
- scope-step4: 38 draw calls, 361931 tris, p95 33.4 ms, 1 long
- scope-step5: 40 draw calls, 405049 tris, p95 16.7 ms, 1 long
- scope-step6: 34 draw calls, 364359 tris, p95 16.7 ms, 0 long
- scope-step7: 31 draw calls, 264506 tris, p95 16.7 ms, 0 long
- scope-rig: 21 draw calls, 220501 tris, p95 16.7 ms, 0 long
- outside: 94 draw calls, 756039 tris, p95 16.7 ms, 0 long
- olv: 94 draw calls, 756039 tris, p95 16.7 ms, 0 long
- clamp: 95 draw calls, 756040 tris, p95 16.7 ms, 0 long
- xray: 95 draw calls, 756040 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 95 draw calls, 756040 tris, p95 16.7 ms, 0 long
- m4-scope: 94 draw calls, 838321 tris, p95 16.7 ms, 0 long
- m4-tools: 48 draw calls, 412969 tris, p95 33.4 ms, 0 long
- m4-cautery: 97 draw calls, 843382 tris, p95 33.3 ms, 0 long
- m4-staple: 49 draw calls, 406337 tris, p95 16.8 ms, 0 long
- m4-outside-hands: 103 draw calls, 749437 tris, p95 50 ms, 0 long
- heap 10.2 → 11.3 MB
- long frames 2 (max 67 ms), fps 50.7, frame p95 16.8 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 36 → 36 · 55 calls / 453643 tris peak (complication 54 / 433912) · p95 33.3 ms · 14 long (max 267 ms) · heap 10.4 → 12.2 MB (17.9 %)
- practice run 2: 51 s · programs 36 → 36 · 54 calls / 453643 tris peak (complication 55 / 433913) · p95 33.3 ms · 28 long (max 233 ms) · heap 10.5 → 12.2 MB (16.6 %)
- practice run 3: 51 s · programs 36 → 36 · 54 calls / 453643 tris peak (complication 54 / 433912) · p95 33.3 ms · 19 long (max 117 ms) · heap 10.9 → 12.2 MB (12.4 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 17.9 / 16.6 / 12.4 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T12:02:04.461Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 132 ms · ready 2979 ms · transfer 11.42 MB
- programs 36 → 36 · textures 91 (≈ 74 MB)
- ready: 94 draw calls, 756039 tris, p95 16.7 ms, 0 long
- orbit: 94 draw calls, 756039 tris, p95 33.3 ms, 1 long
- scope-step1: 51 draw calls, 454188 tris, p95 50 ms, 1 long
- scope-step2: 37 draw calls, 391959 tris, p95 50 ms, 1 long
- scope-step3: 46 draw calls, 414312 tris, p95 16.7 ms, 0 long
- scope-step4: 41 draw calls, 363979 tris, p95 50 ms, 1 long
- scope-step5: 42 draw calls, 406905 tris, p95 16.7 ms, 0 long
- scope-step6: 35 draw calls, 366214 tris, p95 33.3 ms, 0 long
- scope-step7: 32 draw calls, 264507 tris, p95 16.7 ms, 0 long
- scope-rig: 22 draw calls, 220502 tris, p95 16.7 ms, 0 long
- outside: 95 draw calls, 756040 tris, p95 16.8 ms, 0 long
- olv: 95 draw calls, 756040 tris, p95 16.7 ms, 0 long
- clamp: 95 draw calls, 756040 tris, p95 16.7 ms, 0 long
- xray: 95 draw calls, 756040 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 95 draw calls, 756040 tris, p95 16.8 ms, 0 long
- m4-scope: 48 draw calls, 414314 tris, p95 16.7 ms, 0 long
- m4-tools: 103 draw calls, 843154 tris, p95 33.4 ms, 0 long
- m4-cautery: 103 draw calls, 847478 tris, p95 16.7 ms, 0 long
- m4-staple: 51 draw calls, 408193 tris, p95 16.7 ms, 0 long
- m4-outside-hands: 105 draw calls, 751484 tris, p95 33.3 ms, 1 long
- heap 10.3 → 11.4 MB
- long frames 5 (max 100 ms), fps 53.3, frame p95 33.3 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 36 → 36 · 56 calls / 455499 tris peak (complication 56 / 435768) · p95 33.3 ms · 16 long (max 133 ms) · heap 10.5 → 12.3 MB (18.1 %)
- practice run 2: 51 s · programs 36 → 36 · 56 calls / 455499 tris peak (complication 56 / 435768) · p95 33.2 ms · 14 long (max 117 ms) · heap 10.6 → 12.4 MB (16.6 %)
- practice run 3: 51 s · programs 36 → 36 · 56 calls / 455499 tris peak (complication 56 / 435768) · p95 33.3 ms · 12 long (max 117 ms) · heap 10.6 → 12.3 MB (16.4 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 18.1 / 16.6 / 16.4 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T12:18:39.421Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 136 ms · ready 2880 ms · transfer 11.42 MB
- programs 36 → 36 · textures 91 (≈ 74 MB)
- ready: 94 draw calls, 756039 tris, p95 16.7 ms, 0 long
- orbit: 94 draw calls, 756039 tris, p95 16.8 ms, 0 long
- scope-step1: 51 draw calls, 454188 tris, p95 16.7 ms, 0 long
- scope-step2: 36 draw calls, 391958 tris, p95 16.7 ms, 0 long
- scope-step3: 46 draw calls, 414312 tris, p95 16.7 ms, 0 long
- scope-step4: 41 draw calls, 363979 tris, p95 33.4 ms, 0 long
- scope-step5: 43 draw calls, 406906 tris, p95 33.3 ms, 0 long
- scope-step6: 36 draw calls, 366406 tris, p95 16.7 ms, 0 long
- scope-step7: 31 draw calls, 264506 tris, p95 16.8 ms, 0 long
- scope-rig: 21 draw calls, 220501 tris, p95 33.4 ms, 0 long
- outside: 94 draw calls, 756039 tris, p95 16.7 ms, 0 long
- olv: 94 draw calls, 756039 tris, p95 16.8 ms, 0 long
- clamp: 94 draw calls, 756039 tris, p95 16.7 ms, 0 long
- xray: 94 draw calls, 756039 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 94 draw calls, 756039 tris, p95 16.7 ms, 0 long
- m4-scope: 98 draw calls, 842193 tris, p95 16.7 ms, 0 long
- m4-tools: 102 draw calls, 843153 tris, p95 33.4 ms, 1 long
- m4-cautery: 103 draw calls, 847478 tris, p95 33.3 ms, 0 long
- m4-staple: 110 draw calls, 838909 tris, p95 16.7 ms, 0 long
- m4-outside-hands: 105 draw calls, 751484 tris, p95 33.4 ms, 0 long
- heap 10.3 → 11.4 MB
- long frames 1 (max 67 ms), fps 53.3, frame p95 16.8 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 36 → 36 · 57 calls / 455499 tris peak (complication 56 / 435768) · p95 33.3 ms · 14 long (max 133 ms) · heap 10.5 → 12.3 MB (18 %)
- practice run 2: 51 s · programs 36 → 36 · 57 calls / 455500 tris peak (complication 56 / 435768) · p95 33.3 ms · 16 long (max 233 ms) · heap 10.6 → 12.4 MB (16.6 %)
- practice run 3: 51 s · programs 36 → 36 · 56 calls / 455500 tris peak (complication 57 / 435769) · p95 16.8 ms · 13 long (max 100 ms) · heap 10.6 → 12.3 MB (16.5 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 18 / 16.6 / 16.5 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod

### 2026-11-05T12:22:02.827Z PASS (headless real GPU (ANGLE/Vulkan), preset medium, 1280×720, script: orbit + window.__sim.probeScript (guided steps 1–7, rig, outside, OLV, clamp, X-ray, M4) + 3 practice runs (PA01→PA32 + 1 complication))
- FCP 124 ms · ready 2787 ms · transfer 11.42 MB
- programs 36 → 36 · textures 91 (≈ 74 MB)
- ready: 94 draw calls, 756039 tris, p95 16.7 ms, 0 long
- orbit: 94 draw calls, 756039 tris, p95 16.7 ms, 0 long
- scope-step1: 51 draw calls, 454188 tris, p95 16.7 ms, 0 long
- scope-step2: 36 draw calls, 391958 tris, p95 16.7 ms, 0 long
- scope-step3: 46 draw calls, 414312 tris, p95 16.7 ms, 0 long
- scope-step4: 41 draw calls, 363979 tris, p95 16.7 ms, 0 long
- scope-step5: 43 draw calls, 406906 tris, p95 16.7 ms, 0 long
- scope-step6: 36 draw calls, 366406 tris, p95 16.7 ms, 0 long
- scope-step7: 31 draw calls, 264506 tris, p95 16.7 ms, 0 long
- scope-rig: 21 draw calls, 220501 tris, p95 16.7 ms, 0 long
- outside: 95 draw calls, 756040 tris, p95 16.7 ms, 0 long
- olv: 95 draw calls, 756040 tris, p95 16.7 ms, 0 long
- clamp: 95 draw calls, 756040 tris, p95 16.8 ms, 0 long
- xray: 95 draw calls, 756040 tris, p95 16.7 ms, 0 long
- opacity-cutaway: 95 draw calls, 756040 tris, p95 16.7 ms, 0 long
- m4-scope: 48 draw calls, 414314 tris, p95 16.7 ms, 0 long
- m4-tools: 49 draw calls, 414793 tris, p95 33.4 ms, 1 long
- m4-cautery: 49 draw calls, 418846 tris, p95 33.4 ms, 0 long
- m4-staple: 111 draw calls, 847317 tris, p95 16.8 ms, 0 long
- m4-outside-hands: 105 draw calls, 751484 tris, p95 33.4 ms, 0 long
- heap 10.3 → 11.4 MB
- long frames 1 (max 100 ms), fps 54.5, frame p95 16.8 ms — NOT representative (headless, test-driven)
- practice run 1: 51 s · programs 36 → 36 · 56 calls / 455499 tris peak (complication 56 / 435768) · p95 16.8 ms · 11 long (max 133 ms) · heap 10.5 → 12.3 MB (18.1 %)
- practice run 2: 51 s · programs 36 → 36 · 57 calls / 455499 tris peak (complication 57 / 435769) · p95 33.3 ms · 17 long (max 150 ms) · heap 10.6 → 12.4 MB (16.6 %)
- practice run 3: 51 s · programs 36 → 36 · 56 calls / 455500 tris peak (complication 57 / 435769) · p95 33.3 ms · 17 long (max 117 ms) · heap 10.6 → 12.3 MB (16.5 %)
- practice heap: run 1 → 3 end 0 % (gate, budget < 10 %); per run 18.1 / 16.6 / 16.5 % (informational, incl. lazy debrief chunk); reload per run, see qa/perf.json heapMethod
