import mysql from "mysql2/promise";

export type V2DatabaseProvisionConfig = {
  sourceUrl: string;
  databaseName: string;
};

/**
 * Database provisioning is deliberately a separate, explicit command. It is
 * not part of application startup and it only issues CREATE DATABASE IF NOT
 * EXISTS for the already validated V2 database name.
 */
export function readV2DatabaseProvisionConfig(
  environment: NodeJS.ProcessEnv = process.env
): V2DatabaseProvisionConfig {
  const sourceUrl = environment.V2_DATABASE_URL;
  const databaseName = environment.V2_APP_DATABASE?.trim();
  if (!sourceUrl) throw new Error("V2_DATABASE_URL não configurada");
  if (!databaseName || !/^[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error("V2_APP_DATABASE inválida ou não configurada");
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error("V2_DATABASE_URL inválida");
  }
  if (parsed.protocol !== "mysql:") {
    throw new Error("V2_DATABASE_URL deve utilizar o protocolo mysql");
  }

  return { sourceUrl, databaseName };
}

export async function provisionV2Database(
  config = readV2DatabaseProvisionConfig()
) {
  const connection = await mysql.createConnection({
    uri: config.sourceUrl,
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });
  try {
    // databaseName is constrained to alphanumeric/underscore before quoting.
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.databaseName}\``
    );
    return { databaseName: config.databaseName, createdOrAlreadyExists: true };
  } finally {
    await connection.end();
  }
}
