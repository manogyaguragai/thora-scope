// Single combined post-FX pass (§6.10, §8 Optics): scene → HDR target → one full-screen pass to the canvas.
// ponytail: FullScreenQuad + one HDR target instead of EffectComposer (its ping-pong pair would be a second unused
// full-res half-float target for a two-pass chain). Swap in EffectComposer if a real pass chain ever appears.
import { HalfFloatType, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderTarget } from 'three';
import type { Camera, IUniform, Scene, Texture, WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { config } from '../core/config';
import type { QualityPreset } from '../core/quality';
import { setWarmupTarget, registerWarmupHook } from './loadingStages';
import { lumFrag, postFrag, quadVert } from './postfx.glsl';

const C = config.postfx;
const AE = C.autoExposure;
const size = new Vector2(); // drawing-buffer size, reused every frame
const sceneSize = new Vector2(); // HDR scene target size (drawing buffer × preset scale), reused every frame

export interface PostFx {
  /** Render scene through the scope optics to the canvas. Once per frame. */
  render(scene: Scene, camera: Camera, now: number): void;
  /** uScopeMode (0 outside, 1 scope), uFog (0…1, cautery smoke haze) etc. — drive effects here, never via defines. */
  uniforms: PostUniforms;
}
export type PostUniforms = ReturnType<typeof makeUniforms>;

function makeUniforms(scene: Texture, preset: QualityPreset) {
  return {
    tScene: { value: scene },
    uRes: { value: new Vector2().copy(size) },
    uScopeMode: { value: 0 },
    uTime: { value: 0 },
    uExposure: { value: C.exposure as number },
    uK1: { value: preset.postFx.distortion ? C.barrelK1 : 0 },
    uK2: { value: preset.postFx.distortion ? C.barrelK2 : 0 },
    uMaskAspect: { value: C.maskAspect },
    uMaskFill: { value: C.maskFill },
    uMaskRadius: { value: C.maskCornerRadius },
    uMaskFeather: { value: C.maskFeather },
    uVignette: { value: C.vignette },
    uVignetteStart: { value: C.vignetteStart },
    uCA: { value: preset.postFx.chromaticAberration ? C.chromaticAberration : 0 },
    uGrain: { value: preset.postFx.grain ? C.grain : 0 },
    uFog: { value: 0 },
    uFogColor: { value: new Vector3(...C.fogColor) },
    uLift: { value: new Vector3(...C.lift) },
    uGamma: { value: new Vector3(...C.gamma) },
    uGain: { value: new Vector3(...C.gain) },
    uSaturation: { value: C.saturation },
    uTexel: { value: new Vector2() }, // one scene-target texel in uv (edge AA taps)
    uAA: {
      value: new Vector4(C.edgeAA.amount, C.edgeAA.threshold, C.edgeAA.relThreshold, C.edgeAA.spanTexels),
    },
    uGlint: { value: new Vector3(C.glint.lo, C.glint.hi, C.glint.amount) },
  };
}

const quadMaterial = (uniforms: Record<string, IUniform>, fragmentShader: string): ShaderMaterial =>
  new ShaderMaterial({
    uniforms,
    vertexShader: quadVert,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false, // tone mapping + sRGB encode happen inside postFrag
  });

export function createPostFx(renderer: WebGLRenderer, preset: QualityPreset): PostFx {
  // sceneScale < 1: the scene renders into a smaller HDR target; the combined pass upsamples it (bilinear + edge AA).
  // Scale is fixed at load (the preset's); the target only resizes when the drawing buffer does (resize/pixel ratio).
  const scale = preset.postFx.sceneScale;
  const sceneSizeOf = (v: Vector2): Vector2 =>
    sceneSize.set(Math.max(1, Math.round(v.x * scale)), Math.max(1, Math.round(v.y * scale)));
  renderer.getDrawingBufferSize(size);
  sceneSizeOf(size);
  const target = new WebGLRenderTarget(sceneSize.x, sceneSize.y, {
    type: HalfFloatType,
    samples: preset.antialias ? C.msaaSamples : 0,
  });
  setWarmupTarget(target);

  const uniforms = makeUniforms(target.texture, preset);
  uniforms.uTexel.value.set(1 / sceneSize.x, 1 / sceneSize.y);
  const quad = new FullScreenQuad(quadMaterial(uniforms, postFrag));

  // Auto-exposure: tiny log-luminance meter, read back asynchronously ≤ AE.hz; exposure eases toward the target.
  const meterTarget = new WebGLRenderTarget(AE.size, AE.size);
  const meterPixels = new Uint8Array(AE.size * AE.size * 4);
  const meter = new FullScreenQuad(
    quadMaterial(
      {
        tScene: { value: target.texture },
        uCell: { value: new Vector2(1 / AE.size, 1 / AE.size) },
        uMinLog2: { value: AE.minLog2 },
        uRangeLog2: { value: AE.maxLog2 - AE.minLog2 },
      },
      lumFrag,
    ),
  );
  const meterMs = 1000 / AE.hz;
  let exposure = 1;
  let exposureTarget = 1;
  let lastMeter = -Infinity;
  let lastNow = 0;
  let pending = false;
  const onMeter = (): void => {
    pending = false;
    let sum = 0;
    for (let i = 0; i < meterPixels.length; i += 4) sum += meterPixels[i] as number;
    const log2Avg = AE.minLog2 + (sum / ((meterPixels.length / 4) * 255)) * (AE.maxLog2 - AE.minLog2);
    exposureTarget = Math.min(AE.max, Math.max(AE.min, AE.key / 2 ** log2Avg));
  };
  const onMeterFail = (): void => {
    pending = false;
  };

  function drawMeter(): void {
    renderer.setRenderTarget(meterTarget);
    meter.render(renderer);
  }

  registerWarmupHook((r) => {
    // Compiles the meter + post programs (mode is a uniform, so both modes share one program).
    drawMeter();
    r.setRenderTarget(null);
    const mode = uniforms.uScopeMode.value; // set by the camera rig before warm-up; restore it
    for (const m of [1, 0]) {
      uniforms.uScopeMode.value = m;
      quad.render(r);
    }
    uniforms.uScopeMode.value = mode;
  });

  return {
    uniforms,
    render(scene, camera, now) {
      renderer.getDrawingBufferSize(size);
      if (!size.equals(uniforms.uRes.value)) {
        sceneSizeOf(size);
        target.setSize(sceneSize.x, sceneSize.y);
        uniforms.uTexel.value.set(1 / sceneSize.x, 1 / sceneSize.y);
        uniforms.uRes.value.copy(size); // output (canvas) pixels: mask, vignette and grain stay full-res
      }
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      if (!pending && now - lastMeter >= meterMs) {
        lastMeter = now;
        pending = true;
        drawMeter();
        renderer
          .readRenderTargetPixelsAsync(meterTarget, 0, 0, AE.size, AE.size, meterPixels)
          .then(onMeter, onMeterFail);
      }
      const dt = lastNow ? now - lastNow : 0;
      lastNow = now;
      exposure += (exposureTarget - exposure) * (1 - Math.exp(-dt / AE.adaptMs));
      uniforms.uExposure.value = C.exposure * exposure;
      uniforms.uTime.value = (now / 1000) % C.grainPeriodS;
      renderer.setRenderTarget(null);
      quad.render(renderer);
    },
  };
}
