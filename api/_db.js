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
      // Metadatos de cada partida 1v1 (roles + semilla + reloj de inicio),
      // compartidos por ambos clientes para el lockstep determinista.
      await sql`CREATE TABLE IF NOT EXISTS matches (
        match_id   TEXT PRIMARY KEY,
        host       TEXT NOT NULL,   -- wallet del equipo 1 (abajo)
        guest      TEXT NOT NULL,   -- wallet del equipo -1 (arriba)
        host_name  TEXT,
        guest_name TEXT,
        seed       BIGINT NOT NULL,
        started_at TIMESTAMPTZ DEFAULT now()
      )`;
      // Comandos de despliegue: cada uno se aplica en el mismo `apply_tick`
      // en ambos clientes, manteniendo las simulaciones sincronizadas.
      await sql`CREATE TABLE IF NOT EXISTS events (
        id         BIGSERIAL PRIMARY KEY,
        match_id   TEXT NOT NULL,
        apply_tick BIGINT NOT NULL,
        team       INT NOT NULL,
        card       TEXT NOT NULL,
        x          REAL NOT NULL,
        z          REAL NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS events_match_idx ON events (match_id, id)`;
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
