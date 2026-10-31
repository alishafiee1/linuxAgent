// The engine boundary (design.md): the panel talks to every agent runtime through this shape.
// Claude Agent SDK is the first implementation; a CLI-in-a-PTY adapter (Antigravity CLI) can come later.

import type { ZodRawShape } from "zod";

export type ToolDecision = { allow: true } | { allow: false; message: string };

export type ToolGate = (toolName: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<ToolDecision>;

/** A tool the panel itself offers to a bot, reached by the engine as `mcp__cwp__<name>`. */
export interface PanelTool {
  name: string;
  description: string;
  shape: ZodRawShape;
  run(args: Record<string, unknown>): Promise<string>;
}

export type McpStdioServer = { type: "stdio"; command: string; args: string[] };

export interface EngineStartOptions {
  prompt: string;
  /** Resume this engine session, if set. */
  sessionId: string | null;
  cwd: string;
  additionalDirectories: string[];
  systemPromptAppend: string;
  model: string;
  allowedTools: string[] | null;
  maxTurns: number;
  canUseTool: ToolGate;
  abortController: AbortController;
  panelTools?: PanelTool[];
  mcpServers?: Record<string, McpStdioServer>;
}

export type EngineEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "text"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; content: string; isError: boolean }
  /** `resetsAt` in ms since epoch. */
  | { kind: "rate_limit"; status: "allowed" | "allowed_warning" | "rejected"; resetsAt: number | null }
  | {
      kind: "result";
      ok: boolean;
      /** e.g. success, error_max_turns, error_during_execution */
      subtype: string;
      turns: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      text: string | null;
      errorKind: string | null;
    };

export interface Engine {
  readonly name: string;
  start(options: EngineStartOptions): AsyncIterable<EngineEvent>;
}
