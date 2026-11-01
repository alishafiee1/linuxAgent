import type { BrowserPayload, ConnectionPayload, PlatformInfo, Question, QuestionsPayload, RequestAnswer, RequestKind, RequestPayload, UserRequest } from "@linux-agent/shared";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { ConnectForm, CustomForm } from "./connections";
import { IconCheck, IconGlobe, IconShield, IconX } from "./icons";
import { useT } from "./i18n";
import { LiveBrowser } from "./pagesExt";

function QuestionField({ q, value, onChange }: { q: Question; value: { picked: string[]; other: string }; onChange: (v: { picked: string[]; other: string }) => void }) {
  const { t } = useT();
  const multi = q.multiSelect === true;
  return (
    <fieldset className="q-field">
      <legend dir="auto">{q.question}</legend>
      <div className="q-options">
        {q.options.map((o) => {
          const on = value.picked.includes(o.label);
          return (
            <label key={o.label} className={`q-option${on ? " on" : ""}`}>
              <input
                type={multi ? "checkbox" : "radio"}
                checked={on}
                onChange={() =>
                  onChange(multi ? { ...value, picked: on ? value.picked.filter((x) => x !== o.label) : [...value.picked, o.label] } : { picked: [o.label], other: "" })
                }
              />
              <span>
                <span dir="auto">{o.label}</span>
                {o.description && (
                  <small className="muted" dir="auto">
                    {o.description}
                  </small>
                )}
              </span>
            </label>
          );
        })}
      </div>
      <input
        dir="auto"
        placeholder={t.otherAnswer}
        aria-label={`${q.question}: ${t.otherAnswer}`}
        value={value.other}
        onChange={(e) => onChange({ picked: multi ? value.picked : [], other: e.target.value })}
      />
    </fieldset>
  );
}

function QuestionsForm({ id, payload, onDone }: { id: string; payload: QuestionsPayload; onDone: () => void }) {
  const { t } = useT();
  const [values, setValues] = useState<Record<string, { picked: string[]; other: string }>>({});
  const [error, setError] = useState("");
  const get = (q: Question) => values[q.question] ?? { picked: [], other: "" };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const answers: RequestAnswer["answers"] = {};
    for (const q of payload.questions) {
      const v = get(q);
      answers[q.question] = [...v.picked, ...(v.other.trim() ? [v.other.trim()] : [])];
      if (!answers[q.question]!.length) return setError(`${t.answerThis}: ${q.question}`);
    }
    setError("");
    try {
      await api.post(`/api/requests/${id}/answer`, { answers });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="q-form">
      {payload.questions.map((q) => (
        <QuestionField key={q.question} q={q} value={get(q)} onChange={(v) => setValues({ ...values, [q.question]: v })} />
      ))}
      {error && <div className="err">{error}</div>}
      <div className="row">
        <button className="primary">
          <IconCheck size={16} />
          {t.sendAnswer}
        </button>
        <button type="button" className="ghost" onClick={() => void api.post(`/api/requests/${id}/cancel`).then(onDone, () => {})}>
          {t.notNow}
        </button>
      </div>
    </form>
  );
}

function ConnectionRequest({ id, payload, onDone }: { id: string; payload: ConnectionPayload; onDone: () => void }) {
  const { t } = useT();
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const finish = useCallback(() => void api.post(`/api/requests/${id}/answer`, { done: true }).then(onDone, onDone), [id, onDone]);
  useEffect(() => {
    if (payload.platform) void api.get<PlatformInfo[]>("/api/platforms").then((l) => setPlatform(l.find((p) => p.id === payload.platform) ?? null), () => {});
  }, [payload.platform]);
  return (
    <div className="q-form">
      <p dir="auto" style={{ margin: 0 }}>
        {payload.reason}
      </p>
      {payload.platform ? platform && <ConnectForm platform={platform} onConnected={finish} /> : <CustomForm initial={payload} onConnected={finish} />}
      <div className="row">
        {platform?.kind === "google" && <button onClick={finish}>{t.iConnected}</button>}
        <button className="ghost" onClick={() => void api.post(`/api/requests/${id}/cancel`).then(onDone, () => {})}>
          {t.notNow}
        </button>
      </div>
      <p className="muted secret-note">
        <IconShield size={13} />
        {t.secretNote}
      </p>
    </div>
  );
}

function BrowserRequest({ id, botId, payload, onDone }: { id: string; botId: string; payload: BrowserPayload; onDone: () => void }) {
  const { t } = useT();
  return (
    <div className="q-form">
      <p dir="auto" style={{ margin: 0 }}>
        {payload.reason}
      </p>
      <LiveBrowser botId={botId} vault={null} />
      <div className="row">
        <button className="primary" onClick={() => void api.post(`/api/requests/${id}/answer`, { done: true }).then(onDone, () => {})}>
          <IconCheck size={16} />
          {t.takeoverDone}
        </button>
        <button className="ghost danger" onClick={() => void api.post(`/api/requests/${id}/cancel`).then(onDone, () => {})}>
          <IconX size={15} />
          {t.notNow}
        </button>
      </div>
    </div>
  );
}

/** One card, in chat or on the approvals page, for whatever a bot needs from the person. */
export function RequestCard({ id, botId, botName, kind, payload, onDone }: { id: string; botId: string; botName?: string; kind: RequestKind; payload: RequestPayload; onDone: () => void }) {
  const { t } = useT();
  const title = kind === "questions" ? t.requestQuestions : kind === "connection" ? t.requestConnection : t.requestBrowser;
  const Icon = kind === "questions" ? IconShield : IconGlobe;
  return (
    <div className="approval request-card" role="alert">
      <div className="approval-head">
        <span className="approval-ic">
          <Icon size={18} />
        </span>
        <strong>{title}</strong>
        {botName && <span className="muted">· {botName}</span>}
      </div>
      {kind === "questions" && <QuestionsForm id={id} payload={payload as QuestionsPayload} onDone={onDone} />}
      {kind === "connection" && <ConnectionRequest id={id} payload={payload as ConnectionPayload} onDone={onDone} />}
      {kind === "browser" && <BrowserRequest id={id} botId={botId} payload={payload as BrowserPayload} onDone={onDone} />}
    </div>
  );
}

export function PendingRequests({ activityTick }: { activityTick: number }) {
  const [list, setList] = useState<UserRequest[]>([]);
  const load = useCallback(() => api.get<UserRequest[]>("/api/requests").then(setList, () => {}), []);
  useEffect(() => void load(), [load, activityTick]);
  if (!list.length) return null;
  return (
    <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
      {list.map((r) => (
        <RequestCard key={r.id} id={r.id} botId={r.botId} botName={r.botName} kind={r.kind} payload={r.payload} onDone={() => void load()} />
      ))}
    </div>
  );
}
