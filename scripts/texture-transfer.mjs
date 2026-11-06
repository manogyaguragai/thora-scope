// T854 build-time texture transfer (pure, no I/O; used by optimize-assets.mjs, tested in tests/unit/texture-transfer).
// A remeshed surface (dst) borrows the UVs of a textured surface it lies close to (src): per dst vertex, the
// barycentric UV of the src point along its normal (nearest hit either way within rayM; closest src point otherwise:
// closest-point alone collapses an inset surface's UVs onto ridges → stretched streaks), then Laplacian-smoothed
// within each island (`smooth` Jacobi passes; vertices next to another island pinned): a smooth remesh projected onto
// a wrinkled CT surface otherwise folds its UVs into streaks along the wrinkles. Triangles whose corners land on different src UV islands are split off and laid onto
// the island under their centroid (corner UVs extrapolated through that src triangle's affine UV map), so no triangle
// interpolates across a seam. The textures are then dilated so extrapolated corners never sample the empty atlas.
import { BufferAttribute, BufferGeometry, DoubleSide, Plane, Ray, Triangle, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/** Island id per vertex: connected components of the indexed mesh (glTF splits vertices at UV seams). */
export function uvIslands(count, idx) {
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let t = 0; t < idx.length; t += 3) {
    parent[find(idx[t + 1])] = find(idx[t]);
    parent[find(idx[t + 2])] = find(idx[t]);
  }
  return Int32Array.from({ length: count }, (_, i) => find(i));
}

/**
 * src/dst: { pos: number[] (world xyz), idx: number[] } (+ src.uv per src vertex, dst.nrm per dst vertex). Returns
 * { remap (new vertex → dst vertex), uv (per new vertex), index (new triangles), seamTris, rayMiss }.
 */
export function transferUVs(src, dst, rayM, smooth) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(src.pos), 3));
  geo.setIndex(new BufferAttribute(new Uint32Array(src.idx), 1));
  const bvh = new MeshBVH(geo);
  const sIdx = geo.index.array; // MeshBVH reorders the index: faceIndex refers to this order
  const island = uvIslands(src.pos.length / 3, src.idx);
  const tri = new Triangle();
  const plane = new Plane();
  const p = new Vector3();
  const bary = new Vector3();
  const hit = {};
  const ray = new Ray();
  const dir = new Vector3();
  // UV of point p through src face f (barycentric of p projected on the face plane; unclamped = affine extrapolation).
  const uvAt = (f, out, o) => {
    for (let c = 0; c < 3; c++) {
      const v = sIdx[f * 3 + c] * 3;
      [tri.a, tri.b, tri.c][c].set(src.pos[v], src.pos[v + 1], src.pos[v + 2]);
    }
    tri.getPlane(plane).projectPoint(p, p);
    tri.getBarycoord(p, bary);
    for (let k = 0; k < 2; k++)
      out[o + k] =
        bary.x * src.uv[sIdx[f * 3] * 2 + k] +
        bary.y * src.uv[sIdx[f * 3 + 1] * 2 + k] +
        bary.z * src.uv[sIdx[f * 3 + 2] * 2 + k];
  };
  let rayMiss = 0;
  // Src face for point (x,y,z) with normal n (dst.nrm at vertex v, or the triangle normal); p ← the src point.
  const locate = (x, y, z, nx, ny, nz) => {
    p.set(x, y, z);
    let best = null;
    for (const sgn of [1, -1]) {
      ray.set(p, dir.set(nx * sgn, ny * sgn, nz * sgn).normalize());
      const h = bvh.raycastFirst(ray, DoubleSide, 0, rayM);
      if (h && (!best || h.distance < best.distance)) best = h;
    }
    if (best) {
      p.copy(best.point);
      return best.faceIndex;
    }
    rayMiss++;
    bvh.closestPointToPoint(p, hit);
    return hit.faceIndex;
  };
  const n = dst.pos.length / 3;
  const vUV = new Float32Array(n * 2);
  const vIsland = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const f = locate(...dst.pos.slice(v * 3, v * 3 + 3), ...dst.nrm.slice(v * 3, v * 3 + 3));
    vIsland[v] = island[sIdx[f * 3]];
    uvAt(f, vUV, v * 2);
  }
  // Vertex adjacency (CSR) of dst, then the island-local Laplacian smoothing of vUV.
  const deg = new Int32Array(n + 1);
  for (let t = 0; t < dst.idx.length; t++) deg[dst.idx[t] + 1] += 2;
  for (let v = 0; v < n; v++) deg[v + 1] += deg[v];
  const nbr = new Int32Array(deg[n]);
  const fill = deg.slice(0, n);
  for (let t = 0; t < dst.idx.length; t += 3)
    for (let c = 0; c < 3; c++) {
      const v = dst.idx[t + c];
      nbr[fill[v]++] = dst.idx[t + ((c + 1) % 3)];
      nbr[fill[v]++] = dst.idx[t + ((c + 2) % 3)];
    }
  const pinned = new Uint8Array(n);
  for (let v = 0; v < n; v++)
    for (let e = deg[v]; e < deg[v + 1]; e++) if (vIsland[nbr[e]] !== vIsland[v]) pinned[v] = 1;
  let cur = vUV;
  let next = new Float32Array(n * 2);
  for (let it = 0; it < smooth; it++) {
    for (let v = 0; v < n; v++) {
      let u = 0;
      let w = 0;
      const cnt = deg[v + 1] - deg[v];
      if (!pinned[v] && cnt)
        for (let e = deg[v]; e < deg[v + 1]; e++) {
          u += cur[nbr[e] * 2] / cnt;
          w += cur[nbr[e] * 2 + 1] / cnt;
        }
      next[v * 2] = pinned[v] || !cnt ? cur[v * 2] : u;
      next[v * 2 + 1] = pinned[v] || !cnt ? cur[v * 2 + 1] : w;
    }
    [cur, next] = [next, cur];
  }
  vUV.set(cur);
  const remap = [...Array(n).keys()];
  const uv = Array.from(vUV);
  const index = [];
  const c = new Float32Array(2);
  let seamTris = 0;
  for (let t = 0; t < dst.idx.length; t += 3) {
    const [a, b, d] = [dst.idx[t], dst.idx[t + 1], dst.idx[t + 2]];
    if (vIsland[a] === vIsland[b] && vIsland[a] === vIsland[d]) {
      index.push(a, b, d);
      continue;
    }
    seamTris++;
    const cen = [0, 0, 0];
    const nrm = [0, 0, 0];
    for (const v of [a, b, d])
      for (let k = 0; k < 3; k++) {
        cen[k] += dst.pos[v * 3 + k] / 3;
        nrm[k] += dst.nrm[v * 3 + k];
      }
    const f = locate(...cen, ...nrm);
    const isl = island[sIdx[f * 3]];
    for (const v of [a, b, d]) {
      if (vIsland[v] === isl) {
        index.push(v);
        continue;
      }
      p.set(dst.pos[v * 3], dst.pos[v * 3 + 1], dst.pos[v * 3 + 2]);
      uvAt(f, c, 0);
      index.push(remap.length);
      remap.push(v);
      uv.push(Math.min(1, Math.max(0, c[0])), Math.min(1, Math.max(0, c[1]))); // [0,1]: UVs stay quantizable
    }
  }
  return {
    remap: Uint32Array.from(remap),
    uv: Float32Array.from(uv),
    index: Uint32Array.from(index),
    seamTris,
    rayMiss,
  };
}

/** size×size coverage mask (1 = inside a UV triangle), glTF UV convention (v down the image). */
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
        let inside = true; // texel centre inside (or on an edge of) the UV triangle
        for (let e = 0; e < 3 && inside; e++) {
          const [i, j] = [e, (e + 1) % 3];
          inside = ((x[j] - x[i]) * (py - y[i]) - (y[j] - y[i]) * (px - x[i])) * Math.sign(area) >= 0;
        }
        if (inside) mask[py * size + px] = 1;
      }
  }
  return mask;
}

/** Fill every uncovered texel with its nearest covered texel (multi-source BFS), in place. Returns covered fraction. */
export function dilate(pixels, channels, mask, size) {
  const queue = new Int32Array(size * size);
  const seen = Uint8Array.from(mask);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) queue[tail++] = i;
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
