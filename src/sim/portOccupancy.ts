// Port occupancy, stapler approach angle and the retraction swap (CONTEXT §6.4, ADR-004, VIDEO_STEP_MAP (b)/(d)).
// Pure logic: no scene objects. A port's positions (interactionConfig.capacity: the access incision takes two, the
// 1 cm ports one) are shared by the scope, the tool in the hand and instruments left in it (T820 holds, T840 any
// placed instrument), within the inventory caps (interactionConfig.inventory).
import { TARGET_BY_ID, type ToolId } from '../content/targets';
import { config } from '../core/config';
import { interactionConfig as I, invKind } from './interaction.config';

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

/** An instrument left in its port (holding / retracting / clamped / resting on `target`) while the hand changes tool. */
export interface Hold {
  tool: ToolId;
  /** Sub-option id (inventory kind: ring forceps vs lung grasper). */
  sub: string | null;
  port: string;
  target: string;
}

export class PortOccupancy {
  scopePort: string | null = null;
  activeTool: ToolId | null = null;
  activePort: string | null = null;
  activeSub: string | null = null;
  /** Instruments left in ports, oldest first. */
  readonly holds: Hold[] = [];
  /** Held retraction moved to a different port (debrief: "retraction swaps"). */
  swaps = 0;
  lastSwapFrom: string | null = null;
  lastSwapTo: string | null = null;

  private readonly ports: ReadonlyMap<string, PortLike>;

  constructor(ports: readonly PortLike[]) {
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

  capacity(port: string): number {
    return I.capacity[port] ?? I.defaultCapacity;
  }

  /** Instruments of inventory kind `kind` in the chest (hand + left). */
  inUse(kind: string): number {
    let n = this.activeTool !== null && invKind(this.activeTool, this.activeSub) === kind ? 1 : 0;
    for (const h of this.holds) if (invKind(h.tool, h.sub) === kind) n++;
    return n;
  }

  /** May another `tool` (+ sub) go in? (inventory cap) */
  canTake(tool: ToolId, sub: string | null = null): boolean {
    const kind = invKind(tool, sub);
    return this.inUse(kind) < (I.inventory[kind] ?? 1);
  }

  used(port: string): number {
    return (this.scopePort === port ? 1 : 0) + (this.activePort === port ? 1 : 0) + this.heldIn(port);
  }

  hasRoom(port: string): boolean {
    return this.used(port) < this.capacity(port);
  }

  /** T850 "Insert via": may the hand's instrument enter through `port`? ('' = yes; its own port always may).
   *  `allowed` = the step's ports (practice; empty = any). */
  insertRefusal(port: string, allowed: readonly string[] = []): '' | 'unknown' | 'not-allowed' | 'full' {
    if (!this.ports.has(port)) return 'unknown';
    if (this.activePort === port) return '';
    if (allowed.length > 0 && !allowed.includes(port)) return 'not-allowed';
    return this.hasRoom(port) ? '' : 'full';
  }

  /** P: move the scope. Fails if the port is unknown or full. */
  moveScope(port: string): boolean {
    if (this.scopePort === port) return true;
    if (!this.ports.has(port) || !this.hasRoom(port)) return false;
    this.scopePort = port;
    return true;
  }

  /** Pass a tool in through a port (replaces the current active tool). */
  insert(tool: ToolId, port: string, sub: string | null = null): boolean {
    if (this.activePort !== port && (!this.ports.has(port) || !this.hasRoom(port))) return false;
    this.activeTool = tool;
    this.activePort = port;
    this.activeSub = sub;
    return true;
  }

  /** Esc: withdraw the active tool. */
  withdraw(): void {
    this.activeTool = null;
    this.activePort = null;
    this.activeSub = null;
  }

  /** Take the left instrument `holds[i]` back into the hand, in its port (the hand must be empty). */
  pickUp(i: number): Hold | null {
    const h = this.holds[i];
    if (!h || this.activeTool !== null) return null;
    this.holds.splice(i, 1);
    this.activeTool = h.tool;
    this.activePort = h.port;
    this.activeSub = h.sub;
    return h;
  }

  /** Withdraw the most recent instrument left in `port`. */
  releasePort(port: string): Hold | null {
    for (let i = this.holds.length - 1; i >= 0; i--)
      if (this.holds[i]?.port === port) return this.holds.splice(i, 1)[0] ?? null;
    return null;
  }

  /** G / tool switch: the active tool stays in its port on `target` while the hand changes tool. The same tool kind
   *  re-holding an already held target replaces that hold (a port change counts as a retraction swap). Returns false
   *  if no tool is in. Event-time only. */
  hold(target: string): boolean {
    const tool = this.activeTool;
    if (this.activePort === null || tool === null) return false;
    const kind = invKind(tool, this.activeSub);
    const i = this.holds.findIndex((h) => h.target === target && invKind(h.tool, h.sub) === kind);
    const prev = i >= 0 ? this.holds.splice(i, 1)[0] : undefined;
    if (prev && prev.port !== this.activePort) {
      this.swaps++;
      this.lastSwapFrom = prev.port;
      this.lastSwapTo = this.activePort;
    }
    this.holds.push({ tool, sub: this.activeSub, port: this.activePort, target });
    this.withdraw();
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
