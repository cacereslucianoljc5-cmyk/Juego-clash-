# Herramientas (se ejecutan desde la raíz del repo)

- `optimize.mjs` — optimiza los GLB originales de Clash3deee (en `./models_src`)
  hacia `./models`: weld + simplify (meshoptimizer) + quantize + texturas WebP.
- `bake_walkmap.mjs` — analiza `models/Arena.glb` (alturas + color de la textura)
  y hornea la cuadrícula de colisiones en `js/arenadata.js`.

Dependencias: `npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp gl-matrix`
