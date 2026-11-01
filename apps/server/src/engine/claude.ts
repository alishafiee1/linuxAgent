import { createSdkMcpServer, query, tool, type SDKMessage, type SpawnOptions, type SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import type { Engine, EngineEvent, EngineStartOptions, PanelTool } from "./types.js";

// Only these variables cross into the agent process. Panel secrets (CWP_*) never do.
const PASS_ENV = /^(CLAUDE|ANTHROPIC_BASE_URL$|ANTHROPIC_MODEL$|DEBUG$|PATH$|LANG$|LC_|TZ$|NODE_|USE_BUILTIN_RIPGREP$)/;

export function agentEnv(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([k, v]) => v !== undefined && PASS_ENV.test(k) && !k.startsWith("CWP_"))
    .map(([k, v]) => `${k}=${v}`);
}

/**
 * Spawns Claude Code as the `agent` Linux user (spec R17): `<agentExec...> env K=V... <command> <args...>`.
 * `cwp-agent-exec` sets HOME=/home/agent and execs the rest.
 */
export function makeAgentSpawner(agentExec: string[]): ((o: SpawnOptions) => SpawnedProcess) | undefined {
  if (agentExec.length === 0) return undefined;
  return (o) => {
    const [bin, ...pre] = agentExec;
    const child = spawn(bin!, [...pre, "env", ...agentEnv(o.env), o.command, ...o.args], {
      cwd: o.cwd,
      stdio: ["pipe", "pipe", "inherit"],
      signal: o.signal,
    });
    return child as unknown as SpawnedProcess;
  };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((c) => (c && typeof c === "object" && "text" in c && typeof c.text === "string" ? c.text : ""))
      .join("");
  return "";
}

/** Maps one SDK message to zero or more engine events. Exported for tests. */
export function mapSdkMessage(m: SDKMessage): EngineEvent[] {
  const out: EngineEvent[] = [];
  switch (m.type) {
    case "system":
      if (m.subtype === "init") out.push({ kind: "session", sessionId: m.session_id });
      break;
    case "assistant":
      for (const block of m.message.content) {
        if (block.type === "text") out.push({ kind: "text", text: block.text });
        else if (block.type === "tool_use") out.push({ kind: "tool_use", id: block.id, name: block.name, input: block.input });
      }
      break;
    case "user": {
      const content = m.message.content;
      if (Array.isArray(content))
        for (const block of content)
          if (block.type === "tool_result")
            out.push({
              kind: "tool_result",
              toolUseId: block.tool_use_id,
              content: textOf(block.content).slice(0, 20_000),
              isError: block.is_error === true,
            });
      break;
    }
    case "rate_limit_event": {
      const r = m.rate_limit_info.resetsAt;
      out.push({
        kind: "rate_limit",
        status: m.rate_limit_info.status,
        resetsAt: r === undefined ? null : r < 1e12 ? r * 1000 : r,
        limitType: m.rate_limit_info.rateLimitType,
        utilization: m.rate_limit_info.utilization ?? null,
      });
      break;
    }
    case "result": {
      const usage = m.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
      out.push({
        kind: "result",
        ok: m.subtype === "success" && !m.is_error,
        subtype: m.subtype,
        turns: m.num_turns,
        inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
        outputTokens: usage.output_tokens ?? 0,
        costUsd: m.total_cost_usd ?? 0,
        text: m.subtype === "success" ? m.result : null,
        errorKind: m.subtype === "success" ? null : m.subtype,
      });
      break;
    }
  }
  return out;
}

function panelServer(tools: PanelTool[]) {
  return createSdkMcpServer({
    name: "cwp",
    tools: tools.map((t) =>
      tool(t.name, t.description, t.shape, async (args) => {
        try {
          return { content: [{ type: "text" as const, text: await t.run(args as Record<string, unknown>) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
        }
      }),
    ),
  });
}

export class ClaudeAgentEngine implements Engine {
  readonly name = "claude-agent-sdk";

  constructor(
    private agentExec: string[] = [],
    private claudePath: string | null = null,
  ) {}

  async *start(o: EngineStartOptions): AsyncIterable<EngineEvent> {
    const spawner = makeAgentSpawner(this.agentExec);
    const mcpServers = { ...(o.mcpServers ?? {}), ...(o.panelTools?.length ? { cwp: panelServer(o.panelTools) } : {}) };
    const q = query({
      prompt: o.prompt,
      options: {
        cwd: o.cwd,
        additionalDirectories: o.additionalDirectories,
        resume: o.sessionId ?? undefined,
        model: o.model,
        maxTurns: o.maxTurns,
        // allowedTools is deliberately NOT passed: SDK allow-lists skip canUseTool. The gate enforces it instead.
        permissionMode: "default",
        abortController: o.abortController,
        // No filesystem settings: a bot could write allow rules into .claude/settings.json and skip approvals.
        settingSources: [],
        systemPrompt: { type: "preset", preset: "claude_code", append: o.systemPromptAppend },
        mcpServers,
        canUseTool: async (toolName, input, { signal }) => {
          const d = await o.canUseTool(toolName, input, signal);
          return d.allow ? { behavior: "allow", updatedInput: d.updatedInput ?? input } : { behavior: "deny", message: d.message };
        },
        ...(spawner ? { spawnClaudeCodeProcess: spawner } : {}),
        ...(this.claudePath ? { pathToClaudeCodeExecutable: this.claudePath } : {}),
      },
    });
    for await (const m of q) yield* mapSdkMessage(m);
  }
}
