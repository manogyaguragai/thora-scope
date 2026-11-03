import { Box3 } from 'three';
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

export async function loadModel(renderer: WebGLRenderer): Promise<LoadedModel> {
  const ktx2 = new KTX2Loader().setTranscoderPath(config.decoderPath).detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  try {
    const gltf = await loader.loadAsync(config.modelUrl);
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
