// Sonido del juego con ZzFX (https://github.com/KilledByAPixel/ZzFX, MIT):
// todos los efectos se sintetizan por código, sin archivos de audio.
import { zzfx, ZZFX } from '../lib/zzfx.js';

// presets ZzFX: [volumen, aleatoriedad, frecuencia, ataque, sustain, release,
// forma de onda, curva, slide, ...]. Ajustados a un volumen discreto.
const SFX = {
  hover:      [0.4, 0, 660, 0.005, 0.01, 0.03, 1, 1.6, 0, 0, 260],
  click:      [0.6, 0, 420, 0.005, 0.03, 0.06, 1, 1.4, 0, 0, 180],
  deploy:     [0.8, 0.05, 150, 0.01, 0.08, 0.18, 4, 1.7, 4],
  invalid:    [0.5, 0, 200, 0.01, 0.05, 0.12, 2, 1.5, -6],
  slash:      [0.6, 0.1, 320, 0.002, 0.03, 0.09, 4, 2.5, -8, 0, 0, 0, 0, 0.6],
  arrow:      [0.5, 0.05, 900, 0.002, 0.02, 0.08, 1, 3, -20],
  fireball:   [0.7, 0.1, 120, 0.02, 0.12, 0.25, 4, 1.6, 2, 0, 0, 0, 0, 0.7],
  bombThrow:  [0.5, 0.05, 300, 0.005, 0.04, 0.1, 1, 2, -10],
  explosion:  [1.0, 0.15, 70, 0.02, 0.18, 0.45, 4, 1.4, 0, 0, 0, 0, 0, 1.2],
  cannon:     [0.9, 0.1, 90, 0.01, 0.1, 0.3, 4, 1.8, 0, 0, 0, 0, 0, 0.9],
  towerbolt:  [0.5, 0.05, 520, 0.004, 0.03, 0.09, 1, 2.2, -12],
  hit:        [0.4, 0.1, 240, 0.002, 0.02, 0.06, 3, 2, -4],
  death:      [0.6, 0.1, 180, 0.01, 0.08, 0.25, 3, 1.5, -8],
  towerDown:  [1.0, 0.1, 55, 0.03, 0.25, 0.6, 4, 1.3, 0, 0, 0, 0, 0, 1.4],
  elixirFull: [0.4, 0, 880, 0.01, 0.06, 0.15, 1, 1.5, 0, 0, 220],
};

// jingles de final de partida (secuencias de notas)
const JINGLES = {
  win:  [[523, 0], [659, 110], [784, 220], [1047, 340]],
  lose: [[392, 0], [330, 160], [262, 330]],
  draw: [[440, 0], [440, 180]],
};

let unlocked = false;
export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  ZZFX.audioContext?.resume?.().catch(() => {});
}

const lastPlayed = {};
// suena el efecto `name`; `minGap` (ms) evita saturar cuando pelean muchas unidades
export function sfx(name, minGap = 70) {
  if (!unlocked) return;
  const now = performance.now();
  if (lastPlayed[name] && now - lastPlayed[name] < minGap) return;
  lastPlayed[name] = now;
  try { zzfx(...SFX[name]); } catch { /* audio no disponible */ }
}

export function jingle(kind) {
  if (!unlocked) return;
  for (const [freq, delay] of JINGLES[kind] ?? []) {
    setTimeout(() => {
      try { zzfx(0.6, 0, freq, 0.01, 0.12, 0.22, 1, 1.4); } catch { /* sin audio */ }
    }, delay);
  }
}
