import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import type { BotInput, FileEntry, RunEvent, SettingsInput, UsageReport } from "@linux-agent/shared";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { createReadStream, realpathSync, statSync, statfsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { ApprovalService } from "./approval/service.js";
import { MSG_ALREADY_DECIDED } from "./approval/service.js";
import { MSG_BAD_LOGIN, MSG_LOCKED, SESSION_DAYS, type AuthService } from "./auth/service.js";
import { HttpError, type BotService } from "./bots.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { Notifier } from "./notify/notifier.js";
import type { ProxyService } from "./proxy/service.js";
import type { EventStore } from "./runs/events.js";
import type { Orchestrator } from "./runs/orchestrator.js";
import { registerExtRoutes, type ExtDeps } from "./routesExt.js";
import type { SettingsStore } from "./settings.js";

export const COOKIE = "cwp_session";
export const MSG_LOW_DISK = "فضای دیسک کم است";

export interface AppDeps {
  config: Pick<Config, "cookieSecure" | "workspaceDir" | "botsDir" | "agentHome" | "webDist">;
  db: Db;
  auth: AuthService;
  bots: BotService;
  orchestrator: Orchestrator;
  approvals: ApprovalService;
  events: EventStore;
  settings: SettingsStore;
  notifier: Notifier | null;
  proxy: ProxyService | null;
  ext?: ExtDeps;
}

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, "bad_request", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
};

const botInput = z.object({
  name: z.string(),
  persona: z.string().max(10_000).optional(),
  model: z.string().max(100).nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  maxTurns: z.number().int().optional(),
  maxMinutes: z.number().int().optional(),
  browser: z.boolean().optional(),
});

const settingsInput = z.object({
  defaultModel: z.string().max(100).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(10).optional(),
  browserClicksAuto: z.boolean().optional(),
  uiLanguage: z.enum(["fa", "en"]).optional(),
  bale: z.object({ token: z.string().optional(), chatId: z.string().optional() }).nullable().optional(),
  telegram: z.object({ token: z.string().optional(), chatId: z.string().optional() }).nullable().optional(),
});

function sseHeaders(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
}

function sseSend(reply: FastifyReply, data: unknown, id?: number, event?: string): void {
  let s = "";
  if (event) s += `event: ${event}\n`;
  if (id !== undefined) s += `id: ${id}\n`;
  s += `data: ${JSON.stringify(data)}\n\n`;
  reply.raw.write(s);
}

/** Spec R15: only these roots; anything resolving outside (incl. symlinks) is 404. */
function resolveInRoot(rootDir: string, rel: string): string {
  const root = resolve(rootDir);
  const target = resolve(root, `.${sep}${rel}`);
  let real: string;
  try {
    real = realpathSync(target);
  } catch {
    throw new HttpError(404, "not_found", "پیدا نشد.");
  }
  const realRoot = realpathSync(root);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new HttpError(404, "not_found", "پیدا نشد.");
  return real;
}

export async function buildApp(d: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  await app.register(cookie);
  // The server link is slow; hijacked SSE replies skip this hook, so live output is not buffered.
  await app.register(compress);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) return reply.status(status).send({ error: "bad_request", message: (err as Error).message });
    app.log.error(err);
    return reply.status(500).send({ error: "internal", message: "خطای داخلی سرور" });
  });

  const roots = (): Record<string, string> => ({ workspace: d.config.workspaceDir, bots: d.config.botsDir });

  // --- auth guard: everything under /api except login needs a session; writes need the custom header (CSRF).
  app.addHook("preHandler", async (req: FastifyRequest) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.method !== "GET" && req.headers["x-cwp"] !== "1") throw new HttpError(403, "csrf", "درخواست نامعتبر");
    if (req.url.startsWith("/api/auth/login")) return;
    const user = d.auth.sessionUser(req.cookies[COOKIE]);
    if (!user) throw new HttpError(401, "unauthorized", "لطفاً وارد شوید.");
    (req as FastifyRequest & { user?: { username: string } }).user = user;
  });

  // --- auth
  app.post("/api/auth/login", async (req, reply) => {
    const body = parse(z.object({ username: z.string(), password: z.string(), code: z.string() }), req.body);
    const r = await d.auth.login(body.username, body.password, body.code);
    if (!r.ok) throw new HttpError(r.locked ? 429 : 401, r.locked ? "locked" : "bad_login", r.locked ? MSG_LOCKED : MSG_BAD_LOGIN);
    reply.setCookie(COOKIE, r.sessionId, {
      httpOnly: true,
      secure: d.config.cookieSecure,
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_DAYS * 86_400,
    });
    return { username: body.username };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    const sid = req.cookies[COOKIE];
    if (sid) d.auth.logout(sid);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });
  app.get("/api/auth/me", async (req) => (req as FastifyRequest & { user: { username: string } }).user);

  // --- status (top bar)
  app.get("/api/status", async () => {
    let lowDisk = false;
    try {
      const s = statfsSync(d.config.agentHome);
      lowDisk = s.blocks > 0 && 1 - s.bavail / s.blocks > 0.9;
    } catch {
      // not mounted in dev
    }
    return {
      runs: d.orchestrator.counts(),
      pendingApprovals: d.approvals.list("pending").length,
      proxy: d.proxy?.current() ?? null,
      lowDisk,
      lowDiskMessage: lowDisk ? MSG_LOW_DISK : null,
    };
  });

  // --- bots
  app.get("/api/bots", async () => d.bots.list());
  app.post("/api/bots", async (req) => d.bots.create(parse(botInput, req.body) as BotInput));
  app.get<{ Params: { id: string } }>("/api/bots/:id", async (req) => d.bots.get(req.params.id));
  app.patch<{ Params: { id: string } }>("/api/bots/:id", async (req) => d.bots.update(req.params.id, parse(botInput.partial(), req.body) as Partial<BotInput>));
  app.delete<{ Params: { id: string } }>("/api/bots/:id", async (req) => {
    d.bots.delete(req.params.id);
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>("/api/bots/:id/conversations", async (req) => d.bots.conversations(req.params.id));
  app.post<{ Params: { id: string } }>("/api/bots/:id/conversations", async (req) =>
    d.bots.createConversation(req.params.id, parse(z.object({ title: z.string().max(200).optional() }), req.body ?? {}).title),
  );

  // --- conversations & runs
  app.get<{ Params: { id: string } }>("/api/conversations/:id", async (req) => ({
    conversation: d.bots.conversation(req.params.id),
    runs: d.orchestrator.listForConversation(req.params.id),
  }));
  app.post<{ Params: { id: string } }>("/api/conversations/:id/messages", async (req) => {
    const { text } = parse(z.object({ text: z.string().min(1).max(100_000) }), req.body);
    const run = d.orchestrator.submit(req.params.id, text);
    return { runId: run.id };
  });
  app.get<{ Params: { id: string } }>("/api/runs/:id", async (req) => d.orchestrator.get(req.params.id));
  app.get<{ Params: { id: string }; Querystring: { after?: string; limit?: string } }>("/api/runs/:id/events", async (req) => {
    d.orchestrator.get(req.params.id);
    return d.events.page(req.params.id, Number(req.query.after ?? 0), Math.min(Number(req.query.limit ?? 1000), 5000));
  });
  app.post<{ Params: { id: string } }>("/api/runs/:id/cancel", async (req) => d.orchestrator.cancel(req.params.id));
  app.post<{ Params: { id: string } }>("/api/runs/:id/continue", async (req) => d.orchestrator.continueRun(req.params.id));

  // Spec R6: replay from `after` (or Last-Event-ID), then follow live without gaps or duplicates.
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>("/api/runs/:id/stream", async (req, reply) => {
    const runId = req.params.id;
    d.orchestrator.get(runId);
    let last = Number(req.headers["last-event-id"] ?? req.query.after ?? 0) || 0;
    sseHeaders(reply);
    const pending: RunEvent[] = [];
    let replaying = true;
    const unsubscribe = d.events.subscribe(runId, (ev) => {
      if (replaying) pending.push(ev);
      else if (ev.seq > last) {
        last = ev.seq;
        sseSend(reply, ev, ev.seq);
      }
    });
    for (;;) {
      const page = d.events.page(runId, last, 1000);
      for (const ev of page) {
        last = ev.seq;
        sseSend(reply, ev, ev.seq);
      }
      if (page.length < 1000) break;
    }
    replaying = false;
    for (const ev of pending)
      if (ev.seq > last) {
        last = ev.seq;
        sseSend(reply, ev, ev.seq);
      }
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 20_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  // Activity stream for the top bar and lists.
  app.get("/api/activity/stream", async (req, reply) => {
    sseHeaders(reply);
    sseSend(reply, { kind: "hello" });
    const off = d.events.onActivity((a) => sseSend(reply, a));
    const offProxy = d.proxy ? d.proxy.onChange((s) => sseSend(reply, { kind: "proxy", status: s })) : () => {};
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 20_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      off();
      offProxy();
    });
  });

  // --- approvals
  app.get<{ Querystring: { state?: string } }>("/api/approvals", async (req) =>
    d.approvals.list(req.query.state === "pending" ? "pending" : undefined),
  );
  app.post<{ Params: { id: string } }>("/api/approvals/:id/decide", async (req) => {
    const { allow } = parse(z.object({ allow: z.boolean() }), req.body);
    const r = d.approvals.decide(req.params.id, allow, "panel");
    if (!r.ok) throw new HttpError(409, "already_decided", MSG_ALREADY_DECIDED);
    return r.approval;
  });

  // --- usage (spec R13)
  app.get<{ Querystring: { from?: string; to?: string } }>("/api/usage", async (req): Promise<UsageReport> => {
    const from = req.query.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const to = req.query.to ?? "9999-12-31";
    const rows = d.db
      .prepare(
        `SELECT substr(r.created_at, 1, 10) AS day, b.id AS botId, b.name AS botName, COUNT(*) AS runs,
                SUM(r.input_tokens) AS inputTokens, SUM(r.output_tokens) AS outputTokens, SUM(r.cost_estimate_usd) AS costEstimateUsd
         FROM runs r JOIN conversations c ON c.id = r.conversation_id JOIN bots b ON b.id = c.bot_id
         WHERE substr(r.created_at, 1, 10) BETWEEN ? AND ?
         GROUP BY day, b.id ORDER BY day DESC, b.name`,
      )
      .all(from, to) as UsageReport["rows"];
    const lim = d.db.prepare("SELECT MIN(limit_reset_at) AS at, COUNT(*) AS n FROM runs WHERE state = 'waiting_limit'").get() as { at: string | null; n: number };
    return { rows, limit: { waiting: lim.n > 0, resetAt: lim.at } };
  });

  // --- files (spec R15)
  app.get<{ Querystring: { root?: string; path?: string } }>("/api/files", async (req) => {
    const rootDir = roots()[req.query.root ?? "workspace"];
    if (!rootDir) throw new HttpError(404, "not_found", "پیدا نشد.");
    const dir = resolveInRoot(rootDir, req.query.path ?? "");
    if (!statSync(dir).isDirectory()) throw new HttpError(400, "not_dir", "این مسیر پوشه نیست.");
    const realRoot = realpathSync(rootDir);
    const entries = await readdir(dir, { withFileTypes: true });
    const out: FileEntry[] = [];
    for (const e of entries) {
      try {
        const s = await stat(join(dir, e.name));
        out.push({ name: e.name, path: relative(realRoot, join(dir, e.name)), type: s.isDirectory() ? "dir" : "file", size: s.size, mtime: s.mtime.toISOString() });
      } catch {
        // dangling symlink
      }
    }
    return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  });
  app.get<{ Querystring: { root?: string; path?: string } }>("/api/files/download", async (req, reply) => {
    const rootDir = roots()[req.query.root ?? "workspace"];
    if (!rootDir) throw new HttpError(404, "not_found", "پیدا نشد.");
    const file = resolveInRoot(rootDir, req.query.path ?? "");
    if (!statSync(file).isFile()) throw new HttpError(404, "not_found", "پیدا نشد.");
    reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(basename(file))}`);
    reply.type("application/octet-stream");
    return reply.send(createReadStream(file));
  });

  // --- settings
  app.get("/api/settings", async () => d.settings.publicView());
  app.put("/api/settings", async (req) => {
    const input = parse(settingsInput, req.body) as SettingsInput;
    d.settings.apply(input);
    if (input.bale !== undefined || input.telegram !== undefined) d.notifier?.reload();
    if (input.maxConcurrentRuns !== undefined) d.orchestrator.pump();
    return d.settings.publicView();
  });
  app.post<{ Params: { channel: string } }>("/api/settings/notify/:channel/test", async (req) => {
    const ch = req.params.channel;
    if (ch !== "bale" && ch !== "telegram") throw new HttpError(404, "not_found", "پیدا نشد.");
    if (!d.notifier) throw new HttpError(501, "disabled", "اعلان غیرفعال است.");
    try {
      await d.notifier.test(ch);
    } catch (e) {
      throw new HttpError(502, "notify_failed", `ارسال ناموفق بود: ${(e as Error).message}`);
    }
    return { ok: true };
  });

  // --- proxy (spec R19, R20)
  const needProxy = (): ProxyService => {
    if (!d.proxy) throw new HttpError(501, "disabled", "مدیریت پروکسی غیرفعال است.");
    return d.proxy;
  };
  app.get("/api/proxy/status", async () => needProxy().check());
  app.put("/api/proxy", async (req) => {
    const body = parse(z.object({ link: z.string().max(5000).optional(), subscriptionUrl: z.string().max(2000).nullable().optional() }), req.body);
    const p = needProxy();
    if (body.subscriptionUrl !== undefined) p.setSubscription(body.subscriptionUrl);
    if (body.link) return p.applyLink(body.link);
    return p.current();
  });
  app.get("/api/proxy/subscription/nodes", async () => needProxy().subscriptionNodes());
  app.post("/api/proxy/select", async (req) => needProxy().selectSubscriptionNode(parse(z.object({ index: z.number().int().min(0) }), req.body).index));

  if (d.ext) registerExtRoutes(app, d.ext);

  // --- web app
  if (d.config.webDist) {
    await app.register(fastifyStatic, {
      root: d.config.webDist,
      wildcard: false,
      cacheControl: false,
      setHeaders: (res, path) => {
        // Vite puts a content hash in every asset name.
        if (path.includes(`${sep}assets${sep}`)) res.setHeader("cache-control", "public, max-age=31536000, immutable");
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.status(404).send({ error: "not_found", message: "پیدا نشد." });
      return reply.sendFile("index.html");
    });
  }

  return app;
}

