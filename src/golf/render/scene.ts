import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BALLS, type BallId } from '../sim/balls';
import { MATERIALS } from '../sim/materials';
import { DEG } from '../sim/math';
import { PartState, type Part } from '../sim/parts';
import type { Prediction } from '../sim/aim';
import { golferSpots, type SimEvent, type World } from '../sim/world';
import { buildEnv, type Env } from './env';
import { Fx } from './fx';
import { buildBird, buildCat, buildGolfer, buildModel, buildSquirrel } from './models';

/**
 * Renders a golf demolition world with three.js. Reads the simulation, never
 * writes to it. Bricks and other box parts are instanced (one draw call per
 * size and material class); furniture and garden pieces are single merged
 * meshes. The front of the house turns see-through while a ball is inside.
 */

export interface ViewState {
  phase: 'aim' | 'flight' | 'done' | 'intro';
  ball: BallId;
  yaw: number;
  pitch: number;
  power: number;
  prediction: Prediction | null;
  guideFull: boolean;
  guideShare: number;
  golfers: number;
  peek: boolean;
  zoom: boolean;
  /** Parts to mark with a pin (objective targets). */
  pins: number[];
}

interface Inst {
  mesh: THREE.InstancedMesh;
  index: number;
}

const SHELL_KINDS = new Set(['brick', 'foundation', 'partition', 'lintel']);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const X_AXIS = new THREE.Vector3(1, 0, 0);

function ballTexture(base: number, accent: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = `#${base.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, 128, 64);
  // Dimples.
  g.fillStyle = 'rgba(0,0,0,0.09)';
  for (let y = 4; y < 64; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < 128; x += 6) {
    g.beginPath();
    g.arc(x, y, 1.6, 0, Math.PI * 2);
    g.fill();
  }
  if (accent !== base) {
    g.fillStyle = `#${accent.toString(16).padStart(6, '0')}`;
    g.fillRect(0, 26, 128, 12);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GolfRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  world: World;
  private env!: Env;
  readonly fx = new Fx();
  private houseGroup = new THREE.Group();
  private inst: Array<Inst | null> = [];
  private models: Array<THREE.Mesh | null> = [];
  private baseColor: number[] = [];
  private flashes = new Map<number, number>();
  private finalDone = new Set<number>();
  private ghostMats: THREE.MeshStandardMaterial[] = [];
  private ghostGlass!: THREE.MeshStandardMaterial;
  private ghost = 0;
  private ghostHold = 0;
  private ballMeshes: THREE.Mesh[] = [];
  private ballMats = new Map<BallId, THREE.MeshStandardMaterial>();
  private teeBalls: THREE.Mesh[] = [];
  private guideDots: THREE.InstancedMesh;
  /** The previous shot's flight, shown faintly while aiming the next one. */
  private lastPath: THREE.InstancedMesh;
  private pathPts: number[] = [];
  private pathPhase: ViewState['phase'] = 'aim';
  private pathTick = 0;
  private landing: THREE.Mesh;
  private seamGlint: THREE.Mesh;
  private golfers: Array<{ body: THREE.Group; swing: THREE.Group; t: number; firing: boolean; delay: number }> = [];
  private birds: Array<{ g: THREE.Group; fled: boolean; vx: number; vy: number; vz: number; t: number }> = [];
  private squirrel: { g: THREE.Group; fled: boolean; t: number; home: THREE.Vector3; tree: THREE.Vector3 } | null = null;
  private cat: { g: THREE.Group; fled: boolean; t: number } | null = null;
  private pins: THREE.Mesh[] = [];
  private sun: THREE.DirectionalLight;
  private time = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camFov = 50;
  private camInit = false;
  private wideT = 0;
  private lastFocus = new THREE.Vector3();
  reducedMotion = false;
  lowPower: boolean;
  width = 1;
  height = 1;

  constructor(canvas: HTMLCanvasElement, world: World, opts: { lowPower: boolean; reducedMotion: boolean }) {
    this.world = world;
    this.lowPower = opts.lowPower;
    this.reducedMotion = opts.reducedMotion;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !opts.lowPower, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.lowPower ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    this.scene.fog = new THREE.Fog(0xcfe4ef, 60, 160);

    const hemi = new THREE.HemisphereLight(0xdcefff, 0x7a9a5a, 1.25);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    this.sun.position.set(13, 24, 18);
    this.sun.target.position.set(0, 0, -2);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -17;
    sc.right = 17;
    sc.top = 17;
    sc.bottom = -17;
    sc.near = 2;
    sc.far = 80;
    this.sun.shadow.mapSize.set(opts.lowPower ? 1024 : 2048, opts.lowPower ? 1024 : 2048);
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.045;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(this.fx.group);
    this.fx.quality = opts.lowPower ? 0.6 : 1;

    // Aim guide.
    this.guideDots = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }), 80);
    this.guideDots.count = 0;
    this.guideDots.frustumCulled = false;
    this.guideDots.renderOrder = 5;
    this.scene.add(this.guideDots);
    this.lastPath = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xf2b705, transparent: true, opacity: 0.55, depthWrite: false }), 400);
    this.lastPath.count = 0;
    this.lastPath.frustumCulled = false;
    this.scene.add(this.lastPath);
    this.landing = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 28), new THREE.MeshBasicMaterial({ color: 0xf2b705, depthTest: false, transparent: true }));
    this.landing.renderOrder = 6;
    this.landing.visible = false;
    this.scene.add(this.landing);
    this.seamGlint = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 }));
    this.seamGlint.renderOrder = 6;
    this.seamGlint.visible = false;
    this.scene.add(this.seamGlint);

    for (const id of Object.keys(BALLS) as BallId[]) {
      const d = BALLS[id];
      this.ballMats.set(id, new THREE.MeshStandardMaterial({ map: ballTexture(d.color, d.accent), roughness: id === 'heavy' ? 0.35 : 0.45, metalness: id === 'heavy' ? 0.6 : 0 }));
    }
    const ballGeo = new THREE.SphereGeometry(1, 20, 14);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(ballGeo, this.ballMats.get('standard'));
      m.castShadow = true;
      m.visible = false;
      this.ballMeshes.push(m);
      this.scene.add(m);
    }
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(ballGeo, this.ballMats.get('standard'));
      m.castShadow = true;
      this.teeBalls.push(m);
      this.scene.add(m);
    }
    const shirts = [0xd9452b, 0x2f7a6f, 0x3f74b8];
    for (let i = 0; i < 3; i++) {
      const g = buildGolfer(shirts[i] as number);
      this.scene.add(g.body);
      this.golfers.push({ ...g, t: 0, firing: false, delay: 0 });
    }
    const pinGeo = new THREE.ConeGeometry(0.22, 0.5, 4);
    pinGeo.rotateX(Math.PI);
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(pinGeo, new THREE.MeshStandardMaterial({ color: 0xf2b705, emissive: 0x6b4f00, roughness: 0.5 }));
      p.visible = false;
      this.pins.push(p);
      this.scene.add(p);
    }
    this.load(world);
  }

  /** Builds (or rebuilds after a restart) everything that depends on the level. */
  load(world: World): void {
    this.world = world;
    if (this.env) this.scene.remove(this.env.group);
    this.scene.remove(this.houseGroup);
    this.houseGroup.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).geometry.dispose();
      }
    });
    this.houseGroup = new THREE.Group();
    this.env = buildEnv(world.info, this.lowPower);
    this.scene.add(this.env.group, this.houseGroup);
    this.fx.clear();
    this.flashes.clear();
    this.finalDone.clear();
    this.ghost = 0;
    this.ghostHold = 0;
    this.pathPts = [];
    this.lastPath.count = 0;
    this.camInit = false;
    this.buildHouse();
    this.buildCritters();
  }

  private isGhost(p: Part): boolean {
    return p.wall === 'front' || p.tags.includes('roof-front') || p.tags.includes('porch-roof');
  }

  private buildHouse(): void {
    const parts = this.world.parts;
    this.inst = new Array(parts.length).fill(null);
    this.models = new Array(parts.length).fill(null);
    this.baseColor = parts.map((p) => p.color);
    const solid = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    const ghost = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, transparent: true, opacity: 1 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.42 });
    this.ghostGlass = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.42 });
    this.ghostMats = [ghost];
    const modelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    const groups = new Map<string, Part[]>();
    for (const p of parts) {
      if (p.kind === 'foliage' || p.kind === 'trunk' || p.kind === 'branch') continue;
      if (p.model) {
        const g = buildModel(p.model, p.hx * 2, p.hy * 2, p.hz * 2, this.world.info.palette.door);
        if (g) {
          const mesh = new THREE.Mesh(g, modelMat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.position.set(p.x, p.y, p.z);
          this.houseGroup.add(mesh);
          this.models[p.id] = mesh;
          continue;
        }
      }
      const cls = p.kind === 'glass' ? (this.isGhost(p) ? 'gg' : 'g') : this.isGhost(p) ? 'sg' : 's';
      const k = `${cls}|${p.hx.toFixed(3)}|${p.hy.toFixed(3)}|${p.hz.toFixed(3)}|${SHELL_KINDS.has(p.kind) ? 1 : 0}`;
      let list = groups.get(k);
      if (!list) groups.set(k, (list = []));
      list.push(p);
    }
    for (const [k, list] of groups) {
      const [cls] = k.split('|');
      const p0 = list[0] as Part;
      const gap = SHELL_KINDS.has(p0.kind) ? 0.012 : p0.kind === 'tile' ? 0.004 : 0;
      const w = Math.max(0.01, p0.hx * 2 - gap);
      const h = Math.max(0.01, p0.hy * 2 - gap);
      const d = Math.max(0.01, p0.hz * 2 - gap);
      const minDim = Math.min(w, h, d);
      const geo = SHELL_KINDS.has(p0.kind) || p0.kind === 'tile' || p0.kind === 'column' ? new RoundedBoxGeometry(w, h, d, 2, Math.min(0.035, minDim * 0.22)) : new THREE.BoxGeometry(w, h, d);
      const mat = cls === 's' ? solid : cls === 'sg' ? ghost : cls === 'g' ? glass : this.ghostGlass;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.castShadow = cls === 's' || cls === 'sg';
      mesh.receiveShadow = cls === 's' || cls === 'sg';
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      list.forEach((p, i) => {
        tmpQ.setFromAxisAngle(X_AXIS, p.rot);
        tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ, tmpS.set(1, 1, 1));
        mesh.setMatrixAt(i, tmpM);
        mesh.setColorAt(i, tmpC.setHex(p.kind === 'glass' ? 0xcbe9f5 : p.color));
        this.inst[p.id] = { mesh, index: i };
      });
      mesh.computeBoundingSphere();
      this.houseGroup.add(mesh);
    }
  }

  private buildCritters(): void {
    for (const b of this.birds) this.scene.remove(b.g);
    this.birds = [];
    const info = this.world.info;
    const colors = [0x4a5a72, 0xd9452b, 0x6e4a2e, 0x3f74b8];
    info.perches.forEach((p, i) => {
      if (i % 2 === 1 && this.lowPower) return;
      const g = buildBird(colors[i % colors.length] as number);
      g.position.set(p.x, p.y, p.z + (i % 2 ? 0.05 : -0.05));
      g.rotation.y = i % 2 ? Math.PI * 0.4 : -Math.PI * 0.6;
      this.scene.add(g);
      this.birds.push({ g, fled: false, vx: 0, vy: 0, vz: 0, t: i * 0.7 });
    });
    if (this.squirrel) this.scene.remove(this.squirrel.g);
    this.squirrel = null;
    const tree = info.trees[0];
    if (tree) {
      const g = buildSquirrel();
      const home = new THREE.Vector3(tree.x + 1.6, 0, tree.z + 1.4);
      g.position.copy(home);
      g.rotation.y = 0.8;
      this.scene.add(g);
      this.squirrel = { g, fled: false, t: 0, home, tree: new THREE.Vector3(tree.x, 0, tree.z) };
    }
    if (this.cat) this.scene.remove(this.cat.g);
    this.cat = null;
    const g = buildCat();
    g.position.set(info.doorX + 0.9, 0.6, 1.2);
    g.rotation.y = -0.6;
    this.scene.add(g);
    this.cat = { g, fled: false, t: 0 };
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Screen position (CSS px) of a world point; null if behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    tmpV.set(x, y, z).project(this.camera);
    if (tmpV.z > 1) return null;
    return { x: ((tmpV.x + 1) / 2) * this.width, y: ((1 - tmpV.y) / 2) * this.height };
  }

  // ---------------------------------------------------------------- events

  ingest(events: SimEvent[]): void {
    const P = this.world.parts;
    for (const e of events) {
      switch (e.t) {
        case 'launch':
          this.fleeAll();
          break;
        case 'hit': {
          const p = P[e.part] as Part;
          if (!e.broke && p.state === PartState.Intact) {
            this.flashes.set(p.id, 0.14);
            this.setTint(p);
          }
          const m = MATERIALS[p.mat];
          this.fx.burst(m.debris, e.x, e.y, e.z, e.broke ? 3 : 4, 2.2, 0.045);
          if (e.speed > 6) this.fx.ring(e.x, e.y, e.z, 0, 0, 1, 0.45, e.seam >= 0 ? 0xffffff : 0xf2b705, 0.35);
          break;
        }
        case 'seam': {
          const a = P[e.a] as Part;
          const b = P[e.b] as Part;
          const horizontal = Math.abs(a.y - b.y) > 0.05;
          const along: 'x' | 'z' = a.wall === 'left' || a.wall === 'right' ? 'z' : 'x';
          const jy = horizontal ? (a.y + b.y) / 2 : e.y;
          this.fx.seamFlash(horizontal ? e.x : (a.x + b.x) / 2 || e.x, jy, e.z, horizontal, along, horizontal ? 1.3 : 0.6);
          this.fx.ring(e.x, e.y, e.z, 0, 0, 1, 0.8, 0xffffff, 0.6);
          break;
        }
        case 'break': {
          const p = P[e.part] as Part;
          this.hide(p);
          const m = MATERIALS[p.mat];
          const size = Math.cbrt(p.hx * p.hy * p.hz * 8);
          const n = Math.min(26, 6 + Math.round(size * 18));
          const tint = this.baseColor[p.id];
          this.fx.burst(m.debris, e.x, e.y, e.z, p.kind === 'glass' ? 22 : n, p.kind === 'glass' ? 3.4 : 2.6, p.kind === 'glass' ? 0.07 : Math.min(0.14, size * 0.35), undefined, tint);
          if (m.debris === 'brick' || m.debris === 'dust' || m.debris === 'tile') this.fx.puff(e.x, e.y, e.z, 2, 0.5 + size * 0.5, 0.5);
          if (e.cause === 'overload') this.fx.shake = Math.max(this.fx.shake, 0.2);
          break;
        }
        case 'knock':
          this.fx.ring(e.x, e.y, e.z, 0, 1, 0, 0.5, 0xf2b705, 0.4);
          break;
        case 'land': {
          const p = P[e.part] as Part;
          if (e.speed > 3 && (p.kind === 'brick' || p.kind === 'deck' || p.kind === 'floor' || p.kind === 'partition' || p.kind === 'tile')) {
            this.fx.puff(e.x, Math.max(0.1, e.y), e.z, p.kind === 'deck' || p.kind === 'floor' ? 5 : 1, p.kind === 'deck' || p.kind === 'floor' ? 1.6 : 0.6, 0.4);
          }
          break;
        }
        case 'collapse':
          this.fx.shake = Math.min(1, this.fx.shake + 0.25 + Math.min(0.6, e.count / 120));
          this.fx.puff(e.x, Math.max(0.5, e.y * 0.5), e.z, Math.min(10, 3 + Math.floor(e.count / 15)), 1.6 + Math.min(2, e.count / 60), 0.7);
          if (e.count > 40 || e.roof) this.wideT = 1.8;
          this.env.shakeTree(e.x, e.z, 0.6);
          break;
        case 'blast':
          this.fx.puff(e.x, e.y, e.z, 9, 1.8, 1.4);
          this.fx.burst('dust', e.x, e.y, e.z, 30, 7, 0.1);
          this.fx.ring(e.x, e.y, e.z, 0, 0, 1, e.r * 1.2, 0xff8a50, 0.5);
          this.fx.shake = Math.min(1, this.fx.shake + 0.6);
          break;
        case 'leaves':
          this.env.shakeTree(e.x, e.z, 1);
          this.fx.burst('leaf', e.x, e.y, e.z, 10, 1.8, 0.07);
          break;
        case 'ground':
          if (e.speed > 6) this.fx.puff(e.x, 0.05, e.z, 1, 0.25, 0.3);
          break;
        case 'creak':
          this.flashes.set(e.part, 0.25);
          break;
      }
    }
  }

  private setTint(p: Part): void {
    const i = this.inst[p.id];
    if (!i) return;
    const base = this.baseColor[p.id] as number;
    tmpC.setHex(p.kind === 'glass' ? 0xcbe9f5 : base);
    if (Number.isFinite(p.hp0) && p.hp < p.hp0) tmpC.multiplyScalar(0.62 + 0.38 * Math.max(0, p.hp / p.hp0));
    const f = this.flashes.get(p.id);
    if (f && f > 0) tmpC.lerp(new THREE.Color(0xfff6dc), Math.min(1, f * 5));
    i.mesh.setColorAt(i.index, tmpC);
    if (i.mesh.instanceColor) i.mesh.instanceColor.needsUpdate = true;
  }

  private hide(p: Part): void {
    const i = this.inst[p.id];
    if (i) {
      tmpM.makeScale(0, 0, 0);
      i.mesh.setMatrixAt(i.index, tmpM);
      i.mesh.instanceMatrix.needsUpdate = true;
    }
    const m = this.models[p.id];
    if (m) m.visible = false;
  }

  private fleeAll(): void {
    for (const b of this.birds) {
      if (b.fled) continue;
      b.fled = true;
      b.t = 0;
      const a = Math.random() * Math.PI * 2;
      b.vx = Math.cos(a) * 3;
      b.vz = -2 - Math.random() * 2;
      b.vy = 2.5 + Math.random();
    }
    if (this.squirrel) this.squirrel.fled = true;
    if (this.cat) this.cat.fled = true;
  }

  // ---------------------------------------------------------------- update

  update(dt: number, view: ViewState): void {
    dt = Math.max(0, Math.min(0.1, dt));
    this.time += dt;
    const w = this.world;
    const P = w.parts;
    this.env.update(dt, this.time);

    // Falling and settling pieces follow their debris bodies.
    for (const d of w.debris) {
      if (d.asleep && this.finalDone.has(d.part)) continue;
      const p = P[d.part] as Part;
      if (p.state === PartState.Gone) {
        this.finalDone.add(d.part);
        continue;
      }
      tmpQ.set(d.qx, d.qy, d.qz, d.qw);
      const i = this.inst[d.part];
      if (i) {
        tmpM.compose(tmpV.set(d.x, d.y, d.z), tmpQ, tmpS.set(1, 1, 1));
        i.mesh.setMatrixAt(i.index, tmpM);
        i.mesh.instanceMatrix.needsUpdate = true;
      }
      const m = this.models[d.part];
      if (m) {
        m.position.set(d.x, d.y, d.z);
        m.quaternion.copy(tmpQ);
      }
      if (d.asleep) this.finalDone.add(d.part);
      else this.finalDone.delete(d.part);
    }

    for (const [id, t] of this.flashes) {
      const nt = t - dt;
      if (nt <= 0) this.flashes.delete(id);
      else this.flashes.set(id, nt);
      const p = P[id] as Part;
      if (p.state === PartState.Intact) this.setTint(p);
    }

    // Balls and trails.
    let bi = 0;
    let anyInside = false;
    const focus = new THREE.Vector3();
    let fw = 0;
    for (const b of w.balls) {
      if (!b.alive || b.delay > 0 || b.age <= 0) continue;
      const m = this.ballMeshes[bi++];
      if (!m) break;
      m.visible = true;
      m.material = this.ballMats.get(b.def.id) as THREE.Material;
      m.position.set(b.x, b.y, b.z);
      m.scale.setScalar(b.def.radius);
      m.rotation.x += dt * Math.hypot(b.vx, b.vz) * 2;
      this.fx.trailDot(b.x, b.y, b.z, b.def.radius * 0.75);
      if (b.room) anyInside = true;
      const wgt = b.room ? 3 : 1;
      focus.addScaledVector(tmpV.set(b.x, b.y, b.z), wgt);
      fw += wgt;
    }
    for (; bi < this.ballMeshes.length; bi++) (this.ballMeshes[bi] as THREE.Mesh).visible = false;
    this.recordPath(dt, view);
    if (fw > 0) {
      focus.multiplyScalar(1 / fw);
      this.lastFocus.copy(focus);
    }

    // Cutaway: the front of the house fades while a ball is inside (or on request).
    if (anyInside) this.ghostHold = 1.4;
    else this.ghostHold = Math.max(0, this.ghostHold - dt);
    const ghostTarget = view.peek || this.ghostHold > 0 ? 1 : 0;
    this.ghost += (ghostTarget - this.ghost) * Math.min(1, dt * 6);
    const op = 1 - 0.9 * this.ghost;
    for (const gm of this.ghostMats) {
      gm.opacity = op;
      gm.depthWrite = op > 0.98;
    }
    this.ghostGlass.opacity = 0.42 * op;

    // Tee: the ball waiting on the tee, and the golfers.
    const spots = golferSpots(w.info, Math.max(1, view.golfers));
    const aiming = view.phase === 'aim' || view.phase === 'intro';
    this.teeBalls.forEach((m, i) => {
      const s = spots[i];
      m.visible = aiming && !!s;
      if (!s) return;
      const def = BALLS[view.ball];
      m.material = this.ballMats.get(view.ball) as THREE.Material;
      m.scale.setScalar(def.radius);
      m.position.set(s.x, def.radius + 0.04, s.z);
    });
    this.golfers.forEach((g, i) => {
      const s = spots[i];
      g.body.visible = !!s && (i === 0 || view.golfers > 1);
      if (!s) return;
      g.body.position.set(s.x, 0, s.z);
      g.body.rotation.y = -view.yaw * DEG;
      (g.body.children[0] as THREE.Object3D).position.x = -0.82;
      g.swing.position.x = 0.24 - 0.82;
      if (aiming) {
        g.firing = false;
        g.t = 0;
        const back = -0.25 - view.power * 1.75;
        g.swing.rotation.x += (back + Math.sin(this.time * 2.2 + i) * 0.03 - g.swing.rotation.x) * Math.min(1, dt * 10);
      } else {
        if (!g.firing) {
          g.firing = true;
          g.t = -i * 0.22;
        }
        g.t += dt;
        const t = Math.max(0, g.t);
        const target = t < 0.1 ? -0.25 - view.power * 1.75 + (t / 0.1) * (0.25 + view.power * 1.75) : Math.min(2.3, ((t - 0.1) / 0.25) * 2.3);
        g.swing.rotation.x += (target - g.swing.rotation.x) * Math.min(1, dt * 30);
      }
    });

    this.updateGuide(view);
    this.updateCritters(dt);

    // Objective pins.
    this.pins.forEach((pin, i) => {
      const id = view.pins[i];
      const p = id === undefined ? undefined : P[id];
      pin.visible = !!p && p.state === PartState.Intact && aiming;
      if (p && pin.visible) {
        pin.position.set(p.x, p.y + p.hy + 0.55 + Math.sin(this.time * 3 + i) * 0.08, p.z + 0.1);
        pin.rotation.y = this.time * 1.5;
      }
    });

    this.fx.update(dt);
    if (this.wideT > 0) this.wideT -= dt;
    this.updateCamera(dt, view, fw > 0 ? focus : null, anyInside);
  }

  private recordPath(dt: number, view: ViewState): void {
    if (view.phase === 'flight' && this.pathPhase !== 'flight') {
      this.pathPts = [];
      this.lastPath.count = 0;
    }
    this.pathPhase = view.phase;
    if (view.phase === 'flight') {
      this.pathTick += dt;
      if (this.pathTick < 0.03) return;
      this.pathTick = 0;
      for (const b of this.world.balls) {
        if (!b.alive || b.age <= 0 || this.pathPts.length >= 1200) continue;
        this.pathPts.push(b.x, b.y, b.z);
      }
      return;
    }
    const show = view.phase === 'aim' && this.pathPts.length > 0;
    if (!show) {
      this.lastPath.count = 0;
      return;
    }
    if (this.lastPath.count) return;
    const n = Math.min(400, this.pathPts.length / 3);
    for (let i = 0; i < n; i++) {
      tmpM.makeScale(0.03, 0.03, 0.03);
      tmpM.setPosition(this.pathPts[i * 3] as number, this.pathPts[i * 3 + 1] as number, this.pathPts[i * 3 + 2] as number);
      this.lastPath.setMatrixAt(i, tmpM);
    }
    this.lastPath.count = n;
    this.lastPath.instanceMatrix.needsUpdate = true;
  }

  private updateGuide(view: ViewState): void {
    const pred = view.prediction;
    const show = view.phase === 'aim' && !!pred;
    this.landing.visible = false;
    this.seamGlint.visible = false;
    if (!show || !pred) {
      this.guideDots.count = 0;
      return;
    }
    const pts = pred.points;
    // Total arc length, then dots every 0.55 m up to the share shown.
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot((pts[i] as { x: number }).x - (pts[i - 1] as { x: number }).x, (pts[i] as { y: number }).y - (pts[i - 1] as { y: number }).y, (pts[i] as { z: number }).z - (pts[i - 1] as { z: number }).z);
    const shown = view.guideFull ? total : total * view.guideShare;
    let acc = 0;
    let next = 0.9;
    let n = 0;
    for (let i = 1; i < pts.length && n < 80; i++) {
      const a = pts[i - 1] as { x: number; y: number; z: number };
      const b = pts[i] as { x: number; y: number; z: number };
      const seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      while (acc + seg >= next && next <= shown && n < 80) {
        const t = (next - acc) / seg;
        const fade = view.guideFull ? 1 : 1 - next / Math.max(0.01, shown);
        const s = 0.045 * (0.45 + 0.55 * fade);
        tmpM.makeScale(s, s, s);
        tmpM.setPosition(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
        this.guideDots.setMatrixAt(n++, tmpM);
        next += 0.55;
      }
      acc += seg;
    }
    this.guideDots.count = n;
    this.guideDots.instanceMatrix.needsUpdate = true;
    const c = pred.contact;
    if (view.guideFull && c) {
      this.landing.visible = true;
      this.landing.position.set(c.px + c.nx * 0.03, c.py + c.ny * 0.03, c.pz + c.nz * 0.03);
      this.landing.lookAt(c.px + c.nx, c.py + c.ny, c.pz + c.nz);
      const onSeam = !!pred.seam?.other;
      (this.landing.material as THREE.MeshBasicMaterial).color.setHex(onSeam ? 0xffffff : 0xf2b705);
      this.landing.scale.setScalar(onSeam ? 1.3 + Math.sin(this.time * 10) * 0.12 : 1);
      if (onSeam && pred.seam?.other) {
        const a = c.part;
        const b = pred.seam.other;
        const horizontal = Math.abs(a.y - b.y) > 0.05;
        const along = a.wall === 'left' || a.wall === 'right' ? 'z' : 'x';
        this.seamGlint.visible = true;
        this.seamGlint.position.set(horizontal ? c.px : (a.x + b.x) / 2, horizontal ? (a.y + b.y) / 2 : c.py, c.pz + c.nz * 0.03);
        if (horizontal) this.seamGlint.scale.set(along === 'x' ? 0.7 : 0.03, 0.025, along === 'z' ? 0.7 : 0.03);
        else this.seamGlint.scale.set(0.025, 0.36, 0.03);
      }
    } else if (c && pred.seam?.other) {
      // Without the full guide: only a faint shimmer on the joint, and no landing ring.
      const a = c.part;
      const b = pred.seam.other;
      const horizontal = Math.abs(a.y - b.y) > 0.05;
      const along = a.wall === 'left' || a.wall === 'right' ? 'z' : 'x';
      this.seamGlint.visible = true;
      (this.seamGlint.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(this.time * 6) * 0.12;
      this.seamGlint.position.set(horizontal ? c.px : (a.x + b.x) / 2, horizontal ? (a.y + b.y) / 2 : c.py, c.pz + c.nz * 0.03);
      if (horizontal) this.seamGlint.scale.set(along === 'x' ? 0.45 : 0.02, 0.018, along === 'z' ? 0.45 : 0.02);
      else this.seamGlint.scale.set(0.018, 0.24, 0.02);
      return;
    }
    (this.seamGlint.material as THREE.MeshBasicMaterial).opacity = 0.95;
  }

  private updateCritters(dt: number): void {
    for (const b of this.birds) {
      b.t += dt;
      if (!b.fled) {
        // Little hops.
        b.g.position.y += Math.max(0, Math.sin(b.t * 2.3)) * 0.002 - (b.g.position.y > 0 ? 0 : 0);
        continue;
      }
      b.vy += 0.6 * dt;
      b.g.position.x += b.vx * dt;
      b.g.position.y += b.vy * dt;
      b.g.position.z += b.vz * dt;
      b.g.rotation.y = Math.atan2(-b.vz, b.vx);
      const flap = Math.sin(b.t * 28) * 0.9;
      const wl = b.g.getObjectByName('wl');
      const wr = b.g.getObjectByName('wr');
      if (wl) wl.rotation.x = flap;
      if (wr) wr.rotation.x = -flap;
      if (b.g.position.y > 30) b.g.visible = false;
    }
    if (this.squirrel) {
      const s = this.squirrel;
      if (s.fled) {
        s.t += dt;
        const to = s.tree;
        const d = tmpV.set(to.x - s.g.position.x, 0, to.z + 0.25 - s.g.position.z);
        const dist = d.length();
        if (dist > 0.3) {
          d.normalize();
          s.g.position.x += d.x * 4 * dt;
          s.g.position.z += d.z * 4 * dt;
          s.g.rotation.y = Math.atan2(-d.z, d.x);
          s.g.position.y = Math.abs(Math.sin(s.t * 18)) * 0.06;
        } else {
          // Up the trunk and out of sight in the leaves.
          s.g.rotation.z = Math.PI / 2;
          s.g.position.y = Math.min(4.2, s.g.position.y + 3 * dt);
          if (s.g.position.y >= 4.2) s.g.visible = false;
        }
      }
    }
    if (this.cat && this.cat.fled) {
      const c = this.cat;
      c.t += dt;
      c.g.rotation.y = Math.PI;
      c.g.position.x -= 5 * dt;
      c.g.position.y = Math.max(0, 0.6 - c.t * 1.5) + Math.abs(Math.sin(c.t * 16)) * 0.05;
      if (c.g.position.x < -16) c.g.visible = false;
    }
  }

  // ---------------------------------------------------------------- camera

  /** The aiming view: behind the tee, the whole house in frame at any aspect ratio. */
  aimPose(zoom: boolean): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
    const info = this.world.info;
    const aspect = this.width / Math.max(1, this.height);
    // Over the golfer's shoulder, the whole house across the screen. Zoom moves up to the front wall.
    const portrait = aspect < 0.9;
    const pos = zoom ? new THREE.Vector3(0.8, 3.1, 10.5) : new THREE.Vector3(portrait ? 0.2 : 1.0, portrait ? 3.9 : 3.4, info.tee.z + (portrait ? 6.9 : 6));
    // Tilted down a little so the golfer and the tee sit in the foreground, the house above them.
    const look = zoom ? new THREE.Vector3(0.3, 2.6, 0) : new THREE.Vector3(0.3, portrait ? 1.0 : info.ridgeY * 0.42, -2);
    const halfW = zoom ? 4.9 : 6.4;
    const dist = pos.distanceTo(look);
    const hfov = 2 * Math.atan(halfW / dist);
    // Also keep the house's height in frame (it matters on wide screens).
    const tall = (2 * Math.atan(((info.ridgeY + 1.6) * (zoom ? 0.5 : 0.9)) / dist)) / DEG;
    const fov = Math.max(zoom ? 24 : tall, Math.min(zoom ? 70 : 64, (2 * Math.atan(Math.tan(hfov / 2) / aspect)) / DEG));
    return { pos, look, fov };
  }

  private updateCamera(dt: number, view: ViewState, focus: THREE.Vector3 | null, inside: boolean): void {
    const aim = this.aimPose(view.zoom);
    let pos = aim.pos.clone();
    let look = aim.look.clone();
    let fov = aim.fov;
    let rate = 3;
    if (view.phase === 'done') {
      // Level over: step back and take in what is left of the house.
      const wide = this.aimPose(false);
      pos = wide.pos.clone().add(new THREE.Vector3(0, 1.5, 3));
      look = wide.look.clone();
      fov = wide.fov + 2;
      rate = 1.6;
    } else if (view.phase === 'flight') {
      const f = focus ?? this.lastFocus;
      if (inside && focus) {
        // Interior: come in close on the front and look into the room.
        pos = new THREE.Vector3(f.x * 0.75 + 1, Math.max(f.y + 1.6, 2.6), 9.5);
        look = new THREE.Vector3(f.x, f.y, f.z);
        fov = 44;
        rate = 2.4;
      } else if (focus) {
        const toward = Math.min(0.42, Math.max(0, (this.world.info.tee.z - f.z) / 40));
        pos.lerp(new THREE.Vector3(f.x * 0.4, Math.max(3, f.y + 2.5), f.z + 14), toward);
        look.lerp(f, 0.55);
        rate = 2.6;
      }
      if (this.wideT > 0) {
        const wide = this.aimPose(false);
        pos = wide.pos.clone().add(new THREE.Vector3(0, 2, 6));
        look = wide.look.clone();
        fov = wide.fov + 4;
        rate = 2;
      }
    }
    if (!this.camInit) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
      this.camFov = fov;
      this.camInit = true;
    }
    const k = 1 - Math.exp(-rate * dt);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.camFov += (fov - this.camFov) * k;
    this.camera.position.copy(this.camPos);
    if (this.fx.shake > 0 && !this.reducedMotion) {
      const s = this.fx.shake * 0.12;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.camLook);
    if (Math.abs(this.camera.fov - this.camFov) > 0.01) {
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Jump the camera to its target pose (after a restart or resize). */
  snapCamera(): void {
    this.camInit = false;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
    // Browsers cap live WebGL contexts; give this one back now rather than when it is collected.
    this.renderer.forceContextLoss();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      }
    });
  }
}
