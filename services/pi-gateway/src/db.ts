import pg from "pg";

const { Pool } = pg;

// Lazy: the tool modules that import `pool` (search-filings.ts etc.) need to
// be importable in tests without DIRECT_URL set — e.g. to unit test their
// pure helpers, or to let `describe.skipIf` skip DB-requiring cases without
// the import itself throwing first. Validation + connection only happen on
// first actual query.
let realPool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!realPool) {
    const DIRECT_URL = process.env.DIRECT_URL;
    if (!DIRECT_URL) throw new Error("DIRECT_URL env var is required");
    const cleanUrl = DIRECT_URL
      .replace(/[?&]sslmode=[^&]*/g, "")
      .replace(/[?&]sslaccept=[^&]*/g, "");
    realPool = new Pool({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });
  }
  return realPool;
}

export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    const p = getPool();
    const value = Reflect.get(p, prop, p);
    return typeof value === "function" ? value.bind(p) : value;
  },
});
