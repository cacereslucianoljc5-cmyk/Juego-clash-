// Hornea la cuadrícula de zonas transitables de la arena a js/arenadata.js:
// bloquea agua, murallas, árboles y todo lo que queda fuera del campo.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { vec3 } from 'gl-matrix';
import { writeFileSync } from 'node:fs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('./models/Arena.glb');
const root = doc.getRoot();
const tex = root.listTextures()[0];
const img = sharp(Buffer.from(tex.getImage()));
const { width: TW, height: TH } = await img.metadata();
const pixels = await img.raw().ensureAlpha().toBuffer();
const sampleTex = (u, v) => {
  const x = Math.min(TW - 1, Math.max(0, Math.round(u * (TW - 1))));
  const y = Math.min(TH - 1, Math.max(0, Math.round(v * (TH - 1))));
  const i = (y * TW + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
};
const prims = [];
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) prims.push({ prim, m });
}
let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
const tris = [];
const get = (a, i) => { const el = []; a.getElement(i, el); return el; };
for (const { prim, m } of prims) {
  const pos = prim.getAttribute('POSITION');
  const uv = prim.getAttribute('TEXCOORD_0');
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : pos.getCount();
  const gi = (i) => (idx ? idx.getScalar(i) : i);
  for (let i = 0; i < count; i += 3) {
    const v = []; const uvs = [];
    for (let k = 0; k < 3; k++) {
      const vi = gi(i + k);
      let [x, y, z] = get(pos, vi);
      if (m) { const o = vec3.transformMat4([], [x, y, z], m); x = o[0]; y = o[1]; z = o[2]; }
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      v.push([x, y, z]); uvs.push(uv ? get(uv, vi) : [0, 0]);
    }
    tris.push({ v, uvs });
  }
}

const N = 128;
const hbuf = new Float32Array(N * N).fill(-1e9);
const wbuf = new Uint8Array(N * N); // 1 = color de agua
const px = (x) => ((x - minX) / (maxX - minX)) * (N - 1);
const pz = (z) => ((z - minZ) / (maxZ - minZ)) * (N - 1);
for (const { v, uvs } of tris) {
  const x0 = px(v[0][0]), z0 = pz(v[0][2]);
  const x1 = px(v[1][0]), z1 = pz(v[1][2]);
  const x2 = px(v[2][0]), z2 = pz(v[2][2]);
  const minPX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxPX = Math.min(N - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minPZ = Math.max(0, Math.floor(Math.min(z0, z1, z2)));
  const maxPZ = Math.min(N - 1, Math.ceil(Math.max(z0, z1, z2)));
  const den = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
  if (Math.abs(den) < 1e-12) continue;
  for (let zz = minPZ; zz <= maxPZ; zz++) for (let xx = minPX; xx <= maxPX; xx++) {
    const l0 = ((z1 - z2) * (xx - x2) + (x2 - x1) * (zz - z2)) / den;
    const l1 = ((z2 - z0) * (xx - x2) + (x0 - x2) * (zz - z2)) / den;
    const l2 = 1 - l0 - l1;
    if (l0 < -0.001 || l1 < -0.001 || l2 < -0.001) continue;
    const y = l0 * v[0][1] + l1 * v[1][1] + l2 * v[2][1];
    const i = zz * N + xx;
    if (y > hbuf[i]) {
      hbuf[i] = y;
      const u = l0 * uvs[0][0] + l1 * uvs[1][0] + l2 * uvs[2][0];
      const vv = l0 * uvs[0][1] + l1 * uvs[1][1] + l2 * uvs[2][1];
      const [r, g, b] = sampleTex(u, vv);
      wbuf[i] = (b > 110 && b > r * 1.25 && g > r * 1.05) ? 1 : 0;
    }
  }
}

const FIELD_Y = -0.093;
const walk = new Uint8Array(N * N);
const cx = (i) => minX + ((i % N) + 0.5) / N * (maxX - minX);
const cz = (i) => minZ + (Math.floor(i / N) + 0.5) / N * (maxZ - minZ);
for (let i = 0; i < N * N; i++) {
  const h = hbuf[i];
  const inField = Math.abs(cx(i)) <= 0.55 && Math.abs(cz(i)) <= 0.68;
  walk[i] = (inField && !wbuf[i] && h > FIELD_Y - 0.035 && h < FIELD_Y + 0.053) ? 1 : 0;
}
// quitar motas: celdas bloqueadas no-agua rodeadas de transitables
for (let pass = 0; pass < 2; pass++) {
  for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
    const i = z * N + x;
    if (walk[i] || wbuf[i]) continue;
    let n = 0;
    for (const [dx, dz] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,1],[-1,1],[1,-1]]) n += walk[(z + dz) * N + (x + dx)];
    if (n >= 6) walk[i] = 1;
  }
}
// conservar solo el componente conexo que contiene el centro de cada mitad
const keep = new Uint8Array(N * N);
const stack = [];
for (const [sx, sz] of [[0, 0.3], [0, -0.3]]) {
  const gx = Math.floor(((sx - minX) / (maxX - minX)) * N);
  const gz = Math.floor(((sz - minZ) / (maxZ - minZ)) * N);
  stack.push(gz * N + gx);
}
while (stack.length) {
  const i = stack.pop();
  if (i < 0 || i >= N * N || keep[i] || !walk[i]) continue;
  keep[i] = 1;
  const x = i % N, z = Math.floor(i / N);
  if (x > 0) stack.push(i - 1);
  if (x < N - 1) stack.push(i + 1);
  if (z > 0) stack.push(i - N);
  if (z < N - 1) stack.push(i + N);
}

let walkCount = 0;
for (let i = 0; i < N * N; i++) walkCount += keep[i];
console.log(`transitables: ${walkCount}/${N * N}`);

// vista rápida
let view = '';
for (let z = 0; z < N; z += 2) {
  let row = '';
  for (let x = 0; x < N; x += 2) row += keep[z * N + x] ? '.' : (wbuf[z * N + x] ? '~' : '#');
  view += row + '\n';
}
console.log(view);

// serializar como filas de bits en base36 por compacidad -> JS module
const rows = [];
for (let z = 0; z < N; z++) {
  let s = '';
  for (let x = 0; x < N; x++) s += keep[z * N + x];
  rows.push(s);
}
const out = `// Datos horneados de Arena.glb (generados por bake_walkmap.mjs).
// Coordenadas locales del modelo (antes de escalar): x[${minX.toFixed(3)},${maxX.toFixed(3)}] z[${minZ.toFixed(3)},${maxZ.toFixed(3)}]
export const ARENA = {
  minX: ${minX.toFixed(4)}, maxX: ${maxX.toFixed(4)},
  minZ: ${minZ.toFixed(4)}, maxZ: ${maxZ.toFixed(4)},
  fieldY: ${FIELD_Y},        // altura del pasto
  waterY: -0.140,            // superficie del agua del modelo
  riverZ: [-0.045, 0.075],   // banda del río
  bridges: [                 // pasarelas sobre el río
    { x: -0.165, halfW: 0.055 },
    { x:  0.165, halfW: 0.055 },
  ],
  gridN: ${N},
  grid: [
${rows.map((r) => `    '${r}',`).join('\n')}
  ],
};
`;
writeFileSync('./js/arenadata.js', out);
console.log('escrito js/arenadata.js');
