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
import type { Camera, Scene, Side, Texture, WebGLRenderer } from 'three';
import { config } from '../core/config';
import { instrumentLook } from './instruments.config';
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
  scene.environment = envFrom(pmrem, config.cavityEnv);
  scene.environmentIntensity = look.env.intensity;
  instrumentEnv = envFrom(pmrem, instrumentLook.env);
  pmrem.dispose();
  return headlight;
}

let instrumentEnv: Texture | null = null;
/** T821: neutral reflection env for the instruments (built in setupLights, before buildInstruments). As a material
 *  envMap it also makes the per-material envMapIntensity count (three uses scene.environmentIntensity for
 *  scene.environment); same PMREM size as the cavity env → same program. null before setupLights (unit tests). */
export const getInstrumentEnv = (): Texture | null => instrumentEnv;

interface EnvLook {
  surround: string;
  surroundIntensity: number;
  spot: string;
  spotIntensity: number;
  spotRadius: number;
  spotDir: readonly [number, number, number];
}

function envFrom(pmrem: PMREMGenerator, E: EnvLook): Texture {
  const cavity = cavityScene(E);
  const tex = pmrem.fromScene(cavity, look.env.sigma).texture;
  cavity.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose(); // shared sphere: a second dispose is a no-op
      (o.material as MeshBasicMaterial).dispose();
    }
  });
  return tex;
}

/** Surround sphere + one lamp patch (config.cavityEnv: warm maroon cavity), rendered once into PMREM. */
function cavityScene(E: EnvLook): ThreeScene {
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
