# ThoraScope: VATS right middle lobectomy simulator

ThoraScope is a browser simulator of a video-assisted thoracoscopic (VATS) right middle lobectomy through the
anterior approach. It is meant for medical students and junior surgical trainees who want to see the operation
step by step on a 3D model before they meet it in theatre. Everything runs in the browser: there is no backend,
no analytics and no network traffic once the page has loaded.

The teaching text (captions, learning points, tips, quiz and debrief) is our own paraphrase of a thoracic surgery
textbook and a recorded operation. It has not been reviewed by a clinician and is not clinical guidance.

## What you can do

- **Guided walkthrough.** A narrated, film-like run through the operation on the live model. Each step plays its
  camera moves, instrument insertions and tissue changes on its own; you move between steps with Next and Prev,
  pause or replay a step, and hover over any structure to see its name. The structure being discussed glows. Where
  the collapsed lung hides something from every port, a small outside view shows it next to the scope image.
- **Practice.** Do the operation yourself with the instruments, in the right order, and get a scored debrief with
  the mistakes and complications you caused.
- **Explore.** Free view of the anatomy with layers and a cut-away.
- **Physiology lab.** One-lung ventilation, the bronchus clamp test and the heartbeat and breathing controls.
- **Quiz.** Short questions on the anatomy and the order of the steps.

### The nine steps

1. Inspect the chest: the three lobes, both fissures and the phrenic nerve.
2. Expose the hilum: a grasper takes the middle lobe and reflects the lung; the mediastinal pleura is opened.
3. Middle lobe vein: hook cautery on the hilar strands, peanut dissection, then a vascular stapler.
4. Lymph nodes 11R and 12R: ring forceps take each node out; the oozing node bed is sealed with cautery.
5. Bronchus: a blunt clamp makes a passage, the stapler closes on the bronchus, a test breath confirms the right
   airway (upper and lower lobes inflate, the middle lobe stays down), then the stapler fires.
6. Middle lobe arteries (A4/A5): peanut dissection behind the artery, then a vascular stapler.
7. Fissures: four stapler fires along a dotted guide free the lobe.
8. Lobe out: the lobe goes into a retrieval bag and leaves through the access incision.
9. Irrigation, leak test under saline, and suction.

The ports are named by where they sit on this patient: the inferior camera port, the anterior access incision
(5th intercostal space) and the posterior port.

## Running it

You need Node 22 or newer and a desktop browser with WebGL2 (a current Chrome, Edge, Firefox or Safari).

```sh
npm install
npm run dev       # development server with hot reload
npm run build     # type check and production build into dist/
npm run preview   # serve dist/ on http://localhost:4173
```

Tests and checks:

```sh
npm run lint        # ESLint and Prettier
npm test            # unit tests (Vitest)
npm run test:e2e    # browser tests (Playwright, Chromium)
npm run perf:probe  # scripted performance run; fails if a shader compiles after loading
npm run check       # all of the above
```

The browser tests use software rendering when no GPU is available, so they are slow. Frame rates from them are
not meaningful; see "Measuring frame rate" below.

## Controls

Press `?` in the app for the complete, current list. All bindings live in `src/core/keybindings.ts`.

| Input                                | Action                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `O`                                  | Switch between the outside view and the scope view                         |
| `PageDown` / `PageUp`                | Guided walkthrough: next / previous step (in step 1: next / previous part) |
| Hover (touch: long press)            | Guided walkthrough: name a structure                                       |
| `1` to `9`, `Q` / `E`                | Practice: pick an instrument (press again for its options)                 |
| Left drag, wheel                     | Pivot the scope about its port, move it in and out                         |
| Arrow keys                           | Angle and pan the scope view                                               |
| `Z` / `X`, `H`, `+` / `-`            | Rotate the 30° optic, horizon lock, digital zoom                           |
| `Shift+P`, `V`, `R`                  | Move the scope to the next port, snap to the step view, reset the view     |
| Right drag, wheel, left click / hold | Instrument: steer the tip, set depth, grasp, close, fire, activate         |

## How the project is organised

```
src/core      renderer, frame loop, config, key bindings, quality presets
src/scene     model loading, materials, morphs, cameras, lights, post-processing, effects, instruments
src/sim       app state, steps, physiology, scope rig, ports, actions, practice scoring
src/app       glue modules and the walkthrough engine (src/app/walkthrough: engine, shots, framing, one file per step)
src/ui        loading screen, panels, side dock, hover labels, help
src/content   step text, labels, quiz, practice action table, anatomy manifest
scripts/      asset inspection, optimisation and verification, performance probe, paraphrase check
tests/        unit and browser tests
docs/         specifications and records (see below)
```

Tunable values live in config files (`src/core/config.ts`, `src/scene/*.config.ts`,
`src/app/walkthrough/walkthrough.config.ts`) rather than in the code. The anatomy model is described in one manifest,
`src/content/anatomy.json`: tissue type, lobe, and which step divides or dissects each structure.

Performance rules are strict: everything the app will ever draw is built and compiled during the loading screen,
so no shader is compiled afterwards (the performance probe checks this on every run). The frame loop allocates
nothing, picking uses a bounding volume hierarchy, and the post-processing is a single full-screen pass.

## Assets

The optimised scene, `public/models/thorax_sim.opt.glb`, is in the repository, so the app runs from a fresh clone.
The source material is not: the Blender models, the frames taken from the reference operation video and the
textbook stay outside the repository for copyright reasons. With those files in `assets_src/`,
`npm run assets:optimize` rebuilds the optimised scene. `docs/ASSETS.md` and `docs/MODEL_INTEGRATION.md` describe the
inputs and the build.

## Known limitations

- On this model the fully collapsed upper lobe and the oblique fissure cannot be seen from any port. The walkthrough
  shows them in the outside view instead.
- Lymph node 11R lies under the lower lobe and only comes into view as it is removed.
- The horizontal fissure guide and its staple lines are placed on the side the camera can see, which is an
  approximation of the real anatomy.
- The ports, and some of the instrument routes, differ from the reference video because the scope views the video
  uses are blocked by the collapsed lobes on this model. The walkthrough uses the port that gives a clear,
  square approach for each step.
- Wet gloss and the subsurface look are added at runtime, not baked into the model. Nerve paths, retraction and the
  mediastinal shift are approximations.
- The patient in the reference video had a tumour, and an extra margin of upper lobe was taken. That is not
  modelled.

Model defects are listed in `docs/ASSET_ISSUES.md`.

## Measuring frame rate

1. `npm run build && npm run preview`
2. Open `http://localhost:4173/?perf` in Chrome or Edge, full screen at 1080p, on mains power.
3. Optionally add `&quality=low`, `medium` or `high` to fix the quality preset.
4. Play the guided walkthrough and one practice run, and read the overlay: fps, frame time, draw calls, triangles,
   shader programs, pixel ratio and preset.

The target is at least 45 fps on a mid-range integrated GPU at the medium preset. Budgets and measurements are in
`docs/PERF.md`.

## How it was built

ThoraScope was built with Claude Code. An orchestrating agent planned the work into small tasks and handed each to
a builder agent. A separate reviewer checked every change against its acceptance criteria, module auditors and a
visual critic compared screenshots with frames from a real operation, and a performance probe checked the
rendering budgets. The 3D anatomy was modelled in Blender, driven by Claude through the Blender MCP server. The
working files of that process are kept: `CLAUDE.md` (the rules every agent read), `tasks.md` (the task board),
`docs/PROGRESS.md` (the running log) and `docs/DECISIONS.md` (design decisions).

### Documents

| File                                          | What it holds                                                        |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `docs/CONTEXT.md`                             | Product specification, data contracts, look and performance rules    |
| `docs/DECISIONS.md`                           | Design decisions and the reasons for them                            |
| `docs/VIDEO_STEP_MAP.md`                      | The reference video mapped to steps, ports and practice actions      |
| `docs/REFERENCE_FRAMES.md`                    | The reference frames and the colours sampled from them               |
| `docs/BOOK_NOTES.md`                          | Paraphrased notes from the textbook, with page references            |
| `docs/ASSETS.md`, `docs/MODEL_INTEGRATION.md` | Model inventory, optimisation pipeline and how the hilum model fits  |
| `docs/BLENDER_PROMPT_v8.md`                   | The brief given to the Blender modelling agent for the current model |
| `docs/ASSET_ISSUES.md`                        | Known model defects                                                  |
| `docs/PERF.md`                                | Performance budgets and measurements                                 |
| `docs/WIRING.md`                              | Module interfaces and how they are connected                         |
| `docs/FEEDBACK_*.md`                          | Feedback from live testing and how each item was resolved            |
| `CLAUDE.md`, `tasks.md`, `docs/PROGRESS.md`   | Agent rules, task board and development log                          |

## Credits

Built by [Manogya Guragai](https://www.linkedin.com/in/manogya-guragai) and
[Dr. Mandeep Guragai](https://www.linkedin.com/in/mandeep-guragai-280589117).
