// Source glb → public/models/thorax_sim.opt.glb: Draco removed, meshopt + quantized (morph targets too),
// textures → KTX2 (UASTC normals, ETC1S colour/roughness). Then runs verify-assets.mjs.
// Usage: npm run assets:optimize   (downloads KTX-Software into .cache/ on first run; build-time only)
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress, weld } from '@gltf-transform/functions';
import { Mode, toktx } from '@gltf-transform/cli';
import draco3d from 'draco3dgltf';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'assets_src/thorax_sim_v3.glb');
const OUT = join(root, 'public/models/thorax_sim.opt.glb');
const DECODERS = join(root, 'public/decoders');
const BASIS_DIR = join(root, 'node_modules/three/examples/jsm/libs/basis');
const MAX_BYTES = 12_000_000; // CONTEXT §6.10: glb ≤ ~12 MB
const NORMAL_CAP = 512; // UASTC normals at 1024 overshoot the 12 MB budget (ADR-006)
const NORMAL_SLOTS = /normal/i;
const KTX = {
  version: '4.4.2',
  sha1: 'c6b08c817f8c8dd299deccae4f2fbb8d55e9acd2',
  dir: join(root, '.cache/ktx'),
};
const ktxHome = join(KTX.dir, `KTX-Software-${KTX.version}-Linux-x86_64`);

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
await doc.transform(
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
  [join(root, 'scripts/verify-assets.mjs'), SRC, OUT, '--md', join(root, 'docs/ASSETS.md')],
  { stdio: 'inherit' },
);
process.exit(verify.status ?? 1);
