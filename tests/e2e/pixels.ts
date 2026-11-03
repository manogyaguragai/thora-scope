import sharp from 'sharp';

export const PATCH = 24; // px sampled per corner / centre

/** Brightest channel mean of a PATCH×PATCH crop (one screenshot; each SwiftShader frame takes seconds).
 * stats() reads the input, not the pipeline, so the crop is materialised first. */
export async function meanRGB(png: Buffer, left: number, top: number): Promise<number> {
  const crop = sharp(await sharp(png).extract({ left, top, width: PATCH, height: PATCH }).toBuffer());
  const { channels } = await crop.stats();
  return Math.max(...channels.slice(0, 3).map((c) => c.mean));
}

/** Corner patches of a width×height screenshot. */
export const corners = (width: number, height: number): { x: number; y: number }[] => [
  { x: 0, y: 0 },
  { x: width - PATCH, y: 0 },
  { x: 0, y: height - PATCH },
  { x: width - PATCH, y: height - PATCH },
];
