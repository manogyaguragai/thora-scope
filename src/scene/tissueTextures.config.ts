// T824 procedural tissue detail (CONTEXT §8): one tileable RGBA8 DataArrayTexture built at load, one layer per family.
// Every layer: R,G = height gradient dH/du, dH/dv (0.5-centred, ±gradRange), B = albedo detail (0.5 = neutral),
// A = family mask (see FAMILY_MASK). Sizes in texels of one tile; "cells" are lattice/Voronoi cells per tile
// (integers, so every field wraps). Line widths are in texels. Look values tuned by eye vs the ref-frames.

/** Layer order of the array texture (index = GLSL `family`). */
export const FAMILIES = ['vessel', 'fat', 'pleura', 'lung', 'bronchus', 'blood'] as const;
export type Family = (typeof FAMILIES)[number];
/** What the A channel holds per family (B is always albedo detail; for blood B is the smear mask). */
export const FAMILY_MASK: Record<Family, string> = {
  vessel: 'vasa-vasorum capillaries',
  fat: 'capillaries along the lobule septa',
  pleura: 'sparse capillary network',
  lung: 'anthracotic dots (clustered on lobule borders)',
  bronchus: 'pinkish membranous patches with fine vessels (the rings are model geometry)',
  blood: 'dark clotted core of the smears',
};

/** Contour-line capillaries: |noise − 0.5| / |∇noise| < width → a meandering vessel line. */
export interface Capillaries {
  cells: number;
  octaves: number;
  widthPx: number;
}

export const tissueTex = {
  size: 256, // texels per layer side; ≈ 2.1 MB GPU incl. mips for 6 layers. Cold build (node): 256 ≈ 100 ms, 384 ≈ 230 ms
  seed: 824,
  gradRange: 24, // |dH/du| (tile units) stored at full scale; larger slopes clamp
  genBudgetMs: 150, // unit-test budget for the whole build
  worleyJitter: 0.75, // feature-point jitter (cell units); full jitter (1) breaks the 3×3 F2 → wedge artefacts
  triplanarSharpness: 4, // pow(|n|, k) blend weights: higher = narrower seams between projections
  vessel: {
    mottleCells: 4,
    mottleOctaves: 3,
    mottleAmp: 0.35,
    caps: { cells: 6, octaves: 3, widthPx: 1.6 } satisfies Capillaries,
    fineCaps: { cells: 16, octaves: 2, widthPx: 0.9 } satisfies Capillaries,
    fineWeight: 0.6,
    capHeight: 0.35, // capillaries stand slightly proud of the wall
  },
  fat: {
    cells: 7, // lobules per tile
    septaPx: 0.08, // septum half-width in F2−F1 (cell units)
    bulge: 0.35, // F2−F1 at which a lobule reaches full height
    centreBright: 0.3,
    centreFalloff: 0.7, // F1 (cell units) over which a lobule fades from bright centre to rim
    septaDark: 0.35,
    cellJitter: 0.12, // per-lobule brightness variation
    caps: { cells: 10, octaves: 2, widthPx: 1.1 } satisfies Capillaries,
    capsNearSepta: 0.25, // F2−F1 range around the septa where capillaries run
  },
  pleura: {
    grainCells: [48, 6] as const, // anisotropic lattice → fibrous streaks along v
    grainOctaves: 3,
    grainAmp: 0.25,
    caps: { cells: 5, octaves: 3, widthPx: 1.0 } satisfies Capillaries,
    capsDensity: 0.7, // fraction of the capillary network kept (low-frequency gate)
    gateCells: 3,
    gateSoft: 0.1, // smoothstep half-width of the gate
  },
  lung: {
    cells: 9, // secondary lobules per tile
    edgePx: 0.06, // lobule border half-width in F2−F1
    edgeDark: 0.18, // T831: 0.35 outlined every lobule (honeycomb tiles)
    bulge: 0.25,
    mottleAmp: 0.35, // T831: 0.2; dusky mottling of the collapsed lobe
    mottleCells: 4,
    mottleOctaves: 2,
    dotCells: 32, // anthracotic dot candidate grid (8 texels per cell at size 256)
    dotKeep: 0.5, // candidates kept on a border (× dotFloor away from borders); T831 0.35
    dotFloor: 0.15,
    dotRadius: [0.08, 0.22] as const, // cell units; T831 [0.12, 0.3] read as blurry blobs close up
    dotBorderPx: 0.2, // F2−F1 range counted as "near a border" for clustering
  },
  bronchus: {
    grainCells: 32, // ivory cartilage grain
    grainOctaves: 3,
    grainAmp: 0.2,
    caps: { cells: 8, octaves: 2, widthPx: 1.0 } satisfies Capillaries,
    patchCells: 3,
    patch: [0.45, 0.65] as const, // smoothstep of a low-frequency fBm → membranous patch mask
    patchTint: 0.35, // patch tint strength without a vessel (vessels: 1)
  },
  blood: {
    cells: 3,
    octaves: 3,
    warp: 0.15, // domain warp (tile units) → smeared streaks
    smear: [0.5, 0.62] as const, // smoothstep → soft smear/pool mask (B); T831 [0.56, 0.66] barely showed
    clot: [0.62, 0.72] as const, // smoothstep → dark core (A)
    height: 0.15,
  },
};
