// Scope lighting (CONTEXT §7.5, §8): the headlight on the lens is THE light; tiny ambient; dim env for reflections.
// Built once at load; light count never changes afterwards (§6.10).
import { HemisphereLight, PMREMGenerator, SpotLight } from 'three';
import type { Camera, Scene, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { look } from './materials.config';

export function setupLights(scene: Scene, camera: Camera, renderer: WebGLRenderer): SpotLight {
  const h = look.headlight;
  const headlight = new SpotLight(h.color, h.intensity, h.distance, h.angle, h.penumbra, h.decay);
  headlight.name = 'scope_headlight';
  // Co-located with the lens, aimed down the view axis (-Z in camera space).
  camera.add(headlight, headlight.target);
  headlight.position.set(0, 0, 0); // SpotLight defaults to DEFAULT_UP (0,1,0)
  headlight.target.position.set(0, 0, -1);

  const a = look.ambient;
  scene.add(new HemisphereLight(a.sky, a.ground, a.intensity));

  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, look.env.sigma).texture;
  scene.environmentIntensity = look.env.intensity;
  room.dispose();
  pmrem.dispose();
  return headlight;
}
