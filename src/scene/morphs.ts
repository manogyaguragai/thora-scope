// Morph controller (CONTEXT §7.3): app state → 8 channel values → every mesh carrying each morph name.
// Bindings are resolved by name once at load (morph order differs per mesh); the per-frame path has no strings.
import type { Mesh, Object3D } from 'three';
import { config } from '../core/config';
import { breathOffset } from '../sim/physiology';
import type { AppState } from '../sim/state';

export const CHANNELS = [
  'collapse_RUL',
  'collapse_RML',
  'collapse_RLL',
  'mediastinal_shift',
  'retract_posterior',
  'retract_fissure',
  'heartbeat',
  'breath_left',
] as const;

interface VisNode {
  visible: boolean;
  parent: VisNode | null;
}
/** The subset of three's Mesh the controller touches (lets unit tests use plain objects). */
export interface MorphMesh extends VisNode {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
}

interface Binding {
  mesh: MorphMesh;
  index: number; // influence slot on that mesh
  channel: number; // index into CHANNELS
}

export interface MorphBindings {
  list: Binding[]; // grouped by mesh
  meshes: number;
  values: Float64Array; // channel values of the last update
  writes: number; // influences written by the last update
  skipped: number; // bindings skipped (hidden mesh) by the last update
}

const P = config.physiology;
const [GATE_LO, GATE_HI] = P.retractGate;

/** All meshes under root that have morph targets. Load-time only. */
export function collectMorphMeshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && m.morphTargetDictionary) out.push(m);
  });
  return out;
}

export function buildMorphBindings(meshes: readonly MorphMesh[]): MorphBindings {
  const list: Binding[] = [];
  let count = 0;
  for (const mesh of meshes) {
    const dict = mesh.morphTargetDictionary;
    if (!dict || !mesh.morphTargetInfluences) continue;
    const before = list.length;
    CHANNELS.forEach((name, channel) => {
      const index = dict[name];
      if (index !== undefined) list.push({ mesh, index, channel });
    });
    if (list.length > before) count++;
  }
  return { list, meshes: count, values: new Float64Array(CHANNELS.length), writes: 0, skipped: 0 };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * §7.3 mapping. Retraction gate uses min(deflate) for BOTH retract morphs: they were authored on the fully
 * collapsed right lung, and each moves all three lobes (posterior: whole lung; fissure: RUL/RML/RLL).
 */
export function computeChannels(s: AppState, out: Float64Array): void {
  const u = s.deflate_RUL;
  const m = s.deflate_RML;
  const l = s.deflate_RLL;
  const gate = smoothstep(GATE_LO, GATE_HI, Math.min(u, m, l));
  out[0] = clamp01(u + breathOffset(s, u));
  out[1] = clamp01(m + breathOffset(s, m));
  out[2] = clamp01(l + breathOffset(s, l));
  out[3] = Math.max(u, m, l);
  out[4] = s.retract_posterior * gate;
  out[5] = s.retract_fissure * gate;
  out[6] = s.heartbeat;
  out[7] = s.breath;
}

function shown(o: VisNode | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/**
 * Per frame. Writes an influence only when it differs from the stored one by > epsilon. Hidden meshes
 * (self or ancestor) are skipped; since the comparison is against the mesh's own stored influence, they
 * catch up on the first frame they are shown. Allocation-free. Returns the write count.
 */
export function updateMorphs(b: MorphBindings, s: AppState): number {
  const values = b.values;
  computeChannels(s, values);
  let writes = 0;
  let skipped = 0;
  let prev: MorphMesh | null = null;
  let vis = false;
  const list = b.list;
  for (let k = 0; k < list.length; k++) {
    const bd = list[k];
    if (!bd) continue;
    if (bd.mesh !== prev) {
      prev = bd.mesh;
      vis = shown(prev);
    }
    const inf = bd.mesh.morphTargetInfluences;
    if (!vis || !inf) {
      skipped++;
      continue;
    }
    const v = values[bd.channel] ?? 0;
    if (Math.abs(v - (inf[bd.index] ?? 0)) > P.morphEpsilon) {
      inf[bd.index] = v;
      writes++;
    }
  }
  b.writes = writes;
  b.skipped = skipped;
  return writes;
}
