// Shader strings for the single combined post-FX pass (§6.10, §8 Optics) and the tiny auto-exposure meter.

export const quadVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** 16×16 meter: each texel averages a 2×2 grid of scene taps; log2 luminance packed into R (RGBA8 read-back). */
export const lumFrag = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uCell; // one meter texel in scene uv
uniform float uMinLog2;
uniform float uRangeLog2;
varying vec2 vUv;
float lum(vec2 uv) { return dot(texture2D(tScene, uv).rgb, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec2 q = uCell * 0.25;
  float l = log2(1e-5 + lum(vUv + vec2(-q.x, -q.y))) + log2(1e-5 + lum(vUv + vec2(q.x, -q.y)))
          + log2(1e-5 + lum(vUv + vec2(-q.x, q.y))) + log2(1e-5 + lum(vUv + vec2(q.x, q.y)));
  gl_FragColor = vec4(clamp((0.25 * l - uMinLog2) / uRangeLog2, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

/**
 * Scope optics in one pass. uScopeMode 0 = outside view (exposure + ACES + sRGB only); 1 = thoracoscope
 * (barrel distortion, chromatic aberration, lens fog, vignette, grade, grain, 5:4 rounded-rect mask). Pure uniforms:
 * switching modes or quality never recompiles.
 */
export const postFrag = /* glsl */ `
#include <tonemapping_pars_fragment>
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uScopeMode;
uniform float uTime;
uniform float uExposure;
uniform float uK1;
uniform float uK2;
uniform float uMaskAspect;
uniform float uMaskFill;
uniform float uMaskRadius;
uniform float uMaskFeather;
uniform float uVignette;
uniform float uVignetteStart;
uniform float uCA;
uniform float uGrain;
uniform float uFog;
uniform float uFogRadius;
uniform vec3 uFogColor;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSaturation;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  float s = uScopeMode;
  // Mask rect: 5:4, letterboxed into the viewport, in pixels around the centre.
  vec2 px = (vUv - 0.5) * uRes;
  float h = uMaskFill * min(uRes.y, uRes.x / uMaskAspect);
  vec2 hs = 0.5 * vec2(h * uMaskAspect, h);
  // Barrel distortion normalised so the rect corners stay put (centre magnified, edges bow).
  vec2 d = px / length(hs);
  float r2 = dot(d, d);
  float k = (1.0 + s * (uK1 * r2 + uK2 * r2 * r2)) / (1.0 + s * (uK1 + uK2));
  vec2 dir = px / uRes;
  vec2 ca = dir * (s * uCA * r2);
  vec2 uv = 0.5 + dir * k;
  vec3 col = vec3(texture2D(tScene, uv + ca).r, texture2D(tScene, uv).g, texture2D(tScene, uv - ca).b);
  // Lens fog: milky, blurred veil from a few taps (M5 drives uFog).
  if (uFog > 0.0) {
    vec2 o = vec2(uFogRadius, uFogRadius * uRes.x / uRes.y);
    vec3 blur = 0.25 * (texture2D(tScene, uv + o).rgb + texture2D(tScene, uv - o).rgb
      + texture2D(tScene, uv + vec2(o.x, -o.y)).rgb + texture2D(tScene, uv + vec2(-o.x, o.y)).rgb);
    col = mix(col, mix(blur, uFogColor * dot(blur, vec3(0.333)), 0.5), uFog * s);
  }
  col = ACESFilmicToneMapping(col * uExposure);
  // Grade (display-linear): lift / gamma / gain, saturation.
  vec3 g = uGain * (col + uLift * (1.0 - col));
  g = pow(max(g, 0.0), 1.0 / uGamma);
  g = mix(vec3(dot(g, vec3(0.2126, 0.7152, 0.0722))), g, uSaturation);
  col = mix(col, clamp(g, 0.0, 1.0), s);
  // Vignette (corner of the rect = 1.4142), grain after encode (near-zero per frames).
  col *= 1.0 - s * uVignette * smoothstep(uVignetteStart, 1.4142, length(px / hs));
  col = sRGBTransferOETF(vec4(col, 1.0)).rgb + s * uGrain * (hash(vUv * uRes + uTime) - 0.5);
  // Rounded-rect signed distance (px), soft edge inside; black outside.
  vec2 q = abs(px) - hs + uMaskRadius * h;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uMaskRadius * h;
  gl_FragColor = vec4(col * mix(1.0, 1.0 - smoothstep(-uMaskFeather * h, 0.0, sd), s), 1.0);
}
`;
