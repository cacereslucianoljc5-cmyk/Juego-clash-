// Emparejamiento 1v1 sencillo mediante una cola en Neon.
//  POST { action:'join', wallet, name, stake }  -> entra a la cola; si hay otro
//        esperando con la misma apuesta, empareja a ambos y devuelve el rival.
//  GET  ?wallet=...                              -> consulta si ya te emparejaron.
//  POST { action:'leave', wallet }              -> sale de la cola.
//
// Nota: esto resuelve el LOBBY y el emparejamiento real de jugadores. La
// sincronización de la partida en vivo (mover tropas entre ambos) es la fase 2.
import { sql, initDb, cors, readBody } from './_db.js';

function matchId(a, b) {
  return [a, b].sort().join('_').slice(0, 40) + '_' + Math.abs(hash(a + b));
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!sql) return res.status(503).json({ error: 'DB no configurada' });
  try {
    await initDb();

    if (req.method === 'GET') {
      const wallet = req.query?.wallet;
      if (!wallet) return res.status(400).json({ error: 'falta wallet' });
      const rows = await sql`SELECT match_id, opponent FROM queue WHERE wallet = ${wallet}`;
      if (!rows.length) return res.status(200).json({ status: 'idle' });
      const row = rows[0];
      if (row.match_id) return res.status(200).json({ status: 'matched', matchId: row.match_id, opponent: row.opponent });
      return res.status(200).json({ status: 'waiting' });
    }

    if (req.method === 'POST') {
      const { action, wallet, name, stake } = readBody(req);
      if (!wallet) return res.status(400).json({ error: 'falta wallet' });

      if (action === 'leave') {
        await sql`DELETE FROM queue WHERE wallet = ${wallet}`;
        return res.status(200).json({ ok: true });
      }

      if (action === 'join') {
        // limpia colas viejas (más de 60 s sin emparejar)
        await sql`DELETE FROM queue WHERE match_id IS NULL AND joined_at < now() - interval '60 seconds'`;
        // ¿hay alguien esperando con la misma apuesta?
        const foes = await sql`
          SELECT wallet, name FROM queue
          WHERE match_id IS NULL AND stake = ${stake || '0'} AND wallet <> ${wallet}
          ORDER BY joined_at ASC LIMIT 1`;
        if (foes.length) {
          const foe = foes[0];
          const mid = matchId(wallet, foe.wallet);
          await sql`UPDATE queue SET match_id = ${mid}, opponent = ${name || wallet} WHERE wallet = ${foe.wallet}`;
          await sql`
            INSERT INTO queue (wallet, name, stake, match_id, opponent)
            VALUES (${wallet}, ${name || wallet}, ${stake || '0'}, ${mid}, ${foe.name})
            ON CONFLICT (wallet) DO UPDATE SET match_id = ${mid}, opponent = ${foe.name}, stake = ${stake || '0'}`;
          return res.status(200).json({ status: 'matched', matchId: mid, opponent: foe.name });
        }
        // nadie: me pongo a esperar
        await sql`
          INSERT INTO queue (wallet, name, stake, match_id, opponent)
          VALUES (${wallet}, ${name || wallet}, ${stake || '0'}, NULL, NULL)
          ON CONFLICT (wallet) DO UPDATE SET name = ${name || wallet}, stake = ${stake || '0'}, match_id = NULL, opponent = NULL, joined_at = now()`;
        return res.status(200).json({ status: 'waiting' });
      }

      return res.status(400).json({ error: 'acción desconocida' });
    }

    return res.status(405).json({ error: 'método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
