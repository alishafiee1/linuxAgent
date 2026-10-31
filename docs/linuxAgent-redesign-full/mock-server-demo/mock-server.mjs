// DEMO-ONLY mock backend for visual verification of the linuxAgent UI redesign.
// Not part of the shipped app. Listens on 127.0.0.1:8787.
// Serves the built app from apps/web/dist (if present) plus the mocked /api.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Works wherever the project folder is extracted: <root>/mock-server-demo -> <root>/apps/web/dist
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(PROJECT_ROOT, "apps", "web", "dist");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const serveStatic = (url, res) => {
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  const file = path.join(DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const index = path.join(DIST, "index.html");
    if (!fs.existsSync(index)) return false;
    res.writeHead(200, { "content-type": MIME[".html"] });
    res.end(fs.readFileSync(index));
    return true;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(file));
  return true;
};

const PORT = 8787;
const id = () => crypto.randomUUID();
const now = Date.now();
const iso = (msAgo = 0) => new Date(now - msAgo).toISOString();

let authed = false;

// ---------- seed data ----------
const bots = [
  { id: "b1", name: "معمار", slug: "memar", persona: "معماری کد و رفکتورهای بزرگ", model: "claude-sonnet-4-5", allowedTools: null, maxTurns: 60, maxMinutes: 180, createdAt: iso(86400e3 * 9) },
  { id: "b2", name: "پژوهشگر", slug: "pajooheshgar", persona: "جست‌وجو، مقایسه و خلاصه‌سازی", model: null, allowedTools: null, maxTurns: 40, maxMinutes: 120, createdAt: iso(86400e3 * 6) },
  { id: "b3", name: "نگهبان", slug: "negahban", persona: "نگهداری سرور، لاگ‌ها و پشتیبان‌گیری", model: "claude-haiku-4-5", allowedTools: null, maxTurns: 30, maxMinutes: 60, createdAt: iso(86400e3 * 3) },
];

const conversations = [
  { id: "c1", botId: "b1", title: "رفع باگ API پرداخت", engineSessionId: "s1", createdAt: iso(7200e3), updatedAt: iso(600e3) },
  { id: "c2", botId: "b1", title: "پیاده‌سازی صفحهٔ گزارش", engineSessionId: "s2", createdAt: iso(1800e3), updatedAt: iso(60e3) },
  { id: "c3", botId: "b2", title: "مقایسهٔ کتابخانه‌های نمودار", engineSessionId: "s3", createdAt: iso(5400e3), updatedAt: iso(900e3) },
  { id: "c4", botId: "b3", title: "چرخش لاگ‌ها و پشتیبان", engineSessionId: "s4", createdAt: iso(3600e3), updatedAt: iso(120e3) },
];

let seq = { r1: 0, r2: 0, r3: 0, r4: 0 };
const ev = (runId, type, payload) => ({ runId, seq: ++seq[runId], type, payload, createdAt: new Date().toISOString() });

const events = {
  r1: [
    ev("r1", "user", { text: "باگ ۵۰۰ شدن endpoint پرداخت را پیدا و رفع کن. لاگ‌ها در logs/pay.log هستند." }),
    ev("r1", "state", { state: "running", message: null }),
    ev("r1", "assistant_text", { text: "دارم لاگ‌ها و کد مسیر پرداخت را بررسی می‌کنم تا محل خطا را پیدا کنم." }),
    ev("r1", "tool_use", { id: "t1", name: "Bash", input: { command: "tail -n 40 logs/pay.log | grep -n 'Error'" } }),
    ev("r1", "tool_result", { toolUseId: "t1", content: "12:TypeError: cannot read properties of undefined (reading 'amount')\n    at charge (src/pay/charge.ts:41:19)", isError: false }),
    ev("r1", "tool_use", { id: "t2", name: "Read", input: { file_path: "src/pay/charge.ts" } }),
    ev("r1", "tool_result", { toolUseId: "t2", content: "38  const intent = await gateway.find(req.intentId)\n39  if (!intent.ok) throw new Error(intent.reason)\n41  const amount = intent.data.amount * 100", isError: false }),
    ev("r1", "assistant_text", { text: "مشکل این بود که وقتی gateway درخواست را با status pending برمی‌گرداند، data تعریف نشده است. یک گارد اضافه کردم و تست نوشتم." }),
    ev("r1", "state", { state: "done", message: "2 files changed" }),
  ],
  r2: [
    ev("r2", "user", { text: "صفحهٔ گزارش مصرف را با نمودار روزانه بساز." }),
    ev("r2", "state", { state: "running", message: null }),
    ev("r2", "assistant_text", { text: "الگوی موجود را خواندم؛ کامپوننت گزارش را در apps/web/src/pages.tsx اضافه می‌کنم و داده را از /api/usage می‌گیرم." }),
    ev("r2", "tool_use", { id: "t3", name: "Bash", input: { command: "pnpm --filter web exec tsc --noEmit" } }),
    ev("r2", "tool_result", { toolUseId: "t3", content: "(no output) exit 0", isError: false }),
  ],
  r3: [
    ev("r3", "user", { text: "کتابخانهٔ نمودار سبک با پشتیبانی RTL پیشنهاد بده و مقایسه کن." }),
    ev("r3", "state", { state: "queued", message: "waiting for a free slot" }),
  ],
  r4: [
    ev("r4", "user", { text: "لاگ‌ها را بچرخان و سرویس nginx را ری‌استارت کن." }),
    ev("r4", "state", { state: "running", message: null }),
    ev("r4", "tool_use", { id: "t4", name: "Bash", input: { command: "sudo systemctl restart nginx" } }),
    ev("r4", "approval", { approvalId: "a1", toolName: "Bash", input: { command: "sudo systemctl restart nginx" }, reason: "اجرای دستور حساس: sudo", state: "pending", channel: "panel" }),
    ev("r4", "state", { state: "waiting_approval", message: null }),
  ],
};

const runs = [
  { id: "r1", conversationId: "c1", prompt: "باگ ۵۰۰ شدن endpoint پرداخت", state: "done", reason: null, createdAt: iso(7200e3), startedAt: iso(7190e3), endedAt: iso(600e3), turns: 8, inputTokens: 21400, outputTokens: 3120, costEstimateUsd: 0.21, limitResetAt: null },
  { id: "r2", conversationId: "c2", prompt: "صفحهٔ گزارش مصرف", state: "running", reason: null, createdAt: iso(600e3), startedAt: iso(590e3), endedAt: null, turns: 3, inputTokens: 8600, outputTokens: 940, costEstimateUsd: 0.06, limitResetAt: null },
  { id: "r3", conversationId: "c3", prompt: "مقایسهٔ کتابخانهٔ نمودار", state: "queued", reason: null, createdAt: iso(120e3), startedAt: null, endedAt: null, turns: 0, inputTokens: 0, outputTokens: 0, costEstimateUsd: 0, limitResetAt: null },
  { id: "r4", conversationId: "c4", prompt: "چرخش لاگ‌ها", state: "waiting_approval", reason: null, createdAt: iso(300e3), startedAt: iso(295e3), endedAt: null, turns: 1, inputTokens: 2100, outputTokens: 120, costEstimateUsd: 0.01, limitResetAt: null },
];

const approvals = [
  { id: "a1", runId: "r4", botName: "نگهبان", toolName: "Bash", input: { command: "sudo systemctl restart nginx" }, reason: "اجرای دستور حساس: sudo", state: "pending", decidedByChannel: null, createdAt: iso(240e3), decidedAt: null },
  { id: "a0", runId: "r1", botName: "معمار", toolName: "Bash", input: { command: "git push origin fix/pay-500" }, reason: "پوش کد به مخزن مشترک", state: "allowed", decidedByChannel: "panel", createdAt: iso(5000e3), decidedAt: iso(4900e3) },
  { id: "a2", runId: "r0", botName: "پژوهشگر", toolName: "Bash", input: { command: "npm install canvas" }, reason: "نصب بستهٔ جدید", state: "denied", decidedByChannel: "telegram", createdAt: iso(90000e3), decidedAt: iso(89900e3) },
];

const usage = {
  rows: [
    { day: "2026-10-30", botId: "b1", botName: "معمار", runs: 6, inputTokens: 128400, outputTokens: 21400, costEstimateUsd: 1.12 },
    { day: "2026-10-30", botId: "b3", botName: "نگهبان", runs: 3, inputTokens: 22100, outputTokens: 3800, costEstimateUsd: 0.16 },
    { day: "2026-10-29", botId: "b1", botName: "معمار", runs: 11, inputTokens: 302500, outputTokens: 58900, costEstimateUsd: 2.98 },
    { day: "2026-10-29", botId: "b2", botName: "پژوهشگر", runs: 4, inputTokens: 44100, outputTokens: 9700, costEstimateUsd: 0.38 },
    { day: "2026-10-28", botId: "b1", botName: "معمار", runs: 9, inputTokens: 257000, outputTokens: 41200, costEstimateUsd: 2.31 },
  ],
  limit: { waiting: false, resetAt: null },
};

const files = {
  "": [
    { name: "apps", path: "apps", type: "dir", size: 0, mtime: iso(3600e3) },
    { name: "packages", path: "packages", type: "dir", size: 0, mtime: iso(7200e3) },
    { name: "logs", path: "logs", type: "dir", size: 0, mtime: iso(600e3) },
    { name: "report.html", path: "report.html", type: "file", size: 48213, mtime: iso(900e3) },
    { name: "pay-fix.patch", path: "pay-fix.patch", type: "file", size: 2187, mtime: iso(700e3) },
  ],
  logs: [
    { name: "pay.log", path: "logs/pay.log", type: "file", size: 154200, mtime: iso(300e3) },
    { name: "proxy.log", path: "logs/proxy.log", type: "file", size: 8710, mtime: iso(310e3) },
  ],
};

let settings = {
  defaultModel: "claude-sonnet-4-5",
  maxConcurrentRuns: 2,
  uiLanguage: "fa",
  bale: { configured: true, chatId: "98765432" },
  telegram: { configured: false, chatId: null },
};

const proxy = {
  state: "connected",
  latencyMs: 87,
  current: { scheme: "vless", host: "de-01.fastline.net", port: 443, remark: "DE-01" },
  subscriptionUrlSet: true,
  checkedAt: iso(20e3),
};

const nodes = [
  { index: 0, scheme: "vless", host: "de-01.fastline.net", port: 443, remark: "DE-01" },
  { index: 1, scheme: "vless", host: "nl-03.fastline.net", port: 8443, remark: "NL-03" },
  { index: 2, scheme: "trojan", host: "tr-01.fastline.net", port: 443, remark: "TR-01" },
];

// ---------- SSE fans ----------
const activityClients = new Set();
const runClients = new Map(); // runId -> Set(res)
const broadcastActivity = () => {
  for (const res of activityClients) res.write(`data: tick\n\n`);
};
const pushToRun = (runId, event) => {
  events[runId].push(event);
  for (const res of runClients.get(runId) ?? []) res.write(`data: ${JSON.stringify(event)}\n\n`);
};
const setState = (runId, state, message = null) => {
  const run = runs.find((r) => r.id === runId);
  if (run) run.state = state;
  pushToRun(runId, ev(runId, "state", { state, message }));
  broadcastActivity();
};

// slow streaming simulation for r2 (running)
setTimeout(() => pushToRun("r2", ev("r2", "assistant_text", { text: "فایل استایل را هم هماهنگ می‌کنم تا جدول مصرف در موبایل درست دیده شود." })), 4000);
setTimeout(() => pushToRun("r2", ev("r2", "tool_use", { id: "t5", name: "Edit", input: { file_path: "apps/web/src/styles.css" } })), 9000);

// ---------- helpers ----------
const json = (res, code, body) => {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": buf.length });
  res.end(buf);
};
const sse = (res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  return res;
};
const readBody = (req) =>
  new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch {
        resolve({});
      }
    });
  });

const status = () => {
  const by = (s) => runs.filter((r) => r.state === s).length;
  return {
    runs: { running: by("running"), queued: by("queued"), waitingApproval: by("waiting_approval"), waitingLimit: by("waiting_limit") },
    pendingApprovals: approvals.filter((a) => a.state === "pending").length,
    proxy,
    lowDisk: false,
    lowDiskMessage: null,
  };
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  const m = req.method;
  const cookie = req.headers.cookie ?? "";
  const isAuthed = authed && cookie.includes("cwp_demo=1");

  if (!p.startsWith("/api/") && serveStatic(url, res)) return;

  if (p === "/api/auth/login" && m === "POST") {
    await readBody(req);
    authed = true;
    res.setHeader("set-cookie", "cwp_demo=1; Path=/; HttpOnly");
    return json(res, 200, { username: "arman" });
  }
  if (p === "/api/auth/logout" && m === "POST") {
    authed = false;
    res.setHeader("set-cookie", "cwp_demo=1; Path=/; Max-Age=0");
    return json(res, 200, { ok: true });
  }
  if (p === "/api/auth/me") {
    return isAuthed ? json(res, 200, { username: "arman" }) : json(res, 401, { error: "unauthorized", message: "ورود لازم است" });
  }
  if (!isAuthed) return json(res, 401, { error: "unauthorized", message: "ورود لازم است" });

  if (p === "/api/bots" && m === "GET") return json(res, 200, bots);
  if (p === "/api/bots" && m === "POST") {
    const b = await readBody(req);
    const bot = { id: id(), name: b.name ?? "بات تازه", slug: crypto.randomUUID().slice(0, 6), persona: b.persona ?? "", model: b.model ?? null, allowedTools: null, maxTurns: b.maxTurns ?? 50, maxMinutes: b.maxMinutes ?? 120, createdAt: new Date().toISOString() };
    bots.push(bot);
    broadcastActivity();
    return json(res, 200, bot);
  }
  let mt;
  if ((mt = p.match(/^\/api\/bots\/([^/]+)$/))) {
    const bot = bots.find((b) => b.id === mt[1]);
    if (!bot) return json(res, 404, { error: "nf", message: "بات پیدا نشد" });
    if (m === "PATCH") {
      Object.assign(bot, await readBody(req));
      return json(res, 200, bot);
    }
    if (m === "DELETE") {
      const busy = runs.some((r) => r.state === "running" || r.state === "waiting_approval");
      if (busy) return json(res, 409, { error: "busy", message: "بات در حال کار است؛ اول اجرا را متوقف کنید." });
      bots.splice(bots.indexOf(bot), 1);
      broadcastActivity();
      return json(res, 200, { ok: true });
    }
  }
  if ((mt = p.match(/^\/api\/bots\/([^/]+)\/conversations$/)) && m === "GET") {
    return json(res, 200, conversations.filter((c) => c.botId === mt[1]));
  }
  if ((mt = p.match(/^\/api\/bots\/([^/]+)\/conversations$/)) && m === "POST") {
    const b = await readBody(req);
    const c = { id: id(), botId: mt[1], title: b.title ?? "گفت‌وگوی تازه", engineSessionId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    conversations.push(c);
    return json(res, 200, c);
  }
  if ((mt = p.match(/^\/api\/conversations\/([^/]+)$/)) && m === "GET") {
    return json(res, 200, { runs: runs.filter((r) => r.conversationId === mt[1]) });
  }
  if ((mt = p.match(/^\/api\/conversations\/([^/]+)\/messages$/)) && m === "POST") {
    const b = await readBody(req);
    const cid = mt[1];
    const rid = id();
    const run = { id: rid, conversationId: cid, prompt: b.text ?? "", state: "queued", reason: null, createdAt: new Date().toISOString(), startedAt: null, endedAt: null, turns: 0, inputTokens: 0, outputTokens: 0, costEstimateUsd: 0, limitResetAt: null };
    runs.push(run);
    events[rid] = [ev(rid, "user", { text: b.text ?? "" }), ev(rid, "state", { state: "queued", message: null })];
    seq[rid] = 2;
    broadcastActivity();
    setTimeout(() => setState(rid, "running"), 2500);
    setTimeout(() => pushToRun(rid, ev(rid, "assistant_text", { text: "گرفتم؛ شروع می‌کنم." })), 5000);
    return json(res, 200, run);
  }
  if ((mt = p.match(/^\/api\/runs\/([^/]+)\/events$/))) {
    const list = (events[mt[1]] ?? []).filter((e) => e.seq > Number(url.searchParams.get("after") ?? 0));
    return json(res, 200, list.slice(-Number(url.searchParams.get("limit") ?? 5000)));
  }
  if ((mt = p.match(/^\/api\/runs\/([^/]+)\/stream$/))) {
    const rid = mt[1];
    const after = Number(url.searchParams.get("after") ?? 0);
    const s = sse(res);
    // slight delay so React StrictMode's double-mount (dev) closes the first
    // connection before the replay arrives — prevents duplicate bubbles in dev
    const snapshot = [...(events[rid] ?? [])].filter((e) => e.seq > after);
    const timer = setTimeout(() => {
      for (const e of snapshot) s.write(`data: ${JSON.stringify(e)}\n\n`);
    }, 350);
    let set = runClients.get(rid);
    if (!set) runClients.set(rid, (set = new Set()));
    set.add(s);
    req.on("close", () => {
      clearTimeout(timer);
      set.delete(s);
    });
    return;
  }
  if ((mt = p.match(/^\/api\/runs\/([^/]+)\/cancel$/)) && m === "POST") {
    setState(mt[1], "cancelled", "توسط کاربر");
    return json(res, 200, { ok: true });
  }
  if ((mt = p.match(/^\/api\/runs\/([^/]+)\/continue$/)) && m === "POST") {
    setState(mt[1], "running");
    return json(res, 200, { ok: true });
  }
  if (p === "/api/approvals" && m === "GET") return json(res, 200, approvals);
  if ((mt = p.match(/^\/api\/approvals\/([^/]+)\/decide$/)) && m === "POST") {
    const b = await readBody(req);
    const a = approvals.find((x) => x.id === mt[1]);
    if (a) {
      a.state = b.allow ? "allowed" : "denied";
      a.decidedByChannel = "panel";
      a.decidedAt = new Date().toISOString();
      const ap = events[a.runId]?.find((e) => e.type === "approval" && e.payload.approvalId === a.id);
      if (ap) {
        ap.payload = { ...ap.payload, state: a.state, channel: "panel" };
        for (const s of runClients.get(a.runId) ?? []) s.write(`data: ${JSON.stringify(ap)}\n\n`);
      }
      setState(a.runId, b.allow ? "running" : "cancelled", b.allow ? null : "تأیید رد شد");
    }
    broadcastActivity();
    return json(res, 200, { ok: true });
  }
  if (p === "/api/usage" && m === "GET") return json(res, 200, usage);
  if (p === "/api/files" && m === "GET") return json(res, 200, files[url.searchParams.get("path") ?? ""] ?? []);
  if (p === "/api/files/download") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return res.end("demo file");
  }
  if (p === "/api/settings" && m === "GET") return json(res, 200, settings);
  if (p === "/api/settings" && m === "PUT") {
    settings = { ...settings, ...(await readBody(req)) };
    return json(res, 200, settings);
  }
  if (p.startsWith("/api/settings/notify/") && m === "POST") return json(res, 200, { ok: true });
  if (p === "/api/status") return json(res, 200, status());
  if (p === "/api/activity/stream") {
    const s = sse(res);
    activityClients.add(s);
    req.on("close", () => activityClients.delete(s));
    return;
  }
  if (p === "/api/proxy") {
    if (m === "PUT") return json(res, 200, { ok: true });
  }
  if (p === "/api/proxy/subscription/nodes" && m === "GET") return json(res, 200, nodes);
  if (p === "/api/proxy/select" && m === "POST") {
    const b = await readBody(req);
    const n = nodes.find((x) => x.index === b.index);
    if (n) proxy.current = { scheme: n.scheme, host: n.host, port: n.port, remark: n.remark };
    broadcastActivity();
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: "nf", message: `no route: ${m} ${p}` });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock api on http://127.0.0.1:${PORT}`));
