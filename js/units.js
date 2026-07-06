// Carga de los modelos GLB (optimizados desde el repo Clash3deee) y
// animaciones procedurales: los modelos no traen esqueleto, así que caminar,
// atacar y morir se animan moviendo el cuerpo completo (rebote, balanceo,
// embestida, retroceso...). La Arena no se anima: solo su agua (ver game.js).
import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js';

export const MODEL_FILES = [
  'Arena', 'Arquero', 'Barbaro', 'Bombardero', 'Canon', 'Esqueleto',
  'Gigante', 'MagoFuego', 'MontaPuercos', 'Pekka', 'Torre', 'TorreRey',
];

const templates = {};

export async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(MODEL_FILES.map(async (name) => {
    const gltf = await loader.loadAsync(`./models/${name}.glb?v=3`);
    const root = gltf.scene;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = name !== 'Arena';
        o.receiveShadow = name === 'Arena';
        if (o.material) {
          o.material.roughness = Math.min(0.95, o.material.roughness ?? 0.9);
          o.material.metalness = 0;
        }
      }
    });
    templates[name] = root;
    done += 1;
    if (onProgress) onProgress(done / MODEL_FILES.length);
  }));
}

export function getArenaModel() {
  return templates.Arena;
}

// ---------------------------------------------------------------- catálogo
// anim: 'walk' (camina + golpea), 'gallop' (montapuercos), 'heavy' (pasos
// pesados), 'bow' (arquero), 'cast' (mago), 'throw' (bombardero),
// 'cannon' (edificio que dispara), 'tower' (torre que dispara).
export const UNIT_TYPES = {
  Esqueleto: {
    name: 'Esqueletos', ico: '💀', cost: 2, count: 3,
    hp: 90, dmg: 45, range: 1.1, speed: 4.1, attackRate: 1.1,
    height: 1.9, radius: 0.5, anim: 'walk', walkFreq: 11, walkAmp: 0.10,
  },
  Barbaro: {
    name: 'Bárbaro', ico: '⚔️', cost: 3,
    hp: 340, dmg: 80, range: 1.2, speed: 3.1, attackRate: 0.85,
    height: 2.3, radius: 0.62, anim: 'walk', walkFreq: 9, walkAmp: 0.12,
  },
  Arquero: {
    name: 'Arquero', ico: '🏹', cost: 3,
    hp: 160, dmg: 48, range: 9, speed: 3.0, attackRate: 0.9,
    height: 2.1, radius: 0.55, anim: 'bow', projectile: 'arrow', walkFreq: 9, walkAmp: 0.10,
  },
  Bombardero: {
    name: 'Bombardero', ico: '💣', cost: 3,
    hp: 190, dmg: 105, range: 8, speed: 3.0, attackRate: 0.55,
    splash: 2.6, height: 2.0, radius: 0.55, anim: 'throw', projectile: 'bomb',
    walkFreq: 9, walkAmp: 0.10,
  },
  MagoFuego: {
    name: 'Mago de Fuego', ico: '🔥', cost: 4,
    hp: 330, dmg: 95, range: 8.5, speed: 2.8, attackRate: 0.6,
    splash: 2.2, height: 2.3, radius: 0.6, anim: 'cast', projectile: 'fireball',
    walkFreq: 8, walkAmp: 0.09,
  },
  MontaPuercos: {
    name: 'Montapuercos', ico: '🐗', cost: 4,
    hp: 750, dmg: 120, range: 1.3, speed: 4.4, attackRate: 0.75,
    height: 2.7, radius: 0.7, anim: 'gallop', walkFreq: 12, walkAmp: 0.16,
  },
  Gigante: {
    name: 'Gigante', ico: '🗿', cost: 5,
    hp: 1300, dmg: 110, range: 1.5, speed: 2.0, attackRate: 0.65,
    height: 3.8, radius: 0.95, anim: 'heavy', walkFreq: 5.5, walkAmp: 0.14,
  },
  Pekka: {
    name: 'P.E.K.K.A', ico: '🤖', cost: 7,
    hp: 1500, dmg: 280, range: 1.4, speed: 1.9, attackRate: 0.5,
    height: 3.4, radius: 0.85, anim: 'heavy', walkFreq: 5, walkAmp: 0.12,
  },
  Canon: {
    name: 'Cañón', ico: '🎯', cost: 4, building: true, lifetime: 30,
    hp: 650, dmg: 85, range: 10, speed: 0, attackRate: 1.0,
    height: 2.2, radius: 1.0, anim: 'cannon', projectile: 'cannonball',
  },
  Torre: {
    name: 'Torre', ico: '🏰', tower: true,
    hp: 950, dmg: 42, range: 11, speed: 0, attackRate: 1.0,
    height: 4.6, radius: 1.5, anim: 'tower', projectile: 'towerbolt',
  },
  TorreRey: {
    name: 'Torre del Rey', ico: '👑', tower: true,
    hp: 1500, dmg: 55, range: 7, speed: 0, attackRate: 1.0,
    height: 5.6, radius: 1.9, anim: 'tower', projectile: 'towerbolt',
  },
};

export const CARD_KEYS = Object.keys(UNIT_TYPES).filter((k) => !UNIT_TYPES[k].tower);

// ------------------------------------------------------- instancias 3D
// Normaliza el modelo a la altura del catálogo, apoyado en el suelo y
// centrado; lo envuelve en `group` (posición/orientación en el mundo) con
// `inner` (cuerpo que animamos).
export function makeUnitMesh(key) {
  const t = UNIT_TYPES[key];
  const inner = templates[key].clone(true);
  inner.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });

  const box = new THREE.Box3().setFromObject(inner);
  const size = new THREE.Vector3(); box.getSize(size);
  const s = t.height / size.y;
  inner.scale.setScalar(s);
  const center = new THREE.Vector3(); box.getCenter(center);
  inner.position.set(-center.x * s, -box.min.y * s, -center.z * s);

  const body = new THREE.Group();  // pivote de animación (a ras de suelo)
  body.add(inner);
  const group = new THREE.Group();
  group.add(body);
  // la Torre del Rey trae el cañón en un nodo aparte ('Turret') para apuntar
  const turret = inner.getObjectByName('Turret') ?? null;
  return { group, body, turret };
}

export function collectMeshMaterials(root) {
  const mats = [];
  root.traverse((o) => { if (o.isMesh && o.material) mats.push(o.material); });
  return mats;
}

// ------------------------------------------------------- animaciones
// u = { body, type, animT, walkPhase, attackAnimT, ... }  (ver game.js)
const TWO_PI = Math.PI * 2;

export function animateUnit(u, dt, moving) {
  const t = u.type;
  const b = u.body;
  u.animT += dt;

  // base: reposo
  let bobY = 0, rotX = 0, rotZ = 0, rotY = 0, scaleY = 1, fwd = 0;

  if (u.dying) {
    // morir: caer hacia atrás y hundirse
    const p = Math.min(1, u.deathT / 0.9);
    rotX = -p * p * Math.PI / 2;
    bobY = -p * p * 0.8;
    b.rotation.set(rotX, 0, 0);
    b.position.y = bobY;
    return;
  }

  if (moving && t.speed > 0) {
    u.walkPhase += dt * t.walkFreq;
    const ph = u.walkPhase;
    switch (t.anim) {
      case 'gallop': // brincos largos del puerco
        bobY = Math.abs(Math.sin(ph)) * t.walkAmp * 1.4;
        rotX = Math.sin(ph) * 0.14;            // cabecea al galopar
        rotZ = Math.sin(ph * 0.5) * 0.03;
        break;
      case 'heavy': // pasos pesados: se ladea de pierna a pierna
        bobY = Math.abs(Math.sin(ph)) * t.walkAmp;
        rotZ = Math.sin(ph) * 0.09;
        rotX = 0.05;
        break;
      default:      // caminata estándar: rebote + balanceo + inclinación
        bobY = Math.abs(Math.sin(ph)) * t.walkAmp;
        rotZ = Math.sin(ph) * 0.06;
        rotX = 0.07;
        break;
    }
  } else if (t.speed > 0 || t.building) {
    // respiración sutil en reposo
    scaleY = 1 + Math.sin(u.animT * 2.2) * 0.008;
  }

  // ataque superpuesto (attackAnimT > 0 cuenta hacia 0)
  if (u.attackAnimT > 0) {
    const dur = u.attackAnimDur;
    const p = 1 - u.attackAnimT / dur;      // 0 -> 1
    const pulse = Math.sin(Math.PI * Math.min(1, p)); // sube y baja
    switch (t.anim) {
      case 'walk':
      case 'gallop':
      case 'heavy':   // embestida hacia el objetivo + hachazo
        fwd = pulse * (t.anim === 'heavy' ? 0.55 : 0.45);
        rotX += -pulse * 0.28;
        break;
      case 'bow':     // tensar el arco: atrás y suelta
        fwd = -pulse * 0.18;
        rotX += -pulse * 0.10;
        break;
      case 'cast':    // conjuro: se alza y "explota" el gesto
        bobY += pulse * 0.30;
        scaleY *= 1 + pulse * 0.06;
        rotX += -pulse * 0.12;
        break;
      case 'throw':   // giro corto y lanzamiento
        rotY = Math.sin(p * Math.PI * 2) * 0.35;
        fwd = pulse * 0.25;
        rotX += -pulse * 0.15;
        break;
      case 'cannon':  // culatazo: se aplasta y recula
        fwd = -pulse * 0.30;
        scaleY *= 1 - pulse * 0.08;
        break;
      case 'tower':   // las torres no se mueven al disparar (como en Clash)
        break;
    }
    u.attackAnimT -= dt;
  }

  b.position.y = bobY;
  b.position.z = fwd; // +z local = hacia donde mira el grupo
  b.rotation.set(rotX, rotY, rotZ);
  b.scale.set(1, scaleY, 1);
}
