// Port occupancy, stapler approach angle and the retraction swap (CONTEXT §6.4, ADR-004, VIDEO_STEP_MAP (b)/(d)).
// Pure logic: no scene objects, no allocations after construction. Each port holds at most one scope, one active
// tool and up to retractionConfig.maxHeld held retractions (T820); capacity caps how many of those may share it.
import { TARGET_BY_ID, type ToolId } from '../content/targets';
import { config } from '../core/config';
import { retractionConfig } from './retraction.config';

export const PORT_CONFIG = config.ports; // values in src/core/config.ts

export interface PointLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PortLike {
  readonly id: string;
  /** Fulcrum the shaft pivots about. */
  readonly pleura: PointLike;
}

export type FireCheck =
  | 'ok'
  | 'no-target'
  | 'no-port'
  | 'wrong-tool'
  | 'poor-angle'
  /** Port is full and the held retraction is one of its occupants → transfer it (retraction swap). */
  | 'retraction-in-port'
  | 'port-full';

const RAD2DEG = 180 / Math.PI;

/** A retraction held in its port while the hand changes tool. */
export interface Hold {
  tool: ToolId;
  port: string;
  target: string;
}

export class PortOccupancy {
  scopePort: string | null = null;
  activeTool: ToolId | null = null;
  activePort: string | null = null;
  /** Held retractions, oldest first (≤ maxHeld). */
  readonly holds: Hold[] = [];
  /** Held retraction moved to a different port (debrief: "retraction swaps"). */
  swaps = 0;
  lastSwapFrom: string | null = null;
  lastSwapTo: string | null = null;

  private readonly ports: ReadonlyMap<string, PortLike>;

  constructor(
    ports: readonly PortLike[],
    readonly maxHeld = retractionConfig.maxHeld,
  ) {
    this.ports = new Map(ports.map((p) => [p.id, p]));
  }

  /** Most recent hold (null = none). */
  get heldTool(): ToolId | null {
    return this.holds.at(-1)?.tool ?? null;
  }
  get heldPort(): string | null {
    return this.holds.at(-1)?.port ?? null;
  }
  get heldTarget(): string | null {
    return this.holds.at(-1)?.target ?? null;
  }

  heldIn(port: string): number {
    let n = 0;
    for (const h of this.holds) if (h.port === port) n++;
    return n;
  }

  /** Would hold(target) need a free hold slot it can't get? */
  holdFull(target: string): boolean {
    return this.holds.length >= this.maxHeld && !this.holds.some((h) => h.target === target);
  }

  capacity(port: string): number {
    return PORT_CONFIG.capacity[port] ?? PORT_CONFIG.defaultCapacity;
  }

  used(port: string): number {
    return (this.scopePort === port ? 1 : 0) + (this.activePort === port ? 1 : 0) + this.heldIn(port);
  }

  hasRoom(port: string): boolean {
    return this.used(port) < this.capacity(port);
  }

  /** P: move the scope. Fails if the port is unknown or full. */
  moveScope(port: string): boolean {
    if (this.scopePort === port) return true;
    if (!this.ports.has(port) || !this.hasRoom(port)) return false;
    this.scopePort = port;
    return true;
  }

  /** Pass a tool in through a port (replaces the current active tool). */
  insert(tool: ToolId, port: string): boolean {
    if (this.activePort !== port && (!this.ports.has(port) || !this.hasRoom(port))) return false;
    this.activeTool = tool;
    this.activePort = port;
    return true;
  }

  /** Esc: withdraw the active tool. */
  withdraw(): void {
    this.activeTool = null;
    this.activePort = null;
  }

  /** G: the active tool's retraction on `target` stays while the hand changes tool. Re-holding an already held
   *  target replaces that hold (a port change counts as a retraction swap); a new target takes a free hold slot.
   *  Returns false if no tool is in or all hold slots are taken. Event-time only. */
  hold(target: string): boolean {
    if (this.activePort === null || this.activeTool === null || this.holdFull(target)) return false;
    const i = this.holds.findIndex((h) => h.target === target);
    const prev = i >= 0 ? this.holds.splice(i, 1)[0] : undefined;
    if (prev && prev.port !== this.activePort) {
      this.swaps++;
      this.lastSwapFrom = prev.port;
      this.lastSwapTo = this.activePort;
    }
    this.holds.push({ tool: this.activeTool, port: this.activePort, target });
    this.activeTool = null;
    this.activePort = null;
    return true;
  }

  /** Let go of the hold on `target` (undefined = the most recent one); returns the released hold. */
  release(target?: string): Hold | null {
    const i = target === undefined ? this.holds.length - 1 : this.holds.findIndex((h) => h.target === target);
    return i >= 0 ? (this.holds.splice(i, 1)[0] ?? null) : null;
  }

  releaseAll(): void {
    this.holds.length = 0;
  }

  /** Deviation (deg) of the shaft pleura → target from perpendicular to the target axis; 0 if the target has no
   *  axis, NaN if target or port is unknown. `point` = live target point (morphs move structures). */
  approachDeg(targetId: string, port: string, point?: PointLike): number {
    const t = TARGET_BY_ID.get(targetId);
    const p = this.ports.get(port);
    if (!t || !p) return NaN;
    if (!t.axis) return 0;
    const dx = (point ? point.x : t.point[0]) - p.pleura.x;
    const dy = (point ? point.y : t.point[1]) - p.pleura.y;
    const dz = (point ? point.z : t.point[2]) - p.pleura.z;
    const [ax, ay, az] = t.axis;
    const len = Math.hypot(dx, dy, dz) * Math.hypot(ax, ay, az);
    if (len === 0) return 0;
    return Math.asin(Math.min(1, Math.abs(dx * ax + dy * ay + dz * az) / len)) * RAD2DEG;
  }

  /** Can `tool` (sub-option `sub`, e.g. stapler cartridge) act on `targetId` through `port`? The angle check applies
   *  to the stapler only. The active tool's own port counts as free for it. */
  canFire(
    tool: ToolId,
    targetId: string,
    port: string,
    sub: string | null = null,
    point?: PointLike,
  ): FireCheck {
    const t = TARGET_BY_ID.get(targetId);
    if (!t) return 'no-target';
    if (!this.ports.has(port)) return 'no-port';
    const subs = t.tools[tool];
    if (!subs || (sub !== null && subs.length > 0 && !subs.includes(sub))) return 'wrong-tool';
    if (
      tool === 'stapler' &&
      this.approachDeg(targetId, port, point) > (t.maxApproachDeg ?? PORT_CONFIG.maxApproachDeg)
    )
      return 'poor-angle';
    if (this.activePort === port || this.hasRoom(port)) return 'ok';
    return this.heldIn(port) > 0 ? 'retraction-in-port' : 'port-full';
  }
}
