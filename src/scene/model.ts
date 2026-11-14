import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// All scene geometry lives in this file so it can be swapped for a .glb later.
// World axes: +x east, -z north, y up (metres). The quad's paved floor spans x -30..30, z -22..22.
// The gatehouse sits in the east range; a freestanding cloister runs the west side, with the chapel
// behind its northern half and an open yard behind the middle.

// Pale washes over paper, in the spirit of an ink-and-watercolour sketch; the ink pass does the drawing.
export const PALETTE = {
  wall: '#F4F0E8',
  brick: '#E3C9BB',
  stone: '#E8E2D7',
  roof: '#BAC2CC',
  lawn: '#D5DCC8',
  paving: '#EFEBE3',
  glass: '#B4C5DF',
  ground: '#E2E5D8',
  road: '#D9D7D1',
  dark: '#3A3733',
  flag: '#7389B2',
  leaf: '#CBD5BA',
  bark: '#BDB2A5',
  shadow: '#211E1B', // archway passage lining, seen from inside
} as const;

// Materials drawn from the inside (back faces), so a tunnel can be seen into.
const INSIDE: ReadonlySet<string> = new Set(['shadow']);
// Materials shaded smoothly rather than per face (the tree's rounded canopy).
const SMOOTH: ReadonlySet<string> = new Set(['leaf']);

type Mat = keyof typeof PALETTE;
type V2 = [number, number];
type V3 = [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);

/** Collects geometry per material under a matrix stack, then merges to one mesh per material. */
class Builder {
  private parts = new Map<Mat, THREE.BufferGeometry[]>();
  private stack = [new THREE.Matrix4()];

  private get m() {
    return this.stack[this.stack.length - 1];
  }

  within(local: THREE.Matrix4, fn: () => void) {
    this.stack.push(this.m.clone().multiply(local));
    fn();
    this.stack.pop();
  }

  add(mat: Mat, g: THREE.BufferGeometry) {
    const geo = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.applyMatrix4(this.m);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat)!.push(geo);
  }

  box(mat: Mat, w: number, h: number, d: number, x: number, y: number, z: number) {
    this.add(mat, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  }

  build() {
    const group = new THREE.Group();
    let triangles = 0;
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos);
      triangles += merged.attributes.position.count / 3;
      // Pale fills with only a gentle wash of light and shade (see the lights in main.ts);
      // form comes mostly from the ink outline pass (src/look.ts).
      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshLambertMaterial({
          color: PALETTE[mat],
          flatShading: !SMOOTH.has(mat),
          side: INSIDE.has(mat) ? THREE.BackSide : THREE.FrontSide,
        }),
      );
      mesh.name = mat;
      group.add(mesh);
    }
    return { group, triangles };
  }
}

// ---------------------------------------------------------------------------
// Shape helpers

function translate(x: number, y: number, z: number) {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}

/** Local frame for one range: local x runs along the inner face, local +z points into the quad. */
function frame(origin: V3, along: V3, normal: V3) {
  return new THREE.Matrix4()
    .makeBasis(new THREE.Vector3(...along), UP, new THREE.Vector3(...normal))
    .setPosition(...origin);
}

function polyShape(pts: V2[], holes: V2[][] = []) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return shape;
}

/** Prism along local z from z0 to z0 + depth; outline in (x, y). */
function prismZ(pts: V2[], z0: number, depth: number, holes: V2[][] = []) {
  return new THREE.ExtrudeGeometry(polyShape(pts, holes), { depth, bevelEnabled: false }).translate(0, 0, z0);
}

/** Prism along local x from x0 to x0 + length; outline in (z, y). */
function prismX(pts: V2[], x0: number, length: number) {
  return new THREE.ExtrudeGeometry(polyShape(pts.map(([z, y]) => [-z, y] as V2)), {
    depth: length,
    bevelEnabled: false,
  })
    .rotateY(Math.PI / 2)
    .translate(x0, 0, 0);
}

/** Just the side walls of an extrusion (no end caps), e.g. the inside of a tunnel. */
function sidesOnly(g: THREE.ExtrudeGeometry) {
  const sides = g.groups.find((grp) => grp.materialIndex === 1)!;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal'] as const) {
    const attr = g.getAttribute(name) as THREE.BufferAttribute;
    const n = attr.itemSize;
    out.setAttribute(
      name,
      new THREE.BufferAttribute(attr.array.slice(sides.start * n, (sides.start + sides.count) * n), n),
    );
  }
  return out;
}

function rect(x0: number, y0: number, x1: number, y1: number): V2[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** Inverted-V roof section with thickness t, so a gable's face stays visible beneath it. */
function chevron(x0: number, x1: number, yBase: number, yApex: number, t: number): V2[] {
  const cx = (x0 + x1) / 2;
  const slope = (yApex - yBase) / (cx - x0);
  return [
    [x0, yBase],
    [x0 + t, yBase],
    [cx, yApex - t * slope],
    [x1 - t, yBase],
    [x1, yBase],
    [cx, yApex],
  ];
}

type ArchKind = 'tudor' | 'round' | 'lancet';

/** Closed counter-clockwise arch outline: jambs from y0 to spring, crown at apex. */
function arch(cx: number, y0: number, w: number, spring: number, apex: number, kind: ArchKind): V2[] {
  const h = apex - spring;
  const r = w / 2;
  const ctrl: Record<ArchKind, [V2, V2]> = {
    // Four-centred: tight haunch, flat crown meeting at a shallow point.
    tudor: [
      [cx + r, spring + h * 0.75],
      [cx + w * 0.22, apex - h * 0.05],
    ],
    round: [
      [cx + r, spring + h * 0.552],
      [cx + r * 0.552, apex],
    ],
    lancet: [
      [cx + r, spring + h * 0.55],
      [cx + w * 0.1, apex - h * 0.3],
    ],
  };
  const [c1, c2] = ctrl[kind];
  const curve = new THREE.CubicBezierCurve(
    new THREE.Vector2(cx + r, spring),
    new THREE.Vector2(...c1),
    new THREE.Vector2(...c2),
    new THREE.Vector2(cx, apex),
  );
  const right = curve.getPoints(10).map((p) => [p.x, p.y] as V2);
  const left = right
    .slice(0, -1)
    .reverse()
    .map(([x, y]) => [2 * cx - x, y] as V2);
  return [[cx - r, y0], [cx + r, y0], ...right, ...left];
}

// ---------------------------------------------------------------------------
// Building parts (all in a range's local frame: face at z = 0, building behind at z < 0)

// Details are deliberately chunky: anything only a few centimetres proud of a surface is thinner than a
// pixel at a distance, and the ink pass would draw it as a broken, dotted line.
function windowAt(b: Builder, x: number, y: number, w: number, h: number) {
  b.box('stone', w + 0.4, h + 0.4, 0.26, x, y + h / 2, 0.13);
  b.box('glass', w, h, 0.04, x, y + h / 2, 0.28);
  b.box('stone', 0.18, h, 0.2, x, y + h / 2, 0.4); // mullion
  b.box('stone', w, 0.18, 0.2, x, y + h * 0.7, 0.4); // transom
}

/** A row of merlons along local x at height y, on a base course. */
function crenels(b: Builder, x0: number, x1: number, y: number, z: number, depth = 0.5) {
  const L = x1 - x0;
  b.box('stone', L, 0.35, depth, x0 + L / 2, y + 0.175, z);
  const n = Math.max(1, Math.floor(L / 1.3));
  const step = L / n;
  for (let i = 0; i < n; i++) b.box('stone', step * 0.5, 0.75, depth, x0 + step * (i + 0.5), y + 0.35 + 0.375, z);
}

interface RangeOpts {
  L: number;
  H: number;
  storeys: number;
  D?: number;
  bay?: number;
  rise?: number;
  gableEvery?: number;
  gableOffset?: number;
  arcade?: boolean;
  chimneys?: number[];
  /** Window width (m) and height as a fraction of the storey height. */
  win?: [number, number];
}

/** A brick range: mullioned windows, string courses, steep cross-gables with dormers between, slate roof, chimneys. */
function range(b: Builder, o: RangeOpts) {
  const { L, H, storeys } = o;
  const D = o.D ?? 10;
  const bay = o.bay ?? 3.4;
  const rise = o.rise ?? 5.5;
  const sh = H / storeys;

  b.box('wall', L, H, D, L / 2, H / 2, -D / 2);
  b.box('brick', L, 0.7, 0.3, L / 2, 0.35, 0.15);
  for (let k = 1; k < storeys; k++) b.box('brick', L, 0.3, 0.3, L / 2, k * sh, 0.15);
  b.box('stone', L + 0.2, 0.4, 0.36, L / 2, H - 0.2, 0.18);
  b.add(
    'roof',
    prismX(
      [
        [0.6, H - 0.1],
        [-D - 0.6, H - 0.1],
        [-D / 2, H + rise],
      ],
      0,
      L,
    ),
  );

  const n = Math.floor(L / bay);
  const off = (L - n * bay) / 2;
  const every = o.gableEvery ?? 0;
  const gableOff = o.gableOffset ?? 0;
  const [winW, winH] = o.win ?? [1.5, 0.56];

  for (let i = 0; i < n; i++) {
    const x = off + bay * (i + 0.5);
    for (let s = o.arcade ? 1 : 0; s < storeys; s++) {
      windowAt(b, x, s * sh + sh * (0.78 - winH) / 2 + sh * 0.11, winW, sh * winH);
    }

    const isGable = every > 0 && (i - gableOff) % every === 0 && i >= gableOff;
    if (isGable) {
      const gw = bay * 1.5;
      const gh = rise * 1.05;
      b.add(
        'wall',
        prismZ(
          [
            [x - gw / 2, H - 0.05],
            [x + gw / 2, H - 0.05],
            [x, H + gh],
          ],
          -D / 2,
          D / 2,
        ),
      );
      b.add('roof', prismZ(chevron(x - gw / 2 - 0.4, x + gw / 2 + 0.4, H - 0.3, H + gh + 0.4, 0.5), -D / 2, D / 2 + 0.45));
      windowAt(b, x, H + 0.5, 1.2, gh * 0.4);
    } else if (i % 2 === 1) {
      // Dormer on the front slope.
      b.box('wall', 1.8, 2.0, 2.4, x, H + 1.0, -2.4);
      b.box('glass', 1.0, 1.0, 0.05, x, H + 1.0, -1.17);
      b.add('roof', prismZ(chevron(x - 1.15, x + 1.15, H + 1.8, H + 3.0, 0.25), -3.8, 2.75));
    }
  }

  for (const cx of o.chimneys ?? []) {
    const ch = rise + 3.2;
    b.box('brick', 1.5, ch, 0.9, cx, H + ch / 2, -D / 2);
    b.box('stone', 1.8, 0.3, 1.2, cx, H + ch + 0.15, -D / 2);
  }

  if (o.arcade) {
    // Ground-floor arcade projecting 2.4m into the quad.
    const holes: V2[][] = [];
    for (let i = 0; i < n; i++) {
      const x = off + bay * (i + 0.5);
      const w = bay * 0.68;
      holes.push(arch(x, -0.2, w, sh * 0.5, sh * 0.5 + w / 2, 'round'));
    }
    b.add('stone', prismZ(rect(0, -0.3, L, sh), 0, 2.4, holes));
    b.box('stone', L, 0.3, 2.5, L / 2, sh + 0.15, 1.2);
  }
}

/** Gatehouse tower in the east range's frame: a four-centred arch passage through a crenellated tower. */
function gatehouse(b: Builder, cx: number) {
  const w = 12;
  const H = 24;
  const zFront = 2; // projects 2m into the quad
  const zBack = -14; // and 4m beyond the outer face of the range
  const depth = zFront - zBack;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const passage = arch(cx, -0.2, 4.6, 3.4, 5.4, 'tudor');

  b.add('wall', prismZ(rect(x0, -0.3, x1, H), zBack, depth, [passage]));
  // Dark lining and floor, so from inside the passage the quad reads as a bright arch.
  b.add('shadow', sidesOnly(prismZ(arch(cx, -0.1, 4.5, 3.35, 5.33, 'tudor'), zBack + 0.02, depth - 0.04)));
  b.box('dark', 4.5, 0.05, depth, cx, 0.025, (zFront + zBack) / 2);

  for (const z of [zFront, zBack]) {
    const sign = z === zFront ? 1 : -1;
    b.add('stone', prismZ(rect(cx - 3.6, -0.3, cx + 3.6, 7.4), sign > 0 ? z : z - 0.35, 0.35, [passage]));
    b.box('stone', 8.0, 0.3, 0.6, cx, 7.55, z + sign * 0.3);
    for (const y of [9.5, 15.5, 21]) b.box('brick', w, 0.3, 0.2, cx, y, z + sign * 0.1);
  }

  // Windows and clock on the quad face.
  b.within(translate(0, 0, zFront), () => {
    windowAt(b, cx, 10.3, 2.4, 3.2);
    windowAt(b, cx, 16.2, 2.0, 1.8);
  });
  const clockY = 19.4;
  b.add('stone', new THREE.CylinderGeometry(1.8, 1.8, 0.2, 24).rotateX(Math.PI / 2).translate(cx, clockY, zFront + 0.1));
  b.add('wall', new THREE.CylinderGeometry(1.5, 1.5, 0.2, 24).rotateX(Math.PI / 2).translate(cx, clockY, zFront + 0.2));
  b.box('dark', 0.14, 0.9, 0.05, cx, clockY + 0.4, zFront + 0.33);
  b.add('dark', new THREE.BoxGeometry(0.1, 1.25, 0.05).translate(0, 0.55, 0).rotateZ(-Math.PI / 3).translate(cx, clockY, zFront + 0.36));

  // Parapet and corner turrets.
  b.box('stone', w, 0.4, depth, cx, H + 0.2, (zFront + zBack) / 2);
  crenels(b, x0, x1, H + 0.4, zFront - 0.25);
  crenels(b, x0, x1, H + 0.4, zBack + 0.25);
  b.within(new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(translate(x0 + 0.25, 0, 0)), () =>
    crenels(b, -zFront, -zBack, H + 0.4, 0),
  );
  b.within(new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(translate(x1 - 0.25, 0, 0)), () =>
    crenels(b, -zFront, -zBack, H + 0.4, 0),
  );
  for (const tx of [x0, x1]) {
    for (const tz of [zFront, zBack]) {
      b.add('wall', new THREE.CylinderGeometry(1.25, 1.25, H + 4, 8).translate(tx, (H + 4) / 2, tz));
      b.add('stone', new THREE.CylinderGeometry(1.5, 1.5, 0.5, 8).translate(tx, H + 4.25, tz));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 8;
        b.box('stone', 0.6, 0.7, 0.6, tx + Math.cos(a) * 1.15, H + 4.85, tz + Math.sin(a) * 1.15);
      }
      b.box('brick', 2.6, 0.3, 2.6, tx, 9.5, tz);
    }
  }

  // Flagpole.
  const poleZ = (zFront + zBack) / 2;
  b.add('dark', new THREE.CylinderGeometry(0.07, 0.07, 7, 6).translate(cx, H + 0.4 + 3.5, poleZ));
  b.box('flag', 2.4, 1.5, 0.04, cx + 1.25, H + 6.4, poleZ);
}

/**
 * Crenellated wall along the west side of the quad. Between archFrom and archTo it opens into an
 * arcaded cloister walk, arched on both faces so the yard behind shows through; elsewhere it is plain.
 * In the west side's frame.
 */
function cloister(b: Builder, x0: number, x1: number, archFrom: number, archTo: number) {
  const L = x1 - x0;
  const depth = 4;
  const height = 4;
  const bay = 3.4;
  const n = Math.round(L / bay);
  const step = L / n;
  const first = Math.ceil((archFrom - x0) / step);
  const last = Math.floor((archTo - x0) / step) - 1;
  const a0 = x0 + first * step;
  const a1 = x0 + (last + 1) * step;
  const holes: V2[][] = [];
  for (let i = first; i <= last; i++) holes.push(arch(x0 + step * (i + 0.5), -0.2, 2.4, 2.1, 3.1, 'tudor'));

  // Quad-facing wall runs the full length; the back wall, roof and walk only where it's arcaded.
  b.add('stone', prismZ(rect(x0, -0.3, x1, height), depth - 0.6, 0.6, holes));
  b.add('stone', prismZ(rect(a0, -0.3, a1, height), 0, 0.6, holes));
  b.box('stone', a1 - a0, 0.3, depth, (a0 + a1) / 2, height + 0.15, depth / 2);
  b.box('stone', L, 0.3, 0.6, x0 + L / 2, height + 0.15, depth - 0.3);
  b.box('paving', a1 - a0, 0.06, depth - 1.2, (a0 + a1) / 2, 0.03, depth / 2);
  for (const x of [a0 + 0.3, a1 - 0.3]) b.box('stone', 0.6, height, depth, x, height / 2, depth / 2);
  crenels(b, x0, x1, height + 0.3, depth - 0.3);
  crenels(b, a0, a1, height + 0.3, 0.3);
}

/**
 * Chapel: tall hall with lancet windows facing the quad, buttresses, gable ends, a steep roof and a flèche.
 * Lancets run from winFrom to winTo (local x), where the chapel can be seen over the cloister.
 */
function chapel(b: Builder, L: number, winFrom: number, winTo: number) {
  const H = 13;
  const D = 12;
  const rise = 9;
  b.box('wall', L, H, D, L / 2, H / 2, -D / 2);
  b.box('brick', L, 0.7, 0.3, L / 2, 0.35, 0.15);
  b.box('brick', L, 0.3, 0.3, L / 2, 2.2, 0.15);
  b.box('stone', L + 0.2, 0.4, 0.36, L / 2, H - 0.2, 0.18);
  b.add(
    'roof',
    prismX(
      [
        [0.6, H - 0.1],
        [-D - 0.6, H - 0.1],
        [-D / 2, H + rise],
      ],
      0,
      L,
    ),
  );
  // Gable ends; the near one faces the open yard, with a tall window.
  for (const x0 of [-0.3, L - 0.3]) {
    b.add(
      'wall',
      prismX(
        [
          [0, H],
          [-D, H],
          [-D / 2, H + rise],
        ],
        x0,
        0.6,
      ),
    );
  }
  b.add('stone', prismX(arch(-D / 2, 2.6, 3.8, 9, 12.4, 'lancet'), -0.45, 0.15));
  b.add('glass', prismX(arch(-D / 2, 3, 3, 9, 11.8, 'lancet'), -0.5, 0.05));

  for (let x = winFrom; x <= winTo; x += 4) {
    const outline = arch(x, 2.6, 1.9, 8, 9.8, 'lancet');
    b.add('stone', prismZ(arch(x, 2.25, 2.7, 8, 10.35, 'lancet'), 0, 0.25, [outline]));
    b.add('glass', prismZ(outline, 0.02, 0.05));
    b.box('stone', 0.12, 6.4, 0.08, x, 5.6, 0.12);
    b.box('stone', 0.9, 10, 1.2, x - 2, 5, 0.6);
  }
  b.box('stone', 0.9, 10, 1.2, winTo + 2, 5, 0.6);

  b.box('wall', 1.6, 2, 1.6, L * 0.58, H + rise - 0.2, -D / 2);
  b.add('roof', new THREE.ConeGeometry(0.9, 5, 6).translate(L * 0.58, H + rise + 3.3, -D / 2));
}

/** Stone column on a stepped base at the crossing. */
function column(b: Builder) {
  b.add('stone', new THREE.CylinderGeometry(3.2, 3.2, 0.04, 24).translate(0, 0.02, 0));
  [3.6, 2.8, 2.0].forEach((s, i) => b.box('stone', s, 0.4, s, 0, 0.2 + i * 0.4, 0));
  b.box('stone', 1.2, 2, 1.2, 0, 2.2, 0);
  b.box('stone', 1.4, 0.3, 1.4, 0, 3.35, 0);
  b.add('stone', new THREE.CylinderGeometry(0.3, 0.36, 8, 10).translate(0, 7.5, 0));
  b.box('stone', 0.9, 0.5, 0.9, 0, 11.75, 0);
  b.box('stone', 0.18, 1.4, 0.18, 0, 12.7, 0);
  b.box('stone', 0.8, 0.18, 0.18, 0, 12.9, 0);
}

/** Ground, paving, lawns with stone kerbs, approach drive and road. */
function grounds(b: Builder) {
  b.box('ground', 400, 0.1, 400, 0, -0.11, 0);
  b.box('paving', 60, 0.1, 44, 0, -0.05, 0);
  b.box('paving', 60, 0.1, 9, 74, -0.05, 0);
  b.box('road', 14, 0.1, 400, 110, -0.04, 0);

  for (const zc of [-11, 11]) {
    b.box('lawn', 48, 0.12, 15, 0, 0.06, zc);
    b.box('stone', 48.6, 0.18, 0.3, 0, 0.09, zc - 7.65);
    b.box('stone', 48.6, 0.18, 0.3, 0, 0.09, zc + 7.65);
    b.box('stone', 0.3, 0.18, 15, -24.15, 0.09, zc);
    b.box('stone', 0.3, 0.18, 15, 24.15, 0.09, zc);
  }
}

/**
 * The Old Tree on the north lawn: a tapered trunk with two limbs, under a round canopy built from
 * overlapping smooth blobs. The ink pass outlines the blobs' silhouettes and where they overlap,
 * which gives the canopy its scalloped, drawn edge.
 */
function oldTree(b: Builder, x: number, z: number) {
  b.within(translate(x, 0, z), () => {
    b.add('bark', new THREE.CylinderGeometry(0.32, 0.55, 5, 9).translate(0, 2.5, 0));
    for (const [rz, rx, len] of [
      [0.55, 0.15, 3.2],
      [-0.6, -0.25, 3],
      [0.1, 0.65, 2.6],
    ]) {
      b.add(
        'bark',
        new THREE.CylinderGeometry(0.12, 0.26, len, 7)
          .translate(0, len / 2, 0)
          .rotateZ(rz)
          .rotateX(rx)
          .translate(0, 3.6, 0),
      );
    }
    // [x, y, z, radius] relative to the trunk; a round crown, slightly flattened underneath.
    const blobs: [number, number, number, number][] = [
      [0, 7.2, 0, 3.3],
      [2.4, 6.4, 0.8, 2.4],
      [-2.3, 6.5, 0.6, 2.5],
      [0.6, 6.3, 2.4, 2.4],
      [-0.5, 6.4, -2.4, 2.4],
      [1.8, 8.4, -1.2, 2.1],
      [-1.6, 8.6, 1.3, 2.1],
      [0.2, 9.3, 0.3, 2],
      [2.1, 5.6, -1.6, 1.8],
      [-1.9, 5.5, -1.4, 1.8],
      [-1.2, 5.4, 2.1, 1.7],
      [1.6, 5.3, 2, 1.7],
    ];
    for (const [bx, by, bz, r] of blobs) {
      b.add('leaf', new THREE.IcosahedronGeometry(r, 2).scale(1, 0.92, 1).translate(bx, by, bz));
    }
  });
}

// ---------------------------------------------------------------------------

export function buildModel() {
  const b = new Builder();

  grounds(b);
  column(b);
  oldTree(b, 6, -11);

  // North range (starts at x -30; the chapel fills the north-west corner):
  // a long tall single-storey hall, then a three-storey gabled block into the north-east corner.
  b.within(frame([-40, 0, -22], [1, 0, 0], [0, 0, 1]), () => {
    b.within(translate(10, 0, 0), () =>
      range(b, { L: 42, H: 7.5, storeys: 1, bay: 6, rise: 6, win: [2.6, 0.62], chimneys: [10, 30] }),
    );
    b.within(translate(52, 0, 0), () =>
      range(b, { L: 28, H: 12, storeys: 3, rise: 6, gableEvery: 3, gableOffset: 1, chimneys: [6, 22] }),
    );
  });

  // South range.
  b.within(frame([40, 0, 22], [-1, 0, 0], [0, 0, -1]), () =>
    range(b, { L: 80, H: 11, storeys: 3, gableEvery: 3, gableOffset: 1, chimneys: [10, 30, 50, 70] }),
  );

  // West side: a crenellated wall the full length, arcaded across the open yard and the chapel's
  // southern end. Behind it (south to north): a small slate-roofed building, the yard, then the
  // chapel running into the north-west corner.
  b.within(frame([-30, 0, 22], [0, 0, -1], [1, 0, 0]), () => {
    cloister(b, 0, 44, 12, 34.5);
    range(b, { L: 12, H: 8, storeys: 2, chimneys: [6] });
    b.box('paving', 12, 0.1, 14, 18, -0.04, -7);
    b.within(translate(24, 0, 0), () => chapel(b, 30, 3, 19));
  });

  // East range, split by the gatehouse; the southern half has the ground-floor arcade.
  b.within(frame([30, 0, -22], [0, 0, 1], [-1, 0, 0]), () => {
    range(b, { L: 16, H: 10, storeys: 3, gableEvery: 2, chimneys: [8] });
    b.within(translate(28, 0, 0), () =>
      range(b, { L: 16, H: 10, storeys: 3, arcade: true, gableEvery: 2, gableOffset: 1, chimneys: [8] }),
    );
    gatehouse(b, 22);
  });

  const { group, triangles } = b.build();
  return { root: group, triangles };
}
