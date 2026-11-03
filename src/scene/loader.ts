import { Box3, LoaderUtils } from 'three';
import type { Object3D, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
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

export async function loadModel(renderer: WebGLRenderer, onProgress: ByteProgress): Promise<LoadedModel> {
  const ktx2 = new KTX2Loader().setTranscoderPath(config.decoderPath).detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  try {
    const data = await fetchModel(config.modelUrl, onProgress);
    const gltf = await loader.parseAsync(data, LoaderUtils.extractUrlBase(config.modelUrl));
    const axis = checkAxis(gltf.scene);
    console.info(axis);
    return { gltf, axis };
  } finally {
    ktx2.dispose(); // all textures are in the one glb; free the transcoder workers
  }
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
