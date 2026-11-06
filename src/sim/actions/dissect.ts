// Dissect (CONTEXT §6.4): peanut / cautery held on a dissectable target (tip in contact, wireM4) builds per-target
// progress 0..1. The manifest soft-tissue layers (anatomy.json `dissectable` + `dissectStep`: hilar pleura, connective
// strands) are judged by the practice gate when their dissection completes; they stay in place and show the local
// cautery openings (T822 CutPool). Smoke / char are the effect pools'; the sucker clears the view. Allocation-free.
import { DISSECT_LAYERS, TARGETS } from '../../content/targets';
import { config } from '../../core/config';

export type DissectTool = 'peanut' | 'cautery';

export const DISSECT_CONFIG = config.dissect; // values in src/core/config.ts

export interface DissectHooks {
  /** Sucker: effects.suction() + fog.clear(). */
  clearView(): void;
}

interface Slot {
  p: number;
  /** Manifest layer: its completion is gated (practice), not its start. */
  layer: boolean;
}

export class Dissect {
  /** Target being dissected, null when idle. */
  target: string | null = null;
  tool: DissectTool | null = null;
  /** Tool of the latest begin() (still set after a completion ended the hold). */
  lastTool: DissectTool | null = null;
  private readonly slots = new Map<string, Slot>();
  private readonly tools = new Map<string, readonly DissectTool[]>();

  constructor(private readonly hooks: DissectHooks) {
    for (const t of TARGETS) {
      const ok: DissectTool[] = [];
      if (t.tools.peanut !== undefined) ok.push('peanut');
      if (t.tools.cautery !== undefined) ok.push('cautery');
      if (ok.length === 0) continue;
      this.tools.set(t.id, ok);
      this.slots.set(t.id, { p: 0, layer: DISSECT_LAYERS.includes(t.id) });
    }
  }

  /** Progress of a target (0 if unknown). */
  progress(id: string): number {
    return this.slots.get(id)?.p ?? 0;
  }

  /** Is `id` a manifest soft-tissue layer (gated on completion)? */
  isLayer(id: string): boolean {
    return this.slots.get(id)?.layer === true;
  }

  /** Start holding `tool` on `id`. A completed target restarts from 0. */
  begin(id: string, tool: DissectTool): boolean {
    const slot = this.slots.get(id);
    if (!slot || this.tools.get(id)?.includes(tool) !== true) return false;
    if (slot.p >= 1) slot.p = 0;
    this.target = id;
    this.tool = this.lastTool = tool;
    return true;
  }

  /** Release the hold; progress is kept (resume later). */
  end(): void {
    this.target = this.tool = null;
  }

  /** Sucker activation. */
  suction(): void {
    this.hooks.clearView();
  }

  /** Advance the hold; returns the target id exactly once when its progress reaches 1, else null. */
  update(dtMs: number): string | null {
    const target = this.target;
    const tool = this.tool;
    if (target === null || tool === null) return null;
    const slot = this.slots.get(target);
    if (!slot) return null;
    const C = DISSECT_CONFIG;
    slot.p = Math.min(1, slot.p + (C.ratePerSec[tool] * dtMs) / 1000);
    if (slot.p < 1) return null;
    this.end();
    return target;
  }

  /** Completed dissection refused (out of order): it must be dissected again. */
  cancel(id: string): void {
    const slot = this.slots.get(id);
    if (slot) slot.p = 0;
  }

  /** New run: all progress back to 0. */
  reset(): void {
    for (const s of this.slots.values()) s.p = 0;
    this.end();
  }
}
