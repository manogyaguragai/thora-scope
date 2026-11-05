// T825: procedural instrument textures, generated ONCE at load from a seeded LCG (deterministic), mip-mapped, never
// rebuilt or swapped (§6.10). Every opaque instrument material binds the same three slots → one shared program:
//   map          RGB = albedo modulator (× material colour), A = soil mask (low texels soil first, see instruments.ts)
//   roughnessMap G   = roughness modulator (× material roughness), RG8
//   normalMap    tangent-space normals from a periodic height field (derivative TBN, no tangents needed)
// Sets: brushed + scratched steel, insulation grain + scuffs, woven gauze + loose fibres, stapler cartridge pockets.
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGFormat,
  RGBAFormat,
  RepeatWrapping,
} from 'three';
import type { PixelFormat } from 'three';
import { instrumentTex as T } from './instruments.config';

export interface TexSet {
  readonly map: DataTexture;
  readonly roughnessMap: DataTexture;
  readonly normalMap: DataTexture;
}
export interface InstrumentTextures {
  readonly steel: TexSet;
  readonly shaft: TexSet;
  readonly gauze: TexSet;
  readonly cartridge: TexSet;
}

type Field = Float32Array;
interface Layers {
  w: number;
  h: number;
  albedo: Field;
  rough: Field;
  height: Field;
  mask: Field;
}
type Rnd = () => number;

const rng = (seed: number): Rnd => {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
};
const wrap = (i: number, n: number): number => ((i % n) + n) % n;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const layers = (w: number, h: number, albedo: number, rough: number): Layers => ({
  w,
  h,
  albedo: new Float32Array(w * h).fill(albedo),
  rough: new Float32Array(w * h).fill(rough),
  height: new Float32Array(w * h),
  mask: new Float32Array(w * h).fill(1),
});

/** Tileable value-noise fBm in 0…1: smoothstep-interpolated `cells`² lattice, doubling per octave. */
function fbm(w: number, h: number, cells: number, octaves: number, rnd: Rnd): Field {
  const out = new Float32Array(w * h);
  let amp = 1;
  let total = 0;
  for (let o = 0, c = cells; o < octaves; o++, c *= 2, amp /= 2) {
    const lat = Float32Array.from({ length: c * c }, rnd);
    const at = (x: number, y: number): number => lat[wrap(y, c) * c + wrap(x, c)] ?? 0;
    for (let y = 0; y < h; y++) {
      const gy = (y / h) * c;
      const iy = Math.floor(gy);
      const sy = smooth(0, 1, gy - iy);
      for (let x = 0; x < w; x++) {
        const gx = (x / w) * c;
        const ix = Math.floor(gx);
        const sx = smooth(0, 1, gx - ix);
        const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
        const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
        out[y * w + x] = (out[y * w + x] ?? 0) + amp * (a + (b - a) * sy);
      }
    }
    total += amp;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / total;
  return out;
}

/** Remap a field to span 0…1 (soil masks: `amount` then reads as roughly the covered fraction). */
function stretch(f: Field): Field {
  let [lo, hi] = [Infinity, -Infinity];
  for (const v of f) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
  return f.map((v) => (v - lo) / (hi - lo || 1));
}

/** Wandering stroke (scratch, scuff, fibre): visits every wrapped texel along a path with drifting heading. */
function stroke(
  L: Layers,
  rnd: Rnd,
  ang: number,
  len: number,
  curl: number,
  visit: (i: number) => void,
): void {
  let x = rnd() * L.w;
  let y = rnd() * L.h;
  for (let t = 0; t < len; t += 0.5) {
    visit(wrap(Math.floor(y), L.h) * L.w + wrap(Math.floor(x), L.w));
    ang += (rnd() - 0.5) * curl;
    x += Math.cos(ang) * 0.5;
    y += Math.sin(ang) * 0.5;
  }
}

function texture(data: Uint8Array, w: number, h: number, format: PixelFormat): DataTexture {
  const t = new DataTexture(data, w, h, format);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = T.anisotropy;
  t.needsUpdate = true;
  return t;
}

/** Layers → the three textures; normals from central differences of the (wrapped) height field × `gain`. */
function pack(L: Layers, gain: number): TexSet {
  const { w, h, height: H } = L;
  const n = w * h;
  const map = new Uint8Array(n * 4);
  const rough = new Uint8Array(n * 2);
  const nor = new Uint8Array(n * 4);
  const hAt = (x: number, y: number): number => H[wrap(y, h) * w + wrap(x, w)] ?? 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = clamp01(L.albedo[i] ?? 1) * 255;
      map[i * 4] = map[i * 4 + 1] = map[i * 4 + 2] = a;
      map[i * 4 + 3] = clamp01(L.mask[i] ?? 1) * 255;
      rough[i * 2] = rough[i * 2 + 1] = clamp01(L.rough[i] ?? 1) * 255;
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * 0.5 * gain;
      const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * 0.5 * gain;
      const k = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      nor[i * 4] = (0.5 - 0.5 * dx * k) * 255;
      nor[i * 4 + 1] = (0.5 - 0.5 * dy * k) * 255;
      nor[i * 4 + 2] = (0.5 + 0.5 * k) * 255;
      nor[i * 4 + 3] = 255;
    }
  }
  return {
    map: texture(map, w, h, RGBAFormat),
    roughnessMap: texture(rough, w, h, RGFormat),
    normalMap: texture(nor, w, h, RGBAFormat),
  };
}

/** Brushed stainless: per-column streak ridges (u varies, constant along v = along the part), random scratches. */
function steel(rnd: Rnd): Layers {
  const S = T.steel;
  const L = layers(S.size, S.size, 1, 1);
  const raw = Float32Array.from({ length: S.size }, rnd);
  const col = raw.map((v, i) => (v + (raw[wrap(i + 1, S.size)] ?? v) + (raw[wrap(i - 1, S.size)] ?? v)) / 3);
  const mottle = fbm(S.size, S.size, 4, 3, rnd);
  const soil = stretch(fbm(S.size, S.size, 3, 4, rnd));
  for (let y = 0; y < S.size; y++) {
    for (let x = 0; x < S.size; x++) {
      const i = y * S.size + x;
      const c = col[x] ?? 0.5;
      L.height[i] = c + S.fine * (raw[x] ?? 0) + S.wave * (mottle[i] ?? 0);
      L.rough[i] = S.min + (1 - S.min) * c + (rnd() - 0.5) * S.jitter;
      L.albedo[i] = 1 - S.mottle * (mottle[i] ?? 0);
      L.mask[i] = soil[i] ?? 1;
    }
  }
  for (let k = 0; k < S.scratches; k++) {
    const depth = S.scratchDepth * (0.4 + 0.6 * rnd());
    stroke(L, rnd, rnd() * 2 * Math.PI, S.size * (0.05 + 0.35 * rnd()), S.scratchCurl, (i) => {
      L.height[i] = (L.height[i] ?? 0) - depth;
      L.rough[i] = Math.min(1, (L.rough[i] ?? 1) + S.scratchRough);
    });
  }
  return L;
}

/** Matte insulation: fine grain, a few axial scuffs from sliding through the port (v = along the shaft). */
function shaft(rnd: Rnd): Layers {
  const S = T.shaft;
  const L = layers(S.size, S.size, 1, 1);
  const grain = fbm(S.size, S.size, S.grainCells, 2, rnd);
  for (let i = 0; i < L.height.length; i++) {
    const g = grain[i] ?? 0;
    L.height[i] = g;
    L.albedo[i] = 1 - S.grain * g;
    L.rough[i] = 1 - S.grain * (1 - g);
  }
  for (let k = 0; k < S.scuffs; k++) {
    stroke(L, rnd, Math.PI / 2 + (rnd() - 0.5) * S.scuffSpread, S.size * (0.1 + 0.3 * rnd()), 0.1, (i) => {
      L.albedo[i] = 1; // scuffs: lighter, rougher-looking stripes on the black
      L.height[i] = (L.height[i] ?? 0) - S.scuffDepth;
    });
  }
  return L;
}

/** Plain-woven cotton: over/under warp + weft threads, darker open gaps, loose curly fibres; A = soak mask. */
function gauze(rnd: Rnd): Layers {
  const S = T.gauze;
  const L = layers(S.size, S.size, 1, 1);
  const P = S.size / S.threads;
  const lumpy = fbm(S.size, S.size, 8, 2, rnd);
  const soak = stretch(fbm(S.size, S.size, 2, 4, rnd));
  const prof = (f: number): number => Math.max(0, 1 - (f / S.threadWidth) ** 2);
  for (let y = 0; y < S.size; y++) {
    for (let x = 0; x < S.size; x++) {
      const i = y * S.size + x;
      const [cx, cy] = [Math.floor(x / P), Math.floor(y / P)];
      const fx = Math.abs((x + 0.5) / P - cx - 0.5) * 2;
      const fy = Math.abs((y + 0.5) / P - cy - 0.5) * 2;
      const over = (cx + cy) % 2 === 0;
      const along = Math.sin(((y + 0.5) / P) * Math.PI) ** 2; // warp bulges where it crosses over the weft
      const across = Math.sin(((x + 0.5) / P) * Math.PI) ** 2;
      const warp = prof(fx) * (over ? 0.6 + 0.4 * along : 0.4);
      const weft = prof(fy) * (over ? 0.4 : 0.6 + 0.4 * across);
      const t = Math.max(warp, weft);
      const lump = lumpy[i] ?? 0;
      L.height[i] = t + 0.2 * lump;
      L.albedo[i] = t > 0 ? 1 - S.threadShade * (1 - t) - 0.05 * lump : S.gap;
      L.rough[i] = 1;
      L.mask[i] = soak[i] ?? 1;
    }
  }
  for (let k = 0; k < S.fibres; k++) {
    stroke(L, rnd, rnd() * 2 * Math.PI, P * (1 + 3 * rnd()), S.fibreCurl, (i) => {
      L.height[i] = Math.max(L.height[i] ?? 0, 0.8);
      L.albedo[i] = 1;
    });
  }
  return L;
}

/** Cartridge top (u = across one insert strip 0…1, v = along it per staple pitch): staggered pocket rows + grain. */
function cartridge(rnd: Rnd): Layers {
  const S = T.cartridge;
  const L = layers(S.width, S.length, 1, 1);
  const grain = fbm(S.width, S.length, 4, 2, rnd);
  for (let y = 0; y < S.length; y++) {
    for (let x = 0; x < S.width; x++) {
      const i = y * S.width + x;
      const [u, v] = [(x + 0.5) / S.width, (y + 0.5) / S.length];
      let pocket = 0;
      for (let r = 0; r < S.rows; r++) {
        const du = Math.abs(u - (r + 0.5) / S.rows) / (S.pocketWidth / 2);
        const dv = Math.abs(wrap(v - (r % 2) * 0.5 + 0.5, 1) - 0.5) / (S.pocketLength / 2);
        pocket = Math.max(pocket, 1 - smooth(0.7, 1, Math.max(du, dv)));
      }
      const g = grain[i] ?? 0;
      L.height[i] = -pocket + S.grain * g;
      L.albedo[i] = 1 - S.grain * g - (1 - S.pocketShade) * pocket;
      L.rough[i] = 1 - S.grain * (1 - g);
    }
  }
  return L;
}

export function buildInstrumentTextures(): InstrumentTextures {
  const rnd = rng(T.seed);
  const sets = {
    steel: pack(steel(rnd), T.steel.normal),
    shaft: pack(shaft(rnd), T.shaft.normal),
    gauze: pack(gauze(rnd), T.gauze.normal),
    cartridge: pack(cartridge(rnd), T.cartridge.normal),
  };
  for (const t of Object.values(sets.gauze)) t.repeat.setScalar(T.gauze.repeat);
  // GPU memory: counted by the perf probe's scene-material walk (src/sim/probe.ts textureBytes), like every texture.
  return sets;
}
