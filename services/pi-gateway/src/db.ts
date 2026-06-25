import pg from "pg";

const { Pool } = pg;

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error("DIRECT_URL env var is required");

const cleanUrl = DIRECT_URL
  .replace(/[?&]sslmode=[^&]*/g, "")
  .replace(/[?&]sslaccept=[^&]*/g, "");

export const pool = new Pool({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });
