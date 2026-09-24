import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2";
import * as schema from "../../drizzle-v2/schema";
import { readV2ConnectionConfig } from "./connectionConfig";

export type V2Database = ReturnType<typeof drizzle<typeof schema>>;

let database: V2Database | null = null;
let initialization: Promise<void> | null = null;
let connectionPool: mysql.Pool | null = null;

async function connectV2Database() {
  // V2 never falls back to the V1 connection. This guard prevents a future
  // V2 process from accidentally pointing its migration-ready code at V1.
  const connection = readV2ConnectionConfig();
  const pool = mysql.createPool({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.databaseName,
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });

  try {
    database = drizzle(pool, { schema, mode: "default" });
    connectionPool = pool;
  } catch (error) {
    await pool.promise().end();
    throw error;
  }
}

/**
 * Explicitly release the V2 pool for one-shot CLIs such as bootstrap and the
 * optional demo seed. The HTTP server intentionally keeps its pool open.
 */
export async function closeV2Db() {
  const pool = connectionPool;
  connectionPool = null;
  database = null;
  initialization = null;
  if (pool) await pool.promise().end();
}

/** Opens a connection only. Schema changes are exclusively Drizzle migrations. */
export async function getV2Db() {
  if (!database && process.env.V2_DATABASE_URL) {
    initialization ??= connectV2Database();
    try {
      await initialization;
    } catch (error) {
      database = null;
      initialization = null;
      throw error;
    }
  }

  if (!database) throw new Error("Banco V2 indisponível");
  return database;
}
