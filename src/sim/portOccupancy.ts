// Port occupancy, stapler approach angle and the retraction swap (CONTEXT §6.4, ADR-004, VIDEO_STEP_MAP (b)/(d)).
// Pure logic: no scene objects, no allocations after construction. Each port holds at most one scope, one active
// tool and one held retraction; capacity caps how many of those may share it.
import { TARGET_BY_ID, type ToolId } from '../content/targets';
import { config } from '../core/config';

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

export class PortOccupancy {
  scopePort: string | null = null;
  activeTool: ToolId | null = null;
  activePort: string | null = null;
  heldTool: ToolId | null = null;
  heldPort: string | null = null;
  heldTarget: string | null = null;
  /** Held retraction moved to a different port (debrief: "retraction swaps"). */
  swaps = 0;
  lastSwapFrom: string | null = null;
  lastSwapTo: string | null = null;

  private readonly ports: ReadonlyMap<string, PortLike>;

  constructor(ports: readonly PortLike[]) {
    this.ports = new Map(ports.map((p) => [p.id, p]));
  }

  capacity(port: string): number {
    return PORT_CONFIG.capacity[port] ?? PORT_CONFIG.defaultCapacity;
  }

  used(port: string): number {
    return (
      (this.scopePort === port ? 1 : 0) +
      (this.activePort === port ? 1 : 0) +
      (this.heldPort === port ? 1 : 0)
    );
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

  /** G: the active tool's retraction on `target` stays while the hand changes tool. Replaces any previous held
   *  retraction; a port change counts as a retraction swap. Returns false if no tool is in. */
  hold(target: string): boolean {
    if (this.activePort === null || this.activeTool === null) return false;
    // ponytail: one held retraction at a time (all the video needs); make it a list if two-retractor holds appear.
    if (this.heldPort !== null && this.heldPort !== this.activePort) {
      this.swaps++;
      this.lastSwapFrom = this.heldPort;
      this.lastSwapTo = this.activePort;
    }
    this.heldTool = this.activeTool;
    this.heldPort = this.activePort;
    this.heldTarget = target;
    this.activeTool = null;
    this.activePort = null;
    return true;
  }

  release(): void {
    this.heldTool = null;
    this.heldPort = null;
    this.heldTarget = null;
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
    return this.heldPort === port ? 'retraction-in-port' : 'port-full';
  }
}
