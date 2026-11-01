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
  browser: boolean;
  createdAt: string;
}

export interface BotInput {
  name: string;
  persona?: string;
  model?: string | null;
  allowedTools?: string[] | null;
  maxTurns?: number;
  maxMinutes?: number;
  browser?: boolean;
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
  parentRunId: string | null;
  depth: number;
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
  browserClicksAuto: boolean;
}

export interface SettingsInput {
  defaultModel?: string;
  maxConcurrentRuns?: number;
  uiLanguage?: UiLanguage;
  bale?: { token?: string; chatId?: string } | null;
  telegram?: { token?: string; chatId?: string } | null;
  browserClicksAuto?: boolean;
}

export interface Me {
  username: string;
}

export interface ApiError {
  error: string;
  message: string;
}

// --- routines (cycle 002)
export type RoutineTrigger = "cron" | "webhook";

export interface Routine {
  id: string;
  botId: string;
  botName: string;
  name: string;
  prompt: string;
  trigger: RoutineTrigger;
  /** Five-field cron, read in `timezone`. Null for webhook routines. */
  cron: string | null;
  timezone: string;
  enabled: boolean;
  notify: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastRunState: RunState | null;
  createdAt: string;
}

export interface RoutineInput {
  botId: string;
  name: string;
  prompt: string;
  trigger: RoutineTrigger;
  cron?: string | null;
  timezone?: string;
  enabled?: boolean;
  notify?: boolean;
}

// --- skills and memory (cycle 002)
export interface Skill {
  slug: string;
  name: string;
  description: string;
  body: string;
}

export interface SkillInput {
  name: string;
  description: string;
  body: string;
}

export interface MemoryFile {
  /** "shared", or a bot id. */
  scope: string;
  label: string;
  path: string;
  content: string;
}

// --- vault (cycle 003). The value never leaves the server.
export interface VaultItem {
  id: string;
  name: string;
  username: string | null;
  /** When set, the secret only goes into pages of this origin. */
  site: string | null;
  createdAt: string;
}

export interface VaultInput {
  name: string;
  username?: string | null;
  secret?: string;
  site?: string | null;
}

// --- browser (cycle 003)
export interface BrowserStatus {
  botId: string;
  running: boolean;
  url: string | null;
  title: string | null;
}

export type BrowserInput =
  | { type: "click"; x: number; y: number }
  | { type: "scroll"; x: number; y: number; deltaY: number }
  | { type: "text"; text: string }
  | { type: "key"; key: string }
  | { type: "navigate"; url: string };

// --- pages (cycle 004)
export interface SharedPage {
  id: string;
  botId: string | null;
  name: string;
  title: string;
  /** Null once sharing is revoked. */
  url: string | null;
  updatedAt: string;
  createdAt: string;
}

// --- connectors (cycle 004)
export interface ConnectorsStatus {
  github: { configured: boolean };
  google: { clientConfigured: boolean; connected: boolean; redirectUri: string };
}

export interface ConnectorsInput {
  githubToken?: string | null;
  googleClientId?: string | null;
  googleClientSecret?: string | null;
}

// --- desktop bridge (cycle 006)
export interface BridgeDevice {
  id: string;
  name: string;
  folders: string[];
  lastSeenAt: string | null;
  online: boolean;
  createdAt: string;
}

export type BridgeCommand =
  | { kind: "list"; path: string }
  | { kind: "read"; path: string }
  | { kind: "write"; path: string; content: string }
  | { kind: "run"; cwd: string; command: string };
