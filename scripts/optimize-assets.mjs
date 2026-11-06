// v3 scene + the RML hilum model named in src/content/anatomy.json (docs/MODEL_INTEGRATION.md) →
// public/models/thorax_sim.opt.glb: model nodes replace the old hilum at the scene root (already world space, identity
// transforms), Draco removed, meshopt + quantized (morph targets too), textures → KTX2 (UASTC normals, ETC1S
// colour/roughness). Then runs verify-assets.mjs. v8+ = new file in assets_src + bump the manifest `source`.
// Usage: npm run assets:optimize   (downloads KTX-Software into .cache/ on first run; build-time only)
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  compactPrimitive,
  dedup,
  mergeDocuments,
  meshopt,
  prune,
  textureCompress,
  unpartition,
  weld,
} from '@gltf-transform/functions';
import { Mode, toktx } from '@gltf-transform/cli';
import draco3d from 'draco3dgltf';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { contrast, dilate, projectUVs, sampleBilinear, uvCoverage } from './texture-transfer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(root, 'src/content/anatomy.json');
const anatomy = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const SRC = join(root, anatomy.base);
const MODEL = join(root, anatomy.source);
// v3 nodes dropped in the merge: the manifest's removed list + every manifest structure (old same-name meshes);
// every model node name is dropped from v3 too (below).
const REMOVED = [...anatomy.removedFromBase, ...Object.keys(anatomy.structures)];
const OUT = join(root, 'public/models/thorax_sim.opt.glb');
const DECODERS = join(root, 'public/decoders');
const BASIS_DIR = join(root, 'node_modules/three/examples/jsm/libs/basis');
const MAX_BYTES = 12_000_000; // CONTEXT §6.10: glb ≤ ~12 MB
const NORMAL_CAP = 512; // UASTC normals at 1024 overshoot the 12 MB budget (ADR-006)
const NORMAL_SLOTS = /normal/i;
// T854 colour transfer (transferColors): ray reach along the normal (v8 lobes sit 3–7 mm inside v3's); lobular
// contrast gain on the base map (the prefilter + vertex sampling soften the v3 network; 1 = as baked); prefilter σ per
// model edge length (½ = alias-free but washes the network out, T854 screenshots) with a floor in texels.
const TRANSFER = { rayM: 0.015, contrast: 2, blurPerEdge: 1 / 3, minBlurPx: 0.5 };
const KTX = {
  version: '4.4.2',
  sha1: 'c6b08c817f8c8dd299deccae4f2fbb8d55e9acd2',
  dir: join(root, '.cache/ktx'),
};
const ktxHome = join(KTX.dir, `KTX-Software-${KTX.version}-Linux-x86_64`);

// World-space positions of a node's mesh (all primitives concatenated) with the named morph keys at full influence
// (collapse_* × manifest collapseGain, like src/scene/morphs.ts) + the matching triangle indices.
function posedTriangles(node, keys) {
  const m = node.getWorldMatrix();
  const names = node.getMesh().getExtras()?.targetNames ?? [];
  const pos = [];
  const idx = [];
  const p = [0, 0, 0];
  const d = [0, 0, 0];
  for (const prim of node.getMesh().listPrimitives()) {
    const attr = prim.getAttribute('POSITION');
    const deltas = [];
    prim.listTargets().forEach((t, i) => {
      if (!keys.includes(names[i])) return;
      deltas.push([t.getAttribute('POSITION'), names[i].startsWith('collapse_') ? anatomy.collapseGain : 1]);
    });
    const base = pos.length / 3;
    for (let i = 0, n = attr.getCount(); i < n; i++) {
      attr.getElement(i, p);
      for (const [a, w] of deltas) {
        a.getElement(i, d);
        for (let k = 0; k < 3; k++) p[k] += w * d[k];
      }
      for (let k = 0; k < 3; k++) pos.push(m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]);
    }
    const ind = prim.getIndices()?.getArray() ?? Array.from({ length: attr.getCount() }, (_, i) => i);
    for (const i of ind) idx.push(base + i);
  }
  return { pos, idx };
}

// T846c: manifest `trimFromBase` — drop the triangles of a kept base mesh whose centroid lies within `clearanceM`
// of any model structure (except `except`) in any of `poses` (morph-key sets; the base mesh is posed with the same
// keys), then islands < `minIslandTris`. Keeps v3 CT fat in the anterior mediastinum, off the v8 hilum.
function trimFromBase(base, src) {
  for (const [name, cfg] of Object.entries(anatomy.trimFromBase ?? {})) {
    if (name.startsWith('$')) continue;
    const node = base
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === name && n.getMesh());
    if (!node) throw new Error(`trimFromBase: no base mesh ${name}`);
    const targets = src
      .getRoot()
      .listNodes()
      .filter((n) => n.getMesh() && anatomy.structures[n.getName()] && !cfg.except.includes(n.getName()));
    const prims = node.getMesh().listPrimitives();
    const total = prims.reduce((t, pr) => t + (pr.getIndices()?.getCount() ?? 0) / 3, 0);
    const drop = new Uint8Array(total);
    const q = new Vector3();
    for (const keys of cfg.poses) {
      const pos = [];
      const idx = [];
      for (const t of targets) {
        const g = posedTriangles(t, keys);
        const off = pos.length / 3;
        for (const v of g.pos) pos.push(v);
        for (const i of g.idx) idx.push(off + i);
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      geo.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
      const bvh = new MeshBVH(geo);
      const fat = posedTriangles(node, keys);
      for (let t = 0; t < total; t++) {
        if (drop[t]) continue;
        q.set(0, 0, 0);
        for (let c = 0; c < 3; c++) {
          const v = fat.idx[t * 3 + c] * 3;
          q.x += fat.pos[v] / 3;
          q.y += fat.pos[v + 1] / 3;
          q.z += fat.pos[v + 2] / 3;
        }
        if (bvh.closestPointToPoint(q, {}, 0, cfg.clearanceM)) drop[t] = 1;
      }
    }
    // Islands of the kept triangles (vertices joined by quantised rest position: UV/normal seams split indices).
    const rest = posedTriangles(node, []);
    const parent = new Int32Array(rest.pos.length / 3).map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const byPos = new Map();
    for (let v = 0; v < parent.length; v++) {
      const key = [0, 1, 2].map((k) => Math.round(rest.pos[v * 3 + k] * 1e5)).join(',');
      if (byPos.has(key)) parent[find(v)] = find(byPos.get(key));
      else byPos.set(key, v);
    }
    for (let t = 0; t < total; t++)
      if (!drop[t]) for (let c = 1; c < 3; c++) parent[find(rest.idx[t * 3 + c])] = find(rest.idx[t * 3]);
    const size = new Map();
    for (let t = 0; t < total; t++)
      if (!drop[t]) size.set(find(rest.idx[t * 3]), (size.get(find(rest.idx[t * 3])) ?? 0) + 1);
    let near = 0;
    let islands = 0;
    for (let t = 0; t < total; t++) {
      if (drop[t]) near++;
      else if (size.get(find(rest.idx[t * 3])) < cfg.minIslandTris) {
        drop[t] = 1;
        islands++;
      }
    }
    let t0 = 0;
    for (const prim of prims) {
      const ind = prim.getIndices().getArray();
      const kept = [];
      for (let t = 0; t < ind.length / 3; t++)
        if (!drop[t0 + t]) kept.push(ind[t * 3], ind[t * 3 + 1], ind[t * 3 + 2]);
      t0 += ind.length / 3;
      const old = prim.getIndices();
      prim.setIndices(
        base.createAccessor().setType('SCALAR').setArray(new Uint32Array(kept)).setBuffer(old.getBuffer()),
      );
      compactPrimitive(prim);
    }
    const left = total - near - islands;
    console.log(
      `trim ${name}: ${total} tris → kept ${left}, dropped ${near} near the hilum + ${islands} in islands`,
    );
  }
}

// T854: manifest `textureTransfer` {modelMesh: baseMesh} — the model mesh (no UVs) takes the base mesh's colour map as
// COLOR_0: per vertex, the base point along its normal (rest pose, world space; scripts/texture-transfer.mjs) → base UV
// → bilinear sample of the map (lobular contrast × TRANSFER.contrast, atlas gaps dilated, prefiltered per the model's
// mean edge length so the vertex sampling does not alias). The base normal/roughness maps are not carried over
// (v3 lung normals are flat; T824 procedural relief stays). Skipped for a model mesh that ships COLOR_0 or a colour map.
async function transferColors(base, src) {
  const byName = (d, name) =>
    d
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === name && n.getMesh());
  for (const [name, from] of Object.entries(anatomy.textureTransfer ?? {})) {
    if (name.startsWith('$')) continue;
    const dst = byName(src, name);
    const ref = byName(base, from);
    if (!dst || !ref) throw new Error(`textureTransfer: missing ${dst ? from : name}`);
    const prims = dst.getMesh().listPrimitives();
    if (prims.some((p) => p.getAttribute('COLOR_0') || p.getMaterial()?.getBaseColorTexture())) {
      console.log(`colour transfer ${name}: model ships its own colours, skipped`);
      continue;
    }
    const refPrims = ref.getMesh().listPrimitives();
    const uv = refPrims.flatMap((p) => Array.from(p.getAttribute('TEXCOORD_0').getArray()));
    const from3 = { ...posedTriangles(ref, []), uv };
    const tex = refPrims[0].getMaterial().getBaseColorTexture();
    const { data, info } = await sharp(Buffer.from(tex.getImage()))
      .raw()
      .toBuffer({ resolveWithObject: true });
    const size = info.width;
    if (info.height !== size) throw new Error(`textureTransfer: ${tex.getName()} is not square`);
    const mask = uvCoverage(uv, from3.idx, size);
    contrast(data, info.channels, mask, TRANSFER.contrast);
    dilate(data, info.channels, mask, size);
    // Texels per metre of the base atlas (√ UV area / world area).
    let uvArea = 0;
    let worldArea = 0;
    for (let t = 0; t < from3.idx.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => from3.idx[t + k]);
      const d = (i, j, k) => from3.pos[j * 3 + k] - from3.pos[i * 3 + k];
      const cr = [0, 1, 2].map(
        (k) => d(a, b, (k + 1) % 3) * d(a, c, (k + 2) % 3) - d(a, b, (k + 2) % 3) * d(a, c, (k + 1) % 3),
      );
      worldArea += Math.hypot(...cr) / 2;
      const du = (i, k) => uv[i * 2 + k] - uv[a * 2 + k];
      uvArea += Math.abs(du(b, 0) * du(c, 1) - du(c, 0) * du(b, 1)) / 2;
    }
    const texelsPerM = Math.sqrt(uvArea / worldArea) * size;
    const m = dst.getWorldMatrix();
    for (const prim of prims) {
      const local = prim.getAttribute('POSITION');
      const normal = prim.getAttribute('NORMAL');
      const p = [0, 0, 0];
      const pos = [];
      const nrm = [];
      for (let i = 0; i < local.getCount(); i++) {
        local.getElement(i, p);
        for (let k = 0; k < 3; k++) pos.push(m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]);
        normal.getElement(i, p); // ponytail: rotation/uniform-scale world matrices only (manifest models: identity)
        for (let k = 0; k < 3; k++) nrm.push(m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2]);
      }
      const idx = prim.getIndices()?.getArray() ?? Array.from({ length: local.getCount() }, (_, i) => i);
      let edge = 0;
      for (let t = 0; t < idx.length; t++) {
        const [i, j] = [idx[t], idx[t - (t % 3) + (((t % 3) + 1) % 3)]];
        edge += Math.hypot(...[0, 1, 2].map((k) => pos[i * 3 + k] - pos[j * 3 + k])) / idx.length;
      }
      const sigma = Math.max(TRANSFER.minBlurPx, edge * texelsPerM * TRANSFER.blurPerEdge);
      const img = await sharp(data, { raw: info }).blur(sigma).raw().toBuffer();
      const r = projectUVs(from3, { pos, nrm }, TRANSFER.rayM);
      const colors = new Float32Array(local.getCount() * 3);
      const rgb = [0, 0, 0];
      const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      let luma = 0;
      for (let v = 0; v < local.getCount(); v++) {
        sampleBilinear(img, info.channels, size, r.uv[v * 2], r.uv[v * 2 + 1], rgb);
        for (let k = 0; k < 3; k++) colors[v * 3 + k] = lin(rgb[k]);
        luma +=
          (0.2126 * colors[v * 3] + 0.7152 * colors[v * 3 + 1] + 0.0722 * colors[v * 3 + 2]) /
          local.getCount();
      }
      prim.setAttribute(
        'COLOR_0',
        src.createAccessor().setType('VEC3').setArray(colors).setBuffer(src.getRoot().listBuffers()[0]),
      );
      console.log(
        `colour transfer ${name} ← ${from}: ${local.getCount()} vertices, ${r.rayMiss} closest-point fallbacks, ` +
          `prefilter σ ${sigma.toFixed(1)} px, mean linear luma ${luma.toFixed(3)} (materials.config mapLuma)`,
      );
    }
  }
}

// --- KTX-Software (toktx/ktx), project-local, no sudo.
if (!existsSync(join(ktxHome, 'bin/ktx'))) {
  const name = `KTX-Software-${KTX.version}-Linux-x86_64.tar.bz2`;
  const url = `https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX.version}/${name}`;
  console.log(`fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`KTX-Software download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha1 = createHash('sha1').update(buf).digest('hex');
  if (sha1 !== KTX.sha1) throw new Error(`KTX-Software sha1 mismatch: ${sha1}`);
  mkdirSync(KTX.dir, { recursive: true });
  writeFileSync(join(KTX.dir, name), buf);
  execFileSync('tar', ['-xjf', join(KTX.dir, name), '-C', KTX.dir]);
}
process.env.PATH = `${join(ktxHome, 'bin')}:${process.env.PATH}`;
process.env.LD_LIBRARY_PATH = `${join(ktxHome, 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}`;

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.encoder': MeshoptEncoder,
});

const doc = await io.read(SRC);
const model = await io.read(MODEL);
const drop = new Set([
  ...REMOVED,
  ...model
    .getRoot()
    .listNodes()
    .map((n) => n.getName()),
]);
// Base nodes kept under a new name (e.g. v3 CT mediastinal fat fills the anterior mediastinum; name clashes with a model node).
for (const n of doc.getRoot().listNodes()) {
  const to = anatomy.renamedFromBase?.[n.getName()];
  if (to) {
    n.setName(to);
    n.getMesh()?.setName(to);
  }
}
trimFromBase(doc, model);
await transferColors(doc, model);
for (const n of doc.getRoot().listNodes()) {
  if (!drop.has(n.getName())) continue;
  n.getMesh()?.dispose();
  n.dispose();
}
// Reference cameras (cam_anterior_hilum) are kept as non-step cameras: the app reads their view axis to aim the
// port views of steps 2–5 (src/scene/cameras.ts), so a v8 camera tweak needs no code change.
const modelScene = mergeDocuments(doc, model).get(model.getRoot().listScenes()[0]);
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
for (const n of modelScene.listChildren()) {
  modelScene.removeChild(n);
  scene.addChild(n); // scene root, never under thorax_root (scale 1.3)
}
modelScene.dispose();
await doc.transform(
  unpartition(), // one buffer (GLB)
  // keepUniqueNames: never merge two named meshes/materials into one (names are the app contract).
  dedup({ keepUniqueNames: true }),
  // Keep empty/leaf nodes (thorax_root, cameras, ports), extras, unused attributes and flat textures.
  prune({ keepLeaves: true, keepAttributes: true, keepExtras: true, keepSolidTextures: true }),
  weld(),
  // WebP → PNG (lossless from the WebP pixels) so KTX-Software can read it; cap normals.
  textureCompress({ encoder: sharp, targetFormat: 'png' }),
  textureCompress({
    encoder: sharp,
    targetFormat: 'png',
    slots: NORMAL_SLOTS,
    resize: [NORMAL_CAP, NORMAL_CAP],
  }),
  toktx({ mode: Mode.UASTC, slots: NORMAL_SLOTS, level: 2, zstd: 18 }),
  toktx({ mode: Mode.ETC1S, quality: 128 }), // remaining: colour (sRGB) + roughness
  // reorder + quantize (positions/UVs; morph POSITION/NORMAL deltas too) + EXT_meshopt_compression FILTER.
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (ext.extensionName === 'KHR_draco_mesh_compression' || ext.extensionName === 'EXT_texture_webp')
    ext.dispose();
}

mkdirSync(dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const bytes = statSync(OUT).size;
console.log(`wrote ${OUT} — ${bytes} B (${(bytes / 1048576).toFixed(2)} MiB)`);
if (bytes > MAX_BYTES) {
  console.error(`FAIL: ${bytes} B > budget ${MAX_BYTES} B`);
  process.exit(1);
}

// KTX2 transcoder for three's KTX2Loader (meshopt decoder is bundled from three/examples).
mkdirSync(DECODERS, { recursive: true });
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm'])
  copyFileSync(join(BASIS_DIR, f), join(DECODERS, f));

const verify = spawnSync(
  process.execPath,
  [
    join(root, 'scripts/verify-assets.mjs'),
    SRC,
    MODEL,
    OUT,
    '--drop',
    REMOVED.join(','),
    '--md',
    join(root, 'docs/ASSETS.md'),
  ],
  { stdio: 'inherit' },
);
process.exit(verify.status ?? 1);
