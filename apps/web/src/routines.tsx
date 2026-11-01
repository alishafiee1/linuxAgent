import type { Bot, Routine, RoutinePreview } from "@linux-agent/shared";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import { IconBot, IconCheck, IconClock, IconPencil, IconPlay, IconPlus, IconTrash, IconX } from "./icons";
import { useT } from "./i18n";
import { buildCron, classifyCron, describeCron, type CronForm, type Freq } from "./cronText";

const TIMEZONES = ["Asia/Tehran", "Asia/Dubai", "Asia/Istanbul", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "UTC", "America/New_York", "America/Los_Angeles"];
const WEEK = [6, 0, 1, 2, 3, 4, 5];
const DAY_MS = 86_400_000;

type Filter = "all" | "mine" | "bots";

function useClock(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(tick);
  }, [ms]);
  return now;
}

function relative(at: string, now: number, t: ReturnType<typeof useT>["t"], locale: string): string {
  const minutes = Math.round((Date.parse(at) - now) / 60_000);
  const abs = Math.abs(minutes);
  if (abs < 1) return t.rt.momentNow;
  const n = (v: number): string => v.toLocaleString(locale);
  const text = abs < 60 ? `${n(abs)} ${t.rt.minutes}` : abs < 1440 ? `${n(Math.floor(abs / 60))} ${t.rt.hours}${abs % 60 ? ` ${t.rt.and} ${n(abs % 60)} ${t.rt.minutes}` : ""}` : `${n(Math.floor(abs / 1440))} ${t.rt.days}`;
  return minutes > 0 ? t.rt.inFuture.replace("{x}", text) : t.rt.inPast.replace("{x}", text);
}

function when(at: string, timezone: string, now: number, t: ReturnType<typeof useT>["t"], locale: string): string {
  const day = (ms: number): string => new Date(ms).toLocaleDateString("en-CA", { timeZone: timezone });
  const time = new Date(at).toLocaleTimeString(locale, { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });
  const target = Date.parse(at);
  if (day(target) === day(now)) return `${t.rt.today} ${time}`;
  if (day(target) === day(now + DAY_MS)) return `${t.rt.tomorrow} ${time}`;
  return `${new Date(at).toLocaleDateString(locale, { timeZone: timezone, weekday: "long" })} ${time}`;
}

/** Runs close together share one mark, so a routine every few minutes stays readable. */
function Timeline({ routines, onPick }: { routines: Routine[]; onPick: (id: string) => void }) {
  const { t, locale } = useT();
  const now = useClock(60_000);
  const runs = routines
    .filter((r) => r.enabled)
    .flatMap((r) => r.upcoming.map((at) => ({ r, at: Date.parse(at) })))
    .filter((x) => x.at > now && x.at <= now + DAY_MS)
    .sort((a, b) => a.at - b.at);
  const marks: { left: number; items: typeof runs }[] = [];
  for (const run of runs) {
    const left = ((run.at - now) / DAY_MS) * 100;
    const last = marks[marks.length - 1];
    if (last && left - last.left < 1.2) last.items.push(run);
    else marks.push({ left, items: [run] });
  }
  const ticks: { left: number; label: string }[] = [];
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  for (let h = 1; h <= 24; h++) {
    const at = start.getTime() + h * 3_600_000;
    const d = new Date(at);
    if (at <= now + DAY_MS && d.getHours() % 4 === 0) ticks.push({ left: ((at - now) / DAY_MS) * 100, label: d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false }) });
  }
  return (
    <section className="card rt-panel">
      <div className="rt-panel-head">
        <h3>{t.rt.next24}</h3>
        <span className="rt-legend">
          <i className="rt-dot mine" />
          {t.rt.you}
          <i className="rt-dot bot" />
          {t.rt.botMade}
        </span>
      </div>
      {marks.length === 0 ? (
        <p className="muted rt-empty-line">{t.rt.noRuns24}</p>
      ) : (
        <div className="rt-tl-wrap">
          <div className="rt-tl" dir="ltr">
            <div className="rt-tl-track" />
            <span className="rt-tl-now" />
            {ticks.map((k) => (
              <span key={k.left} className="rt-tl-tick" style={{ left: `${k.left}%` }}>
                {k.label}
              </span>
            ))}
            {marks.map((m) => {
              const first = m.items[0]!;
              const title = [...new Set(m.items.map((i) => i.r.name))].join("، ");
              const time = new Date(first.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
              const label = `${title} · ${time}${m.items.length > 1 ? ` · ${m.items.length.toLocaleString(locale)}` : ""}`;
              return <button key={first.at} type="button" className={`rt-tl-mark ${first.r.createdBy ? "bot" : "mine"}`} style={{ left: `${m.left}%` }} title={label} aria-label={label} onClick={() => onPick(first.r.id)} />;
            })}
          </div>
        </div>
      )}
    </section>
  );
}

const defaultForm = (botId: string): CronFormState => ({
  name: "",
  botId,
  prompt: "",
  timezone: "Asia/Tehran",
  deliver: ["bale", "telegram"],
  freq: "daily",
  everyHours: 1,
  minute: 0,
  time: "08:00",
  days: [6],
  dayOfMonth: 1,
  cron: "0 8 * * *",
});

interface CronFormState extends CronForm {
  name: string;
  botId: string;
  prompt: string;
  timezone: string;
  deliver: string[];
}

function RoutineDialog({ bots, routine, onClose, onSaved }: { bots: Bot[]; routine: Routine | null; onClose: () => void; onSaved: (token: string | null) => void }) {
  const { t, locale } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<CronFormState>(() => {
    const base = defaultForm(routine?.botId ?? bots[0]?.id ?? "");
    if (!routine) return base;
    const parsed = routine.trigger === "webhook" ? { freq: "webhook" as Freq } : classifyCron(routine.cron ?? "");
    return { ...base, ...parsed, name: routine.name, botId: routine.botId, prompt: routine.prompt, timezone: routine.timezone, deliver: routine.deliver, cron: routine.cron ?? "" };
  });
  const [preview, setPreview] = useState<RoutinePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cron = form.freq === "webhook" ? null : buildCron(form);
  const set = (p: Partial<CronFormState>) => setForm((f) => ({ ...f, ...p }));

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // The server's own parser decides, so what this form accepts is what will be saved.
  useEffect(() => {
    if (cron === null) return setPreview(null);
    const wait = setTimeout(() => {
      api.post<RoutinePreview>("/api/routines/preview", { cron, timezone: form.timezone }).then(setPreview, () => setPreview(null));
    }, 250);
    return () => clearTimeout(wait);
  }, [cron, form.timezone]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.prompt.trim()) return setError(t.rt.required);
    if (form.freq === "weekly" && !form.days.length) return setError(t.rt.pickDay);
    if (preview && !preview.valid) return setError(preview.error ?? t.rt.badCron);
    setBusy(true);
    setError("");
    const body = { botId: form.botId, name: form.name, prompt: form.prompt, timezone: form.timezone, deliver: form.deliver };
    try {
      if (routine) {
        await api.patch(`/api/routines/${routine.id}`, { ...body, ...(cron ? { cron } : {}) });
        onSaved(null);
      } else {
        const r = await api.post<{ webhookToken: string | null }>("/api/routines", { ...body, trigger: cron ? "cron" : "webhook", cron });
        onSaved(r.webhookToken);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const freqs: Freq[] = routine ? (routine.trigger === "webhook" ? ["webhook"] : ["hourly", "daily", "weekly", "monthly", "custom"]) : ["hourly", "daily", "weekly", "monthly", "custom", "webhook"];
  const zones = TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];
  return (
    <dialog ref={ref} className="rt-dialog" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="rt-dialog-head">
          <h3>{routine ? t.rt.editRoutine : t.newRoutine}</h3>
          <button type="button" className="ghost icon-btn" aria-label={t.cancel} onClick={() => ref.current?.close()}>
            <IconX size={15} />
          </button>
        </div>
        <div className="rt-dialog-body">
          {routine?.createdBy && <p className="muted rt-note">{t.rt.madeBy.replace("{bot}", routine.createdBy)}</p>}
          <label>
            {t.botName}
            <input value={form.name} dir="auto" maxLength={80} placeholder={t.rt.namePlaceholder} onChange={(e) => set({ name: e.target.value })} autoFocus />
          </label>
          <label>
            {t.bot}
            <select value={form.botId} onChange={(e) => set({ botId: e.target.value })}>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <div className="rt-field">
            <span className="rt-label">{t.rt.repeats}</span>
            <div className="rt-seg" role="group" aria-label={t.rt.repeats}>
              {freqs.map((f) => (
                <button key={f} type="button" className={form.freq === f ? "active" : ""} aria-pressed={form.freq === f} onClick={() => set({ freq: f })}>
                  {t.rt.freq[f]}
                </button>
              ))}
            </div>
            {form.freq === "hourly" && (
              <div className="rt-freq">
                {t.rt.every}
                <input type="number" min={1} max={23} value={form.everyHours} aria-label={t.rt.hours} onChange={(e) => set({ everyHours: Number(e.target.value) })} />
                {t.rt.hours}
                <span>{t.rt.atMinute}</span>
                <input type="number" min={0} max={59} value={form.minute} aria-label={t.rt.atMinute} onChange={(e) => set({ minute: Number(e.target.value) })} />
              </div>
            )}
            {form.freq === "daily" && (
              <div className="rt-freq">
                {t.rt.at}
                <input type="time" dir="ltr" value={form.time} aria-label={t.rt.at} onChange={(e) => set({ time: e.target.value })} />
              </div>
            )}
            {form.freq === "weekly" && (
              <div className="rt-freq">
                <div className="rt-days">
                  {WEEK.map((d) => (
                    <button key={d} type="button" className={form.days.includes(d) ? "on" : ""} aria-pressed={form.days.includes(d)} title={t.rt.weekdays[d]} onClick={() => set({ days: form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d] })}>
                      {t.rt.weekdays[d]!.slice(0, 1)}
                    </button>
                  ))}
                </div>
                {t.rt.at}
                <input type="time" dir="ltr" value={form.time} aria-label={t.rt.at} onChange={(e) => set({ time: e.target.value })} />
              </div>
            )}
            {form.freq === "monthly" && (
              <div className="rt-freq">
                {t.rt.onDay}
                <input type="number" min={1} max={31} value={form.dayOfMonth} aria-label={t.rt.onDay} onChange={(e) => set({ dayOfMonth: Number(e.target.value) })} />
                {t.rt.at}
                <input type="time" dir="ltr" value={form.time} aria-label={t.rt.at} onChange={(e) => set({ time: e.target.value })} />
              </div>
            )}
            {form.freq === "custom" && (
              <input className="rt-cron-input" dir="ltr" value={form.cron} placeholder="0 8 * * *" aria-label="cron" onChange={(e) => set({ cron: e.target.value })} />
            )}
            {form.freq === "webhook" && <p className="muted rt-note">{t.rt.webhookHelp}</p>}
            {cron !== null && preview && (
              <p className={`rt-note ${preview.valid ? "ok" : "err"}`} data-testid="cron-preview">
                {preview.valid ? `${describeCron(cron, t, locale)} · ${t.rt.nextRun}: ${preview.next[0] ? new Date(preview.next[0]).toLocaleString(locale, { timeZone: form.timezone }) : "—"}` : preview.error}
              </p>
            )}
          </div>
          {form.freq !== "webhook" && (
            <label>
              {t.timezone}
              <select value={form.timezone} dir="ltr" onChange={(e) => set({ timezone: e.target.value })}>
                {zones.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            {t.routinePrompt}
            <textarea rows={4} dir="auto" value={form.prompt} placeholder={t.rt.promptPlaceholder} onChange={(e) => set({ prompt: e.target.value })} />
          </label>
          <div className="rt-field">
            <span className="rt-label">{t.rt.deliverTo}</span>
            <div className="row">
              {(["bale", "telegram"] as const).map((c) => (
                <label key={c} className="check">
                  <input type="checkbox" checked={form.deliver.includes(c)} onChange={(e) => set({ deliver: e.target.checked ? [...form.deliver, c] : form.deliver.filter((x) => x !== c) })} />
                  {t.channels[c]}
                </label>
              ))}
            </div>
          </div>
          {error && <div className="err">{error}</div>}
        </div>
        <div className="rt-dialog-foot">
          <button type="button" onClick={() => ref.current?.close()}>
            {t.cancel}
          </button>
          <button className="primary" disabled={busy}>
            {t.save}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function RoutineRow({ r, now, flash, onChanged, onEdit, onOpen }: { r: Routine; now: number; flash: boolean; onChanged: () => void; onEdit: () => void; onOpen: (botId: string, conversationId: string) => void }) {
  const { t, locale } = useT();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  // The switch moves at once; on a slow link the answer can take a moment.
  const [enabled, setEnabled] = useState(r.enabled);
  useEffect(() => setEnabled(r.enabled), [r.enabled]);
  const act = (fn: () => Promise<unknown>) => {
    setError("");
    fn().then(onChanged, (e: Error) => setError(e.message));
  };
  const last = r.last;
  const tokens = last ? last.inputTokens + last.outputTokens : 0;
  const failed = last && ["failed", "cancelled", "interrupted"].includes(last.state);
  return (
    <div className={`rt-row${r.enabled ? "" : " paused"}${flash ? " flash" : ""}`} data-routine={r.id}>
      <div className="rt-cell-main">
        <span className={`rt-maker ${r.createdBy ? "bot" : "mine"}`} title={r.createdBy ? t.rt.madeBy.replace("{bot}", r.createdBy) : t.rt.madeByYou}>
          {r.createdBy ? <IconBot size={13} /> : <IconCheck size={13} />}
        </span>
        <div className="rt-min">
          <div className="rt-name" dir="auto" title={r.name}>
            {r.name}
          </div>
          <div className="rt-sub muted">
            <span dir="auto">{r.botName}</span>
            {r.cron && (
              <code dir="ltr" className="rt-chip">
                {r.cron}
              </code>
            )}
          </div>
        </div>
      </div>
      <div className="rt-min">
        <div>{r.trigger === "webhook" ? t.rt.freq.webhook : describeCron(r.cron ?? "", t, locale)}</div>
        <div className="rt-sub muted" dir="ltr" style={{ textAlign: "start" }}>
          {r.trigger === "webhook" ? "" : r.timezone}
        </div>
      </div>
      <div className="rt-min">
        <div>{r.enabled && r.nextRunAt ? when(r.nextRunAt, r.timezone, now, t, locale) : "—"}</div>
        <div className="rt-sub muted">{r.enabled ? (r.nextRunAt ? relative(r.nextRunAt, now, t, locale) : "") : t.rt.paused}</div>
      </div>
      <div className="rt-min">
        {last ? (
          <>
            <button type="button" className={`rt-last ${failed ? "bad" : last.state === "done" ? "good" : ""}`} title={t.rt.openRun} onClick={() => onOpen(r.botId, last.conversationId)}>
              {t.states[last.state] ?? last.state}
            </button>
            <div className="rt-sub muted">
              {relative(last.at, now, t, locale)}
              {tokens > 0 && ` · ${tokens.toLocaleString(locale)} ${t.rt.tokens}`}
            </div>
          </>
        ) : (
          <span className="muted">{t.rt.neverRan}</span>
        )}
      </div>
      <label className="rt-switch" title={r.enabled ? t.disable : t.enable}>
        <input
          type="checkbox"
          checked={enabled}
          aria-label={`${enabled ? t.disable : t.enable}: ${r.name}`}
          onChange={(e) => {
            const next = e.target.checked;
            setEnabled(next);
            setError("");
            api.patch(`/api/routines/${r.id}`, { enabled: next }).then(onChanged, (err: Error) => {
              setEnabled(!next);
              setError(err.message);
            });
          }}
        />
        <span />
      </label>
      <div className="rt-actions">
        {asking ? (
          <>
            <span className="err">{t.rt.deleteQ}</span>
            <button type="button" className="ghost icon-btn danger" aria-label={t.delete} onClick={() => act(() => api.del(`/api/routines/${r.id}`))}>
              <IconCheck size={14} />
            </button>
            <button type="button" className="ghost icon-btn" aria-label={t.cancel} onClick={() => setAsking(false)}>
              <IconX size={14} />
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ghost icon-btn" title={t.runNow} aria-label={`${t.runNow}: ${r.name}`} onClick={() => act(() => api.post(`/api/routines/${r.id}/run`))}>
              <IconPlay size={14} className="icon-flip" />
            </button>
            <button type="button" className="ghost icon-btn" title={t.edit} aria-label={`${t.edit}: ${r.name}`} onClick={onEdit}>
              <IconPencil size={14} />
            </button>
            <button type="button" className="ghost icon-btn danger" title={t.delete} aria-label={`${t.delete}: ${r.name}`} onClick={() => setAsking(true)}>
              <IconTrash size={14} />
            </button>
          </>
        )}
      </div>
      {error && <div className="err rt-row-error">{error}</div>}
    </div>
  );
}

export function RoutinesPage({ bots, activityTick, onOpenConversation }: { bots: Bot[]; activityTick: number; onOpenConversation: (botId: string, conversationId: string) => void }) {
  const { t, locale } = useT();
  const [list, setList] = useState<Routine[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [dialog, setDialog] = useState<{ routine: Routine | null } | null>(null);
  const [hookUrl, setHookUrl] = useState("");
  const [flash, setFlash] = useState("");
  const now = useClock(30_000);
  const load = useCallback(() => api.get<Routine[]>("/api/routines").then(setList, () => {}), []);
  useEffect(() => void load(), [load, activityTick]);

  const counts = { all: list.length, mine: list.filter((r) => !r.createdBy).length, bots: list.filter((r) => r.createdBy).length };
  const rows = list
    .filter((r) => filter === "all" || (filter === "mine" ? !r.createdBy : r.createdBy))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? "~").localeCompare(b.nextRunAt ?? "~") || a.name.localeCompare(b.name));
  const soonest = list.filter((r) => r.enabled && r.nextRunAt).sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))[0];
  const failing = list.filter((r) => r.last && ["failed", "interrupted"].includes(r.last.state)).length;

  const pick = (id: string) => {
    setFlash(id);
    document.querySelector(`[data-routine="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setFlash(""), 1300);
  };

  return (
    <div className="page rt-page">
      <div className="row">
        <h2 style={{ margin: 0 }}>{t.routines}</h2>
        <span className="spacer" />
        <button className="primary" disabled={!bots.length} onClick={() => setDialog({ routine: null })}>
          <IconPlus size={15} />
          {t.newRoutine}
        </button>
      </div>
      <p className="muted">{t.rt.help}</p>

      {hookUrl && (
        <div className="help-box">
          <strong>{t.webhookOnce}</strong>
          <code dir="ltr" className="break" data-testid="hook-url">
            {hookUrl}
          </code>
          <div className="row">
            <button onClick={() => void navigator.clipboard?.writeText(hookUrl)}>{t.rt.copy}</button>
            <button className="ghost" onClick={() => setHookUrl("")}>
              {t.rt.close}
            </button>
          </div>
        </div>
      )}

      {list.length > 0 && (
        <div className="rt-summary">
          <span>
            <IconClock size={14} />
            {t.rt.nextRun}: <strong>{soonest ? `${when(soonest.nextRunAt!, soonest.timezone, now, t, locale)} · ${soonest.name}` : "—"}</strong>
          </span>
          {failing > 0 && <span className="err">{t.rt.failing.replace("{n}", failing.toLocaleString(locale))}</span>}
        </div>
      )}

      {list.length > 0 && <Timeline routines={list} onPick={pick} />}

      <section className="card rt-panel">
        <div className="rt-panel-head">
          <h3>{t.rt.all}</h3>
          <div className="rt-seg" role="group" aria-label={t.rt.all}>
            {(["all", "mine", "bots"] as Filter[]).map((f) => (
              <button key={f} type="button" className={filter === f ? "active" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {t.rt.filter[f]} <small>{counts[f].toLocaleString(locale)}</small>
              </button>
            ))}
          </div>
        </div>
        {rows.length > 0 && (
          <div className="rt-row rt-head">
            <span>{t.rt.routine}</span>
            <span>{t.rt.schedule}</span>
            <span>{t.rt.nextRun}</span>
            <span>{t.rt.lastRun}</span>
            <span />
            <span />
          </div>
        )}
        {rows.map((r) => (
          <RoutineRow key={r.id} r={r} now={now} flash={flash === r.id} onChanged={() => void load()} onEdit={() => setDialog({ routine: r })} onOpen={onOpenConversation} />
        ))}
        {rows.length === 0 && <div className="empty slim">{list.length ? t.rt.emptyFilter : t.rt.empty}</div>}
      </section>

      {dialog && (
        <RoutineDialog
          bots={bots}
          routine={dialog.routine}
          onClose={() => setDialog(null)}
          onSaved={(token) => {
            setDialog(null);
            if (token) setHookUrl(`${location.origin}/hook/${token}`);
            void load();
          }}
        />
      )}
    </div>
  );
}
