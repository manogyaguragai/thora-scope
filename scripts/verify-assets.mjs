// Contract check: optimised glb vs its sources (v3 scene minus the dropped nodes, plus every hilum-model node;
// same-name model nodes replace v3 ones) and vs src/content/anatomy.json (every manifest structure + morph key).
// Exit 1 on any mismatch.
// Usage: node scripts/verify-assets.mjs <v3.glb> <model.glb> <opt.glb> [--drop a,b,…] [--md docs/ASSETS.md]
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { gzipSync } from 'node:zlib';
import { ImageUtils, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';
import { format, resolveConfig } from 'prettier';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const mdPath = flag('--md');
const dropped = new Set((flag('--drop') ?? '').split(',').filter(Boolean));
const [srcPath, modelPath, optPath] = args;
if (!srcPath || !modelPath || !optPath) {
  console.error(
    'Usage: node scripts/verify-assets.mjs <v3.glb> <model.glb> <opt.glb> [--drop a,b,…] [--md docs/ASSETS.md]',
  );
  process.exit(2);
}
const BOUNDS_TOL_M = 5e-4; // 0.5 mm: quantisation error allowed on world-space AABBs (base + each morph)
const NUM_TOL = 1e-6; // camera params

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
});

// World-space AABB of a mesh node's vertices with one morph target at full influence (-1 = base).
function worldBounds(node, targetIdx) {
  const m = node.getWorldMatrix();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const p = [0, 0, 0];
  const d = [0, 0, 0];
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const delta = targetIdx >= 0 ? prim.listTargets()[targetIdx].getAttribute('POSITION') : null;
    for (let i = 0, n = pos.getCount(); i < n; i++) {
      pos.getElement(i, p);
      if (delta) {
        delta.getElement(i, d);
        p[0] += d[0];
        p[1] += d[1];
        p[2] += d[2];
      }
      for (let k = 0; k < 3; k++) {
        const w = m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k];
        if (w < min[k]) min[k] = w;
        if (w > max[k]) max[k] = w;
      }
    }
  }
  return [...min, ...max];
}

async function summarize(path) {
  const doc = await io.read(path);
  const root = doc.getRoot();
  const nodes = new Map();
  let tris = 0;
  for (const n of root.listNodes()) {
    const mesh = n.getMesh();
    const cam = n.getCamera();
    let morphs = null;
    let bounds = null;
    let nodeTris = 0;
    if (mesh) {
      const names = mesh.getExtras()?.targetNames ?? [];
      morphs = new Map(names.map((name, i) => [name, i]));
      bounds = { base: worldBounds(n, -1) };
      for (const [name, i] of morphs) bounds[name] = worldBounds(n, i);
      for (const prim of mesh.listPrimitives())
        nodeTris += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
      tris += nodeTris;
    }
    nodes.set(n.getName(), {
      tris: nodeTris,
      extras: n.getExtras(),
      morphs,
      nTargets: mesh?.listPrimitives()[0]?.listTargets().length ?? 0,
      bounds,
      camera: cam && {
        type: cam.getType(),
        yfov: cam.getYFov(),
        aspect: cam.getAspectRatio(),
        znear: cam.getZNear(),
        zfar: cam.getZFar(),
        world: n.getWorldMatrix(),
      },
    });
  }
  const textures = root.listTextures().map((t) => ({
    mime: t.getMimeType(),
    size: ImageUtils.getSize(t.getImage(), t.getMimeType()) ?? [0, 0],
    bytes: t.getImage().byteLength,
  }));
  const extensions = root.listExtensionsUsed().map((e) => e.extensionName);
  return { count: root.listNodes().length, nodes, tris, textures, extensions };
}

const v3 = await summarize(srcPath);
const model = await summarize(modelPath);
const anatomy = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/content/anatomy.json'), 'utf8'),
);
const opt = await summarize(optPath);
// Expected merge: v3 minus dropped/replaced names, then every model node.
const renamed = anatomy.renamedFromBase ?? {};
const nodes = new Map(
  [...v3.nodes].map(([n, v]) => [renamed[n] ?? n, v]).filter(([n]) => !dropped.has(n) && !model.nodes.has(n)),
);
for (const [n, v] of model.nodes) nodes.set(n, v);
const src = {
  count: nodes.size,
  nodes,
  tris: [...nodes.values()].reduce((t, n) => t + n.tris, 0),
  textures: [...v3.textures, ...model.textures],
  extensions: [...new Set([...v3.extensions, ...model.extensions])],
};
const errors = [];
const err = (msg) => errors.push(msg);
const near = (a, b, tol) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

if (src.count !== opt.count) err(`node count ${src.count} → ${opt.count}`);
for (const name of src.nodes.keys()) if (!opt.nodes.has(name)) err(`node missing: ${name}`);
for (const name of opt.nodes.keys()) if (!src.nodes.has(name)) err(`unexpected node: ${name}`);
// Manifest contract: every structure present; each morphed model mesh carries exactly the manifest keys.
for (const name of Object.keys(anatomy.structures))
  if (!opt.nodes.has(name)) err(`manifest structure missing: ${name}`);
for (const name of anatomy.referenceCameras ?? [])
  if (!opt.nodes.get(name)?.camera) err(`reference camera missing: ${name}`);
const manifestKeys = [...anatomy.morphs].sort();
for (const name of model.nodes.keys()) {
  const m = opt.nodes.get(name)?.morphs;
  if (m?.size && !isDeepStrictEqual([...m.keys()].sort(), manifestKeys))
    err(`morph keys on ${name} ≠ manifest morphs`);
}

let morphChecks = 0;
for (const [name, a] of src.nodes) {
  const b = opt.nodes.get(name);
  if (!b) continue;
  if (!isDeepStrictEqual(a.extras, b.extras)) err(`extras differ: ${name}`);
  if (!!a.morphs !== !!b.morphs) err(`mesh presence differs: ${name}`);
  if (a.morphs && b.morphs) {
    const an = [...a.morphs.keys()].sort();
    const bn = [...b.morphs.keys()].sort();
    if (!isDeepStrictEqual(an, bn)) err(`morph names differ on ${name}: [${an}] vs [${bn}]`);
    if (b.nTargets !== bn.length) err(`targetNames/targets count mismatch on ${name}`);
    // trimFromBase meshes (T846c) lose triangles by design: their AABBs shrink, so only names/targets are checked.
    for (const key of anatomy.trimFromBase?.[name] ? [] : Object.keys(a.bounds)) {
      if (!b.bounds[key]) continue;
      morphChecks++;
      if (!near(a.bounds[key], b.bounds[key], BOUNDS_TOL_M))
        err(`world bounds (${key}) drift > ${BOUNDS_TOL_M} m on ${name}`);
    }
  }
  if (!!a.camera !== !!b.camera) err(`camera presence differs: ${name}`);
  if (a.camera && b.camera) {
    const { type, world, ...pa } = a.camera;
    const { type: tb, world: wb, ...pb } = b.camera;
    if (type !== tb) err(`camera type differs: ${name}`);
    if (!near(Object.values(pa), Object.values(pb), NUM_TOL)) err(`camera params differ: ${name}`);
    if (!near(world, wb, NUM_TOL)) err(`camera transform differs: ${name}`);
  }
}
// Textures of dropped meshes are pruned, so the merged file may hold fewer than its sources (never more).
if (opt.textures.length > src.textures.length)
  err(`texture count ${src.textures.length} → ${opt.textures.length}`);

// --- Report
const srcBytes = statSync(srcPath).size + statSync(modelPath).size;
const optBytes = statSync(optPath).size;
const gzBytes = gzipSync(readFileSync(optPath), { level: 9 }).length;
const mib = (b) => `${(b / 1048576).toFixed(2)} MiB (${b} B)`;
const texSummary = (t) => {
  const byMime = {};
  for (const x of t) {
    const s = (byMime[x.mime] ??= { n: 0, bytes: 0, px: 0, max: 0 });
    s.n++;
    s.bytes += x.bytes;
    s.px += x.size[0] * x.size[1];
    s.max = Math.max(s.max, ...x.size);
  }
  return Object.entries(byMime)
    .map(([m, s]) => `${s.n}× ${m}, ${mib(s.bytes)}, ${(s.px / 1e6).toFixed(1)} MP, max ${s.max}px`)
    .join('; ');
};
const dTris = opt.tris - src.tris;
const result = errors.length ? `FAIL (${errors.length})` : 'PASS';
const rows = [
  ['File size', mib(srcBytes), mib(optBytes)],
  ['gzip -9 size', '—', mib(gzBytes)],
  ['Triangles', String(src.tris), `${opt.tris} (Δ ${dTris})`],
  ['Textures', texSummary(src.textures), texSummary(opt.textures)],
  ['Extensions', src.extensions.join(', '), opt.extensions.join(', ')],
];
console.log(rows.map(([k, a, b]) => `${k}: ${a} → ${b}`).join('\n'));
console.log(
  `verify: ${result} — ${opt.count} node names, extras, cameras, morph names; ${morphChecks} base/morph world-AABB checks (tol ${BOUNDS_TOL_M} m)`,
);
for (const e of errors) console.error(`  ✗ ${e}`);

if (mdPath) {
  const section = `## Optimisation (before/after)

Generated by \`npm run assets:optimize\` (\`scripts/optimize-assets.mjs\` → \`scripts/verify-assets.mjs\`). Do not hand-edit.

| Metric | Sources (v3 + ${anatomy.version}) | \`public/models/thorax_sim.opt.glb\` |
|---|---|---|
${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}

Merge (manifest \`src/content/anatomy.json\`, ${anatomy.version}): \`${basename(srcPath)}\` minus ${dropped.size} removed / manifest-structure nodes and the same-name v3 nodes, plus all ${model.count} \`${basename(modelPath)}\` nodes at the scene root, identity transforms (docs/MODEL_INTEGRATION.md). Reference camera(s) ${(anatomy.referenceCameras ?? []).join(', ')} kept as non-step cameras. Source triangles = the kept nodes only.

Verify: **${result}** — identical node-name set (${opt.count}), node extras deep-equal (incl. port \`skin_point\`/\`pleura_point\`/\`axis_into_chest\`), camera params + transforms equal, morph target names per mesh equal (by name), ${morphChecks} world-space AABB checks of base pose and each morph at full influence within ${BOUNDS_TOL_M * 1000} mm.

Pipeline: dedup (unique names kept) → prune (leaves, extras, attributes, flat textures kept) → weld → WebP→PNG, normals capped 512 → KTX2 (UASTC normals, ETC1S colour/roughness, mipmapped) → meshopt (reorder, quantize incl. morph deltas, EXT_meshopt_compression) → Draco removed. No simplification. See ADR-006.

Loader notes: mesh nodes carry the KHR_mesh_quantization dequantisation in their local matrix, so mesh-node TRS differs from the source (world-space geometry does not); use port \`extras\`, not port node transforms. Decoders: \`public/decoders/basis_transcoder.{js,wasm}\` (KTX2Loader); meshopt decoder is bundled from \`three/examples/jsm/libs/meshopt_decoder.module.js\`; no Draco decoder needed.

`;
  const md = readFileSync(mdPath, 'utf8');
  const re = /## Optimisation \(before\/after\)[\s\S]*?(?=## Notes)/;
  if (!re.test(md)) throw new Error(`${mdPath}: Optimisation section not found`);
  const out = md.replace(re, section);
  writeFileSync(mdPath, await format(out, { ...(await resolveConfig(mdPath)), filepath: mdPath }));
  console.log(`wrote ${mdPath} (Optimisation section)`);
}
process.exit(errors.length ? 1 : 0);
