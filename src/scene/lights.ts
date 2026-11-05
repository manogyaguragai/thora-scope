// Scope lighting (CONTEXT §7.5, §8): the headlight on the lens is THE light; tiny ambient; dim env for reflections.
// Built once at load; light count never changes afterwards (§6.10).
import {
  BackSide,
  Color,
  FrontSide,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene as ThreeScene,
  SphereGeometry,
  SpotLight,
} from 'three';
import type { Camera, Scene, Side, WebGLRenderer } from 'three';
import { config } from '../core/config';
import { look } from './materials.config';

const a = look.ambient;
const ambient = new HemisphereLight(a.sky, a.ground, a.intensity);

/** View change: the outside view has no headlight on the body, so the ambient is raised (intensity only). */
export function setAmbientForView(scope: boolean): void {
  ambient.intensity = scope ? a.intensity : a.outsideIntensity;
}

export function setupLights(scene: Scene, camera: Camera, renderer: WebGLRenderer): SpotLight {
  const h = look.headlight;
  const headlight = new SpotLight(h.color, h.intensity, h.distance, h.angle, h.penumbra, h.decay);
  headlight.name = 'scope_headlight';
  // Co-located with the lens, aimed down the view axis (-Z in camera space).
  camera.add(headlight, headlight.target);
  headlight.position.set(0, 0, 0); // SpotLight defaults to DEFAULT_UP (0,1,0)
  headlight.target.position.set(0, 0, -1);

  scene.add(ambient);

  const pmrem = new PMREMGenerator(renderer);
  const cavity = cavityScene();
  scene.environment = pmrem.fromScene(cavity, look.env.sigma).texture;
  scene.environmentIntensity = look.env.intensity;
  cavity.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose(); // shared sphere: a second dispose is a no-op
      (o.material as MeshBasicMaterial).dispose();
    }
  });
  pmrem.dispose();
  return headlight;
}

/** Warm maroon cavity + one warm lamp patch (config.cavityEnv): the reflection source, rendered once into PMREM. */
function cavityScene(): ThreeScene {
  const E = config.cavityEnv;
  const env = new ThreeScene();
  const sphere = new SphereGeometry(1, 32, 16);
  const unlit = (hex: string, k: number, side: Side): MeshBasicMaterial =>
    new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(k), side, toneMapped: false });
  env.add(new Mesh(sphere, unlit(E.surround, E.surroundIntensity, BackSide))); // seen from inside
  const spot = new Mesh(sphere, unlit(E.spot, E.spotIntensity, FrontSide));
  spot.scale.setScalar(E.spotRadius);
  spot.position
    .set(...E.spotDir)
    .normalize()
    .multiplyScalar(1 - E.spotRadius);
  env.add(spot);
  return env;
}
