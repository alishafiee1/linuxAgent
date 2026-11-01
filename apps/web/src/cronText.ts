import type { Dict } from "./i18n";

export type Freq = "hourly" | "daily" | "weekly" | "monthly" | "custom" | "webhook";

export interface CronForm {
  freq: Freq;
  everyHours: number;
  minute: number;
  time: string;
  days: number[];
  dayOfMonth: number;
  cron: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const parts = (time: string): [number, number] => {
  const [h, m] = time.split(":").map(Number);
  return [h ?? 0, m ?? 0];
};

/** The form's choices as a schedule. The server still validates the result. */
export function buildCron(f: CronForm): string {
  const [h, m] = parts(f.time);
  switch (f.freq) {
    case "hourly":
      return f.everyHours <= 1 ? `${f.minute} * * * *` : `${f.minute} */${f.everyHours} * * *`;
    case "daily":
      return `${m} ${h} * * *`;
    case "weekly":
      return `${m} ${h} * * ${[...f.days].sort((a, b) => a - b).join(",") || "*"}`;
    case "monthly":
      return `${m} ${h} ${f.dayOfMonth} * *`;
    default:
      return f.cron.trim();
  }
}

/** Reads a schedule back into the simple form. Anything it cannot represent stays custom. */
export function classifyCron(cron: string): Partial<CronForm> {
  const custom = { freq: "custom" as Freq, cron };
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return custom;
  const [mi, h, dom, mon, dow] = f as [string, string, string, string, string];
  if (!/^\d+$/.test(mi) || mon !== "*") return custom;
  const minute = Number(mi);
  if (dom === "*" && dow === "*") {
    if (h === "*") return { freq: "hourly", everyHours: 1, minute };
    const every = /^\*\/(\d+)$/.exec(h);
    if (every) return { freq: "hourly", everyHours: Number(every[1]), minute };
  }
  if (!/^\d+$/.test(h)) return custom;
  const time = `${pad(Number(h))}:${pad(minute)}`;
  if (dom === "*" && dow === "*") return { freq: "daily", time };
  if (dom === "*" && /^\d(,\d)*$/.test(dow)) return { freq: "weekly", time, days: dow.split(",").map((d) => Number(d) % 7) };
  if (/^\d+$/.test(dom) && dow === "*") return { freq: "monthly", time, dayOfMonth: Number(dom) };
  return custom;
}

/** A schedule in words. What it cannot say simply is shown as written, never guessed. */
export function describeCron(cron: string, t: Dict, locale: string): string {
  const c = classifyCron(cron);
  const num = (n: number): string => n.toLocaleString(locale);
  const clock = (time: string): string => {
    const [h, m] = parts(time);
    return `${num(h).padStart(2, num(0))}:${num(m).padStart(2, num(0))}`;
  };
  switch (c.freq) {
    case "hourly":
      return c.everyHours === 1 ? t.rt.everyHour : t.rt.everyNHours.replace("{n}", num(c.everyHours!));
    case "daily":
      return t.rt.everyDayAt.replace("{time}", clock(c.time!));
    case "weekly": {
      const order = [6, 0, 1, 2, 3, 4, 5].filter((d) => c.days!.includes(d));
      return t.rt.everyDaysAt.replace("{days}", order.map((d) => t.rt.weekdays[d]).join("، ")).replace("{time}", clock(c.time!));
    }
    case "monthly":
      return t.rt.monthlyAt.replace("{d}", num(c.dayOfMonth!)).replace("{time}", clock(c.time!));
    default:
      return `${t.rt.customSchedule}: ⁦${cron}⁩`;
  }
}
