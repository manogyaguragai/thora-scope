// Morph controller (CONTEXT §7.3): app state → channel values → every mesh carrying each morph name. Channels =
// the manifest morphs (src/content/anatomy.json, additive deltas from the inflated Basis) + heartbeat + breath_left.
// Bindings are resolved by name once at load (morph order differs per mesh); the per-frame path has no allocations.
import type { Mesh, Object3D } from 'three';
import { ANATOMY } from '../content/anatomy';
import type { Anatomy } from '../content/anatomy';
import { config } from '../core/config';
import { breathOffset } from '../sim/physiology';
import { TWEEN_KEYS } from '../sim/state';
import type { AppState, TweenKey } from '../sim/state';

const MODEL = ANATOMY.morphs;
export const CHANNELS: readonly string[] = [...MODEL, 'heartbeat', 'breath_left'];
const HEART = MODEL.length;
const BREATH = HEART + 1;
const COLLAPSE = 'collapse_';
/** Legacy grasper key (old model's retract_posterior) also drives this morph until T832/T833 move to it. */
const LEGACY_RETRACT: TweenKey = 'retract_posterior';
const LEGACY_TARGET = 'retract_hilum';

/** State key per model morph: collapse_<lobe> ← deflate_<lobe> (ventilated lobes breathe), else the same name. */
const SOURCE: (TweenKey | null)[] = MODEL.map((m) => {
  const key = m.startsWith(COLLAPSE) ? `deflate_${m.slice(COLLAPSE.length)}` : m;
  if ((TWEEN_KEYS as readonly string[]).includes(key)) return key as TweenKey;
  console.warn(`[morphs] manifest morph "${m}" has no state key; held at 0`);
  return null;
});
const BREATHES = MODEL.map((m) => m.startsWith(COLLAPSE));
/** T843: manifest `collapseGain` scales the collapse_* depth (v7's collapse is shallow; the keys are analytic, so
 *  extrapolating stays connected). Breathing excursion is not scaled. */
export const COLLAPSE_GAIN = (ANATOMY as Anatomy & { collapseGain?: number }).collapseGain ?? 1;
const LEGACY = MODEL.indexOf(LEGACY_TARGET);

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

/** §7.3 mapping. The model's keys are additive and position-independent, so no retraction gate is needed. */
export function computeChannels(s: AppState, out: Float64Array): void {
  for (let i = 0; i < SOURCE.length; i++) {
    const key = SOURCE[i];
    const v = key ? s[key] : 0;
    out[i] = BREATHES[i] ? clamp01(v + breathOffset(s, v)) + (COLLAPSE_GAIN - 1) * v : v;
  }
  if (LEGACY >= 0) out[LEGACY] = Math.max(out[LEGACY] ?? 0, s[LEGACY_RETRACT]);
  out[HEART] = s.heartbeat;
  out[BREATH] = s.breath;
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
