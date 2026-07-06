// Sincronización de la partida 1v1 (lockstep determinista).
//  GET  ?matchId=X&since=Y  -> { now, match:{host,guest,seed,startedAt}, events:[…] }
//        Devuelve la hora del servidor (reloj compartido), los metadatos de la
//        partida y los comandos con id > Y.
//  POST { matchId, applyTick, team, card, x, z }  -> guarda un comando de despliegue.
import { sql, initDb, cors, readBody } from './_db.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!sql) return res.status(503).json({ error: 'DB no configurada' });
  try {
    await initDb();
    const now = Date.now();

    if (req.method === 'GET') {
      const matchId = req.query?.matchId;
      const since = Number(req.query?.since || 0);
      if (!matchId) return res.status(400).json({ error: 'falta matchId' });

      const m = await sql`SELECT host, guest, host_name, guest_name, seed, started_at FROM matches WHERE match_id = ${matchId}`;
      const ev = await sql`
        SELECT id, apply_tick, team, card, x, z FROM events
        WHERE match_id = ${matchId} AND id > ${since} ORDER BY id ASC LIMIT 500`;
      const events = ev.map((r) => ({
        id: Number(r.id), applyTick: Number(r.apply_tick), team: r.team,
        card: r.card, x: r.x, z: r.z,
      }));
      const match = m.length ? {
        host: m[0].host, guest: m[0].guest,
        hostName: m[0].host_name, guestName: m[0].guest_name,
        seed: Number(m[0].seed), startedAt: new Date(m[0].started_at).getTime(),
      } : null;
      return res.status(200).json({ now, match, events });
    }

    if (req.method === 'POST') {
      const { matchId, applyTick, team, card, x, z } = readBody(req);
      if (!matchId || applyTick == null || team == null || !card) {
        return res.status(400).json({ error: 'faltan campos' });
      }
      await sql`
        INSERT INTO events (match_id, apply_tick, team, card, x, z)
        VALUES (${matchId}, ${Math.floor(applyTick)}, ${team}, ${card}, ${Number(x)}, ${Number(z)})`;
      return res.status(200).json({ ok: true, now });
    }

    return res.status(405).json({ error: 'método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
