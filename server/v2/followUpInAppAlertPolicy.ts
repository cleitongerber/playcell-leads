import type { FollowUpStatus } from "../../drizzle-v2/schema";

export type InAppFollowUpStage = "PRE30" | "DUE" | "LATE60" | "OVERDUE";
const TOLERANCE_MS = 7 * 60 * 1000;

function localWindow(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[value("weekday") ?? ""];
  const minutes = Number(value("hour")) * 60 + Number(value("minute"));
  return weekday !== 0 && minutes >= 8 * 60 && minutes < (weekday === 6 ? 13 * 60 : 19 * 60);
}

/** Current session-only alert. It never persists or schedules a notification. */
export function inAppFollowUpStage(input: {
  status: FollowUpStatus;
  dueAt: Date;
  now: Date;
  timeZone: string;
}): InAppFollowUpStage | null {
  if (input.status !== "pending" || !localWindow(input.now, input.timeZone)) return null;
  const checks: Array<[Exclude<InAppFollowUpStage, "OVERDUE">, number]> = [
    ["PRE30", -30], ["DUE", 0], ["LATE60", 60],
  ];
  for (const [stage, offsetMinutes] of checks) {
    const target = input.dueAt.getTime() + offsetMinutes * 60_000;
    if (input.now.getTime() >= target && input.now.getTime() < target + TOLERANCE_MS)
      return stage;
  }
  return input.now > input.dueAt ? "OVERDUE" : null;
}

export function overdueBand(dueAt: Date, now: Date) {
  const elapsed = Math.max(0, now.getTime() - dueAt.getTime());
  if (elapsed <= 60 * 60_000) return "upToOneHour" as const;
  if (elapsed <= 24 * 60 * 60_000) return "oneTo24Hours" as const;
  return "over24Hours" as const;
}
