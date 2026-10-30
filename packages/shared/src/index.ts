// API contract shared by the server and the web app.

export type RunState =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_limit"
  | "done"
  | "failed"
  | "interrupted"
  | "cancelled";

export const ACTIVE_RUN_STATES: readonly RunState[] = ["queued", "running", "waiting_approval", "waiting_limit"];

export type RunEndReason = "max_turns" | "max_minutes" | "engine_error" | "cancelled" | "restart" | null;

export interface Bot {
  id: string;
  name: string;
  slug: string;
  persona: string;
  model: string | null;
  allowedTools: string[] | null;
  maxTurns: number;
  maxMinutes: number;
  createdAt: string;
}

export interface BotInput {
  name: string;
  persona?: string;
  model?: string | null;
  allowedTools?: string[] | null;
  maxTurns?: number;
  maxMinutes?: number;
}

export interface Conversation {
  id: string;
  botId: string;
  title: string;
  engineSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  conversationId: string;
  prompt: string;
  state: RunState;
  reason: RunEndReason;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  costEstimateUsd: number;
  limitResetAt: string | null;
}

/** One stored, replayable event of a run. `payload` is the engine message or a panel notice. */
export interface RunEvent {
  runId: string;
  seq: number;
  type: RunEventType;
  payload: unknown;
  createdAt: string;
}

export type RunEventType =
  | "user"
  | "assistant_text"
  | "tool_use"
  | "tool_result"
  | "state"
  | "approval"
  | "notice"
  | "result"
  | "error";

export type ApprovalState = "pending" | "allowed" | "denied" | "expired";
export type ApprovalChannel = "panel" | "bale" | "telegram" | "timeout";

export interface Approval {
  id: string;
  runId: string;
  botName: string;
  toolName: string;
  input: unknown;
  reason: string;
  state: ApprovalState;
  decidedByChannel: ApprovalChannel | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface UsageRow {
  day: string;
  botId: string;
  botName: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costEstimateUsd: number;
}

export interface UsageReport {
  rows: UsageRow[];
  limit: { waiting: boolean; resetAt: string | null };
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  mtime: string;
}

export type ProxyConnState = "connected" | "disconnected" | "connecting" | "unknown";

export interface ProxyStatus {
  state: ProxyConnState;
  latencyMs: number | null;
  /** Never the full link: only what is safe to show. */
  current: { scheme: string; host: string; port: number; remark: string } | null;
  subscriptionUrlSet: boolean;
  checkedAt: string;
}

export interface ProxyNode {
  index: number;
  scheme: string;
  host: string;
  port: number;
  remark: string;
}

export type UiLanguage = "fa" | "en";

export interface PublicSettings {
  defaultModel: string;
  maxConcurrentRuns: number;
  uiLanguage: UiLanguage;
  bale: { configured: boolean; chatId: string | null };
  telegram: { configured: boolean; chatId: string | null };
}

export interface SettingsInput {
  defaultModel?: string;
  maxConcurrentRuns?: number;
  uiLanguage?: UiLanguage;
  bale?: { token?: string; chatId?: string } | null;
  telegram?: { token?: string; chatId?: string } | null;
}

export interface Me {
  username: string;
}

export interface ApiError {
  error: string;
  message: string;
}
