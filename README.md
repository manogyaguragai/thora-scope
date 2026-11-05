# ThoraScope — VATS right middle lobectomy simulator

A browser-based teaching simulator of a video-assisted thoracoscopic (VATS) right middle lobectomy via the
anterior approach, aimed at medical students and junior surgical trainees. It runs as a static site
(Vite + TypeScript + three.js) with no backend, no analytics and no network calls at runtime.

> **Pending clinician review.** All teaching text (step captions, learning points, tips, quiz and debrief
> wording, labels) is the project's own paraphrase and has not yet been reviewed by a clinician. It is not
> clinical guidance. Every teaching surface in the app carries this badge.

Modes: **Guided** (steps 1–7 with captions and learning points), **Practice** (perform the operation with
instruments; scored), **Explore** (free orbit, layers, cut-away) and **Physiology lab** (one-lung ventilation,
bronchus clamp test).

## Run locally

Requires Node 22+ and a desktop browser with WebGL2 (latest Chrome, Edge, Firefox or Safari).

```sh
npm i
npm run dev       # dev server with hot reload
npm run build     # type-check + production build into dist/
npm run preview   # serve dist/ on http://localhost:4173
```

Checks: `npm run lint`, `npm test` (unit), `npm run test:e2e` (Playwright), `npm run perf:probe`, or
`npm run check` for all of them.

## Controls

Bindings live in one file, `src/core/keybindings.ts`; press `?` in the app for the full, current list.

| Input                                | Action                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `O`                                  | Toggle outside / scope view                                                              |
| `→` / `PageDown`, `←` / `PageUp`     | Guided: next / previous step                                                             |
| `1`–`9`, `Q` / `E`                   | Select a tool slot / cycle previous–next (press the active key again for its sub-option) |
| Left-drag, wheel                     | Hands: pivot the scope about its port, insert / withdraw                                 |
| `Z` / `X`, `H`, `+` / `-`            | 30° optic rotation, horizon lock, digital zoom                                           |
| `P`, `V`, `R`                        | Cycle scope port (`Shift+P` with a tool), snap to the step view, reset view              |
| Port chip (click / Enter)            | Any tool or mode: move the scope to that port                                            |
| Right-drag, wheel, left-click / hold | Tool: steer the tip, set depth, snap to a structure / close, fire, activate              |
| `?`                                  | Help overlay                                                                             |

Some of these arrive with later modules.

## Measuring real frame rate

Headless test runs (`npm run perf:probe`, e2e) are driven by scripts, so their fps and frame-time numbers are
indicative only (on this project's dev machine they run on the Intel iGPU via ANGLE/Vulkan; on machines without a
GPU they fall back to SwiftShader software rendering). To measure on your own machine:

1. `npm run build && npm run preview`
2. Open `http://localhost:4173/?perf` in Chrome or Edge, full screen at 1080p, plugged in.
3. Optional: add `&quality=medium` (or `low` / `high`) to pin a quality preset; otherwise the device check picks
   one and adaptive resolution may change the pixel ratio.
4. Let it reach the scene, do a full Guided walk (steps 1–7) and one Practice run, and read the overlay: fps, p95
   frame time, draw calls, triangles, shader programs, textures, pixel ratio and preset.
5. Record the values in the "User measured" column of the budget table in `docs/PERF.md` (target ≥ 45 fps
   sustained on a mid-range integrated GPU at Medium).

## Known limitations of the model

- The middle lobe's vessel and bronchus branches sit inside the lobe; there is no opened fissure in the mesh.
- Wet gloss and subsurface look are added at runtime, not baked into the model.
- Nerve paths, retraction amounts and the small mediastinal shift are approximations.
- Vessel trees are trimmed inside the lung, so the outside view with lungs hidden shows hilar vessels only.
- Semi-transparent pleura can show sorting artefacts.
- The patient in the reference video had a tumour and an extra upper-lobe margin was taken; that is not
  modelled (Guided step 6 notes it).
- Port positions differ from the video; ports are mapped by role.

Asset defects are logged in `docs/ASSET_ISSUES.md`.

## Deployment

None. This project is not deployed anywhere. Hosting notes (for the owner to act on, not automation) belong in
`docs/DEPLOY_HOSTINGER_KVM.md`. Only `public/models/thorax_sim.opt.glb` and the KTX2 decoders ship in `dist/`;
nothing from `assets_src/` does (guarded by `tests/unit/dist-contents.test.ts`).

## Credits

Built by [Manogya Guragai](https://www.linkedin.com/in/manogya-guragai) and
[Dr. Mandeep Guragai](https://www.linkedin.com/in/mandeep-guragai).
