// ===========================================================================
// Netcode de la partida 1v1 — lockstep determinista sobre Neon (sondeo HTTP).
//
// Solo se sincronizan COMANDOS de despliegue. Cada comando se agenda para un
// `applyTick` futuro (con margen para la latencia) y ambos clientes lo aplican
// en ese mismo tick sobre su simulación idéntica → se mantienen en sincronía.
//
// El reloj compartido se deriva de `startedAt` (hora del servidor cuando se creó
// la partida) más un offset estimado servidor↔cliente. El tick global es
//   floor((horaServidorEstimada - startedAt) / TICK_MS).
// ===========================================================================

const TICK_MS = 1000 / 60;   // igual que el paso fijo de la simulación (1/60 s)
const DELAY_TICKS = 150;     // ~2.5 s de margen para el sondeo
const POLL_MS = 700;

export async function createNetMatch({ api, matchId, wallet }) {
  const net = {
    api, matchId, wallet,
    myTeam: 1, oppName: 'Rival', seed: 0, startedAt: 0,
    offset: 0, bestRtt: Infinity, lastId: 0,
    buffer: new Map(),   // applyTick -> [comando,…]
    ready: false,
    delayTicks: DELAY_TICKS,
    _timer: null,
  };

  async function poll() {
    const t0 = Date.now();
    let data;
    try {
      const res = await fetch(
        `${api}/match-events?matchId=${encodeURIComponent(matchId)}&since=${net.lastId}`);
      if (!res.ok) return;
      data = await res.json();
    } catch { return; }
    const t1 = Date.now();
    const rtt = t1 - t0;
    // usa la muestra con menor RTT para el mejor offset de reloj
    if (typeof data.now === 'number' && rtt < net.bestRtt) {
      net.bestRtt = rtt;
      net.offset = data.now + rtt / 2 - t1;
    }
    if (data.match && !net.ready) {
      net.myTeam = data.match.host === wallet ? 1 : -1;
      net.seed = data.match.seed;
      net.startedAt = data.match.startedAt;
      net.oppName = net.myTeam === 1 ? data.match.guestName : data.match.hostName;
      net.ready = true;
    }
    for (const e of (data.events || [])) {
      if (e.id > net.lastId) net.lastId = e.id;
      const arr = net.buffer.get(e.applyTick) || [];
      arr.push(e);
      net.buffer.set(e.applyTick, arr);
    }
  }

  net.currentTick = () => {
    if (!net.ready) return 0;
    const serverNow = Date.now() + net.offset;
    return Math.max(0, Math.floor((serverNow - net.startedAt) / TICK_MS));
  };

  // Devuelve (y consume) los comandos agendados para ese tick.
  net.commandsForTick = (tick) => {
    const arr = net.buffer.get(tick);
    if (arr) net.buffer.delete(tick);
    return arr || [];
  };

  // Red de seguridad: comandos cuyo tick ya pasó (llegaron tarde). Se aplican
  // igualmente para no perderlos; con el margen de delay no debería ocurrir.
  net.drainBefore = (tick) => {
    const out = [];
    for (const [k, arr] of net.buffer) {
      if (k < tick) { out.push(...arr); net.buffer.delete(k); }
    }
    return out;
  };

  // Envía un despliegue propio. El poll de vuelta lo entrega a AMBOS clientes
  // (incluido el emisor), así que se aplica por la misma vía en los dos.
  net.sendDeploy = async ({ applyTick, team, card, x, z }) => {
    const res = await fetch(`${api}/match-events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, applyTick, team, card, x, z }),
    });
    if (!res.ok) throw new Error('envío rechazado');
  };

  net.stop = () => { if (net._timer) { clearInterval(net._timer); net._timer = null; } };

  // Sondea hasta obtener los metadatos de la partida (roles/semilla/reloj).
  const t0 = Date.now();
  while (!net.ready && Date.now() - t0 < 15000) {
    await poll();
    if (!net.ready) await new Promise((r) => setTimeout(r, 400));
  }
  if (!net.ready) throw new Error('no se pudieron cargar los datos de la partida');

  net._timer = setInterval(poll, POLL_MS);
  return net;
}
