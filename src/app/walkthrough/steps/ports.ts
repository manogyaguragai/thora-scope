// T860 port + structure shorthands for the step files (ids per src/sim/ports.ts; labels there).
import type { PortId } from '../types';

export const CAM: PortId = 'port_camera_8ICS'; // inferior camera port
export const UTIL: PortId = 'port_utility_5ICS'; // anterior access incision (5th space)
export const POST: PortId = 'port_retraction_8ICS'; // posterior port
export const RUL = 'lung_upper_lobe_right';
export const RML = 'lung_middle_lobe_right';
export const RLL = 'lung_lower_lobe_right';
export const VEIN = 'middle_lobe_vein';
export const BR = 'middle_lobe_bronchus';
export const ART = 'middle_lobe_artery';
export const PLEURA = 'mediastinal_pleura_hilum';
export const STRANDS = 'hilar_connective_tissue';
export const PHRENIC = 'phrenic_nerve_right';
