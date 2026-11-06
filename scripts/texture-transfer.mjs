// T854 build-time colour transfer (pure, no I/O; used by optimize-assets.mjs, tested in tests/unit/texture-transfer).
// A remeshed surface (dst, no UVs) takes the colour of a textured surface it lies close to (src) as per-vertex colour:
// per dst vertex, the src point along its normal (nearest hit either way within rayM; closest src point otherwise),
// its barycentric src UV, a bilinear sample of the prefiltered src map. Vertex colours have no seams: the v3 lung
// atlases are too fragmented (v3 RLL: 1155 of 1193 UV islands < 50 vertices) for a UV transfer without a
// per-triangle mosaic (T854 screenshots).
import { BufferAttribute, BufferGeometry, DoubleSide, Plane, Ray, Triangle, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/**
 * src: { pos: number[] (world xyz), idx: number[], uv: number[] per src vertex }; dst: { pos, nrm } per vertex.
 * Returns { uv: Float32Array (src UV per dst vertex), rayMiss }.
 */
export function projectUVs(src, dst, rayM) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(src.pos), 3));
  geo.setIndex(new BufferAttribute(new Uint32Array(src.idx), 1));
  const bvh = new MeshBVH(geo);
  const sIdx = geo.index.array; // MeshBVH reorders the index: faceIndex refers to this order
  const tri = new Triangle();
  const plane = new Plane();
  const p = new Vector3();
  const bary = new Vector3();
  const ray = new Ray();
  const dir = new Vector3();
  const hit = {};
  const n = dst.pos.length / 3;
  const uv = new Float32Array(n * 2);
  let rayMiss = 0;
  for (let v = 0; v < n; v++) {
    p.fromArray(dst.pos, v * 3);
    let best = null;
    for (const sgn of [1, -1]) {
      ray.set(
        p,
        dir
          .fromArray(dst.nrm, v * 3)
          .multiplyScalar(sgn)
          .normalize(),
      );
      const h = bvh.raycastFirst(ray, DoubleSide, 0, rayM);
      if (h && (!best || h.distance < best.distance)) best = h;
    }
    let f;
    if (best) {
      p.copy(best.point);
      f = best.faceIndex;
    } else {
      rayMiss++;
      bvh.closestPointToPoint(p, hit);
      p.copy(hit.point);
      f = hit.faceIndex;
    }
    for (let c = 0; c < 3; c++) [tri.a, tri.b, tri.c][c].fromArray(src.pos, sIdx[f * 3 + c] * 3);
    tri.getPlane(plane).projectPoint(p, p);
    tri.getBarycoord(p, bary);
    for (let k = 0; k < 2; k++)
      uv[v * 2 + k] =
        bary.x * src.uv[sIdx[f * 3] * 2 + k] +
        bary.y * src.uv[sIdx[f * 3 + 1] * 2 + k] +
        bary.z * src.uv[sIdx[f * 3 + 2] * 2 + k];
  }
  return { uv, rayMiss };
}

/** size×size coverage mask (1 = texel centre inside a UV triangle), glTF UV convention (v down the image). */
export function uvCoverage(uv, idx, size) {
  const mask = new Uint8Array(size * size);
  const x = [0, 0, 0];
  const y = [0, 0, 0];
  for (let t = 0; t < idx.length; t += 3) {
    for (let c = 0; c < 3; c++) {
      x[c] = uv[idx[t + c] * 2] * size - 0.5;
      y[c] = uv[idx[t + c] * 2 + 1] * size - 0.5;
    }
    const area = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0]);
    if (!area) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...x)));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(...x)));
    const y0 = Math.max(0, Math.floor(Math.min(...y)));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(...y)));
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        let inside = true;
        for (let e = 0; e < 3 && inside; e++) {
          const [i, j] = [e, (e + 1) % 3];
          inside = ((x[j] - x[i]) * (py - y[i]) - (y[j] - y[i]) * (px - x[i])) * Math.sign(area) >= 0;
        }
        if (inside) mask[py * size + px] = 1;
      }
  }
  return mask;
}

/** Fill every uncovered texel with its nearest covered texel (multi-source BFS), in place: the prefilter blur and
 *  bilinear taps at island rims never pull in the empty (black) atlas. Returns the covered fraction. */
export function dilate(pixels, channels, mask, size) {
  const queue = new Int32Array(size * size);
  const seen = Uint8Array.from(mask);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) queue[tail++] = i;
  if (!tail) throw new Error('dilate: empty coverage');
  const covered = tail / mask.length;
  while (head < tail) {
    const i = queue[head++];
    const px = i % size;
    const py = (i - px) / size;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const qx = px + dx;
      const qy = py + dy;
      if (qx < 0 || qy < 0 || qx >= size || qy >= size) continue;
      const q = qy * size + qx;
      if (seen[q]) continue;
      seen[q] = 1;
      for (let k = 0; k < channels; k++) pixels[q * channels + k] = pixels[i * channels + k];
      queue[tail++] = q;
    }
  }
  return covered;
}

/** Scale the covered texels' luminance deviation from their mean by `gain` (hue kept), in place. */
export function contrast(pixels, channels, mask, gain) {
  const luma = (i) => 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
  let sum = 0;
  let n = 0;
  for (let t = 0; t < mask.length; t++)
    if (mask[t]) {
      sum += luma(t * channels);
      n++;
    }
  const mean = sum / n;
  for (let t = 0; t < mask.length; t++) {
    if (!mask[t]) continue;
    const i = t * channels;
    const l = luma(i);
    const k = l > 0 ? (mean + gain * (l - mean)) / l : 1;
    for (let c = 0; c < 3; c++) pixels[i + c] = Math.min(255, Math.max(0, Math.round(pixels[i + c] * k)));
  }
}

/** Bilinear RGB (0–255) at glTF uv from a size×size image (clamped to the edge), written to out. */
export function sampleBilinear(pixels, channels, size, u, v, out) {
  const fx = Math.min(size - 1, Math.max(0, u * size - 0.5));
  const fy = Math.min(size - 1, Math.max(0, v * size - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  for (let k = 0; k < 3; k++) {
    const at = (x, y) => pixels[(y * size + x) * channels + k];
    out[k] =
      (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
  }
  return out;
}
