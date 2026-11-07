import { BoxGeometry, Group, Mesh, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import type { WalkStep } from '../../src/app/walkthrough/types';
import { WALK_STEPS } from '../../src/app/walkthrough/steps';
import { config } from '../../src/core/config';
import { beatWarmupViews } from '../../src/scene/beatViews';
import type { Port } from '../../src/sim/ports';

// T863: one warm-up camera per distinct (scope port, subject) of the walkthrough's cam beats.
const port = (id: string, x: number): Port => ({
  id,
  label: id,
  skin: new Vector3(x, 0.1, 0),
  pleura: new Vector3(x, 0.08, 0),
  axis: new Vector3(0, -1, 0),
});
const PORTS = [port('port_camera_8ICS', -0.1), port('port_retraction_8ICS', 0)];
const model = new Group();
const node = new Mesh(new BoxGeometry(0.01, 0.01, 0.01));
node.name = 'subject';
node.position.set(0.02, -0.03, 0.01);
model.add(node);

describe('beatWarmupViews', () => {
  test('dedupes by port + subject, follows scopePort moves, skips unknown nodes / step cams', () => {
    const step: WalkStep = {
      step: 1,
      scopePort: 'port_camera_8ICS',
      end: { finish: {}, state: {}, scopePort: 'port_retraction_8ICS' },
      beats: [
        { id: 'a', kind: 'working', say: '', cam: { k: 'frame', subject: 'subject' } },
        { id: 'b', kind: 'working', say: '', cam: { k: 'wide', subject: ['subject'], back: 0.02 } },
        { id: 'c', kind: 'working', say: '', cam: { k: 'frame', subject: 'missing' } },
        { id: 'd', kind: 'working', say: '', cam: { k: 'step' } },
        { id: 'e', kind: 'working', say: '', cam: { k: 'frame', subject: { bed: true } } },
        {
          id: 'f',
          kind: 'transition',
          say: '',
          cam: { k: 'scopePort', port: 'port_retraction_8ICS', subject: 'subject' },
        },
      ],
    };
    const views = beatWarmupViews([step], PORTS, model, new PerspectiveCamera());
    expect(views).toHaveLength(2);
    const [cam, ret] = views as [PerspectiveCamera, PerspectiveCamera];
    expect(cam.position.y).toBeCloseTo(0.08 - config.scopeRig.depthM.default);
    expect(ret.position.x).toBeCloseTo(0);
    // Looks at the subject: the camera's -Z axis points at the node.
    const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const to = node.position.clone().sub(cam.position).normalize();
    expect(fwd.dot(to)).toBeCloseTo(1, 5);
  });

  test('the shipped walkthrough steps parse', () => {
    expect(() => beatWarmupViews(WALK_STEPS, PORTS, model, new PerspectiveCamera())).not.toThrow();
  });
});
