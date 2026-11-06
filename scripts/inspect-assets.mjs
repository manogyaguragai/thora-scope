// Factual inventory of a .glb (read-only). Usage: node scripts/inspect-assets.mjs <glb> [--out docs/ASSETS.md]
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, ImageUtils, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';
import { format, resolveConfig } from 'prettier';

const args = process.argv.slice(2);
const glbPath = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
if (!glbPath || (outIdx >= 0 && !outPath)) {
  console.error('Usage: node scripts/inspect-assets.mjs <glb> [--out docs/ASSETS.md]');
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stepsPath = join(root, 'src/content/procedure_steps.json'); // the app's step table
const anatomy = JSON.parse(readFileSync(join(root, 'src/content/anatomy.json'), 'utf8'));
const PORT_KEYS = ['skin_point', 'pleura_point', 'axis_into_chest'];
// CONTEXT §7.2 explicit names (brachiocephalic vessels covered by procedure_steps.json layer_groups).
const CONTEXT_NAMES = [
  'lung_upper_lobe_left',
  'lung_lower_lobe_left',
  'arteries_left_intrapulm',
  // RML hilum model: every structure in the manifest (src/content/anatomy.json)
  ...Object.keys(anatomy.structures),
  'vagus_nerve_right',
  'inferior_vena_cava',
  'aorta',
  'heart_rest',
  'esophagus',
  'diaphragm',
  'skin',
  'subcutaneous_fat',
  'chest_wall_muscle',
  'intercostal_muscles',
  'parietal_pleura_wall',
  'spine',
  'sternum',
  'scapula_left',
  'scapula_right',
  'clavicula_left',
  'clavicula_right',
  'costal_cartilages',
  'port_camera_8ICS',
  'port_utility_5ICS',
  'port_retraction_8ICS',
  'thorax_root',
  ...Array.from({ length: 12 }, (_, i) => `rib_R${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `rib_L${i + 1}`),
];

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
});
const doc = await io.read(glbPath);
const docRoot = doc.getRoot();
const scene = docRoot.getDefaultScene() ?? docRoot.listScenes()[0];
const nodes = docRoot.listNodes();
const byName = new Map(nodes.map((n) => [n.getName(), n]));

const f = (n, d = 4) => Number(n).toFixed(d);
const vec = (v) => `(${v.map((x) => f(x)).join(', ')})`;
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const mb = (b) => `${(b / 1048576).toFixed(2)} MiB`;
const num = (x) => Number(x.toPrecision(6));
const table = (head, rows) =>
  [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
const centroid = (list) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const n of list) {
    const b = getBounds(n);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i]);
      max[i] = Math.max(max[i], b.max[i]);
    }
  }
  return { min, max, c: min.map((v, i) => (v + max[i]) / 2) };
};
const hasAncestor = (node, name) => {
  for (let p = node.getParentNode(); p; p = p.getParentNode()) if (p.getName() === name) return true;
  return false;
};

// --- Nodes & meshes
const meshNodes = nodes.filter((n) => n.getMesh());
const mismatches = meshNodes.filter((n) => n.getName() !== n.getMesh().getName());
const meshStats = docRoot.listMeshes().map((m) => {
  let tris = 0;
  let verts = 0;
  for (const p of m.listPrimitives()) {
    const v = p.getAttribute('POSITION')?.getCount() ?? 0;
    const idx = p.getIndices()?.getCount() ?? v;
    verts += v;
    if (p.getMode() === 4) tris += idx / 3;
    else if (p.getMode() === 5 || p.getMode() === 6) tris += Math.max(0, idx - 2);
  }
  const targets = m.getExtras()?.targetNames ?? [];
  const nTargets = m.listPrimitives()[0]?.listTargets().length ?? 0;
  return { name: m.getName(), tris, verts, targets, nTargets };
});
meshStats.sort((a, b) => b.tris - a.tris);
const totalTris = meshStats.reduce((s, m) => s + m.tris, 0);
const totalVerts = meshStats.reduce((s, m) => s + m.verts, 0);

// --- Morphs
const morphCount = new Map();
for (const m of meshStats) for (const t of m.targets) morphCount.set(t, (morphCount.get(t) ?? 0) + 1);
const morphOdd = meshStats.filter((m) => m.targets.length !== m.nTargets);

// --- Materials & textures
const texName = (t) => t?.getName() || t?.getURI() || '(unnamed)';
const materials = docRoot.listMaterials().map((mat) => {
  const cc = mat.getExtension('KHR_materials_clearcoat');
  const slots = [
    ['base', mat.getBaseColorTexture()],
    ['normal', mat.getNormalTexture()],
    ['mr', mat.getMetallicRoughnessTexture()],
    ['ao', mat.getOcclusionTexture()],
    ['emis', mat.getEmissiveTexture()],
    ['cc', cc?.getClearcoatTexture()],
    ['ccRough', cc?.getClearcoatRoughnessTexture()],
    ['ccNormal', cc?.getClearcoatNormalTexture()],
  ].filter(([, t]) => t);
  return {
    name: mat.getName(),
    clearcoat: cc ? `${f(cc.getClearcoatFactor(), 2)}/${f(cc.getClearcoatRoughnessFactor(), 2)}` : '—',
    alpha: mat.getAlphaMode(),
    textures: slots.map(([s, t]) => `${s}:${texName(t)}`).join(', ') || '—',
  };
});
const textures = docRoot.listTextures().map((t) => {
  const img = t.getImage();
  const size = img ? ImageUtils.getSize(img, t.getMimeType()) : null;
  return { name: texName(t), mime: t.getMimeType(), size, bytes: img?.byteLength ?? 0 };
});
const texBytes = textures.reduce((s, t) => s + t.bytes, 0);
const texPixels = textures.reduce((s, t) => s + (t.size ? t.size[0] * t.size[1] : 0), 0);

// --- Cameras
const cameras = nodes
  .filter((n) => n.getCamera())
  .map((n) => {
    const c = n.getCamera();
    return {
      name: n.getName(),
      cam: c.getName(),
      type: c.getType(),
      yfov: c.getYFov(),
      znear: c.getZNear(),
      zfar: c.getZFar(),
      pos: n.getWorldTranslation(),
    };
  });

// --- Ports
const toGl = ([x, y, z]) => [x, z, -y];
const ports = nodes
  .filter((n) => n.getName().startsWith('port_'))
  .map((n) => {
    const e = n.getExtras() ?? {};
    // cos(angle) between (pleura − skin) and axis_into_chest; ≈1 means extras are self-consistent.
    let cos = NaN;
    if (PORT_KEYS.every((k) => Array.isArray(e[k]))) {
      const d = e.pleura_point.map((v, i) => v - e.skin_point[i]);
      const dot = d.reduce((s, v, i) => s + v * e.axis_into_chest[i], 0);
      cos = dot / (Math.hypot(...d) * Math.hypot(...e.axis_into_chest));
    }
    return { name: n.getName(), extras: e, pos: n.getWorldTranslation(), cos };
  });

// --- Hierarchy
const sceneRoots = scene.listChildren().map((n) => n.getName());
const outsideRoot = meshNodes.filter((n) => !hasAncestor(n, 'thorax_root')).map((n) => n.getName());

// --- Axis verification (CONTEXT §7.1)
const pick = (names) => names.map((n) => byName.get(n)).filter(Boolean);
const rightLobes = pick(['lung_upper_lobe_right', 'lung_middle_lobe_right', 'lung_lower_lobe_right']);
const heart = pick(['heart_rest']);
const axisY =
  rightLobes.length && heart.length ? { lung: centroid(rightLobes).c, heart: centroid(heart).c } : null;
const yPass = axisY ? axisY.lung[1] > axisY.heart[1] : false;
const superior = pick(['clavicula_left', 'clavicula_right', 'bronchial_tree']);
const inferior = pick(['diaphragm']);
const axisX =
  superior.length && inferior.length ? { sup: centroid(superior).c, inf: centroid(inferior).c } : null;
const xPass = axisX ? axisX.sup[0] > axisX.inf[0] : false;
const sternum = pick(['sternum']);
const spine = pick(['spine']);
const axisZ = sternum.length && spine.length ? { st: centroid(sternum).c, sp: centroid(spine).c } : null;
const zPass = axisZ ? axisZ.st[2] > axisZ.sp[2] : false;

// --- Cross-check
const steps = JSON.parse(readFileSync(stepsPath, 'utf8'));
const refs = new Map();
const addRef = (name, src) => refs.set(name, [...(refs.get(name) ?? []), src]);
for (const n of steps.default_hidden ?? []) addRef(n, 'default_hidden');
for (const s of steps.steps ?? []) {
  for (const n of s.hidden ?? []) addRef(n, `step${s.step}.hidden`);
  if (s.camera) addRef(s.camera, `step${s.step}.camera`);
  if (s.port) addRef(s.port, `step${s.step}.port`);
}
for (const [g, list] of Object.entries(steps.layer_groups ?? {}))
  for (const n of list) addRef(n, `layer_groups.${g}`);
const missingSteps = [...refs].filter(([n]) => !byName.has(n));
const missingContext = CONTEXT_NAMES.filter((n) => !byName.has(n));
const stepMorphs = [...new Set([...Object.keys(steps.state_to_morph ?? {}), ...anatomy.morphs])];
const missingMorphs = stepMorphs.filter((m) => !morphCount.has(m));

// --- Report
const bytes = statSync(glbPath).size;
const rel = relative(root, glbPath) || glbPath;
const pass = (b) => (b ? 'PASS' : 'FAIL');
// Optimisation section is owned by scripts/verify-assets.mjs (npm run assets:optimize); keep it on re-run.
const optSection =
  (outPath && existsSync(outPath)
    ? readFileSync(outPath, 'utf8').match(/## Optimisation \(before\/after\)[\s\S]*?(?=## Notes)/)?.[0]
    : null) ?? '## Optimisation (before/after)\nRun `npm run assets:optimize` to fill this section.\n\n';
const md = `# ASSETS — \`${rel}\`

Generated by \`node scripts/inspect-assets.mjs ${rel} --out docs/ASSETS.md\`. Do not hand-edit; re-run instead.
Coordinates are glTF world space (metres) after decode. Axis convention: CONTEXT §7.1.

## Summary
${table(
  ['Metric', 'Value'],
  [
    ['File size', `${mb(bytes)} (${bytes} B)`],
    [
      'Extensions used',
      doc
        .getRoot()
        .listExtensionsUsed()
        .map((e) => e.extensionName)
        .join(', '),
    ],
    ['Nodes / mesh nodes / meshes', `${nodes.length} / ${meshNodes.length} / ${meshStats.length}`],
    ['Triangles / vertices (total)', `${totalTris} / ${totalVerts}`],
    ['Morph target names', `${morphCount.size} (${[...morphCount.keys()].join(', ')})`],
    ['Materials / textures', `${materials.length} / ${textures.length}`],
    ['Texture bytes / pixels', `${mb(texBytes)} / ${(texPixels / 1e6).toFixed(1)} MP`],
    ['Cameras', String(cameras.length)],
    ['Axis check (right lung Y > heart Y)', pass(yPass)],
    ['Missing names (procedure_steps / CONTEXT §7.2)', `${missingSteps.length} / ${missingContext.length}`],
  ],
)}

## Nodes & mismatches
Scene roots (${sceneRoots.length}): ${sceneRoots.map((n) => `\`${n}\``).join(', ')}.

\`thorax_root\` ${byName.has('thorax_root') ? 'exists' : 'MISSING'}; mesh nodes NOT under it: ${
  outsideRoot.length ? outsideRoot.map((n) => `\`${n}\``).join(', ') : 'none'
}.

\`thorax_root\` local TRS: ${
  byName.has('thorax_root')
    ? (() => {
        const r = byName.get('thorax_root');
        return `translation ${vec(r.getTranslation())}, rotation (xyzw) ${vec(r.getRotation())}, scale ${vec(r.getScale())}`;
      })()
    : '—'
}.

Node ≠ mesh name (${mismatches.length}):

${table(
  ['Node', 'Mesh'],
  mismatches.map((n) => [n.getName(), n.getMesh().getName()]),
)}

## Triangles
Total: **${totalTris}** triangles, **${totalVerts}** vertices over ${meshStats.length} meshes (sorted by triangles).

${table(
  ['Mesh', 'Tris', 'Verts', '% tris'],
  meshStats.map((m) => [m.name, m.tris, m.verts, f((100 * m.tris) / totalTris, 1)]),
)}

## Morph targets
Names come from glTF \`mesh.extras.targetNames\`.

${table(
  ['Morph name', 'Meshes carrying it'],
  [...morphCount].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]),
)}

Meshes with no morphs: ${meshStats.filter((m) => !m.nTargets).length}. Meshes whose targetNames count ≠ target count: ${
  morphOdd.length
    ? morphOdd.map((m) => `\`${m.name}\` (${m.targets.length}/${m.nTargets})`).join(', ')
    : 'none'
}.

Per-mesh morph sets (grouped):

${table(
  ['Morph set', '# meshes', 'Meshes'],
  Object.entries(
    meshStats.reduce((acc, m) => {
      const k = m.targets.join(', ') || '(none)';
      (acc[k] ??= []).push(m.name);
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, list]) => [k, list.length, list.sort().join(', ')]),
)}

## Materials
${table(
  ['Material', 'Clearcoat (factor/rough)', 'Alpha', 'Textures'],
  materials.map((m) => [m.name, m.clearcoat, m.alpha, m.textures]),
)}

## Textures
Total: ${textures.length} textures, ${mb(texBytes)}, ${(texPixels / 1e6).toFixed(1)} MP.

${table(
  ['Texture', 'MIME', 'Pixels', 'Bytes'],
  [...textures]
    .sort((a, b) => b.bytes - a.bytes)
    .map((t) => [t.name, t.mime, t.size ? t.size.join('×') : '?', kb(t.bytes)]),
)}

## Cameras
${table(
  ['Node', 'Type', 'yfov (rad / °)', 'znear', 'zfar', 'World pos (glTF)'],
  cameras.map((c) => [
    c.name,
    c.type,
    `${f(c.yfov)} / ${f((c.yfov * 180) / Math.PI, 1)}`,
    num(c.znear),
    num(c.zfar),
    vec(c.pos),
  ]),
)}

## Ports (extras)
Raw extras are Blender world (Z-up); converted glTF = (x, z, −y) per CONTEXT §7.2.

${table(
  ['Port', 'Key', 'Blender (raw)', 'glTF (converted)'],
  ports.flatMap((p) =>
    PORT_KEYS.map((k) => {
      const v = p.extras[k];
      return [p.name, k, Array.isArray(v) ? vec(v) : 'MISSING', Array.isArray(v) ? vec(toGl(v)) : '—'];
    }),
  ),
)}

Port node world positions (glTF): ${ports.map((p) => `\`${p.name}\` ${vec(p.pos)}`).join('; ')}.

Consistency (cos between pleura−skin and axis_into_chest; 1 = aligned): ${ports
  .map((p) => `\`${p.name}\` ${f(p.cos, 4)}`)
  .join('; ')}.

Other port extras keys: ${ports
  .map(
    (p) =>
      `\`${p.name}\`: ${
        Object.keys(p.extras)
          .filter((k) => !PORT_KEYS.includes(k))
          .join(', ') || '—'
      }`,
  )
  .join('; ')}.

## Axis verification
${table(
  ['Check', 'Values', 'Result'],
  [
    [
      '+Y = patient right/up: right-lung centroid Y > heart_rest centroid Y',
      axisY ? `lung ${vec(axisY.lung)} vs heart ${vec(axisY.heart)}` : 'nodes missing',
      pass(yPass),
    ],
    [
      '+X = head: clavicles+airway centroid X > diaphragm centroid X',
      axisX ? `superior ${vec(axisX.sup)} vs diaphragm ${vec(axisX.inf)}` : 'nodes missing',
      pass(xPass),
    ],
    [
      '+Z = anterior: sternum centroid Z > spine centroid Z',
      axisZ ? `sternum ${vec(axisZ.st)} vs spine ${vec(axisZ.sp)}` : 'nodes missing',
      pass(zPass),
    ],
  ],
)}

## Cross-check vs procedure_steps.json
${refs.size} distinct node names referenced (steps[].hidden/camera/port, default_hidden, layer_groups). Missing in glb: ${
  missingSteps.length ? '' : '**none**.'
}
${
  missingSteps.length
    ? table(
        ['Name', 'Referenced by'],
        missingSteps.map(([n, s]) => [n, [...new Set(s)].join(', ')]),
      )
    : ''
}

state_to_morph keys missing as morph names: ${missingMorphs.length ? missingMorphs.join(', ') : '**none**'}.

CONTEXT §7.2 names (${CONTEXT_NAMES.length}) missing in glb: ${
  missingContext.length ? missingContext.map((n) => `\`${n}\``).join(', ') : '**none**'
}.

${optSection}## Notes
- Use node names (not mesh names) everywhere; see mismatch table.
- Morph target order differs between meshes: always resolve by name via \`morphTargetDictionary\`, never by index.
- Bounding boxes/centroids are the unmorphed base pose (right lobes inflated, every manifest morph = 0).
- The ${anatomy.version} hilum + right lobes (\`${anatomy.source}\`) are scene roots in world space (not under \`thorax_root\`), see docs/MODEL_INTEGRATION.md.
- Geometry dominates file size: textures are only ${mb(texBytes)} of ${mb(bytes)}; morph targets multiply vertex data.
- Cameras and ports are scene roots, not children of \`thorax_root\` (see Nodes); apply any root transform to them separately. ${(anatomy.referenceCameras ?? []).map((c) => `\`${c}\``).join(', ')} (${anatomy.version}) reference view only, not a step camera (it aims the step 2–5 port views).
- \`rib_R5\` + \`rib_R6\` are two halves of anatomical rib 5 (CONTEXT §7.2) — mesh names are not anatomical labels.
- Asset defects found here are logged in \`docs/ASSET_ISSUES.md\`.
`;

// Prettier-format so `npm run lint` stays green after a re-run.
if (outPath)
  writeFileSync(outPath, await format(md, { ...(await resolveConfig(outPath)), filepath: outPath }));
console.log(
  [
    `file ${mb(bytes)} | nodes ${nodes.length} | meshes ${meshStats.length} | tris ${totalTris} | verts ${totalVerts}`,
    `morphs: ${[...morphCount].map(([k, v]) => `${k}×${v}`).join(', ')}`,
    `textures ${textures.length} (${mb(texBytes)}) | materials ${materials.length} | cameras ${cameras.length}`,
    `axis Y ${pass(yPass)} | X ${pass(xPass)} | Z ${pass(zPass)}`,
    `scene roots: ${sceneRoots.join(', ')} | mesh nodes outside thorax_root: ${outsideRoot.length}`,
    `missing (procedure_steps): ${missingSteps.map(([n]) => n).join(', ') || 'none'}`,
    `missing (CONTEXT §7.2): ${missingContext.join(', ') || 'none'} | missing morphs: ${missingMorphs.join(', ') || 'none'}`,
    outPath ? `wrote ${outPath}` : '',
  ].join('\n'),
);
