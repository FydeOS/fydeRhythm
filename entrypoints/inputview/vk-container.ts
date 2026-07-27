// The ChromeOS VK container outlives this page: what we leave on it is
// inherited by the next keyboard, and what that keyboard does to our window
// must not be read back as user intent.

import {
  type ContainerGeometry,
  geometryFor,
  type KeyboardMode,
  kOneHandRows,
  type OneHandSide,
  type Placement,
} from './placement';
import { windowSized } from './window-state';

export interface FloatingPos { left: number; top: number }

export interface PlacementBase {
  mode: KeyboardMode;
  scale: number;
  side: OneHandSide;
}

export interface ContainerHost {
  setupContainer(geom: ContainerGeometry): Promise<void>;
  releaseContainer(): Promise<void>;
  readPlacement(): Promise<Placement>;
  writePlacement(placement: Placement): void;
}

// Only restore() may move out of 'released' — the next keyboard owns the
// container until we deliberately take it back.
type Phase = 'unloaded' | 'live' | 'released';

function readWindowPos(): FloatingPos {
  return { left: window.screenX, top: window.screenY };
}

function sameGeometry(a: ContainerGeometry | null, b: ContainerGeometry): boolean {
  return a !== null && a.floating === b.floating && a.width === b.width
    && a.height === b.height && a.draggable === b.draggable
    && a.left === b.left && a.top === b.top;
}

export class VkContainer {
  private phase: Phase = 'unloaded';
  private pos: FloatingPos | null = null;
  private requested: ContainerGeometry | null = null;
  private dragging = false;

  constructor(
    private readonly host: ContainerHost,
    private readonly base: () => PlacementBase,
    private readonly rows: () => number,
  ) {}

  placement(): Placement {
    return { ...this.base(), left: this.pos?.left, top: this.pos?.top };
  }

  geometry(): ContainerGeometry {
    return geometryFor(this.placement(), window.screen, this.rows() || kOneHandRows);
  }

  async load(): Promise<Placement> {
    const prefs = await this.host.readPlacement();
    this.pos = prefs.left !== undefined && prefs.top !== undefined
      ? { left: prefs.left, top: prefs.top }
      : null;
    this.phase = 'live';
    return prefs;
  }

  persist(): void {
    this.host.writePlacement(this.placement());
  }

  // screenX/Y mixes a user drag, a position the lock screen imposed, and the
  // echo of our own moveTo; only the size tells them apart.
  private placementLanded(): boolean {
    return this.requested !== null
      && window.innerWidth === this.requested.width
      && window.innerHeight === this.requested.height;
  }

  // A handle drag fires no event, so a live read is the only way to see it.
  capturePos(): boolean {
    if (this.base().mode !== 'floating' || !this.placementLanded()) return false;
    this.pos = readWindowPos();
    return true;
  }

  private async place(geom: ContainerGeometry): Promise<void> {
    this.requested = geom;
    await this.host.setupContainer(geom);
  }

  async sync(): Promise<void> {
    if (!this.canWrite()) return;
    // A one-hand card sized before the first layout lands at the wrong height.
    if (this.base().mode === 'onehand' && !this.rows()) return;
    this.capturePos();
    const next = this.geometry();
    if (sameGeometry(this.requested, next)) return;
    await this.place(next);
  }

  private canWrite(): boolean {
    return this.phase === 'live' && !document.hidden && !this.dragging;
  }

  // adoptWindowPos is false when restoring: the lock screen moved us, and
  // adopting that would displace the keyboard and persist the displaced spot.
  private async replace(adoptWindowPos: boolean): Promise<void> {
    if (adoptWindowPos) this.capturePos();
    await this.place(this.geometry());
  }

  async rotate(): Promise<void> {
    if (!this.canWrite()) return;
    await this.replace(true);
  }

  async resized(): Promise<void> {
    if (!this.canWrite() || !windowSized()) return;
    this.capturePos();
    const next = this.geometry();
    if (sameGeometry(this.requested, next)) return;
    await this.place(next);
  }

  async restore(): Promise<void> {
    if (this.phase === 'unloaded' || document.hidden) return;
    this.phase = 'live';
    this.dragging = false;
    await this.replace(false);
  }

  async hide(): Promise<void> {
    if (this.phase !== 'live') return;
    const geom = this.geometry();
    // Before `requested` is cleared — placementLanded() depends on it.
    const captured = this.capturePos();
    // Released even when docked: a queued frame or a late rows change must not
    // re-take it.
    this.phase = 'released';
    this.dragging = false;
    this.requested = null;
    // Keyed on the container we wrote, not the mode name: one-hand is FLOATING
    // too, and would hand the lock screen its corner rect.
    if (!geom.floating) return;
    if (captured) this.persist();
    await this.host.releaseContainer();
  }

  // Places every coalesced frame itself, so the resize events our own resizeTo
  // emits must not race it.
  beginDrag(): FloatingPos {
    this.capturePos();
    this.dragging = true;
    return this.pos ?? readWindowPos();
  }

  async dragTo(): Promise<void> {
    if (this.phase !== 'live' || document.hidden) return;
    await this.place(this.geometry());
  }

  endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.persist();
  }
}
