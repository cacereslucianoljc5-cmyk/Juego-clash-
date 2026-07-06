// Post-procesado con TypeGPU (WebGPU): bloom + gradación de color + viñeta
// sobre el render de three.js. Se activa solo si el navegador tiene WebGPU;
// si no, el juego se ve igual que siempre (WebGL directo).
//
// Cómo funciona: three.js dibuja en su canvas WebGL; cada frame copiamos ese
// canvas a una textura WebGPU (copyExternalImageToTexture), extraemos las
// zonas brillantes a un cuarto de resolución y componemos el resultado final
// (escena + bloom + saturación + viñeta) en un canvas WebGPU superpuesto.
import { tgpu, d } from '../lib/typegpu.js';

const Params = d.struct({
  res: d.vec2f,     // resolución del canvas
  bloom: d.f32,     // intensidad del bloom
  time: d.f32,
});

const SHADER_COMMON = /* wgsl */ `
struct Params { res: vec2f, bloom: f32, time: f32 };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var srcTex: texture_2d<f32>;

struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  // triángulo a pantalla completa
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  var out: VSOut;
  out.pos = vec4f(p[i], 0.0, 1.0);
  out.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return out;
}
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
`;

// extrae zonas brillantes (a 1/4 de resolución, con media 3x3)
const BRIGHT_FS = /* wgsl */ `
@fragment fn fs(in: VSOut) -> @location(0) vec4f {
  let px = 1.0 / params.res;
  var c = vec3f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      c += textureSample(srcTex, samp, in.uv + vec2f(f32(x), f32(y)) * px * 2.0).rgb;
    }
  }
  c /= 9.0;
  let l = luma(c);
  let w = smoothstep(0.58, 0.95, l);
  return vec4f(c * w, 1.0);
}
`;

// composición final: escena + bloom + saturación + viñeta
const COMPOSITE_FS = /* wgsl */ `
@group(0) @binding(3) var bloomTex: texture_2d<f32>;

@fragment fn fs(in: VSOut) -> @location(0) vec4f {
  let scene = textureSample(srcTex, samp, in.uv).rgb;

  // bloom: taps radiales sobre la textura de brillos (ya a 1/4, queda suave)
  let bpx = 4.0 / params.res;
  var glow = textureSample(bloomTex, samp, in.uv).rgb * 0.30;
  glow += textureSample(bloomTex, samp, in.uv + vec2f( 1.5,  0.0) * bpx).rgb * 0.12;
  glow += textureSample(bloomTex, samp, in.uv + vec2f(-1.5,  0.0) * bpx).rgb * 0.12;
  glow += textureSample(bloomTex, samp, in.uv + vec2f( 0.0,  1.5) * bpx).rgb * 0.12;
  glow += textureSample(bloomTex, samp, in.uv + vec2f( 0.0, -1.5) * bpx).rgb * 0.12;
  glow += textureSample(bloomTex, samp, in.uv + vec2f( 2.5,  2.5) * bpx).rgb * 0.055;
  glow += textureSample(bloomTex, samp, in.uv + vec2f(-2.5,  2.5) * bpx).rgb * 0.055;
  glow += textureSample(bloomTex, samp, in.uv + vec2f( 2.5, -2.5) * bpx).rgb * 0.055;
  glow += textureSample(bloomTex, samp, in.uv + vec2f(-2.5, -2.5) * bpx).rgb * 0.055;

  var col = scene + glow * params.bloom;

  // saturación suave y micro-contraste
  let l = luma(col);
  col = mix(vec3f(l), col, 1.13);
  col = clamp((col - 0.5) * 1.03 + 0.5, vec3f(0.0), vec3f(1.0));

  // viñeta
  let q = in.uv - 0.5;
  let vig = 1.0 - smoothstep(0.42, 0.95, length(q * vec2f(1.15, 1.0)));
  col *= mix(0.82, 1.0, vig);

  return vec4f(col, 1.0);
}
`;

export async function initPostFX(sourceCanvas, container) {
  if (!navigator.gpu) return null;
  let root;
  try {
    root = await tgpu.init();
  } catch {
    return null;
  }
  const device = root.device;
  device.addEventListener?.('uncapturederror', (e) => console.warn('PostFX GPU error:', e.error?.message));
  const format = navigator.gpu.getPreferredCanvasFormat();

  // canvas WebGPU superpuesto (la interfaz sigue por encima, z-index 10+)
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  container.appendChild(canvas);
  const ctx = canvas.getContext('webgpu');
  ctx.configure({ device, format, alphaMode: 'opaque' });

  // parámetros tipados con TypeGPU
  const paramsBuf = root
    .createBuffer(Params, { res: d.vec2f(1, 1), bloom: 0.85, time: 0 })
    .$usage('uniform');
  const rawParams = root.unwrap(paramsBuf);

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const module = (fs) => device.createShaderModule({ code: SHADER_COMMON + fs });

  const brightLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  });
  const compLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  });

  const brightPipe = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [brightLayout] }),
    vertex: { module: module(BRIGHT_FS), entryPoint: 'vs' },
    fragment: { module: module(BRIGHT_FS), entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
  });
  const compPipe = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [compLayout] }),
    vertex: { module: module(COMPOSITE_FS), entryPoint: 'vs' },
    fragment: { module: module(COMPOSITE_FS), entryPoint: 'fs', targets: [{ format }] },
  });

  let sceneTex = null, brightTex = null, brightGroup = null, compGroup = null;
  let W = 0, H = 0;

  function rebuild(w, h) {
    W = w; H = h;
    canvas.width = w; canvas.height = h;
    sceneTex?.destroy(); brightTex?.destroy();
    sceneTex = device.createTexture({
      size: [w, h], format: 'rgba8unorm',
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    brightTex = device.createTexture({
      size: [Math.max(1, w >> 2), Math.max(1, h >> 2)], format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    brightGroup = device.createBindGroup({
      layout: brightLayout,
      entries: [
        { binding: 0, resource: { buffer: rawParams } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: sceneTex.createView() },
      ],
    });
    compGroup = device.createBindGroup({
      layout: compLayout,
      entries: [
        { binding: 0, resource: { buffer: rawParams } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: sceneTex.createView() },
        { binding: 3, resource: brightTex.createView() },
      ],
    });
    paramsBuf.writePartial({ res: d.vec2f(w, h) });
  }

  // la copia directa WebGL→WebGPU no está soportada en todos los entornos;
  // si falla, pasamos por un canvas 2D intermedio (drawImage sí es universal).
  // Con ?fxcpu en la URL hay un último recurso por CPU (para pruebas headless).
  const allowCpu = new URLSearchParams(location.search).has('fxcpu');
  let mirror = null, mirrorCtx = null, tier = 0; // 0 directo, 1 espejo 2D, 2 CPU
  function ensureMirror(w, h) {
    if (!mirror) {
      mirror = document.createElement('canvas');
      mirrorCtx = mirror.getContext('2d', { willReadFrequently: allowCpu });
    }
    if (mirror.width !== w || mirror.height !== h) { mirror.width = w; mirror.height = h; }
    mirrorCtx.drawImage(sourceCanvas, 0, 0);
  }
  function grabSource(w, h) {
    if (tier === 0) {
      try {
        device.queue.copyExternalImageToTexture({ source: sourceCanvas }, { texture: sceneTex }, [w, h]);
        return;
      } catch { tier = 1; }
    }
    if (tier === 1) {
      try {
        ensureMirror(w, h);
        device.queue.copyExternalImageToTexture({ source: mirror }, { texture: sceneTex }, [w, h]);
        return;
      } catch (err) {
        if (!allowCpu) throw err;
        tier = 2;
      }
    }
    ensureMirror(w, h);
    const img = mirrorCtx.getImageData(0, 0, w, h);
    device.queue.writeTexture({ texture: sceneTex }, img.data, { bytesPerRow: w * 4 }, [w, h]);
  }

  let failed = false;
  function render(time) {
    if (failed) return;
    try {
      const w = sourceCanvas.width, h = sourceCanvas.height;
      if (!w || !h) return;
      if (w !== W || h !== H) rebuild(w, h);
      paramsBuf.writePartial({ time });

      grabSource(w, h);

      const enc = device.createCommandEncoder();
      const p1 = enc.beginRenderPass({
        colorAttachments: [{ view: brightTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      });
      p1.setPipeline(brightPipe); p1.setBindGroup(0, brightGroup); p1.draw(3); p1.end();

      const p2 = enc.beginRenderPass({
        colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      });
      p2.setPipeline(compPipe); p2.setBindGroup(0, compGroup); p2.draw(3); p2.end();
      device.queue.submit([enc.finish()]);
    } catch (err) {
      // si algo falla en runtime, volvemos al render WebGL de siempre
      failed = true;
      canvas.remove();
      sourceCanvas.style.visibility = '';
      console.warn('PostFX desactivado:', err);
    }
  }

  // el canvas WebGL queda oculto (seguimos leyendo de él cada frame)
  sourceCanvas.style.visibility = 'hidden';
  return { render, canvas };
}
