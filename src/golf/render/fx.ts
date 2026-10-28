import * as THREE from 'three';
import type { DebrisKind } from '../sim/materials';

/**
 * Cosmetic effects driven by simulation events: fragments, dust, ball
 * trails, impact rings and seam flashes. Nothing here feeds back into the
 * simulation, so it can use Math.random and drop work when over budget.
 */

const FRAG_MAX = 900;
const DUST_MAX = 160;
const TRAIL_MAX = 520;
const RING_MAX = 24;

const FRAG_COLORS: Record<DebrisKind, number[]> = {
  brick: [0xb5553a, 0x9c4a33, 0xc66b4f, 0xd8cfc0],
  glass: [0xdff3fb, 0xbfe3f2, 0xffffff],
  wood: [0x9a6b43, 0x7a5636, 0xc89b6a],
  dust: [0xc9c2b4, 0xa9a59c, 0xe0d8c8],
  ceramic: [0xf4f1ea, 0xd9452b, 0x3f74b8],
  leaf: [0x5f9a4a, 0x6fae55, 0x8bc06a],
  metal: [0xdfe3e6, 0x9aa3aa, 0x5b666e],
  tile: [0x4f5d75, 0x3e4a5e, 0x65748c],
  fabric: [0x5c86a3, 0xf6f1e6, 0xd9452b],
};

export class Fx {
  readonly group = new THREE.Group();
  private frags: THREE.InstancedMesh;
  private fp = new Float32Array(FRAG_MAX * 3);
  private fv = new Float32Array(FRAG_MAX * 3);
  private fr = new Float32Array(FRAG_MAX * 3);
  private fw = new Float32Array(FRAG_MAX * 3);
  private fs = new Float32Array(FRAG_MAX);
  private fl = new Float32Array(FRAG_MAX);
  private fn = 0;
  private dust: THREE.InstancedMesh;
  private dp = new Float32Array(DUST_MAX * 3);
  private dv = new Float32Array(DUST_MAX * 3);
  private ds = new Float32Array(DUST_MAX);
  private dl = new Float32Array(DUST_MAX);
  private dmax = new Float32Array(DUST_MAX);
  private dn = 0;
  private trail: THREE.InstancedMesh;
  private tp = new Float32Array(TRAIL_MAX * 3);
  private tl = new Float32Array(TRAIL_MAX);
  private ts = new Float32Array(TRAIL_MAX);
  private tn = 0;
  private rings: Array<{ mesh: THREE.Mesh; life: number; total: number; grow: number }> = [];
  private bars: Array<{ mesh: THREE.Mesh; life: number }> = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  shake = 0;
  quality = 1;

  constructor() {
    const fragMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    this.frags = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), fragMat, FRAG_MAX);
    this.frags.count = 0;
    this.frags.frustumCulled = false;
    this.frags.castShadow = true;
    this.frags.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const dustMat = new THREE.MeshStandardMaterial({ color: 0xe6dccb, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false });
    this.dust = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), dustMat, DUST_MAX);
    this.dust.count = 0;
    this.dust.frustumCulled = false;
    this.dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const trailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false });
    this.trail = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), trailMat, TRAIL_MAX);
    this.trail.count = 0;
    this.trail.frustumCulled = false;
    this.group.add(this.frags, this.dust, this.trail);
    for (let i = 0; i < RING_MAX; i++) {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, life: 0, total: 1, grow: 1 });
    }
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      mesh.visible = false;
      this.group.add(mesh);
      this.bars.push({ mesh, life: 0 });
    }
  }

  clear(): void {
    this.fn = 0;
    this.dn = 0;
    this.tn = 0;
    this.frags.count = 0;
    this.dust.count = 0;
    this.trail.count = 0;
    for (const r of this.rings) r.mesh.visible = false;
    for (const b of this.bars) b.mesh.visible = false;
  }

  /** Bursts of fragments in the material's colours. */
  burst(kind: DebrisKind, x: number, y: number, z: number, n: number, speed: number, size = 0.08, dir?: { x: number; y: number; z: number }, tint?: number): void {
    n = Math.round(n * this.quality);
    const cols = FRAG_COLORS[kind];
    for (let i = 0; i < n; i++) {
      let k = this.fn;
      if (k >= FRAG_MAX) {
        // Recycle the oldest-looking slot.
        k = Math.floor(Math.random() * FRAG_MAX);
      } else this.fn++;
      this.fp[k * 3] = x + (Math.random() - 0.5) * 0.15;
      this.fp[k * 3 + 1] = y + (Math.random() - 0.5) * 0.15;
      this.fp[k * 3 + 2] = z + (Math.random() - 0.5) * 0.15;
      const sp = speed * (0.4 + Math.random() * 0.8);
      let vx = (Math.random() - 0.5) * 2;
      let vy = Math.random() * 1.4;
      let vz = (Math.random() - 0.5) * 2;
      if (dir) {
        vx = vx * 0.6 + dir.x * 1.2;
        vy = vy * 0.6 + dir.y * 1.2;
        vz = vz * 0.6 + dir.z * 1.2;
      }
      const l = Math.hypot(vx, vy, vz) || 1;
      this.fv[k * 3] = (vx / l) * sp;
      this.fv[k * 3 + 1] = (vy / l) * sp + 1;
      this.fv[k * 3 + 2] = (vz / l) * sp;
      this.fr[k * 3] = Math.random() * 6;
      this.fr[k * 3 + 1] = Math.random() * 6;
      this.fr[k * 3 + 2] = Math.random() * 6;
      this.fw[k * 3] = (Math.random() - 0.5) * 16;
      this.fw[k * 3 + 1] = (Math.random() - 0.5) * 16;
      this.fw[k * 3 + 2] = (Math.random() - 0.5) * 16;
      this.fs[k] = size * (0.5 + Math.random() * 0.9) * (kind === 'glass' ? 0.7 : 1);
      this.fl[k] = 1.6 + Math.random() * 1.6;
      const c = i === 0 && tint !== undefined ? tint : (cols[Math.floor(Math.random() * cols.length)] as number);
      this.frags.setColorAt(k, this.c.setHex(c));
    }
    if (this.frags.instanceColor) this.frags.instanceColor.needsUpdate = true;
  }

  puff(x: number, y: number, z: number, n: number, size: number, rise = 0.6): void {
    n = Math.max(1, Math.round(n * this.quality));
    for (let i = 0; i < n; i++) {
      let k = this.dn;
      if (k >= DUST_MAX) k = Math.floor(Math.random() * DUST_MAX);
      else this.dn++;
      this.dp[k * 3] = x + (Math.random() - 0.5) * size;
      this.dp[k * 3 + 1] = y + Math.random() * size * 0.4;
      this.dp[k * 3 + 2] = z + (Math.random() - 0.5) * size;
      this.dv[k * 3] = (Math.random() - 0.5) * 1.2;
      this.dv[k * 3 + 1] = rise * (0.5 + Math.random());
      this.dv[k * 3 + 2] = (Math.random() - 0.5) * 1.2;
      this.dmax[k] = size * (0.5 + Math.random() * 0.6);
      this.ds[k] = (this.dmax[k] as number) * 0.3;
      this.dl[k] = 1.2 + Math.random() * 1.4;
    }
  }

  trailDot(x: number, y: number, z: number, size: number): void {
    const k = this.tn < TRAIL_MAX ? this.tn++ : Math.floor(Math.random() * TRAIL_MAX);
    this.tp[k * 3] = x;
    this.tp[k * 3 + 1] = y;
    this.tp[k * 3 + 2] = z;
    this.ts[k] = size;
    this.tl[k] = 0.55;
  }

  ring(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, color = 0xffffff, life = 0.45): void {
    const r = this.rings.find((q) => q.life <= 0) ?? this.rings[0];
    if (!r) return;
    r.mesh.visible = true;
    r.mesh.position.set(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02);
    r.mesh.lookAt(x + nx, y + ny, z + nz);
    (r.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    r.life = r.total = life;
    r.grow = size;
  }

  /** A bright line along a mortar joint: shows where a seam shot landed. */
  seamFlash(x: number, y: number, z: number, horizontal: boolean, along: 'x' | 'z', len = 1.2): void {
    const b = this.bars.find((q) => q.life <= 0) ?? this.bars[0];
    if (!b) return;
    b.mesh.visible = true;
    b.mesh.position.set(x, y, z);
    if (horizontal) b.mesh.scale.set(along === 'x' ? len : 0.05, 0.04, along === 'z' ? len : 0.05);
    else b.mesh.scale.set(0.04, len * 0.5, 0.05);
    b.life = 0.9;
  }

  update(dt: number): void {
    const m = this.m;
    // Fragments: gravity, bounce on the ground, fade by shrinking.
    let alive = 0;
    for (let i = 0; i < this.fn; i++) {
      const l = (this.fl[i] as number) - dt;
      if (l <= 0) continue;
      const j = alive;
      if (j !== i) {
        for (let a = 0; a < 3; a++) {
          this.fp[j * 3 + a] = this.fp[i * 3 + a] as number;
          this.fv[j * 3 + a] = this.fv[i * 3 + a] as number;
          this.fr[j * 3 + a] = this.fr[i * 3 + a] as number;
          this.fw[j * 3 + a] = this.fw[i * 3 + a] as number;
        }
        this.fs[j] = this.fs[i] as number;
        if (this.frags.instanceColor) {
          this.frags.getColorAt(i, this.c);
          this.frags.setColorAt(j, this.c);
        }
      }
      this.fl[j] = l;
      this.fv[j * 3 + 1] = (this.fv[j * 3 + 1] as number) - 9.8 * dt;
      for (let a = 0; a < 3; a++) this.fp[j * 3 + a] = (this.fp[j * 3 + a] as number) + (this.fv[j * 3 + a] as number) * dt;
      if ((this.fp[j * 3 + 1] as number) < 0.03) {
        this.fp[j * 3 + 1] = 0.03;
        this.fv[j * 3 + 1] = -(this.fv[j * 3 + 1] as number) * 0.25;
        this.fv[j * 3] = (this.fv[j * 3] as number) * 0.6;
        this.fv[j * 3 + 2] = (this.fv[j * 3 + 2] as number) * 0.6;
        this.fw[j * 3] = (this.fw[j * 3] as number) * 0.5;
        this.fw[j * 3 + 2] = (this.fw[j * 3 + 2] as number) * 0.5;
      }
      for (let a = 0; a < 3; a++) this.fr[j * 3 + a] = (this.fr[j * 3 + a] as number) + (this.fw[j * 3 + a] as number) * dt;
      const s = (this.fs[j] as number) * Math.min(1, l / 0.5);
      this.e.set(this.fr[j * 3] as number, this.fr[j * 3 + 1] as number, this.fr[j * 3 + 2] as number);
      this.q.setFromEuler(this.e);
      m.compose(this.v.set(this.fp[j * 3] as number, this.fp[j * 3 + 1] as number, this.fp[j * 3 + 2] as number), this.q, this.s.set(s, s * 0.6, s * 0.8));
      this.frags.setMatrixAt(j, m);
      alive++;
    }
    this.fn = alive;
    this.frags.count = alive;
    this.frags.instanceMatrix.needsUpdate = true;
    if (this.frags.instanceColor) this.frags.instanceColor.needsUpdate = true;

    // Dust puffs: rise, grow, then shrink away.
    alive = 0;
    for (let i = 0; i < this.dn; i++) {
      const l = (this.dl[i] as number) - dt;
      if (l <= 0) continue;
      const j = alive;
      if (j !== i) {
        for (let a = 0; a < 3; a++) {
          this.dp[j * 3 + a] = this.dp[i * 3 + a] as number;
          this.dv[j * 3 + a] = this.dv[i * 3 + a] as number;
        }
        this.ds[j] = this.ds[i] as number;
        this.dmax[j] = this.dmax[i] as number;
      }
      this.dl[j] = l;
      for (let a = 0; a < 3; a++) this.dp[j * 3 + a] = (this.dp[j * 3 + a] as number) + (this.dv[j * 3 + a] as number) * dt;
      this.dv[j * 3 + 1] = (this.dv[j * 3 + 1] as number) * (1 - dt * 0.8);
      this.ds[j] = Math.min(this.dmax[j] as number, (this.ds[j] as number) + dt * (this.dmax[j] as number) * 1.8);
      const s = (this.ds[j] as number) * Math.min(1, l / 0.6);
      m.makeScale(s, s * 0.8, s);
      m.setPosition(this.dp[j * 3] as number, this.dp[j * 3 + 1] as number, this.dp[j * 3 + 2] as number);
      this.dust.setMatrixAt(j, m);
      alive++;
    }
    this.dn = alive;
    this.dust.count = alive;
    this.dust.instanceMatrix.needsUpdate = true;

    // Trails.
    alive = 0;
    for (let i = 0; i < this.tn; i++) {
      const l = (this.tl[i] as number) - dt;
      if (l <= 0) continue;
      const j = alive;
      if (j !== i) {
        for (let a = 0; a < 3; a++) this.tp[j * 3 + a] = this.tp[i * 3 + a] as number;
        this.ts[j] = this.ts[i] as number;
      }
      this.tl[j] = l;
      const s = (this.ts[j] as number) * (l / 0.55);
      m.makeScale(s, s, s);
      m.setPosition(this.tp[j * 3] as number, this.tp[j * 3 + 1] as number, this.tp[j * 3 + 2] as number);
      this.trail.setMatrixAt(j, m);
      alive++;
    }
    this.tn = alive;
    this.trail.count = alive;
    this.trail.instanceMatrix.needsUpdate = true;

    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - r.life / r.total;
      const s = r.grow * (0.3 + t);
      r.mesh.scale.set(s, s, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
      if (r.life <= 0) r.mesh.visible = false;
    }
    for (const b of this.bars) {
      if (b.life <= 0) continue;
      b.life -= dt;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, b.life * 1.6);
      if (b.life <= 0) b.mesh.visible = false;
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }
}
