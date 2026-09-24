type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsAt(date: Date, timeZone: string): Parts {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) =>
    Number(values.find(value => value.type === type)?.value ?? 0);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function zonedLocalToUtc(parts: Parts, timeZone: string) {
  const provisional = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const actual = partsAt(new Date(provisional), timeZone);
  const offset =
    Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    ) - provisional;
  return new Date(provisional - offset);
}

/** Business-day interval belongs to partner_settings.timezone, not browser time. */
export function partnerDayBounds(timeZone: string, now = new Date()) {
  const local = partsAt(now, timeZone);
  const startParts = { ...local, hour: 0, minute: 0, second: 0 };
  const tomorrow = new Date(
    Date.UTC(local.year, local.month - 1, local.day + 1)
  );
  const endParts: Parts = {
    year: tomorrow.getUTCFullYear(),
    month: tomorrow.getUTCMonth() + 1,
    day: tomorrow.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
  return {
    start: zonedLocalToUtc(startParts, timeZone),
    end: zonedLocalToUtc(endParts, timeZone),
    timeZone,
  };
}
