const DATABASE_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export type V2ConnectionConfig = {
  sourceUrl: string;
  databaseName: string;
  targetUrl: string;
  host: string;
  port: number;
  user: string;
  password: string;
};

/**
 * Resolves a connection exclusively from the V2 variables.  The parsed
 * credentials let Drizzle Kit receive an explicit TLS configuration instead
 * of relying on vendor-specific URL query parameters.
 */
export function readV2ConnectionConfig(
  environment: NodeJS.ProcessEnv = process.env
): V2ConnectionConfig {
  const sourceUrl = environment.V2_DATABASE_URL;
  if (!sourceUrl) throw new Error("V2_DATABASE_URL não configurada");

  const databaseName = environment.V2_APP_DATABASE?.trim();
  if (!databaseName || !DATABASE_NAME_PATTERN.test(databaseName)) {
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
  if (!parsed.hostname) {
    throw new Error("V2_DATABASE_URL deve informar um host");
  }

  const target = new URL(parsed);
  target.pathname = `/${databaseName}`;

  return {
    sourceUrl,
    databaseName,
    targetUrl: target.toString(),
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
}

/**
 * Drizzle Kit's URL-only MySQL credentials omit the TLS settings supplied by
 * TiDB Cloud. Passing structured credentials makes TLS mandatory for every
 * migration connection.
 */
export function getV2DrizzleCredentials(
  environment: NodeJS.ProcessEnv = process.env
) {
  const config = readV2ConnectionConfig(environment);
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.databaseName,
    ssl: { rejectUnauthorized: true },
  };
}
