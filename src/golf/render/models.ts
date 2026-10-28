import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Toy-scale models for furniture, garden pieces, golfers and critters,
 * built from a few primitives and merged into one vertex-coloured geometry
 * each, so every model is a single draw call.
 */

type Geo = THREE.BufferGeometry;

class Kit {
  private parts: Geo[] = [];

  private push(g: Geo, color: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): this {
    g.rotateX(rx);
    g.rotateY(ry);
    g.rotateZ(rz);
    g.translate(x, y, z);
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    const ng = g.index ? g.toNonIndexed() : g;
    this.parts.push(ng);
    return this;
  }

  box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    return this.push(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
  }

  cyl(rt: number, rb: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 10, rx = 0, rz = 0): this {
    return this.push(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, rx, 0, rz);
  }

  sphere(r: number, color: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, detail = 1): this {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.scale(sx, sy, sz);
    return this.push(g, color, x, y, z);
  }

  cone(r: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 10, rx = 0, rz = 0): this {
    return this.push(new THREE.ConeGeometry(r, h, seg), color, x, y, z, rx, 0, rz);
  }

  torus(r: number, t: number, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0): this {
    return this.push(new THREE.TorusGeometry(r, t, 6, 14), color, x, y, z, rx, ry);
  }

  build(): Geo {
    const g = mergeGeometries(this.parts, false) as Geo;
    for (const p of this.parts) p.dispose();
    g.computeVertexNormals();
    return g;
  }
}

/** Builds a model sized to a part's box (w, h, d), centred on the origin. */
export function buildModel(model: string, w: number, h: number, d: number, accent = 0x2f7a6f): Geo | null {
  const k = new Kit();
  const y0 = -h / 2;
  const wood = 0x9a6b43;
  const darkWood = 0x6e4a2e;
  switch (model) {
    case 'sofa': {
      const c = 0x5c86a3;
      k.box(w, h * 0.42, d, c, 0, y0 + h * 0.21);
      k.box(w, h * 0.6, d * 0.28, c, 0, y0 + h * 0.6, -d * 0.36);
      k.box(w * 0.1, h * 0.65, d, 0x4f7590, -w * 0.45, y0 + h * 0.32);
      k.box(w * 0.1, h * 0.65, d, 0x4f7590, w * 0.45, y0 + h * 0.32);
      k.box(w * 0.38, h * 0.12, d * 0.6, 0x6f9bb8, -w * 0.2, y0 + h * 0.48, d * 0.08);
      k.box(w * 0.38, h * 0.12, d * 0.6, 0x6f9bb8, w * 0.2, y0 + h * 0.48, d * 0.08);
      k.box(w * 0.18, h * 0.22, d * 0.12, 0xf2b705, -w * 0.3, y0 + h * 0.72, -d * 0.2, 0.3);
      break;
    }
    case 'coffeeTable':
    case 'diningTable':
    case 'desk': {
      const top = model === 'desk' ? 0xd8c3a0 : wood;
      k.box(w, h * 0.1, d, top, 0, -y0 - h * 0.05);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) k.box(0.06, h * 0.9, 0.06, darkWood, sx * (w / 2 - 0.06), y0 + h * 0.45, sz * (d / 2 - 0.06));
      if (model === 'diningTable') k.cyl(0.08, 0.06, 0.18, 0xe9e2d2, 0.1, -y0 + 0.09, 0).sphere(0.07, 0xd9452b, -0.25, -y0 + 0.06, 0.1);
      break;
    }
    case 'floorLamp':
      k.cyl(0.14, 0.16, 0.05, 0x3c4146, 0, y0 + 0.025);
      k.cyl(0.02, 0.02, h * 0.75, 0x3c4146, 0, y0 + h * 0.4);
      k.cyl(w * 0.35, w * 0.5, h * 0.22, 0xffe7a8, 0, -y0 - h * 0.11, 0, 12);
      break;
    case 'tvStand':
      k.box(w, h, d, darkWood, 0, 0);
      k.box(w * 0.42, h * 0.55, 0.02, 0x8a6a4a, -w * 0.24, 0, d / 2 + 0.005);
      k.box(w * 0.42, h * 0.55, 0.02, 0x8a6a4a, w * 0.24, 0, d / 2 + 0.005);
      break;
    case 'tv':
    case 'monitor':
      k.box(w, h * 0.85, d * 0.6, 0x1d2124, 0, h * 0.07);
      k.box(w * 0.92, h * 0.72, 0.01, model === 'tv' ? 0x2a4f6e : 0x3b6e8c, 0, h * 0.07, d * 0.31);
      k.box(w * 0.3, h * 0.12, d, 0x2b2f33, 0, y0 + h * 0.06);
      break;
    case 'bookshelf': {
      const long = w > d ? 'x' : 'z';
      k.box(w, h, d, wood, 0, 0);
      const books = [0xd9452b, 0x2f7a6f, 0xf2b705, 0x4a5a72, 0xe8dcc2, 0x8c3f5d];
      for (let s = 0; s < 4; s++) {
        const sy = y0 + 0.15 + s * (h / 4);
        for (let i = 0; i < 6; i++) {
          const off = -0.38 + i * 0.15;
          const bh = 0.24 + ((i * 7 + s * 3) % 4) * 0.03;
          // Books poke out of both faces so they read whichever way the shelf stands.
          if (long === 'x') k.box(0.1, bh, d + 0.04, books[(i + s) % 6] as number, off * w, sy + bh / 2, 0);
          else k.box(w + 0.04, bh, 0.1, books[(i + s) % 6] as number, 0, sy + bh / 2, off * d);
        }
      }
      break;
    }
    case 'plant':
      k.cyl(w * 0.4, w * 0.3, h * 0.35, 0xc66b3d, 0, y0 + h * 0.175);
      k.sphere(w * 0.55, 0x4f9a48, 0, y0 + h * 0.62, 0, 1, 1.15, 1);
      k.sphere(w * 0.35, 0x66b05a, w * 0.15, y0 + h * 0.85, 0.05);
      break;
    case 'clock':
      k.box(w, h * 0.78, d, darkWood, 0, y0 + h * 0.39);
      k.box(w * 1.1, h * 0.24, d * 1.05, darkWood, 0, -y0 - h * 0.12);
      k.cyl(w * 0.36, w * 0.36, 0.03, 0xf6f1e6, 0, -y0 - h * 0.12, d / 2 + 0.01, 16, Math.PI / 2);
      k.box(w * 0.04, h * 0.3, 0.02, 0xd9b44a, 0, y0 + h * 0.45, d / 2 + 0.005);
      k.cyl(w * 0.14, w * 0.14, 0.02, 0xd9b44a, 0, y0 + h * 0.3, d / 2 + 0.01, 12, Math.PI / 2);
      break;
    case 'coatRack':
      k.cyl(0.03, 0.03, h, darkWood, 0, 0);
      k.cyl(0.18, 0.2, 0.04, darkWood, 0, y0 + 0.02);
      k.sphere(0.13, 0xd9452b, 0.08, -y0 - 0.25, 0.05, 1, 1.4, 1);
      k.sphere(0.11, 0x2f7a6f, -0.08, -y0 - 0.3, -0.05, 1, 1.5, 1);
      break;
    case 'counter':
      k.box(w, h * 0.92, d, 0xe9e2d2, 0, y0 + h * 0.46);
      k.box(w + 0.04, h * 0.08, d + 0.04, 0x55606b, 0, -y0 - h * 0.04);
      for (let i = 0; i < 3; i++) k.box(w * 0.3, h * 0.7, 0.02, 0xd8cfbd, -w * 0.33 + i * w * 0.33, y0 + h * 0.42, d / 2 + 0.005);
      k.box(w * 0.25, 0.05, d * 0.5, 0xc9ced3, w * 0.25, -y0 - h * 0.03, 0);
      break;
    case 'fridge':
      k.box(w, h, d, 0xeef1f3, 0, 0);
      k.box(0.03, h * 0.18, 0.04, 0x9aa3aa, w * 0.38, h * 0.22, d / 2 + 0.02);
      k.box(0.03, h * 0.28, 0.04, 0x9aa3aa, w * 0.38, -h * 0.12, d / 2 + 0.02);
      k.box(w * 0.98, 0.012, 0.01, 0xb8c0c6, 0, h * 0.12, d / 2 + 0.005);
      break;
    case 'chair':
      k.box(w, h * 0.06, d, wood, 0, y0 + h * 0.48);
      k.box(w, h * 0.5, 0.05, wood, 0, y0 + h * 0.75, -d / 2 + 0.03);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) k.box(0.04, h * 0.46, 0.04, darkWood, sx * (w / 2 - 0.04), y0 + h * 0.23, sz * (d / 2 - 0.04));
      break;
    case 'bed':
      k.box(w, h * 0.5, d, darkWood, 0, y0 + h * 0.25);
      k.box(w * 0.96, h * 0.3, d * 0.96, 0xf6f1e6, 0, y0 + h * 0.62);
      k.box(w * 0.98, h * 0.18, d * 0.6, 0xd9452b, 0, y0 + h * 0.74, d * 0.2);
      k.box(w * 0.4, h * 0.2, d * 0.15, 0xffffff, -w * 0.22, y0 + h * 0.84, -d * 0.38);
      k.box(w * 0.4, h * 0.2, d * 0.15, 0xffffff, w * 0.22, y0 + h * 0.84, -d * 0.38);
      k.box(w, h * 1.1, 0.08, darkWood, 0, y0 + h * 0.75, -d / 2 + 0.04);
      break;
    case 'wardrobe':
    case 'nightstand':
    case 'pedestal':
      k.box(w, h, d, model === 'pedestal' ? 0xe9e2d2 : wood, 0, 0);
      if (model !== 'pedestal') {
        const face = d < w ? 'z' : 'x';
        if (face === 'z') {
          k.box(0.03, h * 0.12, 0.03, 0xd9b44a, w * 0.08, h * 0.05, d / 2 + 0.015);
          k.box(0.01, h * 0.95, 0.01, darkWood, 0, 0, d / 2 + 0.005);
        } else {
          k.box(0.03, h * 0.12, 0.03, 0xd9b44a, w / 2 + 0.015, h * 0.05, d * 0.08);
          k.box(0.01, h * 0.95, 0.01, darkWood, w / 2 + 0.005, 0, 0);
        }
      }
      break;
    case 'vase':
      k.cyl(w * 0.3, w * 0.45, h * 0.7, 0x2f7a6f, 0, y0 + h * 0.35, 0, 10);
      k.cyl(w * 0.22, w * 0.3, h * 0.3, 0x2f7a6f, 0, y0 + h * 0.85, 0, 10);
      break;
    case 'trophy':
      k.box(w, h * 0.18, d, 0x3c4146, 0, y0 + h * 0.09);
      k.cyl(w * 0.12, w * 0.18, h * 0.3, 0xe7b928, 0, y0 + h * 0.33, 0, 10);
      k.cyl(w * 0.5, w * 0.2, h * 0.38, 0xf2c94c, 0, y0 + h * 0.66, 0, 12);
      k.torus(w * 0.18, 0.02, 0xf2c94c, -w * 0.48, y0 + h * 0.68, 0, 0, Math.PI / 2);
      k.torus(w * 0.18, 0.02, 0xf2c94c, w * 0.48, y0 + h * 0.68, 0, 0, Math.PI / 2);
      break;
    case 'gnome':
      k.cyl(w * 0.42, w * 0.5, h * 0.42, 0x3f74b8, 0, y0 + h * 0.21);
      k.sphere(w * 0.26, 0xf3c9a8, 0, y0 + h * 0.5, 0.02);
      k.cone(w * 0.28, h * 0.22, 0xffffff, 0, y0 + h * 0.4, w * 0.18, 8, Math.PI * 0.9);
      k.cone(w * 0.3, h * 0.42, 0xd9452b, 0, y0 + h * 0.78, 0, 10);
      break;
    case 'flamingo':
      k.cyl(0.012, 0.012, h * 0.5, 0x2b2f33, 0.03, y0 + h * 0.25);
      k.cyl(0.012, 0.012, h * 0.5, 0x2b2f33, -0.03, y0 + h * 0.25);
      k.sphere(w * 0.45, 0xff7aa8, 0, y0 + h * 0.6, 0, 0.8, 0.7, 1.5);
      k.cyl(0.025, 0.03, h * 0.32, 0xff7aa8, 0, y0 + h * 0.8, d * 0.3, 8, -0.4);
      k.sphere(w * 0.18, 0xff7aa8, 0, y0 + h * 0.96, d * 0.38);
      k.cone(0.03, 0.08, 0x2b2f33, 0, y0 + h * 0.93, d * 0.5, 6, Math.PI / 2);
      break;
    case 'mailbox':
      k.box(0.09, h * 0.75, 0.09, 0xe9e2d2, 0, y0 + h * 0.375);
      k.box(w, h * 0.22, d, accent, 0, y0 + h * 0.86);
      k.cyl(w / 2, w / 2, d, accent, 0, y0 + h * 0.97, 0, 12, Math.PI / 2);
      k.box(0.02, 0.18, 0.05, 0xd9452b, w / 2 + 0.01, y0 + h * 0.95, -d * 0.2);
      break;
    case 'birdbath':
      k.cyl(w * 0.22, w * 0.3, h * 0.72, 0xd8d0c0, 0, y0 + h * 0.36, 0, 10);
      k.cyl(w * 0.5, w * 0.3, h * 0.2, 0xe9e2d2, 0, y0 + h * 0.82, 0, 14);
      k.cyl(w * 0.42, w * 0.42, 0.02, 0x7cc4de, 0, y0 + h * 0.91, 0, 14);
      break;
    case 'pot':
      k.cyl(w * 0.5, w * 0.36, h * 0.6, 0xc66b3d, 0, y0 + h * 0.3, 0, 10);
      k.sphere(w * 0.42, 0x4f9a48, 0, y0 + h * 0.75);
      k.sphere(w * 0.14, 0xf06292, w * 0.2, y0 + h * 0.95, w * 0.1);
      k.sphere(w * 0.12, 0xffd54f, -w * 0.2, y0 + h * 0.9, -w * 0.1);
      break;
    case 'light':
      k.cyl(w * 0.3, w * 0.35, h * 0.7, 0x2b2f33, 0, y0 + h * 0.35, 0, 8);
      k.cyl(w * 0.5, w * 0.5, h * 0.22, 0xfff3c4, 0, y0 + h * 0.8, 0, 8);
      k.cone(w * 0.6, h * 0.14, 0x2b2f33, 0, y0 + h * 0.97, 0, 8);
      break;
    case 'bench':
      k.box(w, 0.06, d * 0.8, wood, 0, y0 + h * 0.5, d * 0.05);
      k.box(w, h * 0.35, 0.05, wood, 0, y0 + h * 0.8, -d / 2 + 0.05, -0.15);
      for (const sx of [-1, 1]) k.box(0.06, h * 0.5, d * 0.8, 0x3c4146, sx * (w / 2 - 0.1), y0 + h * 0.25);
      break;
    case 'lawnchair':
      k.box(w, 0.05, d * 0.6, 0xffffff, 0, y0 + h * 0.4, d * 0.1);
      k.box(w, h * 0.55, 0.05, 0xffffff, 0, y0 + h * 0.68, -d * 0.25, -0.35);
      for (const sx of [-1, 1]) k.box(0.04, h * 0.42, d * 0.8, 0xe9e2d2, sx * (w / 2 - 0.03), y0 + h * 0.2);
      break;
    default:
      return null;
  }
  return k.build();
}

/** A golfer at address, facing +x (the ball is in front of their toes). Club and arms are a separate swing group. */
export function buildGolfer(shirt: number): { body: THREE.Group; swing: THREE.Group } {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
  const body = new THREE.Group();
  const k = new Kit();
  const skin = 0xe8b48f;
  const trousers = 0xd8c7a3;
  const shoe = 0xf6f1e6;
  const lean = -0.42;
  // Legs, slightly flexed, feet shoulder width apart along the target line.
  for (const z of [-0.17, 0.17]) {
    k.cyl(0.075, 0.065, 0.48, trousers, 0.04, 0.24, z, 8, 0, -0.08);
    k.cyl(0.085, 0.075, 0.46, trousers, 0.02, 0.68, z, 8, 0, 0.1);
    k.box(0.27, 0.09, 0.13, shoe, 0.07, 0.045, z);
    k.box(0.12, 0.03, 0.13, 0x2b2f33, -0.02, 0.1, z);
  }
  // Hips and a torso bent over the ball.
  k.box(0.24, 0.2, 0.44, trousers, 0, 0.94, 0);
  k.box(0.07, 0.05, 0.46, 0x3c4146, 0.0, 1.03, 0);
  k.box(0.26, 0.56, 0.46, shirt, 0.12, 1.28, 0, 0, 0, lean);
  k.box(0.2, 0.05, 0.22, 0xffffff, 0.27, 1.53, 0, 0, 0, lean);
  // Head, cap and brim (looking down at the ball).
  k.sphere(0.12, skin, 0.33, 1.66, 0);
  k.sphere(0.125, 0x2b2f33, 0.3, 1.71, 0, 1, 0.6, 1);
  k.sphere(0.13, shirt, 0.33, 1.73, 0, 1, 0.52, 1);
  k.box(0.17, 0.025, 0.2, shirt, 0.47, 1.71, 0, 0, 0, -0.2);
  const g = new THREE.Mesh(k.build(), mat);
  g.castShadow = true;
  body.add(g);
  // Arms and club hang from the shoulders and swing as one.
  const swing = new THREE.Group();
  swing.position.set(0.24, 1.44, 0);
  const a = new Kit();
  a.cyl(0.05, 0.045, 0.5, shirt, 0.07, -0.22, -0.1, 8, 0.12, 0.26);
  a.cyl(0.05, 0.045, 0.5, shirt, 0.07, -0.22, 0.1, 8, -0.12, 0.26);
  a.sphere(0.055, 0xffffff, 0.14, -0.5, 0);
  a.cyl(0.012, 0.012, 1.02, 0x3c4146, 0.27, -1.0, 0, 6, 0, 0.26);
  a.box(0.17, 0.06, 0.09, 0xb8c0c6, 0.4, -1.48, 0.02);
  const am = new THREE.Mesh(a.build(), mat);
  am.castShadow = true;
  swing.add(am);
  body.add(swing);
  return { body, swing };
}

export function buildBird(color: number): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const g = new THREE.Group();
  const k = new Kit();
  k.sphere(0.09, color, 0, 0, 0, 1.3, 1, 1);
  k.sphere(0.06, color, 0.1, 0.06, 0);
  k.cone(0.02, 0.06, 0xf2b705, 0.17, 0.06, 0, 6, 0, -Math.PI / 2);
  g.add(new THREE.Mesh(k.build(), mat));
  for (const side of [-1, 1]) {
    const w = new Kit();
    w.box(0.1, 0.015, 0.16, color, 0, 0, side * 0.08);
    const wing = new THREE.Mesh(w.build(), mat);
    wing.name = side < 0 ? 'wl' : 'wr';
    g.add(wing);
  }
  return g;
}

export function buildSquirrel(): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const k = new Kit();
  const fur = 0xa0623a;
  k.sphere(0.1, fur, 0, 0.12, 0, 1.4, 1, 1);
  k.sphere(0.07, fur, 0.14, 0.2, 0);
  k.sphere(0.02, 0x2b2f33, 0.2, 0.23, 0.04);
  k.sphere(0.09, 0xb87a4e, -0.14, 0.28, 0, 0.7, 1.8, 0.9);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(k.build(), mat));
  return g;
}

export function buildCat(): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const k = new Kit();
  const fur = 0xe08a3c;
  k.sphere(0.16, fur, 0, 0.2, 0, 1.5, 0.9, 0.9);
  k.sphere(0.11, fur, 0.24, 0.32, 0);
  k.cone(0.04, 0.07, fur, 0.26, 0.44, 0.06, 6);
  k.cone(0.04, 0.07, fur, 0.26, 0.44, -0.06, 6);
  k.cyl(0.025, 0.02, 0.32, fur, -0.27, 0.32, 0, 6, 0, 0.6);
  for (const [x, z] of [[0.13, 0.07], [0.13, -0.07], [-0.13, 0.07], [-0.13, -0.07]] as const) k.cyl(0.03, 0.03, 0.14, 0xffffff, x, 0.07, z, 6);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(k.build(), mat));
  return g;
}
