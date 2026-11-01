// Five-field cron without a dependency: minute hour day-of-month month day-of-week.
// Times are read in the routine's own timezone, so "0 8 * * *" means 08:00 in Tehran.

export class CronError extends Error {}

const RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function parseField(field: string, [min, max]: [number, number]): Set<number> | null {
  if (field === "*") return null;
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new CronError(`بخش نامعتبر: ${part}`);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new CronError(`گام نامعتبر: ${part}`);
    let from = min;
    let to = max;
    if (m[1] !== "*") {
      const [a, b] = m[1]!.split("-").map(Number) as [number, number | undefined];
      from = a;
      to = b ?? (m[2] === undefined ? a : max);
    }
    if (from < min || to > max || from > to) throw new CronError(`خارج از بازه: ${part}`);
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

export interface Cron {
  minute: Set<number> | null;
  hour: Set<number> | null;
  dom: Set<number> | null;
  month: Set<number> | null;
  dow: Set<number> | null;
}

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new CronError("زمان‌بندی باید پنج بخش داشته باشد، مثل 0 8 * * *");
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, RANGES[i]!)) as [Cron["minute"], Cron["hour"], Cron["dom"], Cron["month"], Cron["dow"]];
  if (dow?.delete(7)) dow.add(0);
  return { minute, hour, dom, month, dow };
}

function localParts(at: number, timezone: string): { minute: number; hour: number; dom: number; month: number; dow: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    minute: "numeric",
    hour: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "short",
  }).formatToParts(new Date(at));
  const get = (t: string): string => parts.find((p) => p.type === t)!.value;
  return {
    minute: Number(get("minute")),
    hour: Number(get("hour")),
    dom: Number(get("day")),
    month: Number(get("month")),
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  };
}

const has = (set: Set<number> | null, v: number): boolean => set === null || set.has(v);

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** The first matching minute strictly after `from` (ms), or null if none within about two years. */
export function nextCron(cron: Cron, from: number, timezone: string): number | null {
  const MIN = 60_000;
  let t = Math.floor(from / MIN) * MIN + MIN;
  const end = from + 2 * 366 * 86_400_000;
  while (t < end) {
    const p = localParts(t, timezone);
    // Standard cron: when both day fields are restricted, either one matches.
    const dayOk = cron.dom && cron.dow ? cron.dom.has(p.dom) || cron.dow.has(p.dow) : has(cron.dom, p.dom) && has(cron.dow, p.dow);
    if (!dayOk || !has(cron.month, p.month) || !has(cron.hour, p.hour)) t += (60 - p.minute) * MIN;
    else if (!has(cron.minute, p.minute)) t += MIN;
    else return t;
  }
  return null;
}
