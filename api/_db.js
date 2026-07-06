// Conexión compartida a Neon (Postgres serverless) para las funciones /api.
// Usa el driver HTTP de Neon, ideal para funciones serverless de Vercel.
// Si no hay DATABASE_URL configurada, `sql` es null y las funciones devuelven
// 503; el frontend cae entonces a su demo local sin romperse.
import { neon } from '@neondatabase/serverless';

export const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

let ready = null;
export function initDb() {
  if (!sql) return Promise.resolve();
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (
        wallet     TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        seen_at    TIMESTAMPTZ DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS messages (
        id     BIGSERIAL PRIMARY KEY,
        name   TEXT NOT NULL,
        wallet TEXT,
        text   TEXT NOT NULL,
        ts     TIMESTAMPTZ DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS queue (
        wallet    TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        stake     TEXT NOT NULL,
        match_id  TEXT,
        opponent  TEXT,
        joined_at TIMESTAMPTZ DEFAULT now()
      )`;
    })();
  }
  return ready;
}

// Cabeceras CORS + manejo de preflight. Devuelve true si ya respondió (OPTIONS).
export function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

// Body JSON tolerante (Vercel suele parsearlo, pero por si acaso).
export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}
