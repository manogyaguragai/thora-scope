// T703: static per-frame allocation audit (CONTEXT §6.10). Extracts the bodies of named hot functions/methods
// and greps them for allocations and logging.
// ponytail: regex + brace matching, not a parser. Ceilings: braces inside strings/template literals/regexes can
// mis-split a body; return types containing `{` aren't recognised as definitions; allocations hidden behind
// helper calls (e.g. clone(), Promise) aren't seen. Upgrade path: a TS-AST walk (typescript is installed).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** File → hot functions/methods called every frame (or per pointer move). Every name must be found. */
const HOT: Record<string, string[]> = {
  'src/core/renderer.ts': ['frame'],
  'src/core/perf.ts': ['tickPerf', 'sample'],
  'src/core/adaptiveResolution.ts': ['update', 'evaluate', 'step', 'applyPixelRatio'],
  'src/scene/postfx.ts': ['render', 'drawMeter', 'onMeter'],
  'src/scene/cameras.ts': ['update', 'targetPose', 'worldPose', 'lerpPose', 'copyPose'],
  'src/scene/effects.ts': ['update', 'attract', 'drain', 'touch', 'paint'],
  'src/scene/water.ts': ['update', 'apply'],
  'src/scene/hands.ts': ['update'],
  'src/scene/morphs.ts': ['updateMorphs'],
  'src/sim/state.ts': ['updateTweens'],
  'src/sim/physiology.ts': ['tickSim'],
  'src/sim/guided.ts': ['update'],
  'src/app/wireM3.ts': ['update'],
  'src/app/wireM4.ts': ['update'], // afterRender = pip.render (listed)
  'src/app/wireM5.ts': ['update'],
  'src/sim/instrumentControl.ts': ['update'],
  'src/sim/complications.ts': ['update'],
  'src/ui/pip.ts': ['render'],
  'src/scene/otRoom.ts': ['markScreenDirty'],
  'src/ui/compass.ts': ['update', 'projectAxes'],
  'src/sim/scopeRig.ts': ['drag', 'pivot', 'writePose', 'frame', 'viewDir', 'shaftFrame', 'setShaft'],
  'src/sim/actions/dissect.ts': ['update'],
  'src/sim/actions/retract.ts': ['update', 'drag'],
  'src/sim/actions/staple.ts': ['update', 'jawPose'],
  'src/scene/stumps.ts': ['sync', 'syncSplits', 'cutAt', 'centroid', 'followMatrix'],
  'src/scene/staples.ts': ['reveal'], // T841 progressive staple line
  'src/ui/vitalsMonitor.ts': ['tick', 'stroke'],
};

/** Known, documented exceptions (`file:name` → labels), each with its reason. Keep this short. */
const ALLOW: Record<string, string[]> = {
  // Rare event allocation: the over-traction tear request array, once per passage (see its doc comment).
  'src/sim/complications.ts:update': ['array literal assigned'],
};

const BANNED: [string, RegExp][] = [
  [
    'new math/array object',
    /\bnew\s+(Vector[234]|Quaternion|Matrix[34]|Color|Euler|Box3|Sphere|Ray|Array|Float32Array)\b/,
  ],
  ['array spread', /\[\s*\.\.\./],
  ['array literal assigned', /(=|return)\s*\[/],
  ['.map(', /\.map\(/],
  ['.filter(', /\.filter\(/],
  ['console.log', /console\.log/],
];

/** Strip // and /* *\/ comments (naive: ignores comment markers inside strings). */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Bodies of every definition of `name`: `function name(`, `name(...) {`, `name = (...) => {`. */
export function extractBodies(src: string, name: string): string[] {
  const out: string[] = [];
  const head = new RegExp(`\\b${name}\\s*(?:=\\s*(?:async\\s*)?)?\\(`, 'g');
  for (let m = head.exec(src); m; m = head.exec(src)) {
    let i = m.index + m[0].length;
    for (let depth = 1; i < src.length && depth > 0; i++)
      depth += src[i] === '(' ? 1 : src[i] === ')' ? -1 : 0;
    const tail = /^\s*(?::\s*[^{;=,)]+?)?\s*(?:=>\s*)?\{/.exec(src.slice(i));
    if (!tail) continue; // a call, not a definition
    const open = i + tail[0].length - 1;
    let j = open + 1;
    for (let depth = 1; j < src.length && depth > 0; j++)
      depth += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0;
    out.push(src.slice(open, j));
    head.lastIndex = j;
  }
  return out;
}

export function auditBody(body: string): string[] {
  return BANNED.filter(([, re]) => re.test(body)).map(([label]) => label);
}

describe('per-frame allocation audit (static)', () => {
  it('extractor finds definitions and flags allocations', () => {
    const src =
      'rig.update(dt);\nupdate(dt: number): void { const v = new Vector3(); }\nconst frame = (n) => { a.map(f) }';
    const [u] = extractBodies(src, 'update');
    expect(extractBodies(src, 'update')).toHaveLength(1);
    expect(auditBody(u ?? '')).toEqual(['new math/array object']);
    expect(auditBody(extractBodies(src, 'frame')[0] ?? '')).toEqual(['.map(']);
  });

  for (const [file, names] of Object.entries(HOT)) {
    it(`${file}: hot paths allocate nothing`, () => {
      const src = stripComments(readFileSync(resolve(file), 'utf8'));
      const hits: string[] = [];
      for (const name of names) {
        const bodies = extractBodies(src, name);
        expect(bodies.length, `${name} not found in ${file} (renamed? update HOT)`).toBeGreaterThan(0);
        const allowed = ALLOW[`${file}:${name}`] ?? [];
        for (const b of bodies)
          for (const label of auditBody(b)) if (!allowed.includes(label)) hits.push(`${name}: ${label}`);
      }
      expect(hits).toEqual([]);
    });
  }
});
