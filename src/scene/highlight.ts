// T861 walkthrough highlight (FEEDBACK_GUIDED_v1 §2.1-7; HighlightApi in src/app/walkthrough/types.ts). Built ONCE
// at load (§6.10): per scene mesh a rim overlay + a soft back-face outline shell, sharing the mesh's geometry, its
// morphTargetInfluences array (follows collapse / retraction) and its fixed-length clippingPlanes array (divided
// structures stay clipped). Lobe meshes also get a fissure-band overlay: a soft per-vertex strip round the step-7
// fissure guide's traced path (its segments, step-7 pose) on both lobes either side of the gap; per-vertex, so it
// follows the lobes in every pose. All overlays are
// additive ShaderMaterials compiled in the loader's compile stage (they are in the scene, forced visible there);
// runtime = one shared colour uniform write + visibility / matrix copies of the current subject's overlays.
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  Color,
  FrontSide,
  Group,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { Material, Object3D, Side } from 'three';
import type { HighlightApi } from '../app/walkthrough/types';
import { posedPositions } from './fissureGuide';
import type { Segment } from './fissureGuide';
import { fissureGuideConfig } from './fissureGuide.config';
import { highlightConfig as C } from './highlight.config';
import { getStep } from '../sim/steps';

/** Pure: cosine-eased pulse 0…1 with period `periodMs` (0 at t = 0). */
export function pulse(tMs: number, periodMs: number = C.periodMs): number {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * tMs) / periodMs);
}

const smooth = (x: number): number => x * x * (3 - 2 * x);

/** Pure fade + pulse state (unit-tested): level eases linearly toward target over the fade time; intensity is the
 *  smoothstepped level × (base + amp × pulse). */
export class GlowFader {
  level = 0;
  target = 0;
  private rate = 0; // level per ms
  private t = 0; // ms since the current subject started (pulse phase)

  fadeTo(target: number, ms: number): void {
    this.target = target;
    this.rate = ms > 0 ? 1 / ms : 0;
    if (!(ms > 0)) this.level = target; // instant (reduced motion / seek)
  }
  restartPulse(): void {
    this.t = 0;
  }
  update(dtMs: number): void {
    this.t += dtMs;
    const step = this.rate * dtMs;
    this.level =
      this.target > this.level
        ? Math.min(this.target, this.level + step)
        : Math.max(this.target, this.level - step);
  }
  get intensity(): number {
    return smooth(this.level) * (C.base + C.amp * pulse(this.t));
  }
}

export type HighlightSubject = Parameters<HighlightApi['show']>[0];

/** Stable key of a subject (`active`): node names joined by ',' or `fissure:<which>`. */
export function subjectKey(s: HighlightSubject): string {
  return 'fissure' in s ? `fissure:${s.fissure}` : s.join(',');
}

export interface Highlight extends HighlightApi {
  /** scene.add(group) before the compile stage. */
  readonly group: Group;
  /** Per frame. Allocation-free. */
  update(now: number): void;
}

const VERT = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <clipping_planes_pars_vertex>
uniform float uLift;
varying vec3 vHlN;
varying vec3 vHlV;
#ifdef HL_BAND
attribute vec2 aFissure;
uniform vec2 uSel;
varying float vBand;
#endif
void main() {
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <defaultnormal_vertex>
	#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal; // outline shell: inflate outward
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	vHlN = normalize( transformedNormal );
	mvPosition.xyz += vHlN * uLift;
	gl_Position = projectionMatrix * mvPosition;
	vHlV = - mvPosition.xyz;
	#ifdef HL_BAND
	vBand = dot( aFissure, uSel );
	#endif
	#include <clipping_planes_vertex>
}`;

const FRAG = /* glsl */ `
#include <clipping_planes_pars_fragment>
uniform vec3 uColor;
uniform vec3 uShape;
varying vec3 vHlN;
varying vec3 vHlV;
#ifdef HL_BAND
varying float vBand;
#endif
void main() {
	#include <clipping_planes_fragment>
	float ndv = abs( dot( normalize( vHlN ), normalize( vHlV ) ) );
	#if defined( HL_BAND )
	float k = clamp( ( vBand - uShape.x ) / ( 1.0 - uShape.x ), 0.0, 1.0 ) * uShape.y;
	#elif defined( HL_OUTLINE )
	float k = smoothstep( 0.0, uShape.x, ndv ) * uShape.y;
	#else
	float k = pow( 1.0 - ndv, uShape.x ) * uShape.y + uShape.z;
	#endif
	gl_FragColor = vec4( uColor * k, 1.0 );
}`;

type Kind = 'rim' | 'outline' | 'band';
const SHAPE: Record<Kind, readonly [number, number, number]> = {
  rim: [C.rim.power, C.rim.strength, C.rim.fill],
  outline: [C.outline.soft, C.outline.strength, 0],
  band: [1 - C.fissure.bandM / C.fissure.insetBandM, C.fissure.strength, 0], // x: T888 width threshold
};
const LIFT: Record<Kind, number> = { rim: C.rim.liftM, outline: C.outline.widthM, band: C.fissure.liftM };
const SIDE: Record<Kind, Side> = { rim: FrontSide, outline: BackSide, band: FrontSide };
const DEFINES: Record<Kind, Record<string, string>> = {
  rim: {},
  outline: { HL_OUTLINE: '' },
  band: { HL_BAND: '' },
};

interface Entry {
  readonly src: Mesh;
  readonly rim: Mesh;
  readonly outline: Mesh;
  band: Mesh | null;
}

/** Load time, after applyRealism (the overlays copy the realism materials' clipping arrays) and the fissure guide
 *  (`segments`: its traced path, in fissureGuideConfig order), before compile. */
export function buildHighlight(model: Object3D, segments: readonly Segment[]): Highlight {
  const color = new Color(C.color);
  const uColor = { value: new Vector3() }; // colour × intensity, shared by every overlay
  const uSel = { value: new Vector2() }; // fissure band selector: x horizontal, y oblique
  const group = new Group();
  group.name = 'highlight';
  group.matrixAutoUpdate = false;

  const overlay = (src: Mesh, kind: Kind): Mesh => {
    const planes = (src.material as Material).clippingPlanes;
    const mat = new ShaderMaterial({
      name: `highlight:${kind}`,
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: DEFINES[kind],
      uniforms: {
        uColor,
        uSel,
        uLift: { value: LIFT[kind] },
        uShape: { value: new Vector3(...SHAPE[kind]) },
      },
      side: SIDE[kind],
      transparent: true, // fixed from creation (§6.10)
      depthWrite: false,
      blending: AdditiveBlending,
      clipping: true,
      clippingPlanes: planes,
    });
    const o = new Mesh(src.geometry, mat);
    o.name = `${src.name}:highlight-${kind}`;
    o.morphTargetInfluences = src.morphTargetInfluences; // shared array: follows every morph write
    o.morphTargetDictionary = src.morphTargetDictionary;
    o.matrixAutoUpdate = false;
    o.matrixWorldAutoUpdate = false; // update() copies the source's matrixWorld while shown
    o.frustumCulled = src.frustumCulled;
    o.visible = false;
    group.add(o);
    return o;
  };

  const byMesh = new Map<Mesh, Entry>();
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    byMesh.set(mesh, { src: mesh, rim: overlay(mesh, 'rim'), outline: overlay(mesh, 'outline'), band: null });
  });
  /** Every named node → the overlays of all meshes under it. */
  const byName = new Map<string, Entry[]>();
  model.traverse((o) => {
    if (!o.name || byName.has(o.name)) return;
    const list: Entry[] = [];
    o.traverse((c) => {
      const e = byMesh.get(c as Mesh);
      if (e) list.push(e);
    });
    byName.set(o.name, list);
  });

  // Fissure bands: per lobe mesh a vec2 attribute (x horizontal, y oblique), soft strip round the guide path.
  const lobe = model.getObjectByName(fissureGuideConfig.lobe);
  const fissureEntries: Entry[] = [];
  let first = 0;
  fissureGuideConfig.fissures.forEach((f, k) => {
    const nb = model.getObjectByName(f.neighbour);
    const path = segments.slice(first, (first += f.segments)).flatMap((sg) => sg.points);
    for (const node of [lobe, nb])
      if (node && path.length > 1) markPath(node, path, k, byMesh, fissureEntries);
  });
  for (const e of fissureEntries) e.band = overlay(e.src, 'band');

  const fader = new GlowFader();
  let cur: readonly Entry[] | null = null;
  let curKey: string | null = null;
  let curBand = false;
  let next: HighlightSubject | null = null;
  let nextMs = 0;
  let last = 0;

  const setShown = (list: readonly Entry[], band: boolean, on: boolean): void => {
    for (const e of list) {
      if (band) {
        if (e.band) e.band.visible = on;
      } else e.rim.visible = e.outline.visible = on;
    }
  };
  const start = (s: HighlightSubject, ms: number): void => {
    if (cur) setShown(cur, curBand, false);
    curBand = 'fissure' in s;
    if ('fissure' in s) {
      cur = fissureEntries;
      uSel.value.set(s.fissure === 'horizontal' ? 1 : 0, s.fissure === 'oblique' ? 1 : 0);
    } else {
      const list: Entry[] = []; // event time (beat start), not per frame
      for (const n of s) for (const e of byName.get(n) ?? []) if (!list.includes(e)) list.push(e);
      cur = list;
    }
    curKey = subjectKey(s);
    fader.restartPulse();
    fader.fadeTo(1, ms);
  };

  return {
    group,
    get active() {
      return curKey;
    },
    show(s, fadeMs) {
      const key = subjectKey(s);
      next = null;
      if (key === curKey) return fader.fadeTo(1, fadeMs);
      if (!curKey || fader.level === 0) return start(s, fadeMs);
      next = s; // fade the previous subject out first
      nextMs = fadeMs;
      fader.fadeTo(0, fadeMs * C.switchShare);
    },
    hide(fadeMs) {
      next = null;
      fader.fadeTo(0, fadeMs);
    },
    update(now) {
      const dt = last ? now - last : 0;
      last = now;
      if (!cur) return;
      fader.update(dt);
      if (fader.level === 0 && fader.target === 0) {
        if (next) {
          const s = next;
          next = null;
          start(s, nextMs);
        } else {
          setShown(cur, curBand, false);
          cur = curKey = null;
          return;
        }
      }
      uColor.value.set(color.r, color.g, color.b).multiplyScalar(fader.intensity);
      for (const e of cur) {
        const o = curBand ? e.band : e.rim;
        if (!o) continue;
        const shown = shownChain(e.src);
        if (o.visible !== shown) {
          o.visible = shown;
          if (!curBand) e.outline.visible = shown;
        }
        if (!shown) continue;
        o.matrixWorld.copy(e.src.matrixWorld);
        if (!curBand) e.outline.matrixWorld.copy(e.src.matrixWorld);
      }
    },
  };
}

/** The mesh and all its ancestors are visible (hidden structures don't glow). */
function shownChain(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

const _ab = new Vector3();
const _ap = new Vector3();
/** Pure: distance from `p` to the polyline `path`. */
export function distToPath(p: Vector3, path: readonly Vector3[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Vector3;
    _ab.subVectors(path[i] as Vector3, a);
    _ap.subVectors(p, a);
    const t = Math.min(1, Math.max(0, _ab.dot(_ap) / Math.max(_ab.lengthSq(), 1e-12)));
    best = Math.min(best, _ap.addScaledVector(_ab, -t).length());
  }
  return best;
}

/** Load time: on every mesh of `node`, component `k` of aFissure = soft weight (1 on the path → 0 at insetBandM) of each
 *  vertex near the guide path, measured in the guide's (step-7) pose. */
function markPath(
  node: Object3D,
  path: readonly Vector3[],
  k: number,
  byMesh: Map<Mesh, Entry>,
  out: Entry[],
): void {
  const pose = getStep(fissureGuideConfig.step).state;
  const R = C.fissure.insetBandM; // T888: baked wide, thresholded to bandM outside the inset
  node.traverse((o) => {
    const e = byMesh.get(o as Mesh);
    if (!e) return;
    const geo = e.src.geometry;
    const n = geo.getAttribute('position').count;
    const pts = posedPositions(e.src, pose);
    let attr = geo.getAttribute('aFissure') as BufferAttribute | undefined;
    for (let i = 0; i < n; i++) {
      const d = distToPath(pts[i] as Vector3, path);
      if (d >= R) continue;
      if (!attr) {
        attr = new BufferAttribute(new Float32Array(n * 2), 2);
        geo.setAttribute('aFissure', attr);
        out.push(e);
      }
      attr.setComponent(i, k, Math.max(attr.getComponent(i, k), 1 - d / R));
    }
  });
}
