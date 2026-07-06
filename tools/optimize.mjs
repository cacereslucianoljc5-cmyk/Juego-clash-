// Optimiza los GLB de Clash3deee para la web:
// weld + simplify (meshoptimizer) + quantize + texturas WebP redimensionadas.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  weld, simplify, quantize, dedup, prune, textureCompress, resample,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = './models_src';
const OUT = './models';

// objetivo de triángulos por modelo (la arena conserva más detalle)
const TARGETS = {
  Arena: { ratio: 0.10, error: 0.001, texSize: 2048 },
  default: { ratio: 0.06, error: 0.01, texSize: 1024 },
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

for (const file of readdirSync(SRC).filter((f) => f.endsWith('.glb'))) {
  const name = path.basename(file, '.glb');
  const cfg = TARGETS[name] ?? TARGETS.default;
  const inPath = path.join(SRC, file);
  const outPath = path.join(OUT, file);
  const before = statSync(inPath).size;

  const doc = await io.read(inPath);
  await doc.transform(
    dedup(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: cfg.ratio, error: cfg.error }),
    resample(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.texSize, cfg.texSize], quality: 82 }),
    quantize(),
  );

  await io.write(outPath, doc);
  const after = statSync(outPath).size;
  console.log(`${name}: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(2)} MB`);
}
