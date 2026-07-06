// Crea o actualiza un usuario a partir de su wallet de Solana.
import { sql, initDb, cors, readBody } from './_db.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!sql) return res.status(503).json({ error: 'DB no configurada' });
  try {
    await initDb();
    if (req.method === 'POST') {
      const { wallet, name } = readBody(req);
      if (!wallet || !name) return res.status(400).json({ error: 'faltan campos' });
      await sql`
        INSERT INTO users (wallet, name) VALUES (${wallet}, ${name})
        ON CONFLICT (wallet) DO UPDATE SET name = EXCLUDED.name, seen_at = now()`;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
