import { AxesHelper, Box3, PerspectiveCamera, Scene } from 'three';
import type { Mesh } from 'three';
import type { M3 } from './app/wireM3';
import type { M4 } from './app/wireM4';
import type { M5, M5Context } from './app/wireM5';
import type { VitalsMonitor } from './app/wireM7';
import type { Stumps } from './scene/stumps';
import type { FissureGuide } from './scene/fissureGuide';
import {
  AdaptiveResolution,
  applyPixelRatio,
  loadQualityChoice,
  nextLowerPreset,
} from './core/adaptiveResolution';
import { config } from './core/config';
import { armReady } from './core/perf';
import { pickQuality } from './core/quality';
import type { QualityName, QualityPreset } from './core/quality';
import { createRenderer, holdRendering, releaseRendering, requestRender, startLoop } from './core/renderer';
import { registerWarmupObject, runLoadingStages } from './scene/loadingStages';
import { aimStepPoses, createCameraRig } from './scene/cameras';
import type { CameraRig, ViewMode } from './scene/cameras';
import { buildOtRoom } from './scene/otRoom';
import type { OtRoom } from './scene/otRoom';
import { createPostFx } from './scene/postfx';
import { applyRealism, setFade, setHeartbeat } from './scene/materials';
import { buildMorphBindings, collectMorphMeshes, updateMorphs } from './scene/morphs';
import type { MorphBindings } from './scene/morphs';
import { ANATOMY } from './content/anatomy';
import type { Anatomy } from './content/anatomy';
import { GUIDED_STEPS } from './content/steps';
import { createGuided } from './sim/guided';
import type { Guided } from './sim/guided';
import { getMode, MODES, onModeChange, setMode } from './sim/modes';
import type { Mode } from './sim/modes';
import { tickSim } from './sim/physiology';
import { readPorts } from './sim/ports';
import { clampRMLReinflate, createState, releaseClamp, setLobe, startOLV } from './sim/state';
import type { AppState, Lobe } from './sim/state';
import type { ProbeResult } from './sim/probe';
import { applyVisibility, createStepVisibility, getStep, STEPS } from './sim/steps';
import { fissureGuideConfig } from './scene/fissureGuide.config';
import { mountGuidedPanel } from './ui/guidedPanel';
import { irisOpen, setOverall, setStage, showError } from './ui/loadingScreen';
import { mountShell } from './ui/shell';
import type { Shell } from './ui/shell';

const params = new URLSearchParams(location.search);
// M3 controls + BVH picking: own chunk (keeps the initial JS in budget), fetched beside the glb download.
const m3Chunk = import('./app/wireM3');
const m4Chunk = import('./app/wireM4'); // M4 instruments + actions, own chunk
const stumpsChunk = import('./scene/stumps'); // T834 division stumps (built at load)
const fissureChunk = import('./scene/fissureGuide'); // T851 step-7 dotted fissure guide (built at load)
const debug = params.has('debug');
const { holdFraction, stages } = config.loading;
// ?view=scope|outside (?scope = legacy alias from T105) and ?step=N (implies a step camera for the scope).
const urlStep = Number(params.get('step'));
const initialStep = STEPS.some((s) => s.step === urlStep) ? urlStep : 0;
const initialView: ViewMode =
  params.get('view') === 'scope' || (!params.has('view') && params.has('scope')) ? 'scope' : 'outside';

declare global {
  interface Window {
    __sim: {
      state: AppState;
      /** RML hilum model manifest (src/content/anatomy.json), for tests. */
      anatomy: Anatomy;
      morphs: MorphBindings | null;
      cmd: {
        startOLV: () => void;
        clamp: () => void;
        release: () => void;
        setLobe: (lobe: Lobe, v: number) => void;
      };
      /** Apply procedure step n (state tweens, hidden set, step camera); instant skips tweens/transition. */
      setStep: (n: number, instant?: boolean) => void;
      setView: (mode: ViewMode, instant?: boolean) => void;
      /** null until the model is loaded. */
      rig: CameraRig | null;
      /** Guided controller (transitioning = fades still running); null until the model is loaded. */
      guided: Guided | null;
      /** M3 controls (scope rig, picking, hotbar, viewing aids); null until the model is loaded. */
      m3: M3 | null;
      /** M4 instruments + surgical actions; null until the model is loaded. */
      m4: M4 | null;
      /** M5 practice run (lazy chunk, wired on the first switch to Practice). */
      m5: M5 | null;
      /** perf:probe scripted run (lazy chunk src/sim/probe.ts); phase(name) tags the stats that follow. */
      probeScript?: (phase: (name: string) => void) => Promise<ProbeResult>;
      /** e2e / probe: select a tool and place it on a target through the first port that works (lazy probe chunk). */
      placeTool?: (id: string, target: string, sub?: string, port?: string) => Promise<string>;
      /** T813 static OT room (outside view only); null until the model is loaded. */
      room: OtRoom | null;
      /** T834 division stumps + staple lines; null until the model is loaded. */
      stumps: Stumps | null;
      /** T851 step-7 fissure guide (segments fired = sim.fissure.fired); null until the model is loaded. */
      fissure: FissureGuide | null;
    };
  }
}

const state = createState();
const sim: Window['__sim'] = {
  state,
  anatomy: ANATOMY,
  morphs: null,
  cmd: {
    startOLV: () => startOLV(state),
    clamp: () => clampRMLReinflate(state),
    release: () => releaseClamp(state),
    setLobe: (lobe, v) => setLobe(state, lobe, v),
  },
  setStep: () => {},
  setView: () => {},
  rig: null,
  guided: null,
  m3: null,
  m4: null,
  m5: null,
  room: null,
  stumps: null,
  fissure: null,
};
window.__sim = sim;

if (params.has('holdload')) {
  // Debug only (screenshots): freeze at the download stage; never loads.
  setStage(stages.download.label, holdFraction);
  setOverall(holdFraction * stages.download.weight);
} else {
  main().catch((e: unknown) =>
    showError(e instanceof Error ? e.message : String(e), {
      onRetry: () => location.reload(),
      onLowQuality: () => {
        const url = new URL(location.href);
        url.searchParams.set('quality', 'low');
        location.assign(url);
      },
    }),
  );
}

function makeRenderer(app: HTMLElement): {
  renderer: ReturnType<typeof createRenderer>;
  name: QualityName;
  preset: QualityPreset;
  locked: boolean;
} {
  // Persisted settings choice; ?quality= still wins. A chosen preset adapts unless locked (or set by URL).
  const choice = loadQualityChoice();
  const locked = choice.locked || params.has('quality');
  if (choice.preset && !params.has('quality')) params.set('quality', choice.preset);
  const { name, preset } = pickQuality(params); // throws if WebGL2 is missing
  window.__perf.preset = name;
  try {
    return { renderer: createRenderer(app, preset), name, preset, locked };
  } catch {
    throw new Error('WebGL2 is not available. Use a current desktop Chrome, Edge, Firefox or Safari.');
  }
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  const { renderer, name, preset, locked } = makeRenderer(app);
  if (params.has('failload')) throw new Error('Forced load failure (?failload).');
  const post = createPostFx(renderer, preset);
  let quality = name;
  const adaptive = new AdaptiveResolution(Math.min(window.devicePixelRatio, preset.maxPixelRatio));
  adaptive.setLocked(locked);
  if (params.has('perf'))
    void import('./ui/perfOverlay').then((m) => m.mountPerfOverlay(() => renderer.getPixelRatio()));
  // Sustained low fps at the minimum ratio: step down one preset via uniforms + ratio ceiling only.
  // ponytail: MSAA / half-res targets keep the load-time preset (changing them needs a reload).
  const downgrade = (): void => {
    quality = nextLowerPreset(quality) ?? quality;
    const p = config.quality.presets[quality];
    window.__perf.preset = quality;
    post.uniforms.uCA.value = p.postFx.chromaticAberration ? config.postfx.chromaticAberration : 0;
    post.uniforms.uGrain.value = p.postFx.grain ? config.postfx.grain : 0;
    adaptive.setMaxRatio(Math.min(window.devicePixelRatio, p.maxPixelRatio)); // clears the request
  };
  const scene = new Scene();
  // viewCamera: the one rendered camera; the rig (created at load) drives its pose for scope + outside views.
  const camera = new PerspectiveCamera(
    config.camera.fovDeg,
    window.innerWidth / window.innerHeight,
    config.camera.near,
    config.camera.far,
  );
  scene.add(camera); // the scope headlight (applyRealism) is its child, so it follows step cams and orbit

  let overlay: HTMLDivElement | null = null;
  if (debug) {
    scene.add(new AxesHelper(config.debug.axesSize));
    overlay = document.createElement('div');
    overlay.id = 'debug-overlay';
    overlay.style.cssText =
      'position:fixed;left:var(--space-2);bottom:var(--space-2);padding:var(--space-1);background:var(--color-surface);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-sm);font:12px/1.4 monospace;white-space:pre;pointer-events:none';
    overlay.textContent = 'loading…';
    app.append(overlay);
  }

  let axisLine = '';
  const showHover = (name: string | null): void => {
    if (overlay) overlay.textContent = `${axisLine}\nhover: ${name ?? '—'}`;
  };

  let vitals: VitalsMonitor | null = null; // T814, lazy chunk wired after "ready"
  let lastNow = 0;
  function frame(now: number): void {
    if (lastNow) applyPixelRatio(renderer, adaptive.update(now - lastNow));
    lastNow = now;
    if (adaptive.downgradeRequested) downgrade();
    tickSim(state, now);
    setHeartbeat(state.heartbeat); // T831 code pulse on the PA tree / RML arteries / pericardium (uniform only)
    vitals?.tick(now);
    sim.rig?.update(now);
    sim.guided?.update(now);
    if (sim.morphs) updateMorphs(sim.morphs, state);
    sim.m3?.update(now);
    sim.m4?.update(now);
    if (sim.m4) sim.fissure?.update(state, sim.m4.finish);
    sim.m5?.update(now);
    sim.stumps?.sync();
  }

  let m5Ctx: M5Context | null = null; // set once M4 is wired
  const mountUi = (g: Guided): Shell => {
    const shell = mountShell(app, setMode);
    mountGuidedPanel(shell, g, GUIDED_STEPS);
    let closePhysiology: (() => void) | null = null;
    onModeChange((m) => {
      shell.setMode(m);
      const m3 = sim.m3;
      if (m === 'practice' && m5Ctx && !sim.m5) {
        const c = m5Ctx;
        void import('./app/wireM5').then((p) => (sim.m5 ??= p.wireM5(c)));
      }
      if (m === 'quiz' && m3) {
        const gate = { holdRendering, releaseRendering, requestRender };
        void import('./app/wireM6').then((q) => q.enterQuiz({ host: shell.inspector, m3, ...gate }));
      }
      if (m !== 'physiology') {
        closePhysiology?.();
        closePhysiology = null;
        return;
      }
      void import('./ui/physiologyPanel').then(({ mountPhysiologyPanel }) => {
        if (getMode() === 'physiology' && !closePhysiology)
          closePhysiology = mountPhysiologyPanel(shell.inspector, sim);
      });
    });
    return shell;
  };

  const [{ wireM3 }, { wireM4 }, { buildStumps }, { buildFissureGuide }] = await Promise.all([
    m3Chunk,
    m4Chunk,
    stumpsChunk,
    fissureChunk,
  ]);
  const { axis } = await runLoadingStages(
    renderer,
    scene,
    camera,
    (gltf) => {
      const m = gltf.scene;
      scene.add(m);
      registerWarmupObject(applyRealism(scene, renderer, camera, m)); // X-ray variants compile in stage 4
      sim.morphs = buildMorphBindings(collectMorphMeshes(m));
      // T813: theatre fitted around the unmoved patient's skin, in the scene before the compile stage.
      const room = (sim.room = buildOtRoom(scene, new Box3().setFromObject(m.getObjectByName('skin') ?? m)));
      const v = createStepVisibility((name) => m.getObjectByName(name));
      applyVisibility(v, state); // default_hidden
      const r = (sim.rig = createCameraRig(
        camera,
        renderer.domElement,
        m.getObjectByName('thorax_root') ?? m,
        gltf.cameras,
        post.uniforms.uScopeMode,
        (mode) => {
          v.scope = mode === 'scope';
          room.setVisible(mode === 'outside');
          applyVisibility(v, state);
          sim.m3?.reapplyLayers();
        },
      ));
      aimStepPoses(r, m, readPorts(m)); // T830: steps 2–5 aimed from their port at the hilum
      const g = (sim.guided = createGuided({
        vis: v,
        state,
        setCamera: (cam, instant) => r.setScopeCamera(cam, instant),
        setFade: (o, a) => setFade(o as Mesh, a), // non-mesh nodes have no variants: they switch at the end
      }));
      sim.setStep = (n, instant = false) => g.goTo(n, instant);
      sim.setView = (mode, instant = false) => r.setView(mode, instant);
      sim.setStep(initialStep || config.steps.defaultStep, true); // guided is the default mode
      sim.setView(initialView, true);
      r.update(0);
      sim.probeScript = (phase) => import('./sim/probe').then((p) => p.runProbeScript(sim, scene, phase));
      sim.placeTool = (...a) => import('./sim/probe').then((p) => p.placeTool(sim, scene, ...a));
      const shell = mountUi(g); // under the loading screen until the iris opens
      const ui = {
        app,
        canvas: renderer.domElement,
        model: m,
        camera,
        rig: r,
        guided: g,
        state,
        vis: v,
        shell,
      };
      const ctx = { ...ui, setView: (mode: ViewMode) => sim.setView(mode), onHover: showHover };
      const m3 = (sim.m3 = wireM3(ctx));
      const m4 = (sim.m4 = wireM4({ ...ctx, m3, scene, renderer, preset, fog: post.uniforms.uFog }));
      // After picking (stumps are not pickable), before the compile stage (titanium program compiles at load).
      sim.stumps = buildStumps(m);
      const fg = (sim.fissure = buildFissureGuide(
        m,
        r.scopePoseOf(getStep(fissureGuideConfig.step).camera).position,
      ));
      m4.fissure = fg; // T853: the user's stapler seats on its next segment
      scene.add(fg.group);
      registerWarmupObject(fg.group);
      m5Ctx = { ...ui, m3, m4, gain: post.uniforms.uGain, setStep: sim.setStep, setView: sim.setView };
    },
    preset.textureDownscale,
  );
  axisLine = axis;
  showHover(null);
  // Visible loop only after all five stages; "ready" once the lens has opened.
  startLoop(renderer, camera, frame, (now) => {
    post.render(scene, camera, now);
    sim.m4?.afterRender();
  });
  await irisOpen();
  armReady();
  void import('./app/wireM7').then(({ wireVitals }) => {
    const room = sim.room;
    vitals = wireVitals({ state, host: app });
    if (room) vitals.addMirror(room.screenCanvas, () => room.markScreenDirty());
  });
  const startMode = params.get('mode'); // ?mode=practice (practice retry reloads into a fresh case)
  if ((MODES as readonly string[]).includes(startMode ?? '')) setMode(startMode as Mode);
}
