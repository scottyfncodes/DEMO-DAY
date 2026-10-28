import * as THREE from 'three';
import type { HouseInfo } from '../sim/house';

/**
 * The neighbourhood around the house: sky, drifting clouds, a striped lawn,
 * the path, flower beds, the tee box, and the houses across the back fence.
 * Trees are drawn here from the layout; their trunks and branches are also
 * solid parts in the simulation.
 */

export interface Env {
  group: THREE.Group;
  clouds: THREE.Object3D[];
  canopies: Array<{ mesh: THREE.Object3D; x: number; z: number; shake: number; base: THREE.Vector3 }>;
  update(dt: number, t: number): void;
  shakeTree(x: number, z: number, amount: number): void;
}

const lambert = (color: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });

function lawnTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  // Mowing stripes, crosswise to the line of play.
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#7fb35a' : '#88bd61';
    g.fillRect(0, i * 32, 64, 32);
  }
  // A little grain so it is not flat colour.
  for (let i = 0; i < 900; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(60,110,40,0.18)' : 'rgba(170,210,120,0.16)';
    g.fillRect(Math.random() * 64, Math.random() * 256, 1, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(12, 6);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildEnv(info: HouseInfo, lowPower: boolean): Env {
  const group = new THREE.Group();

  // Sky dome: a vertical gradient, warm at the horizon.
  const skyGeo = new THREE.SphereGeometry(220, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x4f9ad8) }, mid: { value: new THREE.Color(0x9fd0f0) }, bottom: { value: new THREE.Color(0xf4e6c8) } },
    vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying float vY; void main(){ float t = clamp(vY,0.0,1.0); vec3 c = t < 0.18 ? mix(bottom, mid, t/0.18) : mix(mid, top, (t-0.18)/0.82); gl_FragColor = vec4(c,1.0); }',
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -10;
  group.add(sky);

  // Lawn.
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ map: lawnTexture(), roughness: 1 }));
  lawn.rotation.x = -Math.PI / 2;
  lawn.receiveShadow = true;
  group.add(lawn);

  // Path to the front door, and the porch steps.
  for (const p of info.paving) {
    const path = new THREE.Mesh(new THREE.BoxGeometry(p.maxX - p.minX, 0.03, p.maxZ - p.minZ), lambert(0xddd3c0));
    path.position.set((p.minX + p.maxX) / 2, 0.015, (p.minZ + p.maxZ) / 2);
    path.receiveShadow = true;
    group.add(path);
    const n = Math.floor((p.maxZ - p.minZ) / 0.9);
    for (let i = 0; i < n; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(p.maxX - p.minX, 0.032, 0.03), lambert(0xc4b9a4));
      line.position.set((p.minX + p.maxX) / 2, 0.016, p.minZ + (i + 1) * 0.9);
      group.add(line);
    }
  }

  // Flower beds along the front wall, either side of the porch.
  const soil = lambert(0x6b4a32);
  const flowerColors = [0xf06292, 0xffd54f, 0xffffff, 0xff8a50, 0xba68c8];
  const flowerGeo = new THREE.IcosahedronGeometry(0.09, 0);
  const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const beds: Array<[number, number]> = [
    [-info.W / 2 + 0.2, info.doorX - 1.9],
    [info.doorX + 1.9, info.W / 2 - 0.2],
  ];
  let fi = 0;
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, 120);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  for (const [x0, x1] of beds) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.12, 0.7), soil);
    bed.position.set((x0 + x1) / 2, 0.06, 0.4);
    bed.receiveShadow = true;
    group.add(bed);
    for (let x = x0 + 0.15; x < x1 - 0.1 && fi < 120; x += 0.22) {
      for (const dz of [0.22, 0.55]) {
        if (fi >= 120) break;
        m.makeTranslation(x + (fi % 3) * 0.03, 0.18 + (fi % 2) * 0.05, dz + (fi % 5) * 0.02);
        flowers.setMatrixAt(fi, m);
        flowers.setColorAt(fi, col.setHex(flowerColors[fi % flowerColors.length] as number));
        fi++;
      }
    }
  }
  flowers.count = fi;
  group.add(flowers);

  // Tee box: a mown rectangle and two markers.
  const tee = info.tee;
  const teeBox = new THREE.Mesh(new THREE.BoxGeometry(9, 0.02, 3.2), lambert(0x6aa84f));
  teeBox.position.set(tee.x, 0.01, tee.z + 0.6);
  teeBox.receiveShadow = true;
  group.add(teeBox);
  for (const dx of [-4, 4]) {
    const mk = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), lambert(0xd9452b));
    mk.position.set(tee.x + dx, 0.16, tee.z - 0.6);
    mk.castShadow = true;
    group.add(mk);
  }

  // Trees: chunky trunk and a cluster of foliage blobs.
  const canopies: Env['canopies'] = [];
  const trunkMat = lambert(0x6b4a32);
  const leafMats = [lambert(0x5f9a4a), lambert(0x6fae55), lambert(0x4f8a3e)];
  for (const t of info.trees) {
    const s = t.s;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.17 * s, 0.24 * s, 3.6 * s, 8), trunkMat);
    trunk.position.set(t.x, 1.8 * s, t.z);
    trunk.castShadow = true;
    group.add(trunk);
    for (const [bx, by, bz, len, rz] of [
      [0.9, 3.0, 0, 1.5, -1.25],
      [-0.8, 3.5, 0.2, 1.3, 1.25],
    ] as const) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * s, 0.09 * s, len * s, 6), trunkMat);
      br.position.set(t.x + bx * s, by * s, t.z + bz * s);
      br.rotation.z = rz;
      br.castShadow = true;
      group.add(br);
    }
    const canopy = new THREE.Group();
    const blobs: Array<[number, number, number, number]> = [
      [0, 0, 0, 1.6],
      [1.1, -0.3, 0.3, 1.1],
      [-1.1, -0.2, -0.2, 1.15],
      [0.2, 0.7, -0.4, 1.1],
      [-0.3, -0.4, 1.0, 1.0],
      [0.4, -0.3, -1.0, 1.0],
    ];
    blobs.forEach(([x, y, z, r], i) => {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 1), leafMats[i % 3]);
      b.position.set(x * s, y * s, z * s);
      b.castShadow = true;
      canopy.add(b);
    });
    canopy.position.set(t.x, 4.6 * s, t.z);
    group.add(canopy);
    canopies.push({ mesh: canopy, x: t.x, z: t.z, shake: 0, base: canopy.position.clone() });
  }

  // The street behind: neighbours' houses over the back hedge, kept muted so the target house leads.
  const neighbourCols = [0xc9b7a0, 0xb8c4c9, 0xd4c2a8, 0xbfae9c, 0xc7cdb8];
  const roofCols = [0x6e7a86, 0x8a5a4a, 0x5d6b5b, 0x7a6a5e];
  for (let i = 0; i < 7; i++) {
    const x = -27 + i * 9 + (i % 2) * 1.5;
    const w = 6.5;
    const hgt = 4.2 + (i % 3) * 1.2;
    const z = -26 - (i % 2) * 3;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, 6), lambert(neighbourCols[i % neighbourCols.length] as number));
    body.position.set(x, hgt / 2, z);
    group.add(body);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 4.4, 2.6, 4, 1), lambert(roofCols[i % roofCols.length] as number));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.05, 1, 0.95);
    roof.position.set(x, hgt + 1.3, z);
    group.add(roof);
    for (let wy = 0; wy < Math.floor(hgt / 2.4); wy++) {
      for (const wx of [-1.6, 1.6]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1, 0.9, 0.05), lambert(0x8fb3c9));
        win.position.set(x + wx, 1.6 + wy * 2.4, z + 3.01);
        group.add(win);
      }
    }
  }
  // Tree line on the horizon.
  const far = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), lambert(0x5e8f52), 26);
  for (let i = 0; i < 26; i++) {
    const s = 2.4 + ((i * 37) % 10) / 6;
    m.compose(new THREE.Vector3(-60 + i * 4.8, s * 0.9 + 1, -36 - ((i * 13) % 7)), new THREE.Quaternion(), new THREE.Vector3(s, s * 1.2, s));
    far.setMatrixAt(i, m);
  }
  group.add(far);
  // Side hedges' far ends and a low fence along the sides of the front lawn.
  const picket = lambert(0xf6f2ea);
  for (const sx of [-1, 1]) {
    for (let z = 14; z < 27; z += 0.5) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.12), picket);
      p.position.set(sx * 15, 0.45, z);
      group.add(p);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 13), picket);
    rail.position.set(sx * 15, 0.6, 20.5);
    group.add(rail);
  }

  // Clouds: puffy clusters drifting across.
  const clouds: THREE.Object3D[] = [];
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.35 });
  const cloudN = lowPower ? 4 : 7;
  for (let i = 0; i < cloudN; i++) {
    const c = new THREE.Group();
    const n = 4 + (i % 3);
    for (let j = 0; j < n; j++) {
      const r = 1.6 + ((i + j) % 3) * 0.7;
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloudMat);
      b.position.set(j * 1.9 - n, ((j * 7) % 3) * 0.5, ((j * 5) % 3) * 0.6);
      b.scale.y = 0.62;
      c.add(b);
    }
    c.position.set(-70 + i * 22, 24 + (i % 3) * 5, -60 - (i % 4) * 12);
    c.userData.speed = 0.6 + (i % 3) * 0.25;
    clouds.push(c);
    group.add(c);
  }

  return {
    group,
    clouds,
    canopies,
    update(dt: number, t: number): void {
      for (const c of clouds) {
        c.position.x += (c.userData.speed as number) * dt;
        if (c.position.x > 90) c.position.x = -90;
      }
      for (const cp of canopies) {
        cp.shake = Math.max(0, cp.shake - dt * 1.6);
        const k = cp.shake;
        cp.mesh.position.set(cp.base.x + Math.sin(t * 23) * 0.08 * k, cp.base.y + Math.sin(t * 17) * 0.03 * k, cp.base.z + Math.cos(t * 19) * 0.06 * k);
        cp.mesh.rotation.z = Math.sin(t * 0.7 + cp.x) * 0.015 + Math.sin(t * 21) * 0.04 * k;
      }
    },
    shakeTree(x: number, z: number, amount: number): void {
      for (const cp of canopies) {
        const d = Math.hypot(cp.x - x, cp.z - z);
        if (d < 6) cp.shake = Math.min(1, cp.shake + amount * (1 - d / 6));
      }
    },
  };
}
