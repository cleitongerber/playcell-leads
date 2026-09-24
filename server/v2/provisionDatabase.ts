import mysql from "mysql2/promise";
import { readV2ConnectionConfig } from "./connectionConfig";

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
  const connection = readV2ConnectionConfig(environment);
  return {
    sourceUrl: connection.sourceUrl,
    databaseName: connection.databaseName,
  };
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
