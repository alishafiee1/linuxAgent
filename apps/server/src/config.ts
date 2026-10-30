import { readFileSync } from "node:fs";

export interface Config {
  host: string;
  port: number;
  dbPath: string;
  /** 32-byte key (hex) for AES-256-GCM of secrets stored in the DB. */
  masterKey: Buffer;
  /** Secret used to sign nothing yet, kept for future CSRF tokens; sessions are random ids in the DB. */
  sessionSecret: string;
  agentHome: string;
  workspaceDir: string;
  botsDir: string;
  /** Command prefix that runs a program as the `agent` user, e.g. ["sudo", "-n", "-u", "agent", "/usr/local/bin/cwp-agent-exec"]. Empty = run as current user (dev). */
  agentExec: string[];
  /** Claude Code executable for the SDK (e.g. the global `claude`). Null = the SDK's bundled one. */
  claudePath: string | null;
  /** Root helper that validates and applies a sing-box config read from stdin. Empty = proxy apply disabled. */
  proxyApply: string[];
  clashApiUrl: string;
  clashSecretPath: string;
  webDist: string | null;
  cookieSecure: boolean;
  publicBaseUrl: string;
}

/** Reads `KEY=VALUE` lines (the systemd EnvironmentFile format) into process.env without overriding. */
export function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || m[1] === undefined) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = (m[2] ?? "").replace(/^"(.*)"$/, "$1");
  }
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  return value.split(" ").filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const masterKeyHex = env.CWP_MASTER_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(masterKeyHex)) {
    throw new Error("CWP_MASTER_KEY must be 64 hex characters (generate with: openssl rand -hex 32)");
  }
  const agentHome = env.CWP_AGENT_HOME ?? "/home/agent";
  return {
    host: env.CWP_HOST ?? "127.0.0.1",
    port: Number(env.CWP_PORT ?? 8787),
    dbPath: env.CWP_DB_PATH ?? "/var/lib/cwp/cwp.db",
    masterKey: Buffer.from(masterKeyHex, "hex"),
    sessionSecret: env.CWP_SESSION_SECRET ?? "",
    agentHome,
    workspaceDir: env.CWP_WORKSPACE_DIR ?? `${agentHome}/workspace`,
    botsDir: env.CWP_BOTS_DIR ?? `${agentHome}/bots`,
    agentExec: list(env.CWP_AGENT_EXEC, []),
    claudePath: env.CWP_CLAUDE_PATH || null,
    proxyApply: list(env.CWP_PROXY_APPLY, []),
    clashApiUrl: env.CWP_CLASH_API ?? "http://127.0.0.1:9090",
    clashSecretPath: env.CWP_CLASH_SECRET_PATH ?? "/etc/cwp/clash-secret",
    webDist: env.CWP_WEB_DIST ?? null,
    cookieSecure: (env.CWP_COOKIE_SECURE ?? "true") !== "false",
    publicBaseUrl: env.CWP_PUBLIC_BASE_URL ?? "https://agent.roditeam.ir",
  };
}
