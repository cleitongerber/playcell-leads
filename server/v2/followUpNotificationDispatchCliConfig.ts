import { readV2ConnectionConfig } from "./connectionConfig";
import type { SyntheticPushOutcome } from "./followUpNotificationSyntheticTransport";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SYNTHETIC_DATABASE = /^[a-z0-9_]*(?:_test|_synthetic)$/i;

export type SyntheticDispatchCliConfig = {
  mode: "inspect" | "run";
  batchSize: number;
  outcome: SyntheticPushOutcome;
  /** Test-only clock, accepted only after the synthetic database checks pass. */
  now?: Date;
};

export function readSyntheticDispatchCliConfig(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env
): SyntheticDispatchCliConfig {
  if (environment.NODE_ENV === "production")
    throw new Error("O dispatcher sintético não pode executar em produção.");
  if (environment.V2_ALLOW_SYNTHETIC_FOLLOW_UP_DISPATCH !== "true")
    throw new Error("Confirmação de dispatcher sintético ausente.");
  const connection = readV2ConnectionConfig(environment);
  if (!LOCAL_HOSTS.has(connection.host.toLowerCase()))
    throw new Error("O dispatcher sintético exige banco em loopback.");
  if (
    !SYNTHETIC_DATABASE.test(connection.databaseName) ||
    environment.V2_SYNTHETIC_DISPATCH_DATABASE !== connection.databaseName
  )
    throw new Error("O database sintético explicitamente autorizado não confere.");

  const mode = argv.includes("--run") ? "run" : argv.includes("--inspect") ? "inspect" : null;
  if (!mode || (argv.includes("--run") && argv.includes("--inspect")))
    throw new Error("Use exatamente um modo: --inspect ou --run.");
  if (mode === "run" && environment.V2_SYNTHETIC_FOLLOW_UP_DISPATCH_RUN_ENABLED !== "true")
    throw new Error("Confirmação de processamento sintético ausente.");

  const rawBatch = argv.find(value => value.startsWith("--batch="))?.slice(8) ?? "25";
  const batchSize = Number(rawBatch);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
    throw new Error("--batch deve ser um inteiro entre 1 e 100.");
  const rawOutcome = argv.find(value => value.startsWith("--simulate="))?.slice(11) ?? "accepted";
  if (!(["accepted", "transient", "timeout", "gone", "not_found"] as const).includes(rawOutcome as SyntheticPushOutcome))
    throw new Error("--simulate inválido.");
  const rawNow = argv.find(value => value.startsWith("--at="))?.slice(5);
  const now = rawNow ? new Date(rawNow) : undefined;
  if (rawNow && Number.isNaN(now?.getTime()))
    throw new Error("--at deve ser um instante ISO-8601 válido.");
  return { mode, batchSize, outcome: rawOutcome as SyntheticPushOutcome, now };
}
