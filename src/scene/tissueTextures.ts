// T824 procedural tissue detail (CONTEXT §8, §6.10): one tileable, mip-mapped RGBA8 DataArrayTexture generated ONCE
// at load (deterministic seed, typed-array loops), one layer per family (tissueTextures.config.ts FAMILIES), sampled
// TRIPLANAR in the rest-pose object space so the pattern sticks to tissue through morphs (the glb UVs are patchy).
//
// Wiring (materials.ts patch; texture presence fixed from load, only uniform values change after ready):
//  1. `const detail = buildTissueDetailTexture()` once in applyMaterials; bind `uTissueDetail: { value: detail }` in
//     every tissue program's uniforms (shared object, like graspUniforms), so every program has the sampler.
//  2. Vertex: after `void main() {`: `vTissueRestPos = position * uRestScale; vTissueRestN = normal / uRestScale;`
//     — the PRE-morph attributes, so detail stays glued to the tissue; uRestScale = the mesh's world scale (the glb
//     positions are quantised, so object units differ per mesh) → metres.
//  3. Fragment pars: prepend TISSUE_DETAIL_PARS (declares the sampler + tissueDetail/tissueBump).
//  4. Fragment: call `vec4 td = tissueDetail(vTissueRestPos, normalize(vTissueRestN), scale, family)` in uniform
//     control flow (it takes derivatives) — e.g. at the top of the MAP replacement; scale/family/strengths come from
//     per-class uniforms (family as a float uniform cast to int). td.z = albedo detail (0.5 neutral), td.w = mask.
//  5. After normal_fragment_begin (and the normalFix blend): `normal = tissueBump(-vViewPosition, normal, td.xy, k)`
//     with k = relief as a fraction of tile size; it uses screen derivatives, so no tangents/normalMatrix needed.
import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping } from 'three';
import { FAMILIES, tissueTex as C } from './tissueTextures.config';
import type { Capillaries } from './tissueTextures.config';

/** Integer lattice hash → [0, 1). Shared with materials.ts buildNoiseTexture. */
export function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Periodic value-noise fBm in [0,1] over an S×S tile; cx×cy lattice cells at octave 0 (anisotropic allowed). */
function fbm(out: Float32Array, S: number, cx: number, cy: number, octaves: number, seed: number): void {
  out.fill(0);
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const nx = cx << o;
    const ny = cy << o;
    const amp = 0.5 ** o;
    norm += amp;
    const lat = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) lat[j * nx + i] = hash(i, j, seed + o * 7919);
    const ixs = new Int32Array(S);
    const x1s = new Int32Array(S);
    const txs = new Float32Array(S);
    for (let x = 0; x < S; x++) {
      const fx = (x / S) * nx;
      const ix = Math.floor(fx);
      ixs[x] = ix;
      x1s[x] = (ix + 1) % nx;
      txs[x] = (fx - ix) * (fx - ix) * (3 - 2 * (fx - ix));
    }
    for (let y = 0; y < S; y++) {
      const fy = (y / S) * ny;
      const iy = Math.floor(fy);
      const ty = (fy - iy) * (fy - iy) * (3 - 2 * (fy - iy));
      const r0 = iy * nx;
      const r1 = ((iy + 1) % ny) * nx;
      for (let x = 0; x < S; x++) {
        const ix = ixs[x] ?? 0;
        const x1 = x1s[x] ?? 0;
        const tx = txs[x] ?? 0;
        const a = (lat[r0 + ix] ?? 0) + ((lat[r0 + x1] ?? 0) - (lat[r0 + ix] ?? 0)) * tx;
        const b = (lat[r1 + ix] ?? 0) + ((lat[r1 + x1] ?? 0) - (lat[r1 + ix] ?? 0)) * tx;
        out[y * S + x] = (out[y * S + x] ?? 0) + amp * (a + (b - a) * ty);
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / norm;
}

/** Periodic Worley: F1, F2 (cell units) and nearest-cell id on a W×W grid (3×3 search; F2 exact for jitter ≲ 0.8). */
function worley(
  S: number,
  W: number,
  seed: number,
  f1: Float32Array,
  f2: Float32Array,
  id: Int32Array,
): void {
  const pts = new Float32Array(W * W * 2);
  for (let j = 0; j < W; j++)
    for (let i = 0; i < W; i++) {
      pts[(j * W + i) * 2] = 0.5 + C.worleyJitter * (hash(i, j, seed) - 0.5);
      pts[(j * W + i) * 2 + 1] = 0.5 + C.worleyJitter * (hash(j, i, seed ^ 0x5bd1) - 0.5);
    }
  const wrap = new Int32Array(W + 2); // wrap[k] = (k − 1) mod W
  for (let k = 0; k < W + 2; k++) wrap[k] = (k - 1 + W) % W;
  for (let y = 0; y < S; y++) {
    const py = (y / S) * W;
    const gy = Math.floor(py);
    for (let x = 0; x < S; x++) {
      const px = (x / S) * W;
      const gx = Math.floor(px);
      let d1 = 9;
      let d2 = 9;
      let best = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const cy = gy + dy;
        const row = (wrap[cy + 1] ?? 0) * W;
        for (let dx = -1; dx <= 1; dx++) {
          const cx = gx + dx;
          const c = row + (wrap[cx + 1] ?? 0);
          const ex = cx + (pts[c * 2] ?? 0) - px;
          const ey = cy + (pts[c * 2 + 1] ?? 0) - py;
          const d = ex * ex + ey * ey;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = c;
          } else if (d < d2) d2 = d;
        }
      }
      const i = y * S + x;
      f1[i] = Math.sqrt(d1);
      f2[i] = Math.sqrt(d2);
      id[i] = best;
    }
  }
}

/** Contour-line capillaries of a periodic fBm: out = max(out, weight · line), line ≈ constant width in texels. */
function capillaries(
  out: Float32Array,
  n: Float32Array,
  S: number,
  c: Capillaries,
  seed: number,
  weight: number,
): void {
  fbm(n, S, c.cells, c.cells, c.octaves, seed);
  for (let y = 0; y < S; y++) {
    const up = ((y + S - 1) % S) * S;
    const dn = ((y + 1) % S) * S;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const gx = ((n[y * S + ((x + 1) % S)] ?? 0) - (n[y * S + ((x + S - 1) % S)] ?? 0)) * 0.5;
      const gy = ((n[dn + x] ?? 0) - (n[up + x] ?? 0)) * 0.5;
      const d = Math.abs((n[i] ?? 0) - 0.5) / (Math.sqrt(gx * gx + gy * gy) + 1e-6);
      const line = weight * Math.max(0, 1 - d / c.widthPx);
      if (line > (out[i] ?? 0)) out[i] = line;
    }
  }
}

/** Bilinear wrap lookup in texel units. */
function sampleWrap(f: Float32Array, S: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = x - ix;
  const ty = y - iy;
  const x0 = ((ix % S) + S) % S;
  const y0 = (((iy % S) + S) % S) * S;
  const x1 = (x0 + 1) % S;
  const y1 = ((y0 / S + 1) % S) * S;
  const a = (f[y0 + x0] ?? 0) + ((f[y0 + x1] ?? 0) - (f[y0 + x0] ?? 0)) * tx;
  const b = (f[y1 + x0] ?? 0) + ((f[y1 + x1] ?? 0) - (f[y1 + x0] ?? 0)) * tx;
  return a + (b - a) * ty;
}

interface Scratch {
  h: Float32Array; // height (tile units, 0..1)
  alb: Float32Array; // albedo detail (0.5 neutral)
  m: Float32Array; // mask
  n: Float32Array;
  t: Float32Array;
  f1: Float32Array;
  f2: Float32Array;
  id: Int32Array;
}

function vessel(s: Scratch, S: number, seed: number): void {
  const v = C.vessel;
  fbm(s.t, S, v.mottleCells, v.mottleCells, v.mottleOctaves, seed);
  s.m.fill(0);
  capillaries(s.m, s.n, S, v.caps, seed + 1, 1);
  capillaries(s.m, s.n, S, v.fineCaps, seed + 2, v.fineWeight);
  for (let i = 0; i < S * S; i++) {
    s.alb[i] = 0.5 + v.mottleAmp * ((s.t[i] ?? 0) - 0.5);
    s.h[i] = (1 - v.capHeight) * (s.t[i] ?? 0) + v.capHeight * (s.m[i] ?? 0);
  }
}

function fat(s: Scratch, S: number, seed: number): void {
  const p = C.fat;
  worley(S, p.cells, seed, s.f1, s.f2, s.id);
  s.m.fill(0);
  capillaries(s.m, s.n, S, p.caps, seed + 1, 1);
  for (let i = 0; i < S * S; i++) {
    const e = (s.f2[i] ?? 0) - (s.f1[i] ?? 0);
    const septa = 1 - ss(0, p.septaPx, e);
    const centre = 1 - ss(0, p.centreFalloff, s.f1[i] ?? 0);
    const jit = (hash(s.id[i] ?? 0, 0, seed) - 0.5) * 2 * p.cellJitter;
    s.alb[i] = 0.5 + p.centreBright * (centre - 0.5) - p.septaDark * septa + jit;
    s.h[i] = ss(0, p.bulge, e);
    s.m[i] = (s.m[i] ?? 0) * (1 - ss(0, p.capsNearSepta, e));
  }
}

function pleura(s: Scratch, S: number, seed: number): void {
  const p = C.pleura;
  fbm(s.t, S, p.grainCells[0], p.grainCells[1], p.grainOctaves, seed);
  s.m.fill(0);
  capillaries(s.m, s.n, S, p.caps, seed + 1, 1);
  fbm(s.n, S, p.gateCells, p.gateCells, 1, seed + 2); // low-frequency gate: capillaries only in some patches
  for (let i = 0; i < S * S; i++) {
    s.alb[i] = 0.5 + p.grainAmp * ((s.t[i] ?? 0) - 0.5);
    s.h[i] = s.t[i] ?? 0;
    s.m[i] = (s.m[i] ?? 0) * ss(1 - p.capsDensity - p.gateSoft, 1 - p.capsDensity + p.gateSoft, s.n[i] ?? 0);
  }
}

function lung(s: Scratch, S: number, seed: number): void {
  const p = C.lung;
  worley(S, p.cells, seed, s.f1, s.f2, s.id);
  fbm(s.n, S, p.mottleCells, p.mottleCells, p.mottleOctaves, seed + 1);
  for (let i = 0; i < S * S; i++) {
    const e = (s.f2[i] ?? 0) - (s.f1[i] ?? 0);
    const border = 1 - ss(0, p.edgePx, e);
    s.alb[i] = 0.5 + p.mottleAmp * ((s.n[i] ?? 0) - 0.5) - p.edgeDark * border;
    s.h[i] = ss(0, p.bulge, e);
    s.t[i] = 1 - ss(0, p.dotBorderPx, e); // near-border weight for dot clustering
  }
  // Anthracotic dots: splat the kept candidates of a dotCells² jittered grid (cheaper than a second Worley pass).
  s.m.fill(0);
  const W = p.dotCells;
  const [r0, r1] = p.dotRadius;
  const px = S / W; // texels per dot cell
  for (let j = 0; j < W; j++)
    for (let i = 0; i < W; i++) {
      const cx = (i + hash(i, j, seed + 2)) * px;
      const cy = (j + hash(j, i, seed + 3)) * px;
      const near = s.t[(Math.floor(cy) % S) * S + (Math.floor(cx) % S)] ?? 0;
      if (hash(i, j, seed + 4) >= p.dotKeep * (p.dotFloor + (1 - p.dotFloor) * near)) continue;
      const r = (r0 + (r1 - r0) * hash(i, j, seed + 5)) * px;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const v = 1 - ss(r * 0.5, r, Math.hypot(x - cx, y - cy));
          const k = (((y % S) + S) % S) * S + (((x % S) + S) % S);
          if (v > (s.m[k] ?? 0)) s.m[k] = v;
        }
    }
}

function bronchus(s: Scratch, S: number, seed: number): void {
  const p = C.bronchus;
  fbm(s.t, S, p.grainCells, p.grainCells, p.grainOctaves, seed);
  fbm(s.n, S, p.jitterCells, p.jitterCells, 1, seed + 1);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const phase = (y / S) * p.rings + p.ringJitter * p.rings * 2 * ((s.n[i] ?? 0) - 0.5);
      s.alb[i] = 0.5 + p.grainAmp * ((s.t[i] ?? 0) - 0.5);
      s.h[i] = s.t[i] ?? 0;
      s.m[i] = ss(p.ringSharp[0], p.ringSharp[1], 0.5 + 0.5 * Math.cos(2 * Math.PI * phase));
    }
}

function blood(s: Scratch, S: number, seed: number): void {
  const p = C.blood;
  fbm(s.n, S, p.cells, p.cells, p.octaves, seed);
  fbm(s.t, S, p.cells, p.cells, 1, seed + 1); // warp x
  fbm(s.h, S, p.cells, p.cells, 1, seed + 2); // warp y (h is overwritten below)
  const w = p.warp * S * 2;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      s.f1[i] = sampleWrap(s.n, S, x + w * ((s.t[i] ?? 0) - 0.5), y + w * ((s.h[i] ?? 0) - 0.5));
    }
  for (let i = 0; i < S * S; i++) {
    const v = s.f1[i] ?? 0;
    s.alb[i] = ss(p.smear[0], p.smear[1], v);
    s.m[i] = ss(p.clot[0], p.clot[1], v);
    s.h[i] = p.height * (s.alb[i] ?? 0);
  }
}

const BUILDERS = { vessel, fat, pleura, lung, bronchus, blood };

/** All layers as one RGBA8 buffer (layer-major, S×S×4 each). Deterministic for a given config. */
export function generateTissueDetail(S = C.size): Uint8Array {
  const n = S * S;
  const f = (): Float32Array => new Float32Array(n);
  const s: Scratch = { h: f(), alb: f(), m: f(), n: f(), t: f(), f1: f(), f2: f(), id: new Int32Array(n) };
  const data = new Uint8Array(n * 4 * FAMILIES.length);
  const out = new Uint8ClampedArray(data.buffer); // clamps + rounds on write
  const g = S / 2 / C.gradRange; // central difference → dH/du (tile units) → ±1 at gradRange
  const xl = new Int32Array(S);
  const xr = new Int32Array(S);
  for (let x = 0; x < S; x++) [xl[x], xr[x]] = [(x + S - 1) % S, (x + 1) % S];
  FAMILIES.forEach((fam, layer) => {
    BUILDERS[fam](s, S, C.seed + layer * 101);
    const base = layer * n * 4;
    for (let y = 0; y < S; y++) {
      const up = ((y + S - 1) % S) * S;
      const dn = ((y + 1) % S) * S;
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const o = base + i * 4;
        out[o] = 127.5 + 127.5 * g * ((s.h[y * S + (xr[x] ?? 0)] ?? 0) - (s.h[y * S + (xl[x] ?? 0)] ?? 0));
        out[o + 1] = 127.5 + 127.5 * g * ((s.h[dn + x] ?? 0) - (s.h[up + x] ?? 0));
        out[o + 2] = 255 * (s.alb[i] ?? 0);
        out[o + 3] = 255 * (s.m[i] ?? 0);
      }
    }
  });
  return data;
}

/** The shared detail texture: RepeatWrapping, trilinear mips. Build once at load, before the compile stage. */
export function buildTissueDetailTexture(): DataArrayTexture {
  const S = C.size;
  const tex = new DataArrayTexture(generateTissueDetail(S), S, S, FAMILIES.length);
  tex.name = 'tissueDetail';
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const k = C.triplanarSharpness.toFixed(1);
const r = C.gradRange.toFixed(1);
/**
 * GLSL (fragment pars). tissueDetail: triplanar sample of layer `family` with `scale` tiles per object unit, in
 * rest-pose object space → vec4(dH/dx, dH/dy per screen pixel [height in tile-size units, so scale cancels],
 * albedo detail, mask). Call in uniform control flow. tissueBump: surface-gradient bump (Mikkelsen) of a view-space
 * normal; strength = relief as a fraction of tile size.
 */
export const TISSUE_DETAIL_PARS = /* glsl */ `
uniform highp sampler2DArray uTissueDetail;
vec4 tissueDetail( vec3 pObj, vec3 nObj, float scale, int family ) {
	vec3 w = pow( abs( nObj ), vec3( ${k} ) );
	w /= w.x + w.y + w.z + 1e-5;
	vec3 p = pObj * scale;
	float layer = float( family );
	vec4 tx = texture( uTissueDetail, vec3( p.yz, layer ) );
	vec4 ty = texture( uTissueDetail, vec3( p.zx, layer ) );
	vec4 tz = texture( uTissueDetail, vec3( p.xy, layer ) );
	vec2 gx = ( tx.rg * 2.0 - 1.0 ) * ${r};
	vec2 gy = ( ty.rg * 2.0 - 1.0 ) * ${r};
	vec2 gz = ( tz.rg * 2.0 - 1.0 ) * ${r};
	vec3 dpx = dFdx( pObj );
	vec3 dpy = dFdy( pObj );
	return vec4(
		w.x * dot( gx, dpx.yz ) + w.y * dot( gy, dpx.zx ) + w.z * dot( gz, dpx.xy ),
		w.x * dot( gx, dpy.yz ) + w.y * dot( gy, dpy.zx ) + w.z * dot( gz, dpy.xy ),
		dot( w, vec3( tx.b, ty.b, tz.b ) ),
		dot( w, vec3( tx.a, ty.a, tz.a ) ) );
}
vec3 tissueBump( vec3 viewPos, vec3 n, vec2 dH, float strength ) {
	vec3 dpx = dFdx( viewPos );
	vec3 dpy = dFdy( viewPos );
	vec3 r1 = cross( dpy, n );
	vec3 r2 = cross( n, dpx );
	float det = dot( dpx, r1 );
	return normalize( abs( det ) * n - strength * sign( det ) * ( dH.x * r1 + dH.y * r2 ) );
}
`;
