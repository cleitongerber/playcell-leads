import type {
  FollowUpNotificationDeliveryStatus,
  FollowUpNotificationStage,
} from "../../drizzle-v2/schema";

export const FOLLOW_UP_NOTIFICATION_TIMEZONE = "America/Sao_Paulo";
export const FOLLOW_UP_NOTIFICATION_TOLERANCE_MS = 7 * 60 * 1000;

type LocalTime = { weekday: number; hour: number; minute: number };

function localTimeAt(date: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  const weekday = value("weekday");
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    weekday: weekdays[weekday ?? ""] ?? -1,
    hour: Number(value("hour") ?? NaN),
    minute: Number(value("minute") ?? NaN),
  };
}

/** Start is inclusive; end is exclusive. Sunday never has a delivery window. */
export function isWithinFollowUpNotificationWindow(
  instant: Date,
  timeZone = FOLLOW_UP_NOTIFICATION_TIMEZONE
) {
  const local = localTimeAt(instant, timeZone);
  if (local.weekday === 0) return false;
  const minutes = local.hour * 60 + local.minute;
  const closesAt = local.weekday === 6 ? 13 * 60 : 19 * 60;
  return minutes >= 8 * 60 && minutes < closesAt;
}

export function scheduledForFollowUpStage(
  dueAt: Date,
  stage: FollowUpNotificationStage
) {
  const offset = stage === "PRE30" ? -30 : stage === "LATE60" ? 60 : 0;
  return new Date(dueAt.getTime() + offset * 60 * 1000);
}

export function eligibleFollowUpNotificationStages(input: {
  dueAt: Date;
  now: Date;
  timeZone?: string;
}) {
  const timeZone = input.timeZone ?? FOLLOW_UP_NOTIFICATION_TIMEZONE;
  return (["PRE30", "DUE", "LATE60"] as const).flatMap(stage => {
    const scheduledFor = scheduledForFollowUpStage(input.dueAt, stage);
    const eligibleUntil = new Date(
      scheduledFor.getTime() + FOLLOW_UP_NOTIFICATION_TOLERANCE_MS
    );
    if (
      !isWithinFollowUpNotificationWindow(scheduledFor, timeZone) ||
      input.now < scheduledFor ||
      input.now >= eligibleUntil
    )
      return [];
    return [{ stage, scheduledFor, eligibleUntil }];
  });
}

export function terminalFollowUpNotificationStatus(
  status: FollowUpNotificationDeliveryStatus
) {
  return status !== "pending" && status !== "sending";
}

/** Fail closed. Partner enablement is intentionally future-facing until dispatch exists. */
export function followUpNotificationAutomationEnabled(
  environment: NodeJS.ProcessEnv = process.env,
  partnerSettings?: { webPushFollowUpAutomationEnabled?: unknown } | null
) {
  return (
    environment.WEB_PUSH_FOLLOW_UP_AUTOMATION_ENABLED === "true" &&
    partnerSettings?.webPushFollowUpAutomationEnabled === true
  );
}
