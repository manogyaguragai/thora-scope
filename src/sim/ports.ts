// Port geometry (CONTEXT §7.2, ADR-004). Positions come from the port nodes' glTF extras (Blender world, Z-up),
// never from the port node transforms (those carry meshopt dequantisation offsets). Load time only.
import { Vector3 } from 'three';
import type { Object3D } from 'three';

export interface Port {
  id: string;
  /** Video-style role label (ADR-004). */
  label: string;
  skin: Vector3;
  /** Fulcrum / remote centre of motion. */
  pleura: Vector3;
  /** Unit, pointing into the chest. */
  axis: Vector3;
}

/** ADR-004 role labels; unknown ports fall back to their node name. */
export const PORT_LABELS: Readonly<Record<string, string>> = {
  port_camera_8ICS: 'Camera port',
  port_utility_5ICS: 'Access incision',
  port_retraction_8ICS: 'Anterior working port',
};

/** Minimum cos(pleura − skin, axis) for a port to count as consistent. */
export const PORT_AXIS_MIN_COS = 0.99;

const EXTRAS = ['skin_point', 'pleura_point', 'axis_into_chest'] as const;

/** Blender Z-up (x, y, z) → glTF (x, z, −y). */
export function blenderToGltf(v: readonly number[], out: Vector3): Vector3 {
  const [x, y, z] = v;
  if (x === undefined || y === undefined || z === undefined)
    throw new Error(`Bad port vector [${v.join(', ')}]`);
  return out.set(x, z, -y);
}

/** All ports under root (nodes carrying the three port extras), sorted by id. Throws if none or inconsistent. */
export function readPorts(root: Object3D): Port[] {
  const ports: Port[] = [];
  const missing: string[] = [];
  root.traverse((o) => {
    const ud = o.userData as Record<string, unknown>;
    const has = EXTRAS.filter((k) => Array.isArray(ud[k]));
    if (has.length === 0) {
      if (o.name.startsWith('port_') && !o.name.includes('.')) missing.push(o.name);
      return;
    }
    if (has.length !== EXTRAS.length)
      throw new Error(`Port "${o.name}": extras incomplete (has ${has.join(', ')})`);
    const skin = blenderToGltf(ud.skin_point as number[], new Vector3());
    const pleura = blenderToGltf(ud.pleura_point as number[], new Vector3());
    const axis = blenderToGltf(ud.axis_into_chest as number[], new Vector3()).normalize();
    const cos = pleura.clone().sub(skin).normalize().dot(axis);
    if (!(cos >= PORT_AXIS_MIN_COS))
      throw new Error(
        `Port "${o.name}": pleura − skin not parallel to axis_into_chest (cos ${cos.toFixed(3)})`,
      );
    ports.push({ id: o.name, label: PORT_LABELS[o.name] ?? o.name, skin, pleura, axis });
  });
  if (ports.length === 0)
    throw new Error(
      `No port extras (skin_point/pleura_point/axis_into_chest) found${missing.length ? ` on ${missing.join(', ')}` : ''}; ` +
        're-export the model with glTF extras enabled.',
    );
  return ports.sort((a, b) => (a.id < b.id ? -1 : 1));
}
