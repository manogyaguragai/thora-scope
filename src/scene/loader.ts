import { Box3, LoaderUtils, Sphere, Vector3 } from 'three';
import type { BufferAttribute, CompressedTexture, Material, Mesh, Object3D, WebGLRenderer } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { config } from '../core/config';

const RIGHT_LOBES = ['lung_upper_lobe_right', 'lung_middle_lobe_right', 'lung_lower_lobe_right'];
const HEART = 'heart_rest';

export interface LoadedModel {
  gltf: GLTF;
  /** `[axis] PASS|FAIL ...` line (CONTEXT §7.1). */
  axis: string;
}

/** Download progress in bytes; total is 0 when the server sends no Content-Length. */
export type ByteProgress = (loaded: number, total: number) => void;

/** Streamed fetch so progress is real bytes (§6.9 stage 1). Matches the `<link rel="preload" as="fetch">`. */
async function fetchModel(url: string, onProgress: ByteProgress): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Model download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  return new Blob(chunks).arrayBuffer();
}

/**
 * Download (bytes via onProgress), then decode; onDecode fires between the two (§6.9 stages 1–2).
 * KTX2 transcode and meshopt decode both run in workers (same pool size), torn down once parsed.
 * `textureDownscale` (quality preset) halves every mipmapped KTX2 texture before upload.
 */
export async function loadModel(
  renderer: WebGLRenderer,
  onProgress: ByteProgress,
  onDecode: () => void,
  textureDownscale = false,
): Promise<LoadedModel> {
  // Decoders are a lazy chunk fetched in parallel with the glb (keeps ~40 KB gz out of the initial JS budget).
  const [data, { GLTFLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
    fetchModel(config.modelUrl, onProgress),
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/KTX2Loader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  const ktx2 = new KTX2Loader().setTranscoderPath(config.decoderPath).detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  MeshoptDecoder.useWorkers(ktx2.workerPool.pool);
  try {
    onDecode();
    const gltf = await loader.parseAsync(data, LoaderUtils.extractUrlBase(config.modelUrl));
    if (textureDownscale) {
      const seen = new Set<CompressedTexture>();
      gltf.scene.traverse((o) => dropTopMip(o, seen));
    }
    gltf.scene.traverse(morphSafeBounds);
    freezeStatic(gltf.scene);
    const axis = checkAxis(gltf.scene);
    console.info(axis);
    return { gltf, axis };
  } finally {
    ktx2.dispose(); // all textures are in the one glb; free the transcoder workers
    MeshoptDecoder.useWorkers(0); // and the meshopt ones
  }
}

/** Low-preset texture cap: drop mip 0 of each KTX2 texture (half size, quarter memory). Load time only. */
function dropTopMip(o: Object3D, seen: Set<CompressedTexture>): void {
  const mats = (o as Object3D & { material?: Material | Material[] }).material;
  if (!mats) return;
  for (const m of Array.isArray(mats) ? mats : [mats])
    for (const v of Object.values(m)) {
      const t = v as CompressedTexture | null;
      const next = t?.isCompressedTexture ? t.mipmaps[1] : undefined;
      if (!t || !next || seen.has(t)) continue;
      seen.add(t);
      t.mipmaps.shift();
      t.image = { width: next.width, height: next.height } as typeof t.image;
    }
}

/**
 * §6.10: nothing in the glb moves (morphs aside; the camera rig drives its own camera), so compute matrices
 * once and skip the whole subtree in every frame's matrix update.
 */
function freezeStatic(root: Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((o) => (o.matrixAutoUpdate = false));
  root.matrixWorldAutoUpdate = false;
}

const tmpV = new Vector3();
const tmpBox = new Box3();
/**
 * §6.10 frustum culling stays on for morphed meshes: GLTFLoader's bounds assume the morph weights sum to ≤ 1, but
 * the lobes run collapse + shift + retract together. Radius = max over vertices of (distance from the rest-pose
 * box centre + sum of that vertex's target displacements), so any mix of weights in [-1, 1] stays inside. Load time.
 */
function morphSafeBounds(o: Object3D): void {
  const g = (o as Mesh).geometry;
  const targets = g?.morphAttributes.position;
  if (!targets?.length || !g.morphTargetsRelative) return;
  const pos = g.getAttribute('position') as BufferAttribute;
  const s = (g.boundingSphere ??= new Sphere());
  tmpBox.setFromBufferAttribute(pos).getCenter(s.center);
  let r = 0;
  for (let i = 0; i < pos.count; i++) {
    let d = tmpV.fromBufferAttribute(pos, i).distanceTo(s.center);
    for (const t of targets) d += tmpV.fromBufferAttribute(t, i).length();
    r = Math.max(r, d);
  }
  s.radius = r;
}

/** §7.1: +Y = patient's right (up). Right-lung bbox centre Y must exceed heart_rest's (same method as inspect-assets). */
export function checkAxis(root: Object3D): string {
  root.updateMatrixWorld(true);
  const lung = new Box3();
  for (const name of RIGHT_LOBES) {
    const o = root.getObjectByName(name);
    if (o) lung.expandByObject(o);
  }
  const heartObj = root.getObjectByName(HEART);
  if (lung.isEmpty() || !heartObj) return `[axis] FAIL missing ${lung.isEmpty() ? 'right lobes' : HEART}`;
  const lungY = (lung.min.y + lung.max.y) / 2;
  const heart = new Box3().setFromObject(heartObj);
  const heartY = (heart.min.y + heart.max.y) / 2;
  const pass = lungY > heartY;
  return `[axis] ${pass ? 'PASS' : 'FAIL'} right-lung Y=${lungY.toFixed(4)} heart_rest Y=${heartY.toFixed(4)}`;
}
