import { ApprovalService } from "./approval/service.js";
import { AuthService } from "./auth/service.js";
import { buildApp } from "./app.js";
import { BotService } from "./bots.js";
import { loadConfig, loadEnvFile } from "./config.js";
import { openDb } from "./db.js";
import { ClaudeAgentEngine } from "./engine/claude.js";
import { Notifier } from "./notify/notifier.js";
import { ProxyService } from "./proxy/service.js";
import { EventStore } from "./runs/events.js";
import { Orchestrator } from "./runs/orchestrator.js";
import { SettingsStore } from "./settings.js";

loadEnvFile(process.env.CWP_ENV_FILE ?? "/etc/cwp/env");
const config = loadConfig();
const db = openDb(config.dbPath);
const settings = new SettingsStore(db, config.masterKey);
const auth = new AuthService(db, config.masterKey);
const bots = new BotService(db, config.botsDir, config.agentExec);
const approvals = new ApprovalService(db);
const events = new EventStore(db);
const log = (m: string): void => console.log(`[cwp] ${m}`);
const notifier = new Notifier(db, settings, approvals, undefined, log);
const proxy = new ProxyService({ settings, clashApiUrl: config.clashApiUrl, clashSecretPath: config.clashSecretPath, applyCommand: config.proxyApply });

const orchestrator = new Orchestrator({
  db,
  engine: new ClaudeAgentEngine(config.agentExec, config.claudePath),
  bots,
  approvals,
  events,
  settings,
  workspaceDir: config.workspaceDir,
  agentHome: config.agentHome,
  networkUp: () => proxy.isUp(),
});

approvals.onChange({
  created: (a) => events.activity({ kind: "approval", approvalId: a.id, state: a.state }),
  decided: (a) => events.activity({ kind: "approval", approvalId: a.id, state: a.state }),
});
// Runs queued while the proxy was down start as soon as it is back (spec R20).
proxy.onChange((s) => {
  if (s.state === "connected") orchestrator.pump();
});

const app = await buildApp({ config, db, auth, bots, orchestrator, approvals, events, settings, notifier, proxy });

orchestrator.recover();
notifier.reload();
proxy.start();
await app.listen({ host: config.host, port: config.port });
log(`listening on ${config.host}:${config.port}`);

const stop = async (): Promise<void> => {
  log("shutting down");
  proxy.stop();
  notifier.stop();
  await orchestrator.shutdown();
  await app.close();
  db.close();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
