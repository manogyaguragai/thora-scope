// Dissect (CONTEXT §6.4): peanut / cautery held on a dissectable target builds per-target progress 0..1. Targets with
// a pre-built `_window` mesh fade while progress builds, then swap to the window at 1. Cautery puffs smoke + lens fog;
// the sucker clears the view. Scene/effects are injected as hooks; allocation-free after construction.
import type { Vector3 } from 'three';
import { TARGETS } from '../../content/targets';
import { config } from '../../core/config';

export type DissectTool = 'peanut' | 'cautery';

export const DISSECT_CONFIG = config.dissect; // values in src/core/config.ts

export interface DissectHooks {
  /** materials.setFade on the target mesh (1 = normal look). */
  setFade(node: string, f: number): void;
  /** Hide `node`, show `windowNode`. */
  swapToWindow(node: string, windowNode: string): void;
  /** effects.cautery(at): smoke wisps + lens-fog pulse. */
  cautery(at: Vector3): void;
  /** Sucker: effects.suction() + fog.clear(). */
  clearView(): void;
}

interface Slot {
  p: number;
  swapped: boolean;
}

export class Dissect {
  /** Target being dissected (base id, never the `_window` name), null when idle. */
  target: string | null = null;
  tool: DissectTool | null = null;
  private readonly slots = new Map<string, Slot>();
  private readonly tools = new Map<string, readonly DissectTool[]>();
  private at: Vector3 | null = null;
  private puffT = 0;

  constructor(private readonly hooks: DissectHooks) {
    for (const t of TARGETS) {
      const ok: DissectTool[] = [];
      if (t.tools.peanut !== undefined) ok.push('peanut');
      if (t.tools.cautery !== undefined) ok.push('cautery');
      if (ok.length === 0) continue;
      this.tools.set(t.id, ok);
      this.slots.set(t.id, { p: 0, swapped: false });
    }
  }

  /** Progress of a target (0 if unknown). Accepts the `_window` name too. */
  progress(id: string): number {
    return this.slots.get(baseId(id))?.p ?? 0;
  }

  /**
   * Start holding `tool` on `id` (a picked node; `_window` names map to their base). `at` = live tip position
   * (kept by reference, read on each cautery puff). A completed target restarts from 0 without fading again.
   */
  begin(id: string, tool: DissectTool, at: Vector3): boolean {
    const target = baseId(id);
    const slot = this.slots.get(target);
    if (!slot || this.tools.get(target)?.includes(tool) !== true) return false;
    if (slot.p >= 1) slot.p = 0;
    this.target = target;
    this.tool = tool;
    this.at = at;
    this.puffT = 0;
    if (tool === 'cautery') this.hooks.cautery(at);
    return true;
  }

  /** Release the hold; progress is kept (resume later). */
  end(): void {
    this.target = this.tool = this.at = null;
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
    const dt = dtMs / 1000;
    if (tool === 'cautery' && this.at) {
      this.puffT += dt;
      if (this.puffT >= C.cauteryPuffSec) {
        this.puffT -= C.cauteryPuffSec;
        this.hooks.cautery(this.at);
      }
    }
    slot.p = Math.min(1, slot.p + C.ratePerSec[tool] * dt);
    const win = C.windows[target];
    if (slot.p < 1) {
      if (win !== undefined && !slot.swapped) this.hooks.setFade(target, 1 - (1 - C.fadeTo) * slot.p);
      return null;
    }
    if (win !== undefined && !slot.swapped) {
      slot.swapped = true;
      this.hooks.setFade(target, 1);
      this.hooks.swapToWindow(target, win);
    }
    this.end();
    return target;
  }

  /** New run: all progress back to 0. The caller restores mesh visibility (step application does). */
  reset(): void {
    for (const s of this.slots.values()) {
      s.p = 0;
      s.swapped = false;
    }
    this.end();
  }
}

function baseId(id: string): string {
  const s = DISSECT_CONFIG.windowSuffix;
  return id.endsWith(s) ? id.slice(0, -s.length) : id;
}
