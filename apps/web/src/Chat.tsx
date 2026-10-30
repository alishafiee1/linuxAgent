import type { Bot, Conversation, Run, RunEvent } from "@linux-agent/shared";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "./api";
import { useT } from "./i18n";

const ACTIVE = new Set(["queued", "running", "waiting_approval", "waiting_limit"]);

export function Chat({ bot, activityTick }: { bot: Bot; activityTick: number }) {
  const { t } = useT();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const list = await api.get<Conversation[]>(`/api/bots/${bot.id}/conversations`);
    setConversations(list);
    setConvId((cur) => (cur && list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? null)));
  }, [bot.id]);

  const loadRuns = useCallback(async () => {
    if (!convId) return setRuns([]);
    const r = await api.get<{ runs: Run[] }>(`/api/conversations/${convId}`);
    setRuns(r.runs);
  }, [convId]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);
  useEffect(() => {
    void loadRuns();
  }, [loadRuns, activityTick]);

  const newConversation = async () => {
    const c = await api.post<Conversation>(`/api/bots/${bot.id}/conversations`, {});
    await loadConversations();
    setConvId(c.id);
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    setError("");
    try {
      let id = convId;
      if (!id) {
        const c = await api.post<Conversation>(`/api/bots/${bot.id}/conversations`, { title: text.slice(0, 60) });
        id = c.id;
        await loadConversations();
        setConvId(id);
      }
      await api.post(`/api/conversations/${id}/messages`, { text });
      setText("");
      await loadRuns();
      setTimeout(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="chat">
      <div className="chat-head">
        <span className="avatar">{bot.name.slice(0, 1).toUpperCase()}</span>
        <strong>{bot.name}</strong>
        <span className="spacer" />
        <select value={convId ?? ""} onChange={(e) => setConvId(e.target.value || null)}>
          {conversations.length === 0 && <option value="">{t.newConversation}</option>}
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button onClick={() => void newConversation()}>+ {t.newConversation}</button>
      </div>
      <div className="messages">
        {runs.map((r) => (
          <RunView key={r.id} run={r} onChanged={loadRuns} />
        ))}
        <div ref={bottom} />
      </div>
      <div className="composer">
        <form onSubmit={send}>
          <textarea rows={2} value={text} placeholder={t.messagePlaceholder} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
          <button className="primary" disabled={!text.trim()}>
            {t.send}
          </button>
        </form>
        {error && <div className="err" style={{ textAlign: "center" }}>{error}</div>}
      </div>
    </div>
  );
}

/** Loads a run's stored events and, while the run is active, follows the live stream (resumes by seq). */
function useRunEvents(run: Run): RunEvent[] {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const active = ACTIVE.has(run.state);
  useEffect(() => {
    let last = 0;
    const add = (evs: RunEvent[]) => {
      const fresh = evs.filter((e) => e.seq > last);
      if (!fresh.length) return;
      last = fresh[fresh.length - 1]!.seq;
      setEvents((cur) => [...cur, ...fresh]);
    };
    setEvents([]);
    if (!active) {
      void api.get<RunEvent[]>(`/api/runs/${run.id}/events?limit=5000`).then(add);
      return;
    }
    const es = new EventSource(`/api/runs/${run.id}/stream?after=0`);
    es.onmessage = (m) => add([JSON.parse(m.data) as RunEvent]);
    return () => es.close();
  }, [run.id, active]);
  return events;
}

function ToolCard({ name, input, result, isError }: { name: string; input: unknown; result?: string; isError?: boolean }) {
  const { t } = useT();
  const summary = typeof input === "object" && input && "command" in input ? String((input as { command: unknown }).command) : typeof input === "object" && input && "file_path" in input ? String((input as { file_path: unknown }).file_path) : "";
  return (
    <details className={`tool card ${isError ? "error" : ""}`}>
      <summary>
        <code>{name}</code>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "ltr" }}>{summary.slice(0, 120)}</span>
      </summary>
      <div className="body">
        <div className="muted">{t.tool}</div>
        <pre>{JSON.stringify(input, null, 2)}</pre>
        {result !== undefined && (
          <>
            <div className="muted" style={{ marginTop: 8 }}>
              {t.result}
            </div>
            <pre>{result}</pre>
          </>
        )}
      </div>
    </details>
  );
}

function ApprovalCard({ payload }: { payload: { approvalId: string; toolName: string; input: unknown; reason: string } }) {
  const { t } = useT();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const decide = async (allow: boolean) => {
    try {
      await api.post(`/api/approvals/${payload.approvalId}/decide`, { allow });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="approval">
      <strong>{payload.reason}</strong>
      <pre>{JSON.stringify(payload.input, null, 2)}</pre>
      {!done && (
        <div className="row">
          <button className="primary" onClick={() => void decide(true)}>
            {t.allow}
          </button>
          <button className="danger" onClick={() => void decide(false)}>
            {t.deny}
          </button>
        </div>
      )}
      {error && <div className="err">{error}</div>}
    </div>
  );
}

function RunView({ run, onChanged }: { run: Run; onChanged: () => void }) {
  const { t } = useT();
  const events = useRunEvents(run);
  const results = new Map<string, { content: string; isError: boolean }>();
  for (const e of events) if (e.type === "tool_result") {
    const p = e.payload as { toolUseId: string; content: string; isError: boolean };
    results.set(p.toolUseId, p);
  }
  const decided = new Set(events.filter((e) => e.type === "approval" && (e.payload as { state: string }).state !== "pending").map((e) => (e.payload as { approvalId: string }).approvalId));
  const lastState = [...events].reverse().find((e) => e.type === "state")?.payload as { state: string; message?: string | null; limitResetAt?: string | null } | undefined;
  const state = lastState?.state ?? run.state;

  return (
    <>
      {events.map((e) => {
        const p = e.payload as Record<string, unknown>;
        switch (e.type) {
          case "user":
            return (
              <div key={e.seq} className="msg">
                <div className="bubble user">{String(p.text)}</div>
              </div>
            );
          case "assistant_text":
            return (
              <div key={e.seq} className="msg">
                <div className="bubble assistant">{String(p.text)}</div>
              </div>
            );
          case "tool_use": {
            const r = results.get(String(p.id));
            return (
              <div key={e.seq} className="msg">
                <ToolCard name={String(p.name)} input={p.input} result={r?.content} isError={r?.isError} />
              </div>
            );
          }
          case "approval":
            if (p.state === "pending" && !decided.has(String(p.approvalId)) && state === "waiting_approval")
              return (
                <div key={e.seq} className="msg">
                  <ApprovalCard payload={p as never} />
                </div>
              );
            if (p.state !== "pending")
              return (
                <div key={e.seq} className="msg state">
                  {String(p.toolName)}: {t.approvalStates[String(p.state)] ?? String(p.state)} ({t.channels[String(p.channel)] ?? ""})
                </div>
              );
            return null;
          case "error":
            return (
              <div key={e.seq} className="msg err">
                {String(p.message)}
              </div>
            );
          default:
            return null;
        }
      })}
      <div className={`msg state ${state}`}>
        {t.states[state] ?? state}
        {state === "waiting_limit" && lastState?.limitResetAt && ` · ${t.limitBanner} ${new Date(lastState.limitResetAt).toLocaleTimeString()}`}
        {lastState?.message ? ` · ${lastState.message}` : ""}
        {ACTIVE.has(state) && (
          <>
            {" "}
            <button className="ghost danger" onClick={() => void api.post(`/api/runs/${run.id}/cancel`).then(onChanged)}>
              {t.stop}
            </button>
          </>
        )}
        {(state === "interrupted" || state === "failed") && (
          <>
            {" "}
            <button className="ghost" onClick={() => void api.post(`/api/runs/${run.id}/continue`).then(onChanged)}>
              {t.continue}
            </button>
          </>
        )}
      </div>
    </>
  );
}
