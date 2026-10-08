import { clamp, easeInOutQuad } from '../core/format';

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The level of the world hierarchy a zoom shows best. */
export type ZoomTier = 'District' | 'Block' | 'Lot' | 'Detail';

export function zoomTier(scale: number): ZoomTier {
  if (scale < 4) return 'District';
  if (scale < 13) return 'Block';
  if (scale < 48) return 'Lot';
  return 'Detail';
}

interface CameraTarget {
  x: number;
  y: number;
  scale: number;
}

/**
 * Maps world metres (y up) to canvas pixels (y down). Supports pan, zoom
 * about a point, fitting a bounds rectangle and smooth animated moves.
 */
export class Camera {
  /** World coordinate at the centre of the viewport. */
  x = 0;
  y = 0;
  /** Pixels per metre. */
  scale = 40;
  minScale = 6;
  maxScale = 360;
  /** Where the camera centre may go, in world metres. */
  limits?: Bounds;
  viewportWidth = 1;
  viewportHeight = 1;
  /** Extra space at the bottom (for the bottom sheet), in CSS pixels. */
  insetBottom = 0;
  insetTop = 0;
  private anim?: { from: CameraTarget; to: CameraTarget; start: number; duration: number };
  shakeX = 0;
  shakeY = 0;
  /** Momentary zoom kick (0.05 = 5% closer), for detonations and big landings. */
  punch = 0;
  /** Glide after a flick, in CSS pixels per millisecond. */
  private glide = { vx: 0, vy: 0, last: 0 };

  setViewport(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
  }

  private get usableHeight(): number {
    return Math.max(1, this.viewportHeight - this.insetBottom - this.insetTop);
  }

  private get centreY(): number {
    return this.insetTop + this.usableHeight / 2;
  }

  /** Scale actually used for drawing, including the zoom punch. */
  get drawScale(): number {
    return this.scale * (1 + this.punch);
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const s = this.drawScale;
    return {
      x: (wx - this.x) * s + this.viewportWidth / 2 + this.shakeX,
      y: -(wy - this.y) * s + this.centreY + this.shakeY,
    };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const s = this.drawScale;
    return {
      x: (sx - this.viewportWidth / 2 - this.shakeX) / s + this.x,
      y: -(sy - this.centreY - this.shakeY) / s + this.y,
    };
  }

  panBy(dxPixels: number, dyPixels: number): void {
    this.anim = undefined;
    this.glide.vx = 0;
    this.glide.vy = 0;
    this.x -= dxPixels / this.scale;
    this.y += dyPixels / this.scale;
    this.clampToLimits();
  }

  /** Keeps gliding after the finger lifts, easing to a stop. */
  fling(vx: number, vy: number, now: number): void {
    const speed = Math.hypot(vx, vy);
    if (speed < 0.15) return;
    const cap = 4 / Math.max(1, speed);
    this.glide = { vx: vx * Math.min(1, cap), vy: vy * Math.min(1, cap), last: now };
  }

  stop(): void {
    this.anim = undefined;
    this.glide.vx = 0;
    this.glide.vy = 0;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.anim = undefined;
    const before = this.screenToWorld(sx, sy);
    this.scale = clamp(this.scale * factor, this.minScale, this.maxScale);
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampToLimits();
  }

  /** Never lets the view wander off the edge of the world or under the ground. */
  clampToLimits(): void {
    const l = this.limits;
    if (!l) return;
    this.x = clamp(this.x, l.minX, l.maxX);
    this.y = clamp(this.y, l.minY, l.maxY);
  }

  /** Computes the camera target that frames `bounds` with padding in metres. */
  fitTarget(bounds: Bounds, padding = 1.5): CameraTarget {
    const w = bounds.maxX - bounds.minX + padding * 2;
    const h = bounds.maxY - bounds.minY + padding * 2;
    const scale = clamp(Math.min(this.viewportWidth / w, this.usableHeight / h), this.minScale, this.maxScale);
    return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, scale };
  }

  fit(bounds: Bounds, padding = 1.5): void {
    this.anim = undefined;
    const t = this.fitTarget(bounds, padding);
    this.x = t.x;
    this.y = t.y;
    this.scale = t.scale;
  }

  animateTo(target: CameraTarget, duration: number, now: number): void {
    this.anim = { from: { x: this.x, y: this.y, scale: this.scale }, to: target, start: now, duration };
  }

  animateFit(bounds: Bounds, padding: number, duration: number, now: number): void {
    this.animateTo(this.fitTarget(bounds, padding), duration, now);
  }

  update(now: number): void {
    const g = this.glide;
    if (!this.anim && (g.vx !== 0 || g.vy !== 0)) {
      const dt = Math.min(50, now - g.last);
      g.last = now;
      this.x -= (g.vx * dt) / this.scale;
      this.y += (g.vy * dt) / this.scale;
      const decay = Math.exp(-dt / 260);
      g.vx *= decay;
      g.vy *= decay;
      if (Math.hypot(g.vx, g.vy) < 0.01) {
        g.vx = 0;
        g.vy = 0;
      }
      this.clampToLimits();
    }
    const a = this.anim;
    if (!a) return;
    const t = clamp((now - a.start) / a.duration, 0, 1);
    const e = easeInOutQuad(t);
    this.x = a.from.x + (a.to.x - a.from.x) * e;
    this.y = a.from.y + (a.to.y - a.from.y) * e;
    // Interpolate scale logarithmically so zooms feel even.
    this.scale = Math.exp(Math.log(a.from.scale) + (Math.log(a.to.scale) - Math.log(a.from.scale)) * e);
    if (t >= 1) this.anim = undefined;
  }

  get animating(): boolean {
    return this.anim !== undefined;
  }
}
