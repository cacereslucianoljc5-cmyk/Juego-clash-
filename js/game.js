// Clash 3D — juego web estilo Clash Royale con los modelos del repo Clash3deee.
// La arena es el mapa (sin animación propia): su agua se anima aparte y tiene
// colisión, igual que los bordes del campo antes de los bosques (cuadrícula
// horneada en js/arenadata.js).
import * as THREE from 'three';
import { ARENA } from './arenadata.js?v=2';
import {
  loadModels, getArenaModel, makeUnitMesh, collectMeshMaterials,
  animateUnit, UNIT_TYPES, CARD_KEYS,
} from './units.js?v=2';

// ------------------------------------------------------------ constantes
const S = 28;                        // escala del modelo Arena
const RIVER_Z0 = ARENA.riverZ[0] * S;
const RIVER_Z1 = ARENA.riverZ[1] * S;
const FIELD_X = 0.55 * S;
const FIELD_Z = 0.68 * S;
const ELIXIR_MAX = 10;
const ELIXIR_RATE = 1 / 1.8;         // 1 elixir cada 1.8 s
const MATCH_TIME = 180;

// ------------------------------------------------------------ escena
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5e0);
scene.fog = new THREE.Fog(0x87b5e0, 70, 160);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 400);
const CAM_BASE = new THREE.Vector3(0, 33, 33);
camera.position.copy(CAM_BASE);
camera.lookAt(0, 0, -2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xcfe5ff, 0x3e5a35, 1.0));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.position.set(28, 45, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 5; sun.shadow.camera.far = 130;
const SD = 34;
sun.shadow.camera.left = -SD; sun.shadow.camera.right = SD;
sun.shadow.camera.top = SD; sun.shadow.camera.bottom = -SD;
scene.add(sun);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------ colisiones
// Cuadrícula transitable horneada de la arena: agua, murallas y bosques
// de los bordes quedan bloqueados; los puentes son el único cruce del río.
const GN = ARENA.gridN;
function walkableLocal(lx, lz) {
  if (lx < ARENA.minX || lx > ARENA.maxX || lz < ARENA.minZ || lz > ARENA.maxZ) return false;
  const gx = Math.min(GN - 1, Math.floor(((lx - ARENA.minX) / (ARENA.maxX - ARENA.minX)) * GN));
  const gz = Math.min(GN - 1, Math.floor(((lz - ARENA.minZ) / (ARENA.maxZ - ARENA.minZ)) * GN));
  return ARENA.grid[gz][gx] === '1';
}
function walkable(x, z, r = 0) {
  const lx = x / S, lz = z / S, lr = r / S;
  if (!walkableLocal(lx, lz)) return false;
  if (lr > 0) {
    const d = lr * 0.75;
    return walkableLocal(lx - d, lz) && walkableLocal(lx + d, lz)
        && walkableLocal(lx, lz - d) && walkableLocal(lx, lz + d);
  }
  return true;
}

// Puentes: se detectan escaneando la fila central del río en la cuadrícula.
const bridges = [];
{
  const lz = (ARENA.riverZ[0] + ARENA.riverZ[1]) / 2;
  const gz = Math.floor(((lz - ARENA.minZ) / (ARENA.maxZ - ARENA.minZ)) * GN);
  let run = null;
  for (let gx = 0; gx < GN; gx++) {
    if (ARENA.grid[gz][gx] === '1') {
      if (!run) run = { from: gx, to: gx }; else run.to = gx;
    } else if (run) {
      const cx = ARENA.minX + ((run.from + run.to + 1) / 2 / GN) * (ARENA.maxX - ARENA.minX);
      bridges.push(cx * S);
      run = null;
    }
  }
  if (run) bridges.push((ARENA.minX + ((run.from + run.to + 1) / 2 / GN) * (ARENA.maxX - ARENA.minX)) * S);
}

// ------------------------------------------------------------ estado
const entities = [];      // unidades, edificios y torres
const projectiles = [];
const effects = [];
let nextId = 1;
const player = { team: 1, elixir: 5, crowns: 0 };
const enemy = { team: -1, elixir: 5, crowns: 0, cd: 3 };
let timeLeft = MATCH_TIME;
let gameOver = false;
let started = false;

// ------------------------------------------------------------ interfaz
const ui = {
  loading: document.getElementById('loading'),
  progress: document.getElementById('progress'),
  loadtext: document.getElementById('loadtext'),
  deck: document.getElementById('deck'),
  elixirFill: document.getElementById('elixirFill'),
  elixirNum: document.getElementById('elixirNum'),
  timer: document.getElementById('timer'),
  crowns: document.getElementById('crowns'),
  result: document.getElementById('result'),
  resultText: document.getElementById('resultText'),
  hint: document.getElementById('hint'),
};
let selectedCard = null;

function buildDeck() {
  for (const key of CARD_KEYS) {
    const t = UNIT_TYPES[key];
    const el = document.createElement('button');
    el.className = 'card';
    el.innerHTML = `<span class="ico">${t.ico}</span>${t.name}<span class="cost">${t.cost}</span>`;
    el.addEventListener('click', () => {
      selectedCard = selectedCard === key ? null : key;
      document.querySelectorAll('.card').forEach((c) => c.classList.remove('active'));
      if (selectedCard) el.classList.add('active');
      ui.hint.textContent = selectedCard
        ? `Toca tu mitad de la arena para desplegar ${t.name}`
        : 'Elige una carta del mazo';
    });
    el.dataset.key = key;
    ui.deck.appendChild(el);
  }
}

function refreshDeck() {
  document.querySelectorAll('.card').forEach((c) => {
    const t = UNIT_TYPES[c.dataset.key];
    c.classList.toggle('poor', player.elixir < t.cost);
  });
  ui.elixirFill.style.width = `${(player.elixir / ELIXIR_MAX) * 100}%`;
  ui.elixirNum.textContent = Math.floor(player.elixir);
}

// ------------------------------------------------------------ barras de vida
function makeHpBar(team) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 10;
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  spr.scale.set(2.4, 0.38, 1);
  spr.renderOrder = 5;
  return { sprite: spr, canvas: c, tex, team, shown: 1 };
}
function paintHpBar(bar, frac) {
  const g = bar.canvas.getContext('2d');
  g.clearRect(0, 0, 64, 10);
  g.fillStyle = 'rgba(10,14,20,.75)';
  g.fillRect(0, 0, 64, 10);
  g.fillStyle = bar.team === 1 ? '#3b82f6' : '#ef4444';
  g.fillRect(1.5, 1.5, 61 * Math.max(0, frac), 7);
  bar.tex.needsUpdate = true;
}

// ------------------------------------------------------------ entidades
function spawnUnit(key, team, x, z) {
  const t = UNIT_TYPES[key];
  const { group, body, turret } = makeUnitMesh(key);
  group.position.set(x, 0, z);
  group.rotation.y = team === 1 ? Math.PI : 0; // mirar hacia el rival
  scene.add(group);

  // anillo de equipo
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(t.radius * 0.85, t.radius * 1.15, 28),
    new THREE.MeshBasicMaterial({ color: team === 1 ? 0x3b82f6 : 0xef4444, transparent: true, opacity: 0.65 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(ring);

  const bar = makeHpBar(team);
  bar.sprite.position.set(0, t.height + 0.9, 0);
  group.add(bar.sprite);
  paintHpBar(bar, 1);

  const u = {
    id: nextId++, key, type: t, team, group, body,
    turret, turretAngle: 0,
    hp: t.hp, maxHp: t.hp, radius: t.radius,
    target: null, retarget: 0, attackCd: 0,
    animT: Math.random() * 10, walkPhase: Math.random() * 6,
    attackAnimT: 0, attackAnimDur: 0.4,
    dying: false, deathT: 0, flash: 0, bar,
    life: t.lifetime ?? Infinity,
    mats: collectMeshMaterials(body),
  };
  entities.push(u);
  addEffect('ring', x, z, team === 1 ? 0x60a5fa : 0xf87171, t.radius + 0.8);
  return u;
}

function spawnTowers() {
  // posiciones sacadas del análisis de la arena (coords locales × S)
  for (const team of [1, -1]) {
    for (const bx of bridges) {
      const tw = spawnUnit('Torre', team, bx, team * 0.42 * S);
      tw.isTower = true;
    }
    const king = spawnUnit('TorreRey', team, 0, team * 0.565 * S);
    king.isTower = true; king.isKing = true;
  }
}

function dealDamage(u, dmg) {
  if (u.dying || gameOver) return;
  u.hp -= dmg;
  u.flash = 0.12;
  paintHpBar(u.bar, u.hp / u.maxHp);
  if (u.hp <= 0) {
    u.dying = true; u.deathT = 0;
    if (u.isTower) {
      const side = u.team === 1 ? enemy : player;
      side.crowns += u.isKing ? 3 : 1;
      ui.crowns.textContent = `👑 ${player.crowns} — ${enemy.crowns} 👑`;
      addEffect('boom', u.group.position.x, u.group.position.z, 0xffc94d, u.radius + 3);
      if (u.isKing) endGame(u.team === -1);
    }
  }
}

function endGame(result) {
  if (gameOver) return;
  gameOver = true;
  ui.resultText.textContent = result === 'draw' ? '🤝 Empate'
    : result ? '🏆 ¡Victoria!' : '💀 Derrota…';
  ui.result.classList.add('show');
}

// ------------------------------------------------------------ proyectiles
const PROJ_STYLE = {
  arrow:      { r: 0.10, color: 0xd9c9a3, speed: 24, arc: 2.0 },
  fireball:   { r: 0.30, color: 0xff7a1a, speed: 16, arc: 1.2, glow: true },
  bomb:       { r: 0.28, color: 0x2c2f38, speed: 12, arc: 4.5 },
  cannonball: { r: 0.24, color: 0x555a66, speed: 26, arc: 0.4 },
  towerbolt:  { r: 0.16, color: 0xffd23e, speed: 28, arc: 1.0, glow: true },
};
function fireProjectile(from, target, kind) {
  const st = PROJ_STYLE[kind];
  const mat = new THREE.MeshStandardMaterial({
    color: st.color,
    emissive: st.glow ? st.color : 0x000000,
    emissiveIntensity: st.glow ? 1.4 : 0,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(st.r, 10, 8), mat);
  const start = from.group.position.clone();
  start.y += from.type.height * 0.6;
  mesh.position.copy(start);
  scene.add(mesh);
  projectiles.push({
    mesh, start, target, kind, t: 0,
    dur: start.distanceTo(target.group.position) / st.speed + 0.001,
    dmg: from.type.dmg, splash: from.type.splash, team: from.team, arc: st.arc,
  });
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.t += dt;
    const k = Math.min(1, p.t / p.dur);
    const end = p.target.group.position.clone();
    end.y += p.target.dying ? 0.2 : p.target.type.height * 0.45;
    p.mesh.position.lerpVectors(p.start, end, k);
    p.mesh.position.y += Math.sin(Math.PI * k) * p.arc;
    if (k >= 1) {
      if (p.splash) {
        addEffect('boom', end.x, end.z, p.kind === 'bomb' ? 0x8a8f9c : 0xff7a1a, p.splash + 0.6);
        for (const u of entities) {
          if (u.team === p.team || u.dying) continue;
          const d = u.group.position.distanceTo(end);
          if (d <= p.splash + u.radius) dealDamage(u, p.dmg);
        }
      } else if (!p.target.dying) {
        dealDamage(p.target, p.dmg);
      }
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}

// ------------------------------------------------------------ efectos
function addEffect(kind, x, z, color, size) {
  const geo = new THREE.RingGeometry(0.15, 0.55, 32);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.12, z);
  scene.add(mesh);
  effects.push({ mesh, t: 0, dur: kind === 'boom' ? 0.5 : 0.6, size });
}
function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    const k = e.t / e.dur;
    if (k >= 1) { scene.remove(e.mesh); effects.splice(i, 1); continue; }
    e.mesh.scale.setScalar(1 + k * e.size);
    e.mesh.material.opacity = 0.9 * (1 - k);
  }
}

// ------------------------------------------------------------ IA y combate
function findTarget(u) {
  let best = null, bestD = Infinity;
  for (const e of entities) {
    if (e.team === u.team || e.dying) continue;
    const d = u.group.position.distanceTo(e.group.position) - e.radius;
    // los edificios y torres solo disparan dentro de su alcance
    if ((u.type.building || u.type.tower) && d > u.type.range + 2) continue;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// ¿hace falta cruzar el río para llegar al objetivo?
function crossingGoal(u, tx, tz) {
  const z = u.group.position.z;
  const inBand = z > RIVER_Z0 - 0.5 && z < RIVER_Z1 + 0.5;
  const sameSide = (z < RIVER_Z0 && tz < RIVER_Z0) || (z > RIVER_Z1 && tz > RIVER_Z1);
  if (sameSide) return { x: tx, z: tz };
  // puente más cercano
  let bx = bridges[0] ?? 0, bd = Infinity;
  for (const b of bridges) {
    const d = Math.abs(u.group.position.x - b) + Math.abs(tx - b) * 0.6;
    if (d < bd) { bd = d; bx = b; }
  }
  if (inBand) return { x: bx, z: tz };           // ya en el puente: seguir
  const nearEdge = z < RIVER_Z0 ? RIVER_Z0 - 1.2 : RIVER_Z1 + 1.2;
  const farEdge = z < RIVER_Z0 ? RIVER_Z1 + 1.5 : RIVER_Z0 - 1.5;
  if (Math.abs(u.group.position.x - bx) > 1.0) return { x: bx, z: nearEdge };
  return { x: bx, z: farEdge };
}

function updateEntity(u, dt) {
  if (u.dying) {
    u.deathT += dt;
    animateUnit(u, dt, false);
    if (u.deathT > 1.2) {
      scene.remove(u.group);
      entities.splice(entities.indexOf(u), 1);
    }
    return;
  }

  // daño: parpadeo rojo
  if (u.flash > 0) {
    u.flash -= dt;
    const on = u.flash > 0;
    for (const m of u.mats) m.emissive?.setHex(on ? 0x881111 : 0x000000);
  }

  // vida útil de edificios (Cañón)
  u.life -= dt;
  if (u.life <= 0) { dealDamage(u, u.hp + 1); return; }

  u.retarget -= dt;
  if (u.retarget <= 0 || !u.target || u.target.dying) {
    u.target = findTarget(u);
    u.retarget = 0.35;
  }
  u.attackCd -= dt;

  // la Torre del Rey no gira: solo su cañón (nodo Turret) apunta al enemigo
  if (u.turret) {
    let goal = 0; // sin objetivo, el cañón vuelve al frente
    if (u.target && !u.target.dying) {
      const tp = u.target.group.position;
      const world = Math.atan2(tp.x - u.group.position.x, tp.z - u.group.position.z);
      goal = world - u.group.rotation.y;
    }
    let delta = goal - u.turretAngle;
    delta = ((delta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    u.turretAngle += delta * Math.min(1, dt * 5);
    u.turret.rotation.y = u.turretAngle;
  }

  let moving = false;
  const t = u.type;
  if (u.target) {
    const tp = u.target.group.position;
    const dist = u.group.position.distanceTo(tp) - u.target.radius;
    const reach = Math.max(t.range, u.radius + 0.2);

    if (dist <= reach) {
      // mirar al objetivo y atacar (las torres quedan fijas, como en Clash)
      if (!t.tower) {
        u.group.rotation.y = Math.atan2(tp.x - u.group.position.x, tp.z - u.group.position.z);
      }
      if (u.attackCd <= 0) {
        u.attackCd = 1 / t.attackRate;
        u.attackAnimDur = Math.min(0.5, 0.9 / t.attackRate);
        u.attackAnimT = u.attackAnimDur;
        if (t.projectile) fireProjectile(u, u.target, t.projectile);
        else dealDamage(u.target, t.dmg);
      }
    } else if (t.speed > 0) {
      // avanzar (cruzando por los puentes si el río está en medio)
      const goal = crossingGoal(u, tp.x, tp.z);
      const dir = new THREE.Vector2(goal.x - u.group.position.x, goal.z - u.group.position.z);
      if (dir.lengthSq() > 0.01) {
        dir.normalize();
        const step = t.speed * dt;
        let nx = u.group.position.x + dir.x * step;
        let nz = u.group.position.z + dir.y * step;
        // colisión con agua/bordes: probar el paso completo y luego deslizar
        if (walkable(nx, nz, u.radius)) {
          u.group.position.x = nx; u.group.position.z = nz;
        } else if (walkable(nx, u.group.position.z, u.radius)) {
          u.group.position.x = nx;
        } else if (walkable(u.group.position.x, nz, u.radius)) {
          u.group.position.z = nz;
        }
        u.group.rotation.y = Math.atan2(dir.x, dir.y);
        moving = true;
      }
    }
  }

  // límites duros del campo (por si la cuadrícula dejara escapar algo)
  u.group.position.x = THREE.MathUtils.clamp(u.group.position.x, -FIELD_X, FIELD_X);
  u.group.position.z = THREE.MathUtils.clamp(u.group.position.z, -FIELD_Z, FIELD_Z);

  animateUnit(u, dt, moving);
}

// separación entre unidades (empuje suave para no encimarse)
function separate() {
  for (let i = 0; i < entities.length; i++) {
    const a = entities[i];
    if (a.dying) continue;
    for (let j = i + 1; j < entities.length; j++) {
      const b = entities[j];
      if (b.dying) continue;
      const dx = b.group.position.x - a.group.position.x;
      const dz = b.group.position.z - a.group.position.z;
      const min = a.radius + b.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 > min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) / 2;
      const px = (dx / d) * push, pz = (dz / d) * push;
      const aMob = a.type.speed > 0 ? 1 : 0;
      const bMob = b.type.speed > 0 ? 1 : 0;
      if (aMob && walkable(a.group.position.x - px, a.group.position.z - pz, a.radius)) {
        a.group.position.x -= px; a.group.position.z -= pz;
      }
      if (bMob && walkable(b.group.position.x + px, b.group.position.z + pz, b.radius)) {
        b.group.position.x += px; b.group.position.z += pz;
      }
    }
  }
}

// IA rival: junta elixir y despliega en su mitad
function updateEnemyAI(dt) {
  enemy.elixir = Math.min(ELIXIR_MAX, enemy.elixir + ELIXIR_RATE * dt);
  enemy.cd -= dt;
  if (enemy.cd > 0) return;
  enemy.cd = 2.2 + Math.random() * 2.2;
  const affordable = CARD_KEYS.filter((k) => UNIT_TYPES[k].cost <= enemy.elixir);
  if (!affordable.length) return;
  const key = affordable[Math.floor(Math.random() * affordable.length)];
  const t = UNIT_TYPES[key];
  const bx = bridges[Math.floor(Math.random() * bridges.length)] ?? 0;
  for (let tries = 0; tries < 12; tries++) {
    const x = t.building ? (Math.random() * 6 - 3) : bx + (Math.random() * 7 - 3.5);
    const z = -(RIVER_Z1 / S + 0.14 + Math.random() * 0.34) * S;
    if (!walkable(x, z, t.radius)) continue;
    enemy.elixir -= t.cost;
    const n = t.count ?? 1;
    for (let i = 0; i < n; i++) {
      spawnUnit(key, -1, x + (i - (n - 1) / 2) * 1.3, z + (i % 2) * 1.1);
    }
    break;
  }
}

// ------------------------------------------------------------ despliegue
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const cursor = new THREE.Mesh(
  new THREE.RingGeometry(0.9, 1.15, 32),
  new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
);
cursor.rotation.x = -Math.PI / 2;
cursor.position.y = 0.1;
cursor.visible = false;
scene.add(cursor);

function pointFromEvent(ev) {
  const nx = (ev.clientX / innerWidth) * 2 - 1;
  const ny = -(ev.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera({ x: nx, y: ny }, camera);
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(groundPlane, p) ? p : null;
}
function validDrop(p, t) {
  return p && p.z > RIVER_Z1 + 0.8 && walkable(p.x, p.z, t.radius);
}

addEventListener('pointermove', (ev) => {
  if (!selectedCard || gameOver || !started) { cursor.visible = false; return; }
  const p = pointFromEvent(ev);
  if (!p) { cursor.visible = false; return; }
  cursor.visible = true;
  cursor.position.set(p.x, 0.1, p.z);
  cursor.material.color.setHex(validDrop(p, UNIT_TYPES[selectedCard]) ? 0x4ade80 : 0xef4444);
});

addEventListener('pointerdown', (ev) => {
  if (!selectedCard || gameOver || !started) return;
  if (ev.target.closest('#deck') || ev.target.closest('#result')) return;
  const t = UNIT_TYPES[selectedCard];
  const p = pointFromEvent(ev);
  if (!validDrop(p, t) || player.elixir < t.cost) return;
  player.elixir -= t.cost;
  const n = t.count ?? 1;
  for (let i = 0; i < n; i++) {
    spawnUnit(selectedCard, 1, p.x + (i - (n - 1) / 2) * 1.3, p.z + (i % 2) * 1.1);
  }
});

// ------------------------------------------------------------ agua animada
// Un plano ondulante cubre la superficie de agua del modelo (el río y los
// canales laterales quedan por debajo del nivel del pasto, así que el plano
// solo asoma donde de verdad hay agua).
let water = null;
function setupWater() {
  const w = (ARENA.maxX - ARENA.minX) * S;
  const h = (ARENA.maxZ - ARENA.minZ) * S;
  const geo = new THREE.PlaneGeometry(w, h, 72, 72);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x2ea3c7, transparent: true, opacity: 0.82,
    shininess: 90, specular: 0x9fd9ec, flatShading: true,
  });
  water = new THREE.Mesh(geo, mat);
  water.position.y = (ARENA.waterY - ARENA.fieldY) * S + 0.22;
  water.receiveShadow = true;
  scene.add(water);
  water.userData.base = geo.attributes.position.array.slice();
}
function updateWater(time) {
  const pos = water.geometry.attributes.position;
  const base = water.userData.base;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3], z = base[i * 3 + 2];
    pos.array[i * 3 + 1] = base[i * 3 + 1]
      + Math.sin(x * 0.55 + time * 1.7) * 0.16
      + Math.cos(z * 0.7 + time * 1.15) * 0.13
      + Math.sin((x + z) * 0.32 + time * 0.8) * 0.08;
  }
  pos.needsUpdate = true;
  water.geometry.computeVertexNormals();
  // el color respira un poco, como corriente
  const k = 0.5 + 0.5 * Math.sin(time * 0.6);
  water.material.color.setHSL(0.53 + k * 0.02, 0.62, 0.45 + k * 0.05);
}

// ------------------------------------------------------------ arranque
async function start() {
  buildDeck();
  await loadModels((f) => {
    ui.progress.style.width = `${f * 100}%`;
    ui.loadtext.textContent = `Cargando modelos… ${Math.round(f * 100)}%`;
  });

  // la arena (mapa): sin animación propia, apoyada para que el pasto sea y=0
  const arena = getArenaModel();
  arena.scale.setScalar(S);
  arena.position.y = -ARENA.fieldY * S;
  scene.add(arena);

  setupWater();
  spawnTowers();
  ui.crowns.textContent = '👑 0 — 0 👑';
  ui.loading.classList.add('hide');
  started = true;
}

let mouseX = 0;
addEventListener('pointermove', (ev) => { mouseX = (ev.clientX / innerWidth) * 2 - 1; });

// Bucle de paso fijo: la simulación avanza en pasos de 1/60 s aunque el
// render vaya lento, así la velocidad del juego no depende de los FPS.
const FIXED = 1 / 60;
const SPEED = Math.min(8, Math.max(0.1, Number(new URLSearchParams(location.search).get('speed')) || 1));
let acc = 0;

function step(dt) {
  if (!gameOver) {
    player.elixir = Math.min(ELIXIR_MAX, player.elixir + ELIXIR_RATE * dt);
    timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      endGame(player.crowns === enemy.crowns ? 'draw' : player.crowns > enemy.crowns);
    }
    updateEnemyAI(dt);
    for (let i = entities.length - 1; i >= 0; i--) updateEntity(entities[i], dt);
    separate();
    updateProjectiles(dt);
    updateEffects(dt);
  } else {
    // tras el final, las animaciones de muerte siguen su curso
    for (let i = entities.length - 1; i >= 0; i--) if (entities[i].dying) updateEntity(entities[i], dt);
    updateEffects(dt);
  }
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const time = clock.elapsedTime;

  if (started) {
    acc += Math.min(0.3 * SPEED, clock.getDelta() * SPEED);
    while (acc >= FIXED) { step(FIXED); acc -= FIXED; }
    const m = Math.floor(timeLeft / 60), s = Math.floor(timeLeft % 60);
    ui.timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
    refreshDeck();
  } else {
    clock.getDelta();
  }

  if (water) updateWater(time);

  // paralaje suave de cámara
  if (!window.__CAMLOCK) {
    camera.position.x += (mouseX * 4 - camera.position.x) * 0.03;
    camera.lookAt(0, 0, -2);
  }

  renderer.render(scene, camera);
}

document.getElementById('replay').addEventListener('click', () => location.reload());

// gancho de depuración (inofensivo en producción)
window.__CAM = camera;
window.__DBG = () => ({
  bridges,
  enemyElixir: +enemy.elixir.toFixed(1),
  playerElixir: +player.elixir.toFixed(1),
  timeLeft: +timeLeft.toFixed(1),
  entities: entities.map((e) => ({
    key: e.key, team: e.team, hp: Math.round(e.hp),
    x: +e.group.position.x.toFixed(1), z: +e.group.position.z.toFixed(1),
    tgt: e.target ? e.target.key : null,
  })),
});

start().catch((err) => {
  ui.loadtext.textContent = `Error cargando: ${err.message}`;
  console.error(err);
});
loop();
