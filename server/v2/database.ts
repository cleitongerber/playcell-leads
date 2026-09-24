import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2";
import * as schema from "../../drizzle-v2/schema";

export type V2Database = ReturnType<typeof drizzle<typeof schema>>;

let database: V2Database | null = null;
let initialization: Promise<void> | null = null;

function getV2DatabaseUrl() {
  // V2 never falls back to the V1 connection. This guard prevents a future
  // V2 process from accidentally pointing its migration-ready code at V1.
  const sourceUrl = process.env.V2_DATABASE_URL;
  if (!sourceUrl) throw new Error("V2_DATABASE_URL não configurada");

  const targetDatabase = process.env.V2_APP_DATABASE?.trim();
  if (!targetDatabase || !/^[a-zA-Z0-9_]+$/.test(targetDatabase)) {
    throw new Error("V2_APP_DATABASE inválido ou não configurado");
  }

  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${targetDatabase}`;
  return targetUrl.toString();
}

async function connectV2Database() {
  const pool = mysql.createPool({
    uri: getV2DatabaseUrl(),
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });

  try {
    database = drizzle(pool, { schema, mode: "default" });
  } catch (error) {
    await pool.promise().end();
    throw error;
  }
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
