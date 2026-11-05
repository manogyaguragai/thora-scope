# WIRING — modules built (phase 1) but not yet connected to the app

Builders run in parallel on disjoint files; `src/main.ts` and `src/core/config.ts` have ONE owner at a time.
Modules below are finished + unit-tested ("[w]" in tasks.md). A wiring task (T110w for M1/M2, T307 for M3,
T409 for M4, T505 for M5) connects them. When a module is wired: remove `test.fixme` from its e2e spec,
move its local config const into `src/core/config.ts`, mark the task `[q]` → QA.
Each entry: files · public API · wiring steps · follow-ups.

## T107 Adaptive resolution + `?perf` overlay → wire in T110w
- Files: src/core/adaptiveResolution.ts, src/core/perfConfig.ts, src/ui/perfOverlay.ts, tests/unit/adaptive.test.ts, tests/e2e/perf-overlay.spec.ts (fixme)
- API: `new AdaptiveResolution(maxRatio)`, `.update(dtMs) → ratio`, `.downgradeRequested`, `.setLocked()`, `.setMaxRatio()`; `applyPixelRatio(renderer, ratio)` (no-op unless quantised value changes); `nextLowerPreset(name)`; `loadQualityChoice()/saveQualityChoice()`; `mountPerfOverlay(getPixelRatio)` (lazy import, `#perf-overlay`).
- Wire: in makeRenderer before pickQuality → `const choice = loadQualityChoice(); if (choice.preset && !params.has('quality')) params.set('quality', choice.preset)`; after createPostFx → create AdaptiveResolution(min(dpr, preset.maxPixelRatio)), `setLocked(choice.locked || params.has('quality'))`; `if (params.has('perf')) import('./ui/perfOverlay').then(m => m.mountPerfOverlay(() => renderer.getPixelRatio()))`; top of frame → `applyPixelRatio(renderer, adaptive.update(dt))`; on `downgradeRequested` → next preset: zero post uniforms uCA/uGrain per preset flags + `setMaxRatio` (MSAA change needs reload).
- Follow-ups: move perfConfig values into config.ts.

## T108 Physiology lab panel → wire in T110w
- Files: src/ui/physiologyPanel.ts, src/ui/panels.css, src/sim/state.ts (lazy tween start fix), tests/unit/state-tween.test.ts, tests/e2e/physiology.spec.ts (fixme)
- API: `mountPhysiologyPanel(host, sim) → dispose` (no three import → lazy chunk).
- Wire: `sim.openPhysiology = async () => { const { mountPhysiologyPanel } = await import('./ui/physiologyPanel'); close = mountPhysiologyPanel(shell.inspector, sim) }`; call it when mode becomes 'physiology' (shell mode button `[data-mode=physiology]`), dispose on leaving.
- Follow-ups: move `LIMITS` (HR 40–180, RR 6–30, 250 ms sync) to config.physiology; fix tests/unit/cameras-steps.test.ts:66 (assumed tween starts at t=0; now starts at first update).

## T202 Guided controller + modes → wire in T110w
- Files: src/sim/guided.ts, src/sim/modes.ts, src/core/keybindings.ts (bindings now {code, alt?, label}, `matchesKey`), tests/unit/guided.test.ts
- API: `createGuided({vis, state, setCamera, setFade})` → `next/prev/goTo(n, instant?)/current/transitioning/update(now)/on('stepchange'|'transitionend', cb)`; modes: `getMode/setMode/onModeChange` (default 'guided').
- Wire: `const guided = sim.guided = createGuided({ vis: v, state, setCamera: (name, instant) => r.setScopeCamera(name, instant), setFade: (o, a) => setOpacity(o as Mesh, a) })`; `sim.setStep = (n, instant) => guided.goTo(n, instant)`; frame: after rig update → `guided.update(now)`; keydown in guided mode: guidedNext/guidedPrev bindings.
- Follow-ups: make camera transition 1500 ms to match fades (config.scope.transitionMs or a duration param); fade must MULTIPLY with layer-panel opacity (add opacity getter in materials.ts); add `guided.off()` for dispose; move GUIDED_CONFIG into config.ts.

## T203 App shell + Guided UI → wire in T110w
- Files: src/ui/shell.ts, src/ui/guidedPanel.ts, src/ui/panels.css (shell + guided sections), tests/e2e/guided.spec.ts (fixme → step-1..7.png)
- API: `mountShell(host, onModeSelect) → {topbar, rail, inspector, caption, hotbarHost, portChipsHost, setMode}`; `mountGuidedPanel(shell, guided, GUIDED_STEPS) → dispose`.
- Wire: `const shell = mountShell(app, m => setMode(m)); onModeChange(m => shell.setMode(m)); shell.setMode(getMode()); mountGuidedPanel(shell, guided, GUIDED_STEPS)`. Physiology panel mounts into `shell.inspector`.
- Follow-ups: arrow keys currently handled inside guidedPanel.ts (ponytail) → use keybindings; remove the old `#app h1` overlay if still present.

## T301 Fulcrum scope rig + ports → wire in T307 — **wired (T307, src/app/wireM3.ts)**
- Files: src/sim/ports.ts, src/sim/scopeRig.ts, tests/unit/scope-rig.test.ts
- API: `readPorts(root) → Port[] {id,label,skin,pleura,axis}` (from extras, (x,z,−y)); `new ScopeRig(ports)`: `drag(dx,dy)` (mirrored), `insert(d)`, `rotateOptic(deg)`, `setHorizonLock(b)`, `zoomBy(k)`, `switchPort(id)`, `snapTo(pose, portId?)` (turns horizon lock off to match rolled authored cams), `reset()`, `writePose(outPos, outQuat, outFovRef)`; public `opticAngleDeg`, `headRollDeg`.
- Wire: build at load; on step change `rig.opticAngleDeg = step.scope_angle_deg; rig.snapTo(scopePoseOf(step.camera), step.port)`; when hotbar slot = Hands and view = scope, CameraRig target pose comes from `rig.writePose`; pointer: left-drag → drag, wheel → insert(−deltaY·wheelMetersPerPx); keys Z/X optic, H horizon lock, +/− zoom, P next port, V snap to step, R reset; show `rig.port.label` + lock state in UI.
- Follow-ups: add `rollHead()`; move SCOPE_RIG_CONFIG (+ wheelMetersPerPx) to config.ts. Asset note L2 (rolled cams, cam_6 95° off axis).

## T302 BVH picking → wire in T307 — **wired (T307, src/app/wireM3.ts)**
- Files: src/scene/picking.ts, tests/unit/picking.test.ts
- API: `buildPickBVH(root, onProgress?) → Picker`: `hover(x, y, camera, now) → name|null` (≤30 Hz cached), `pick(x, y, camera) → {nodeName, point, normal, distance}|null` (shared result object), `refreshMorphs(meshes)` (call when state tweens END, never per frame).
- Wire: build inside runLoadingStages onModel callback (stage 2/3); replace debug Raycaster/hits/hoverMs/lastPick in main.ts; click → `picker.pick`; cache morph-mesh list at load.
- Follow-ups: move PICKING_CONFIG to config.ts. BVH build reorders index buffers in place (render unaffected).

## T306 Help overlay → wire in T307 — **wired (T307, src/app/wireM3.ts)**
- Files: src/ui/helpOverlay.ts, src/ui/help.css, tests/unit/help.test.ts, tests/e2e/help.spec.ts (fixme)
- API: `openHelp(host, {keybindings, hotbarKeys, toolNames, contextActions})`, `closeHelp()`, `isHelpOpen()`; native `<dialog>`.
- Wire: keydown `?` → `Promise.all([import('./ui/helpOverlay'), import('./sim/hotbar')]).then(([h, hb]) => h.isHelpOpen() ? h.closeHelp() : h.openHelp(document.body, {...}))`.
- Follow-ups: add ALL scope/view keys (H, Z/X, +/−, P, V, R, L, Esc withdraw, I PiP) with `group` + `label` to keybindings.ts so help lists them.

## T304 Hotbar → wire in T307 — **wired (T307, src/app/wireM3.ts)**
- Files: src/sim/hotbar.ts, src/ui/hotbar.ts, src/ui/icons.ts, src/ui/hotbar.css, tests/unit/hotbar.test.ts, tests/e2e/hotbar.spec.ts (fixme)
- API: `createHotbar() → {slot, subOption(i?), select(i), cycle(±1), handleKey(code)→bool, on('change',fn)→off}`; `SLOTS` (ids = ToolId/SUB_IDS in targets.ts), `HOTBAR_KEYS`, `CONTEXT_ACTIONS`; `mountHotbar(host, hotbar)→dispose`; `mountPortChips(host, ports[{id,label}], getOccupant)→{setOccupant, dispose}`.
- Wire: `mountHotbar(shell.hotbar, hb)`; `mountPortChips(shell.ports, …)` (NB shell exposes `shell.hotbar` / `shell.ports`, not hotbarHost/portChipsHost); global keydown (skip inputs/dialogs) → `hb.handleKey(e.code)`; on change: slot 0 Hands → ScopeRig, others → InstrumentController; pass HOTBAR_KEYS/SLOTS names/CONTEXT_ACTIONS to openHelp; un-fixme e2e.
- Follow-ups: move HOTBAR_KEYS + CONTEXT_ACTIONS codes (B/A/G/T) into keybindings.ts. Minor a11y: active slot outline masks focus ring.

## T305 Viewing aids (layers, X-ray, cut-away, labels) → wire in T307 — **wired (T307, src/app/wireM3.ts)**
- Files: src/ui/layersPanel.ts, src/ui/labels3d.ts, src/ui/viewing.css, tests/unit/layers.test.ts, tests/e2e/viewing.spec.ts (fixme)
- API: `mountLayersPanel(host, {lookup, stepVisible, bounds})→{layers, dispose}`; `createAnchors(lookup, names)→getWorldPos`; `createLabels3D(host, camera, getWorldPos, {names, masked?})→{pin, dismiss, toggleAll, update(now), dispose}`.
- Wire: mount in right inspector with scene bounds; on step apply, visible = stepVisible && `layers.isUserVisible(name)`; create labels AFTER layout on canvas host (names from LAYER_GROUPS, masked in scope view); `labels.update(now)` in loop; Hands-mode click pick → `labels.pin(name, hit.point)`.
- Follow-ups: move VIEWING_CONFIG to config.ts/keybindings.ts; label Escape listener on window may clash with help overlay Escape — route through one key handler.

## T403 Instrument control → **wired (T409, src/app/wireM4.ts)**
- Files: src/sim/instrumentControl.ts, tests/unit/instrument-control.test.ts
- API: `InstrumentController`: `park(port)`, `snapTo(port, hitPoint, validPoints?)→{ok, reason}` (SNAP_REASONS), `steer(dx,dy)`, `insert(±m)`, `activate(bool)`, `withdraw()`, `update(dtMs)`, `writeTransform(pos, quat)`; set `viewRight`/`viewUp` from scope each frame. Tool model: tip at origin, +Z along shaft.
- Wire: park on tool select; click pick → snapTo (toast reason on fail); right-drag steer, wheel insert, left down/up activate, Esc withdraw; keybindings `instrumentWithdraw: 'Escape'` + pointer bindings.
- Follow-ups: move INSTRUMENT_CONTROL_CONFIG to config.ts; export `clampToCone` from scopeRig.ts and dedupe; main.ts must build valid-point list (BVH hit ± nearby), targets.ts has only centroids.

## T401 Port occupancy + approach angle + retraction swap → **wired (T409, src/app/wireM4.ts)**
- Files: src/sim/portOccupancy.ts, src/content/targets.ts (comment only), tests/unit/port-occupancy.test.ts
- API: `new PortOccupancy(readPorts(root))`: `moveScope`, `insert`, `withdraw`, `hold(targetId)` (G), `release`, `used`, `hasRoom`, `approachDeg`, `canFire(tool, targetId, port, sub?, livePoint?)→ ok|no-target|no-port|wrong-tool|poor-angle|retraction-in-port|port-full`; `swaps`, `lastSwapFrom/To` for scoring.
- Wire: P → moveScope; tool insert → insert; G → hold; Esc → withdraw; canFire before stapler fire/snap (poor-angle → warning toast, retraction-in-port → "transfer the retraction" hint); pass live target point (morphs move structures).
- Follow-ups: PORT_CONFIG (maxApproachDeg 45 — measured: vein via access incision 84° fails, forcing the video's swap; pending clinician review) → config.ts. One held retraction only (ponytail). Every port change counts as a swap (PA11 = swap 2) — decide in T504 scoring. Open: block held-retraction hand from insert?

## T407 Effect pools → **wired (T409, src/app/wireM4.ts)** · blood/complications → T505
- Files: src/scene/effects.ts, tests/unit/effects.test.ts
- API: `createEffects(preset)→{group, objects, smoke, ooze, bubbles, blood, fog, cautery(at), bubbleBurst(at), suction(), update(dt)}`; `blood.spawn(point, normal)→slot`, `blood.stop(slot)`, `blood.activeBleeds`; `fog.value` 0..1, `fog.pulse()`. Capacities = round(preset.particleCap × capScale), allocated once, ring-buffer reuse.
- Wire: create at load; `scene.add(fx.group)` + `registerWarmupObject(fx.group)`; per frame `fx.update(dt)` then post uniform uFog = `fx.fog.value`. Expect +4 draw calls, ~+2 programs (all at warm-up) — confirm with perf:probe.
- Follow-ups: move EFFECTS_CONFIG → config.ts; smoke wisps fixed size (custom shader to grow); "bubbles only on leak" + view reddening from `blood.activeBleeds` belong to M5 logic.

## T402 Procedural instruments → **wired (T409, src/app/wireM4.ts)**
- Files: src/scene/instruments.ts, src/scene/instruments.config.ts, tests/unit/instruments.test.ts
- API: `buildInstruments()→InstrumentSet {root, tools[id], active, show(slotId|null, sub), setJaw(0..1), setGlow(0..1)}`; `TOOL_IDS`, `ToolId`. 6 shared geometries + 6 MeshStandardMaterials, no clipping planes, only silicone leader transparent (fixed at load) → expect ~2 programs.
- Wire: before loading stages: `scene.add(inst.root); registerWarmupObject(inst.root)`; hotbar change → `inst.show(slotId, sub)`; per frame `controller.writeTransform(inst.tools[id].position, .quaternion)` (tip origin, +Z shaft — matches T403); jaw/glow from control layer via `instrumentAnim` rates. perf:probe must show 0 new programs after ready.
- Follow-ups: stapler `articulation` 0 → tune ~20–25° (ref-frame 02:04); no clip load/unload API yet (T405); per-tool e2e screenshots in T409.

## T406 Finish sequence (bronchus test, LN, fissure, bag, chest tube, water test) + fluid → **wired (T409, src/app/wireM4.ts)**
- Files: src/sim/actions/finish.ts, src/scene/fluid.ts, tests/unit/finish.test.ts
- API: `createFinishState()`, FINISH_CONFIG; `removeNode(s,node,port)`, `clampBronchus/unclampBronchus(s)`, `ventilate(s)` (A: bronchus test while clamped; water test after irrigate — bubbles + air_leak only if `s.leak`), `fireBronchus(s)`, `fireFissure(s, retractFissure)` + `confirmUnderside`, `bagExtract(s,port)` (B), `placeChestTube(s,port,scopePort)` (T, optional), `irrigate(s)`, `noteDivided(s,'vein'|'artery')`. Returns `{ok:false,reason,error}` or requests `tween|divide|hide|specimen|flag|advance|rmlDivided|fluid|bubbles`. `IrrigationFluid`: `mesh`, `placeAt(v)`, `setLevel(0..1)`, `update(dt)`; FLUID_CONFIG.
- Wire: `scene.add(fluid.mesh)` + registerWarmupObject; request dispatcher (tween → tweenTo after delayMs, divide → staples.ts, bubbles → fx.bubbleBurst, fluid → setLevel, flag/advance → practice engine); staple.ts → noteDivided + set `s.leak` on bad stump; keys B/A/T.
- Follow-ups: needs a small delayed-call scheduler (state.ts has no delays). DECISION for T409: practice engine (T502, practice_actions.json) is the single authority on ORDER/permission in practice mode; finish.ts only produces state effects — drop/bypass its duplicate gating there (keep it for explore/free mode only if needed).

## T405 Encircle + staple-divide + clips → **wired (T409, src/app/wireM4.ts)**
- Files: src/sim/actions/staple.ts, src/scene/staples.ts, tests/unit/staple.test.ts
- API: `Encircle {pass(target,tool,sub), has, reset}`; `validateStaple(target, cartridge, encircle)→ok|no-target|not-stapleable|wrong-cartridge|not-encircled`; `targetTissue(id)`; `StapleFire {close(), fire(), release(), update(dtMs)→true once on divide, jaw (1 open→0 closed), result {target,cartridge,point,normal,hide}}`; `cutPlane()`. `new Staples()` → `group` (2 InstancedMeshes, 1 titanium mat: 12 lines×3 rows×8, 8 clips), `addLine(point,normal,across,width?)`, `addClip(point,axis,across)`, `reset()`, `setDivisionPlane(planes,point,normal,slot)`, `parkDivisionPlanes(planes)`.
- Wire: `scene.add(st.group)` + registerWarmupObject; clamp encircle → `enc.pass`; stapler click → `PortOccupancy.canFire` then `fire.close`; per frame `fire.update(dt)` + `inst.setJaw(fire.jaw)`; on divide: hide meshes if `result.hide` else `setDivisionPlane(getDivisionPlanes(mesh), …)`, then `st.addLine(…, jaw-width axis from stapler quaternion)`; → finish.ts `noteDivided`; new run → resets + park planes. Expect +2 draw calls, ~+1 program (warm-up).
- Follow-ups: STAPLE_CONFIG/STAPLES_CONFIG → config.ts. Union clipping can't cut a GAP in one mesh: distal piece of the cut mesh vanishes (lobe side survives only where branches are separate meshes) — if the visual-critic flags it, M8: pre-split distal segments at load into separate meshes. Export a park helper from materials.ts (dedupe parked normal). Stump side uses one reference point (carina) for all targets.

## T408 Gloved hands + PiP inset → **wired (T409, src/app/wireM4.ts)**
- Files: src/scene/hands.ts, src/ui/pip.ts, tests/unit/hands.test.ts
- API: `buildHands(glove?)→{root, material, meshes, setGlove, setTarget('scope'|'tool', obj|null), setView('scope'|'outside'|'pip'), update()}` (HANDS_CONFIG). `createPip(renderer, scene, {code, everyNthFrame?, parent?, before?, after?})→{camera, render(), toggle, handleKey, setScopeMode, warmup, sceneRenders}` (256×160 HalfFloat RT, scene every Nth frame, quad every frame bottom-right).
- Wire: `scene.add(hands.root)` + registerWarmupObject; tool change → `setTarget('tool', inst.tools[id]|null)`; create a scope Object3D posed from ScopeRig (tip origin, +Z) → `setTarget('scope', …)`; rig onMode → `hands.setView(m)`, `pip.setScopeMode(m==='scope')`; `createPip(…, {code:'KeyI', before: ()=>hands.setView('pip'), after: ()=>hands.setView(rig.mode)})` + `registerWarmupHook(pip.warmup)`; per frame `hands.update()` before render, `pip.render()` after postFx.render; KeyI in keybindings + help.
- RISK (ADR-008): rendering the scene into the PiP RT may compile different programs than canvas renders → pip.warmup MUST render the full scene into its RT during loading; verify perf:probe 0 new programs after ready WITH PiP toggled on in the probe script.
- Follow-ups: PiP uses the active visibility set (may need outside set in before/after); grip offsets first guesses → visual check hands-outside.png; inset may overlap right inspector (config margin); HANDS_CONFIG → config.ts.

## T504 Scoring + debrief → wire in T505 (M5)
- Files: src/sim/scoring.ts, src/ui/debrief.ts, src/ui/debrief.css, tests/unit/scoring.test.ts
- API: `scoreRun({log, actions, swaps, elapsedSec, complications?})→{total 0–100, items[], facts}` (SCORING_CONFIG weights: completion 35, errors 10, complications 15, time 10, bronchus test 10, upper-lobe vein [tree_pulm_vein_base] preserved 10, port/angle 5, swaps 5 beyond the 3 the reference needs). Complication shape `{kind, severity:'minor'|'major', t, structure?}`. `openDebrief(host, breakdown, {onRetry, onClose})→{renderOnDemand:true, close}`, `closeDebrief()`, `isDebriefOpen()`; type-only imports (no three in chunk).
- Wire: on engine `finish` (or quit) → scoreRun → `import('./ui/debrief')` → openDebrief; pause loop while open, resume in onClose; onRetry → engine.reset() + scene reset; add 'debrief' to LAZY_CHUNKS in tests/unit/bundle-size.test.ts.
- Follow-ups: T503 must emit minor/major severities; weights + 15/60-min time window + swap allowance pending clinician review.

## T503 Complications → wire in T505 (M5)
- Files: src/sim/complications.ts, tests/unit/complications.test.ts
- API: `new ComplicationController(clock, onStop?(slot))`; `onAction({tool, subOption, target, kind, point?})→ComplicationRequest[]` ({type:'blood', bleed, point, severity} | {type:'toast', key}); `update(dt, input{suction, pressure, retract})→requests|null` (tear once per passage); `bindSlot(bleed, slot)`; outputs `pool`, `redden` 0..1 (post uniform), `oozeRate`, `vitalsKey`, `activeBleeds`, `log` (events danger-hit / bleed{severity, cause} / bleed-controlled / injury, with t). `isVascular(name)` exported; COMPLICATIONS_CONFIG.
- Wire: feed EVERY attempt into `onAction` alongside PracticeEngine.attempt; blood request → `fx.blood.spawn` + `bindSlot`; onStop → `fx.blood.stop`; per frame set reused input (suction = sucker active near bleed, pressure = sponge-stick held near bleed — distance check in wiring), redden → post uniform; map log → scoring complications `{kind, severity:'minor'|'major', t, structure}`.
- Follow-ups: ADD TEXT for keys complication.danger|bleed|tear|injury, vitals.bleed.major|minor in src/content (paraphrased, pending review). Tear frame allocates a request (rare). Thresholds placeholders; COMPLICATIONS_CONFIG → config.ts. Vascular derived from node names (targets.ts has no flag).

## T602 Quiz engine + UI → wire in T604 (M6)
- Files: src/sim/quiz.ts, src/ui/quiz.ts, src/ui/quiz.css, tests/unit/quiz.test.ts
- API: `createSession(seed, count?)` (seeded item + option shuffle, correctIndex remapped), `answer`, `checkAnswer`, `score`, `reviewList`; `openQuiz(host, {onIdentifyRequest(cb|null), onClose?, seed?, count?})→{close}`, `closeQuiz()`, `isQuizOpen()`. Non-modal <dialog> top-right; no three import.
- Wire: `await import('./ui/quiz')` from a quiz mode button; keep `pickCb` set by onIdentifyRequest; on click pick while pickCb set → `pickCb(hitNodeName)` instead of click-to-label; onClose restores normal clicks; LAZY_CHUNKS += quiz.
- Follow-ups: `.quiz` inset may overlap the right inspector — adjust in quiz.css during T604.

## T404 Grasp/retract + dissect → **wired (T409, src/app/wireM4.ts)**
- Files: src/sim/actions/retract.ts, src/sim/actions/dissect.ts, src/scene/materials.ts (grasp uniforms in the shared tissue patch), tests/unit/retract.test.ts, tests/unit/dissect.test.ts
- API: `new Retract(state, graspUniforms, springBack?)`: `grasp(targetId, point)→ok|no-target|not-collapsed` (all right lobes deflate ≥ minDeflate, §7.3), `drag(dx,dy)` (px; morph `retract_posterior`, or `retract_fissure` on the RML, clamped 0..1 via tweenTo(…,0); pull offset along `viewRight`/`viewUp`, capped), `release(hold?)` (spring-back to the pre-grasp value unless held), `update(dtMs)` (pull relaxes exponentially after release); `key`. materials.ts: `graspUniforms {uGraspPoint, uGraspOffset, uGraspRadius}` + `GraspUniforms` (vertex offset with radial falloff, skipped when offset = 0). `new Dissect({setFade, swapToWindow, cautery, clearView})`: `begin(id, 'peanut'|'cautery', tipVec3)→bool` (tool must be in the target's tools; `_window` ids map to the base), `end()`, `suction()`, `update(dtMs)→target|null` (once at progress 1), `progress(id)`, `reset()`.
- Wire: retract → set `retract.viewRight/viewUp` from the scope camera each frame; grasper(retractor)/sponge left-down on a lobe → `grasp(hit.nodeName, hit.point)` (toast reason), pointer drag → `drag`, up → `release(heldWithG)`; per frame `retract.update(dt)`; G hold → PortOccupancy.hold. Dissect hooks: `setFade: (n,f) => setFade(mesh(n), f)`, `swapToWindow: (n,w) => { mesh(n).visible = false; mesh(w).visible = true }`, `cautery: at => fx.cautery(at)`, `clearView: () => { fx.suction(); fx.fog.clear() }`; peanut/cautery left-down → `begin(hit.nodeName, tool, instrumentTipVec3)`, up → `end()`; sucker active → `suction()`; on non-null `update` return → PracticeEngine.attempt (the engine decides order/flags; its hide/show then matches the swap). Feed cautery attempts into ComplicationController.onAction too.
- Follow-ups: move RETRACT_CONFIG / DISSECT_CONFIG into config.ts. Pull falloff is radial in world space, so neighbouring meshes (hilar vessels) inside `pull.radius` move too (ponytail; per-mesh mask uniform if the visual-critic flags it). Rates/drag gains/pull cap are placeholders (visual tuning, pending clinician review). Picking BVH does not see the pull offset (visual only). Step application must re-show base meshes on reset/prev (Dissect.reset only clears progress).

## T703 Render gate (render-on-demand) → wire in T505 (debrief) / T604 (quiz)
- Files: src/core/renderer.ts, src/core/perf.ts (`__perf.renders` counter), tests/e2e/visibility.spec.ts, tests/unit/alloc-audit.test.ts
- API (src/core/renderer.ts): `holdRendering(reason)` / `releaseRendering(reason)` (set of reasons; the loop skips onFrame + scene + post-FX while any is held), `requestRender()` (one frame while held, e.g. after a layer change behind an overlay), `isRenderingHeld()`. Hidden tab still stops rAF entirely. Test hook `window.__render {hold, release, request}`.
- Wire: debrief open (`openDebrief` returns `renderOnDemand:true`) → `holdRendering('debrief')`; onClose/onRetry → `releaseRendering('debrief')`. Quiz/menus: hold only while nothing behind them animates; if the quiz identify-pick changes highlights, call `requestRender()` after the change. Don't call from the frame loop.
- Notes: sim time (tweens, eased camera) doesn't tick while held, so in-flight transitions complete on the first frame after release. alloc-audit HOT list must be updated when a hot function is renamed or a new per-frame module is wired (e.g. pip.render, instrumentControl).

## T704 Low-preset texture cap → **wired (T409, main.ts)**
- Files: src/scene/loader.ts (`dropTopMip`), src/scene/loadingStages.ts
- API: `runLoadingStages(renderer, scene, camera, place, textureDownscale = false)`; true drops mip 0 of every mipmapped KTX2 texture before upload (half size, ~¼ GPU memory). Load time only.
- Wire: in src/main.ts pass `preset.textureDownscale` as the 5th argument of `runLoadingStages(...)` (after the `place` closure). A later auto-downgrade does not re-cap (needs a reload).

## T409 M4 wiring notes (for T505 / M8)
- API (`window.__sim.m4`, src/app/wireM4.ts): `gate` (set to PracticeEngine.attempt in practice mode; null = actions just apply), `snapTo(name, point)`, `press(down)`, `nextToolPort()`, `flags`, `errors`, `occupancy`, `finish`, `staples`, `pip`; `update(now)` / `afterRender()` from main.ts. Test helper `__sim.placeTool(id, target, sub?)` (lazy probe chunk).
- Controls: tool slot → instrument parked at its last port (access incision default); P with a tool = next instrument port with room (Hands + P moves the scope, skipping full ports); click = snap through the CURRENT port (no auto port choice: port choice is what practice scores); click again on the placed target = activate; right-drag steer, wheel depth, Esc withdraw, G hold, A/B/T, I PiP, `,`/`.` camera-head roll.
- Stapler: vessels close+fire on one activation; bronchus = close (→ A test) then fire; fissure fires cap only (no lobe clipping). Divides clip only the stapled node (distal branches stay with the lobe).
- finish.ts `advance` requests are ignored (T505: engine owns steps); its physical prerequisites still apply in every mode. No `reset()` yet (T505 retry must reset fin/enc/dissect/staples/division planes/overrides).
- Open: held retractor is not drawn after G (InstrumentSet shows one tool); no scope shaft mesh for the scope hand; PiP renders the active visibility set; specimen tray is a toast only.

## Pending reports (in progress — entries added when they finish)
(none)
