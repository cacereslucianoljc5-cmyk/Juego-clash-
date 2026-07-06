// Chat global: GET devuelve los últimos mensajes, POST publica uno nuevo.
import { sql, initDb, cors, readBody } from './_db.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!sql) return res.status(503).json({ error: 'DB no configurada' });
  try {
    await initDb();

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT name, wallet, text, ts FROM messages ORDER BY id DESC LIMIT 60`;
      const list = rows.reverse().map((r) => ({
        name: r.name, wallet: r.wallet, text: r.text, ts: new Date(r.ts).getTime(),
      }));
      return res.status(200).json(list);
    }

    if (req.method === 'POST') {
      const { name, text, wallet } = readBody(req);
      if (!name || !text) return res.status(400).json({ error: 'faltan campos' });
      const clean = String(text).slice(0, 200);
      await sql`INSERT INTO messages (name, wallet, text) VALUES (${name}, ${wallet || null}, ${clean})`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
