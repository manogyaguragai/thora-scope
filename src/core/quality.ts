// Device check + quality preset choice (§6.9, §6.10). Presets live in config.quality.presets.
import { config } from './config';

export type QualityName = keyof typeof config.quality.presets;
export type QualityPreset = (typeof config.quality.presets)[QualityName];

export interface DeviceInfo {
  /** Unmasked GPU renderer string ('' if unknown). */
  gpu: string;
  /** Logical cores; NaN if unknown. */
  cores: number;
  /** navigator.deviceMemory in GB; NaN if unknown (Firefox/Safari). */
  memoryGB: number;
}

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;
// ponytail: name-pattern GPU tiers; Apple M-series and unknown GPUs land on medium. Add a benchmark if it misjudges.
const DISCRETE_GPU = /nvidia|geforce|quadro|radeon (rx|pro|r9)|arc\(tm\) a\d|arc a\d/i;

/** Pure heuristic: software rasteriser → low; discrete → high; integrated/unknown → medium; weak CPU/RAM caps it. */
export function classifyDevice({ gpu, cores, memoryGB }: DeviceInfo): QualityName {
  const d = config.quality.device;
  if (SOFTWARE_GPU.test(gpu) || cores <= d.lowMaxCores || memoryGB <= d.lowMaxMemoryGB) return 'low';
  if (!DISCRETE_GPU.test(gpu)) return 'medium';
  return cores < d.highMinCores || memoryGB < d.highMinMemoryGB ? 'medium' : 'high';
}

/** `?quality=low|medium|high`, else null. */
export function qualityOverride(params: URLSearchParams): QualityName | null {
  const q = params.get('quality');
  return q && Object.hasOwn(config.quality.presets, q) ? (q as QualityName) : null;
}

/** Probe a throwaway WebGL2 context (WebGL2 required) and pick the preset; the URL override wins. */
export function pickQuality(params: URLSearchParams): { name: QualityName; preset: QualityPreset } {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) throw new Error('WebGL2 is not available. Use a current desktop Chrome, Edge, Firefox or Safari.');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  const nav = navigator as Navigator & { deviceMemory?: number };
  const name =
    qualityOverride(params) ??
    classifyDevice({ gpu, cores: nav.hardwareConcurrency || NaN, memoryGB: nav.deviceMemory ?? NaN });
  return { name, preset: config.quality.presets[name] };
}
