import "dotenv/config";
import { abandonExpiredFollowUpNotificationClaims } from "./followUpNotificationOutbox";
import { closeV2Db, getV2Db } from "./database";
import { createFollowUpNotificationDispatcherRepository } from "./followUpNotificationDispatcherRepository";
import { dispatchFollowUpNotifications } from "./followUpNotificationDispatcher";
import { FOLLOW_UP_NOTIFICATION_TOLERANCE_MS } from "./followUpNotificationPolicy";
import { readSyntheticDispatchCliConfig } from "./followUpNotificationDispatchCliConfig";
import { createSyntheticFollowUpPushTransport } from "./followUpNotificationSyntheticTransport";

async function main() {
  const config = readSyntheticDispatchCliConfig(process.argv.slice(2));
  const db = await getV2Db();
  const repository = createFollowUpNotificationDispatcherRepository(db);
  const now = config.now ?? new Date();
  if (config.mode === "inspect") {
    const candidates = await repository.listDispatchCandidates({ now, batchSize: config.batchSize });
    console.log(JSON.stringify({ mode: "inspect", candidates: candidates.length, batchSize: config.batchSize }));
    return;
  }
  const abandoned = await abandonExpiredFollowUpNotificationClaims(
    db,
    new Date(now.getTime() - FOLLOW_UP_NOTIFICATION_TOLERANCE_MS),
    now
  );
  const result = await dispatchFollowUpNotifications({
    repository,
    transport: createSyntheticFollowUpPushTransport(config.outcome),
    now,
    batchSize: config.batchSize,
  });
  console.log(JSON.stringify({ mode: "run", transport: "synthetic", abandoned, ...result }));
}

void main()
  .catch(error => {
    console.error("[V2 synthetic follow-up dispatch] failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeV2Db();
  });
