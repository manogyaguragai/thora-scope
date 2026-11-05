# ThoraScope — VATS RML Lobectomy Simulator

Browser simulator of a VATS right middle lobectomy (anterior approach) for students/junior trainees.
Vite + TypeScript (strict) + three.js (pinned) + three-mesh-bvh. Static site, no backend.

## Read order (resume from files alone)
1. `CLAUDE.md` (this file)
2. `docs/CONTEXT.md` — product spec (§6), data contracts (§7), look spec (§8), tokens (§9), video timeline (§13)
3. `tasks.md` — STATUS BOARD at the top, then tasks; pick the next unblocked `[ ]`
   + `docs/WIRING.md` — APIs + wiring steps for built-but-unwired modules (`[w]`)
4. As the brief says: `docs/REFERENCE_FRAMES.md`, `docs/VIDEO_STEP_MAP.md`, `docs/BOOK_NOTES.md`, `docs/ASSETS.md`, `docs/PERF.md`, `docs/DECISIONS.md`
5. Last lines of `docs/PROGRESS.md` (append-only log; resume notes live here)

## Hard rules
- NEVER deploy anywhere. Deployment = notes only (`docs/DEPLOY_HOSTINGER_KVM.md`).
- NEVER edit anything in `assets_src/` (read-only inputs, gitignored).
- NEVER paste book text/figures or transcript lines verbatim into the app. Paraphrase. (No "Pending clinician review" badges in the UI: removed by user request 2026-11-05.)
- NEVER ship ref-frames (or anything from `assets_src/`) in the build. Only `public/models/thorax_sim.opt.glb` + decoders.
- No external network calls at runtime; no CDNs; no analytics.
- Config, not magic numbers (`src/core/config.ts`, `src/scene/materials.config.ts`, `src/core/keybindings.ts`).
- NO GIT COMMITS by the orchestrator or any agent (user instruction, overrides the kickoff). Never run `git commit`,
  merge/rebase/stash/reset/worktree-add or anything that creates or rewrites commits. The user commits.
  Small tasks: ≤ ~3 source files, ≤ ~250 changed lines.

## Task loop (orchestrator)
1. Read `tasks.md`. If the next module has no tasks, plan ONLY that module into right-sized tasks.
2. Pick next unblocked `[ ]` → mark `[~]` → spawn builder with a brief (template below).
3. Builder returns → mark `[q]` → spawn a FRESH qa-reviewer (task ID, AC, list of files the builder changed).
   Builders may run IN PARALLEL in the main working tree, each owning a disjoint file set named in its brief
   (hotspots like src/main.ts / src/core/config.ts: one owner at a time; others expose functions to wire later).
   No worktrees (they branch from HEAD and miss uncommitted work).
   QA reviews the uncommitted working-tree diff (`git diff HEAD -- <files>`) and never edits.
4. PASS → `[x]` + PROGRESS line. FAIL → fix task `T###b` (max 2 fix rounds, then `[!]`, move on).
5. Module done → fresh module-auditor (+ visual-critic for M1, M3, M4, M5, M8). Gate fail → defects become tasks.
6. After every task print 3 lines: task ID, result, next task.
7. Long context: write a resume note to PROGRESS, then compact. State must already be in files.

Status legend: `[ ]` todo · `[~]` in progress · `[w]` built, awaiting wiring · `[q]` awaiting QA · `[x]` done · `[!]` blocked · `[>]` deferred.
Write status changes BEFORE moving on. Only non-MANDATORY items may be deferred.

### Builder brief template
```
TASK T### — <title>
Goal: <1–2 lines>
Read first: CLAUDE.md; docs/CONTEXT.md §<x>; <file paths>; <≤3 ref-frames if visual>
Do: <≤8 bullets>
Do not: <scope fences>
AC (must pass): <mechanical checks, incl. perf:probe when rendering/sim changes>
Report: files, summary, commands + exit codes, perf delta, open issues (≤12 lines)
```

## QA rules
- QA never edits source. Checks diff vs AC; runs `npm run lint && npm test && npm run build`;
  + `npm run test:e2e` if UI changed; + `npm run perf:probe` if rendering/sim changed.
- Looks for: §7 contract violations, magic numbers, dead code, console errors, §6.10 violations.
- Output: PASS or FAIL + numbered defects (≤15 lines).

## Token rules
- Briefs pass paths and section names, not pasted content. Reports ≤12 lines. No full-file dumps.
- Visual tasks name at most 3 ref-frames. Don't spawn agents for one-line edits.
- Prefer `grep`/targeted reads over reading whole large files.

## Performance rules (summary of CONTEXT §6.10 — mandatory)
- Build once at load, reuse forever: geometries, materials, instruments, InstancedMeshes, particle/decal pools, render targets. Nothing created/disposed in the frame loop or during actions.
- No runtime shader recompiles: never toggle `transparent`, `defines`, `side`, texture presence, clipping-plane count, or light count after load. Swap pre-compiled variants; drive effects via uniforms.
- No per-frame allocations: module-level temp Vector3/Quaternion/Matrix4; no closures/arrays per frame; no console.log in the loop.
- Morph influences written only when changed (dirty flags); skip invisible meshes.
- Single combined post-FX ShaderPass (distortion, mask, vignette, CA, grain, grade, tone map).
- Shadows off. Per-step visibility sets hide what the scope can't see. Static meshes `matrixAutoUpdate=false`.
- Picking via BVH (built at load), hover ≤ 30 Hz, full pick on click only.
- Pause when tab hidden; render on demand in static screens.
- Adaptive resolution (0.6 … min(dpr,1.5), hysteresis); auto-downgrade preset if < 40 fps for 3 s.
- Any rendering/sim change: run `npm run perf:probe` → 0 new shader programs after "ready".
- Budgets live in `docs/PERF.md`. Headless (SwiftShader) fps is never reported as real fps.

## Commands
`npm run dev | build | preview | lint | test | test:e2e | perf:probe | assets:optimize | check`
(`check` = lint + build + test + e2e + perf:probe). Playwright uses Chromium with SwiftShader if no GPU.
Parallel agents share port 4173: ALWAYS wrap browser runs in the lock, e.g.
`flock /tmp/claude-1000/thorascope-e2e.lock npm run test:e2e` (same for `perf:probe` and `check`).

## Layout
`src/core` renderer/loop/config/keybindings/quality/perf · `src/scene` loader/materials/morphs/cameras/lights/postfx ·
`src/sim` state/steps/physiology/scope/ports/instruments/hands/hotbar/actions/pools/practice/complications ·
`src/ui` loading screen, hotbar, panels · `src/content` text, labels, tips, practice_actions.json, quiz ·
`public/models`, `public/decoders` · `tests/unit`, `tests/e2e` · `scripts/` · `docs/` · `qa/`.
