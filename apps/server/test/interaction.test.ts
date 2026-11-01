import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateTool } from "../src/approval/policy.js";
import { describeTool } from "../src/approval/describe.js";
import { AgentFiles } from "../src/knowledge.js";
import { LearningService, LEARNER_NAME } from "../src/learning.js";
import { Notifier, type FetchLike } from "../src/notify/notifier.js";
import { PlatformService } from "../src/platforms.js";
import { RequestService } from "../src/requests.js";
import { KnowledgeService } from "../src/knowledge.js";
import { BotService } from "../src/bots.js";
import { MAX_UPLOAD_BYTES, safeName, UploadService } from "../src/uploads.js";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { MAX_MESSAGE_DEPTH } from "../src/runs/orchestrator.js";
import { deferred, FakeEngine, ok, setup, tick } from "./helpers.js";

const signal = () => new AbortController().signal;
const COLOR = { question: "چه رنگی؟", options: [{ label: "گرم" }, { label: "آبی" }] };
const ANIM = { question: "انیمیشن؟", options: [{ label: "ملایم" }, { label: "فعال" }], multiSelect: true };

function waitingRun() {
  const hold = deferred();
  const t = setup(new FakeEngine(() => [{ wait: hold.promise }, ok()]));
  const run = t.orchestrator.submit(t.conv.id, "x");
  const requests = new RequestService(t.db);
  return { t, run, requests, hold };
}

describe("requests", () => {
  it("resolves on the first answer and refuses a second one", async () => {
    const { t, run, requests, hold } = waitingRun();
    const { request, done } = requests.ask(run.id, "questions", { questions: [COLOR] }, signal());
    expect(requests.pending()).toHaveLength(1);
    expect(requests.pending()[0]!.botName).toBe("Coder");
    expect(() => requests.answer(request.id, { answers: {} }, "panel")).toThrow();
    requests.answer(request.id, { answers: { [COLOR.question]: ["گرم"] } }, "telegram");
    const final = await done;
    expect(final.state).toBe("answered");
    expect(final.channel).toBe("telegram");
    expect(() => requests.answer(request.id, { answers: { [COLOR.question]: ["آبی"] } }, "bale")).toThrow();
    hold.resolve();
    await t.orchestrator.idle();
  });

  it("cancels when the run stops, expires when late, and clears after a restart", async () => {
    const { t, run, requests, hold } = waitingRun();
    const ctrl = new AbortController();
    const a = requests.ask(run.id, "browser", { reason: "r", url: null }, ctrl.signal);
    ctrl.abort();
    expect((await a.done).state).toBe("cancelled");
    const quick = new RequestService(t.db, 5);
    expect((await quick.ask(run.id, "browser", { reason: "r", url: null }, signal()).done).state).toBe("expired");
    requests.ask(run.id, "browser", { reason: "r", url: null }, signal());
    requests.expireAllPending();
    expect(requests.pending()).toHaveLength(0);
    hold.resolve();
    await t.orchestrator.idle();
  });

  it("limits the size of a question card", () => {
    const { t, run, requests, hold } = waitingRun();
    expect(() => requests.ask(run.id, "questions", { questions: [] }, signal())).toThrow();
    expect(() => requests.ask(run.id, "questions", { questions: Array(7).fill(COLOR) }, signal())).toThrow();
    hold.resolve();
    return t.orchestrator.idle();
  });

  it("turns Claude's own question tool into a card and returns the answers", async () => {
    const engine = new FakeEngine(() => [{ gate: "AskUserQuestion", input: { questions: [COLOR] } }, ok()]);
    const t = setup(engine);
    const requests = new RequestService(t.db);
    (t.orchestrator as unknown as { d: { requests: RequestService } }).d.requests = requests;
    t.orchestrator.submit(t.conv.id, "x");
    await tick(5);
    const [req] = requests.pending();
    expect(req!.kind).toBe("questions");
    requests.answer(req!.id, { answers: { [COLOR.question]: ["آبی"] } }, "panel");
    await t.orchestrator.idle();
    expect(engine.decisions).toEqual([{ tool: "AskUserQuestion", allow: true }]);
    expect(t.approvals.list("pending")).toHaveLength(0);
  });
});

describe("Bale and Telegram cards", () => {
  function channel() {
    const { t, run, requests, hold } = waitingRun();
    t.settings.apply({ telegram: { token: "1:x", chatId: "7" } });
    const sent: { method: string; body: Record<string, unknown> }[] = [];
    let msgId = 100;
    const fetchFn: FetchLike = async (url, init) => {
      const method = String(url).split("/").pop()!;
      sent.push({ method, body: JSON.parse(init?.body ?? "{}") as Record<string, unknown> });
      return { json: async () => ({ ok: true, result: { message_id: ++msgId } }) };
    };
    const n = new Notifier(t.db, t.settings, t.approvals, fetchFn);
    n.attachRequests(requests, "https://panel.test");
    const api = { call: async () => ({}) } as never;
    const press = (data: string) => n.handleUpdate("telegram", api, "7", { update_id: 1, callback_query: { id: "c", data, message: { message_id: 1, chat: { id: 7 } } } });
    const say = (text: string, chat = 7) => n.handleUpdate("telegram", api, "7", { update_id: 2, message: { text, chat: { id: chat } } });
    return { t, run, requests, hold, sent, press, say };
  }

  it("sends each question with buttons, not raw JSON, and collects answers", async () => {
    const { t, run, requests, hold, sent, press } = channel();
    const { request, done } = requests.ask(run.id, "questions", { questions: [COLOR, ANIM] }, signal());
    await tick(5);
    const msgs = sent.filter((s) => s.method === "sendMessage");
    expect(msgs).toHaveLength(2);
    expect(String(msgs[0]!.body.text)).toContain(COLOR.question);
    expect(String(msgs[0]!.body.text)).not.toContain("{");
    const kb = msgs[1]!.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
    expect(kb.inline_keyboard.map((r) => r[0]!.text)).toEqual(["ملایم", "فعال", "سایر (نوشتن)", "تأیید این پرسش"]);
    for (const row of kb.inline_keyboard) expect(Buffer.byteLength(row[0]!.callback_data)).toBeLessThanOrEqual(64);

    await press(`rq:${request.id}:0:1`);
    await press(`rq:${request.id}:1:0`);
    await press(`rq:${request.id}:1:1`);
    expect(requests.get(request.id).state).toBe("pending");
    await press(`rq:${request.id}:1:d`);
    const final = await done;
    expect(final.answer?.answers).toEqual({ [COLOR.question]: ["آبی"], [ANIM.question]: ["ملایم", "فعال"] });
    expect(final.channel).toBe("telegram");
    await tick(5);
    expect(sent.filter((s) => s.method === "editMessageText")).toHaveLength(2);
    hold.resolve();
    await t.orchestrator.idle();
  });

  it("takes free text after the other button, only from the right chat", async () => {
    const { t, run, requests, hold, press, say } = channel();
    const { request, done } = requests.ask(run.id, "questions", { questions: [COLOR] }, signal());
    await tick(5);
    await say("بدون فشردن دکمه");
    expect(requests.get(request.id).state).toBe("pending");
    await press(`rq:${request.id}:0:o`);
    await say("از غریبه", 999);
    expect(requests.get(request.id).state).toBe("pending");
    await say("سبز تیره");
    expect((await done).answer?.answers?.[COLOR.question]).toEqual(["سبز تیره"]);
    hold.resolve();
    await t.orchestrator.idle();
  });

  it("offers a link for a connection and never asks for a key in chat", async () => {
    const { t, run, requests, hold, sent } = channel();
    requests.ask(run.id, "connection", { platform: "github", reason: "برای مخزن" }, signal());
    await tick(5);
    const msg = sent.find((s) => s.method === "sendMessage")!;
    expect(String(msg.body.text)).toContain("فقط در پنل");
    expect(JSON.stringify(msg.body.reply_markup)).toContain("https://panel.test/?inbox=1");
    requests.expireAllPending();
    hold.resolve();
    await t.orchestrator.idle();
  });

  it("continues after the browser turn from a button", async () => {
    const { t, run, requests, hold, press } = channel();
    const { request, done } = requests.ask(run.id, "browser", { reason: "کد را بزن", url: null }, signal());
    await tick(5);
    await press(`rq:${request.id}:0:f`);
    expect((await done).state).toBe("answered");
    hold.resolve();
    await t.orchestrator.idle();
  });
});

describe("connections", () => {
  function platforms(handler: (url: URL, init: RequestInit) => Response = () => new Response("{}")) {
    const t = setup(new FakeEngine(() => [ok()]));
    const calls: { url: string; headers: Record<string, string>; redirect?: string }[] = [];
    const fetchFn = (async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string>, redirect: init.redirect });
      return handler(url, init);
    }) as unknown as typeof fetch;
    return { t, calls, p: new PlatformService(t.settings, "https://panel.test", fetchFn) };
  }

  it("never returns a secret, and stores it encrypted", () => {
    const { t, p } = platforms();
    const info = p.connect("github", { token: "ghp_SECRETVALUE" });
    expect(info.connected).toBe(true);
    expect(JSON.stringify(p.list())).not.toContain("SECRETVALUE");
    const stored = t.db.prepare("SELECT value FROM settings WHERE key = 'platform.github.token.secret'").get() as { value: string };
    expect(stored.value).not.toContain("SECRETVALUE");
    expect(() => p.connect("gitlab", {})).toThrow();
    expect(() => p.get("nope")).toThrow();
  });

  it("adds the key for its own service, hides it in the answer, and refuses to follow redirects", async () => {
    const { calls, p } = platforms(() => new Response('{"echo":"ghp_SECRETVALUE"}'));
    p.connect("github", { token: "ghp_SECRETVALUE" });
    const r = await p.call("github", "GET", "/user");
    expect(calls[0]!.url).toBe("https://api.github.com/user");
    expect(calls[0]!.headers.authorization).toBe("Bearer ghp_SECRETVALUE");
    expect(calls[0]!.redirect).toBe("error");
    expect(r.text).not.toContain("SECRETVALUE");
  });

  it("cannot send the key to another host", async () => {
    const { calls, p } = platforms();
    p.connect("github", { token: "t" });
    await expect(p.call("github", "GET", "@evil.test/x")).rejects.toThrow();
    await expect(p.call("github", "GET", "https://evil.test/x")).rejects.toThrow();
    await p.call("github", "GET", "//evil.test/x").catch(() => {});
    await p.call("github", "GET", "/../../x").catch(() => {});
    for (const c of calls) expect(new URL(c.url).host).toBe("api.github.com");
  });

  it("refuses a service that is not connected", async () => {
    const { p } = platforms();
    await expect(p.call("slack", "GET", "/auth.test")).rejects.toThrow("request_connection");
  });

  it("supports a custom service, https only, and basic auth for Jira", async () => {
    const { calls, p } = platforms();
    expect(() => p.addCustom({ name: "x", baseUrl: "http://a.test", header: "authorization", template: "Bearer {token}" }, "k")).toThrow();
    const c = p.addCustom({ name: "My API", baseUrl: "https://a.test/v1/", header: "X-Key", template: "{token}" }, "k1");
    expect(c.id).toBe("custom-my-api");
    expect(p.list().map((x) => x.id)).toContain("custom-my-api");
    await p.call(c.id, "GET", "/items");
    expect(calls[0]!.url).toBe("https://a.test/v1/items");
    expect(calls[0]!.headers["x-key"]).toBe("k1");
    p.disconnect(c.id);
    expect(p.list().map((x) => x.id)).not.toContain("custom-my-api");
    expect(() => p.connect("jira", { domain: "../evil", email: "a@b", token: "t" })).toThrow();
    p.connect("jira", { domain: "acme", email: "a@b", token: "t" });
    await p.call("jira", "GET", "/rest/api/3/myself");
    expect(calls[1]!.url).toContain("acme.atlassian.net");
    expect(calls[1]!.headers.authorization).toBe(`Basic ${Buffer.from("a@b:t").toString("base64")}`);
  });

  it("reports a bad key from the test call", async () => {
    const { p } = platforms(() => new Response("no", { status: 401 }));
    p.connect("github", { token: "bad" });
    expect((await p.test("github")).ok).toBe(false);
  });

  it("lets reads run, and asks before anything changes", () => {
    const auto = (input: Record<string, unknown>) => evaluateTool("mcp__cwp__call_api", input, "/home/agent").auto;
    expect(auto({ connection: "github", method: "GET", path: "/user" })).toBe(true);
    expect(auto({ connection: "github", method: "POST", path: "/x" })).toBe(false);
    expect(auto({ connection: "github", method: "delete", path: "/x" })).toBe(false);
    expect(auto({})).toBe(true);
    for (const n of ["ask_user", "request_connection", "request_browser_takeover", "send_message_to_bot"]) expect(evaluateTool(`mcp__cwp__${n}`, {}, "/h").auto).toBe(true);
  });
});

describe("messages between bots", () => {
  it("does not wait, keeps one conversation per pair, and stops long chains", async () => {
    const engine = new FakeEngine(() => [ok()]);
    const t = setup(engine, { maxConcurrent: 5 });
    const b = t.bots.create({ name: "B" });
    const parent = t.orchestrator.submit(t.conv.id, "start");
    await t.orchestrator.idle();
    const p = t.orchestrator.get(parent.id);
    const one = t.orchestrator.sendToBot(p, b.id, "سلام");
    const two = t.orchestrator.sendToBot(p, b.id, "دوباره");
    expect(one.conversationId).toBe(two.conversationId);
    await t.orchestrator.idle();
    expect(engine.calls.at(-1)!.prompt).toContain('Message from the bot "Coder"');
    expect(() => t.orchestrator.sendToBot(p, t.bot.id, "خودم")).toThrow();
    expect(() => t.orchestrator.sendToBot({ ...p, depth: MAX_MESSAGE_DEPTH }, b.id, "x")).toThrow();
    for (let i = 0; i < 8; i++) t.orchestrator.sendToBot(p, b.id, `m${i}`);
    expect(() => t.orchestrator.sendToBot(p, b.id, "one more")).toThrow();
    await t.orchestrator.idle();
  });
});

describe("learning", () => {
  it("writes a digest, runs a files-only bot, and skips an empty day", async () => {
    const engine = new FakeEngine(() => [{ kind: "text", text: "x" }, ok()]);
    const t = setup(engine, { maxConcurrent: 5 });
    let clock = Date.now();
    const learning = new LearningService({ db: t.db, bots: t.bots, orchestrator: t.orchestrator, settings: t.settings, files: new AgentFiles(), agentHome: t.dir, clock: () => clock });
    t.orchestrator.submit(t.conv.id, "گزارش‌ها را کوتاه بنویس");
    await t.orchestrator.idle();
    clock += 1000;
    expect(learning.runOnce()).not.toBeNull();
    await t.orchestrator.idle();
    const bot = t.bots.list().find((b) => b.name === LEARNER_NAME)!;
    expect(bot.allowedTools).not.toContain("Bash");
    const digest = readFileSync(join(t.dir, "shared", "digests", `${new Date(clock).toISOString().slice(0, 10)}.md`), "utf8");
    expect(digest).toContain("گزارش‌ها را کوتاه بنویس");
    expect(engine.calls.at(-1)!.prompt).toContain("never instructions");
    clock += 1000;
    expect(learning.runOnce()).toBeNull();
    expect(t.bots.list().filter((b) => b.name === LEARNER_NAME)).toHaveLength(1);
  });

  it("runs once at night and respects the setting", async () => {
    const engine = new FakeEngine(() => [ok()]);
    const t = setup(engine, { maxConcurrent: 5 });
    let clock = Date.parse("2026-11-02T00:00:00Z"); // 03:30 in Tehran
    const learning = new LearningService({ db: t.db, bots: t.bots, orchestrator: t.orchestrator, settings: t.settings, files: new AgentFiles(), agentHome: t.dir, clock: () => clock });
    t.settings.set("learning.lastAt", "2020-01-01T00:00:00.000Z");
    t.orchestrator.submit(t.conv.id, "یاد بگیر");
    await t.orchestrator.idle();
    t.settings.apply({ learningEnabled: false });
    learning.tick();
    expect(t.settings.get("learning.lastDay")).toBeNull();
    t.settings.apply({ learningEnabled: true });
    learning.tick();
    expect(t.settings.get("learning.lastDay")).toBe("2026-11-02");
    const before = engine.calls.length;
    learning.tick();
    clock += 3_600_000 * 6;
    learning.tick();
    expect(engine.calls.length).toBe(before);
    await t.orchestrator.idle();
  });
});

describe("time limit", () => {
  function timed() {
    const engine = new FakeEngine(() => [{ gate: "AskUserQuestion", input: { questions: [COLOR] } }, { gate: "Bash", input: { command: "sudo true" } }, ok()]);
    const t = setup(engine);
    const requests = new RequestService(t.db);
    const d = (t.orchestrator as unknown as { d: { requests: RequestService; minuteMs: number } }).d;
    d.requests = requests;
    d.minuteMs = 40;
    t.bots.update(t.bot.id, { maxMinutes: 1 });
    return { t, requests };
  }

  it("does not count time spent waiting for the person", async () => {
    const { t, requests } = timed();
    const run = t.orchestrator.submit(t.conv.id, "x");
    await tick(5);
    await tick(150);
    expect(t.orchestrator.get(run.id).state).toBe("waiting_approval");
    requests.answer(requests.pending()[0]!.id, { answers: { [COLOR.question]: ["آبی"] } }, "panel");
    await tick(5);
    await tick(150);
    expect(t.orchestrator.get(run.id).state).toBe("waiting_approval");
    t.approvals.decide(t.approvals.list("pending")[0]!.id, true, "panel");
    await t.orchestrator.idle();
    expect(t.orchestrator.get(run.id).state).toBe("done");
  });

  it("still stops a bot that keeps working past its limit", async () => {
    const hold = deferred();
    const t = setup(new FakeEngine(() => [{ wait: hold.promise }, ok()]));
    (t.orchestrator as unknown as { d: { minuteMs: number } }).d.minuteMs = 20;
    t.bots.update(t.bot.id, { maxMinutes: 1 });
    const run = t.orchestrator.submit(t.conv.id, "x");
    await t.orchestrator.idle();
    expect(t.orchestrator.get(run.id).reason).toBe("max_minutes");
  });
});

describe("approval text", () => {
  it("says what will happen in plain words, with no JSON", () => {
    const call = describeTool("mcp__cwp__call_api", { connection: "elevenlabs", method: "POST", path: "/text-to-speech/x", body: JSON.stringify({ text: "سلام", model_id: "m" }) });
    expect(call).toContain("سرویس: elevenlabs");
    expect(call).toContain("text: سلام");
    expect(call).not.toContain("{");
    expect(describeTool("Bash", { command: "sudo true", description: "Test" })).toContain("sudo true");
    expect(describeTool("Write", { file_path: "/etc/x" })).toContain("/etc/x");
    const mail = describeTool("mcp__cwp__gmail_send", { to: "a@b.c", subject: "س", body: "متن" });
    expect(mail).toContain("متن");
    expect(describeTool("Unknown", { a: 1 })).toBe("a: 1");
    expect(describeTool("Bash", { command: "x".repeat(5000) }).length).toBeLessThan(800);
  });

  it("reaches Telegram without raw input", async () => {
    const t = setup(new FakeEngine(() => [{ gate: "mcp__cwp__call_api", input: { connection: "github", method: "POST", path: "/x", body: '{"title":"t"}' } }, ok()]));
    t.settings.apply({ telegram: { token: "1:x", chatId: "7" } });
    const sent: string[] = [];
    new Notifier(t.db, t.settings, t.approvals, (async (url: string, init?: { body?: string }) => {
      if (String(url).endsWith("sendMessage")) sent.push(String((JSON.parse(init?.body ?? "{}") as { text: string }).text));
      return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
    }) as FetchLike);
    t.orchestrator.submit(t.conv.id, "x");
    await tick(10);
    expect(sent[0]).toContain("سرویس: github");
    expect(sent[0]).not.toContain('"connection"');
    t.approvals.decide(t.approvals.list("pending")[0]!.id, false, "panel");
    await t.orchestrator.idle();
  });
});

describe("binary answers", () => {
  it("saves audio as a file and returns its path, not garbage", async () => {
    const t = setup(new FakeEngine(() => [ok()]));
    const saved: { name: string; size: number }[] = [];
    const p = new PlatformService(t.settings, "https://panel.test", (async () => new Response(new Uint8Array([73, 68, 51, 0]), { headers: { "content-type": "audio/mpeg" } })) as unknown as typeof fetch, (name, data) => {
      saved.push({ name, size: data.length });
      return `/w/${name}`;
    });
    p.connect("elevenlabs", { token: "k" });
    const r = await p.call("elevenlabs", "POST", "/text-to-speech/x", "{}");
    expect(saved[0]!.name).toMatch(/\.mp3$/);
    expect(saved[0]!.size).toBe(4);
    expect(r.text).toContain("saved to /w/");
  });
});

describe("files in chat", () => {
  function up() {
    const t = setup(new FakeEngine(() => [ok()]));
    const workspace = join(t.dir, "workspace");
    const bots = join(t.dir, "bots");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(bots, { recursive: true });
    return { t, workspace, u: new UploadService(join(t.dir, "tmp"), new AgentFiles(), workspace, bots) };
  }

  it("rebuilds a file from pieces and tolerates a piece sent twice", () => {
    const { u, workspace } = up();
    const { id } = u.start("گزارش.txt", 6);
    u.chunk(id, 0, Buffer.from("abc"));
    u.chunk(id, 0, Buffer.from("abc"));
    expect(() => u.finish(id)).toThrow();
    expect(() => u.chunk(id, 5, Buffer.from("x"))).toThrow();
    u.chunk(id, 1, Buffer.from("def"));
    const f = u.finish(id);
    expect(readFileSync(join(workspace, f.path), "utf8")).toBe("abcdef");
    expect(f.absolutePath).toContain("uploads");
    expect(f.name).toBe("گزارش.txt");
    expect(u.finish(id).path).toBe(f.path);
  });

  it("refuses a file too big, more data than promised, and bad names", () => {
    const { u } = up();
    expect(() => u.start("x", MAX_UPLOAD_BYTES + 1)).toThrow();
    const { id } = u.start("x", 1);
    expect(() => u.chunk(id, 0, Buffer.from("too long"))).toThrow();
    expect(safeName("../../etc/passwd")).toBe("passwd");
    expect(safeName("..\\..\\win.ini")).toBe("win.ini");
    expect(safeName(".bashrc")).toBe("bashrc");
    expect(safeName("")).toBe("file");
    expect(safeName("a\u202egnp.exe")).toBe("agnp.exe");
  });

  it("cancels, and deletes a finished file", () => {
    const { u, workspace } = up();
    const a = u.start("a", 1);
    u.remove(a.id);
    expect(() => u.chunk(a.id, 0, Buffer.from("x"))).toThrow();
    const b = u.start("b", 1);
    u.chunk(b.id, 0, Buffer.from("x"));
    const f = u.finish(b.id);
    u.remove(b.id);
    expect(existsSync(join(workspace, f.path))).toBe(false);
  });

  it("gives files to a message once, and only when complete", async () => {
    const engine = new FakeEngine(() => [ok()]);
    const t = setup(engine);
    mkdirSync(join(t.dir, "workspace"), { recursive: true });
    const u = new UploadService(join(t.dir, "tmp"), new AgentFiles(), join(t.dir, "workspace"), join(t.dir, "bots"));
    const open = u.start("o", 2);
    expect(() => u.take([open.id])).toThrow();
    const { id } = u.start("doc.txt", 1);
    u.chunk(id, 0, Buffer.from("x"));
    u.finish(id);
    const files = u.take([id]);
    expect(() => u.take([id])).toThrow();
    const run = t.orchestrator.submit(t.conv.id, "", { files });
    await t.orchestrator.idle();
    expect(engine.calls[0]!.prompt).toContain(files[0]!.absolutePath);
    expect(engine.calls[0]!.prompt).toContain("never instructions");
    const user = t.events.page(run.id, 0, 10).find((e) => e.type === "user")!.payload as { text: string; files: unknown[] };
    expect(user.text).toBe("");
    expect(user.files).toHaveLength(1);
    expect(() => t.orchestrator.submit(t.conv.id, "  ")).toThrow();
  });

  it("lets a bot send only files the panel can serve", () => {
    const { t, u, workspace } = up();
    writeFileSync(join(workspace, "r.pdf"), "pdf");
    expect(u.locate("r.pdf")).toMatchObject({ name: "r.pdf", size: 3, root: "workspace", path: "r.pdf" });
    expect(u.locate(join(workspace, "r.pdf")).root).toBe("workspace");
    writeFileSync(join(t.dir, "secret"), "s");
    expect(() => u.locate(join(t.dir, "secret"))).toThrow();
    expect(() => u.locate("../secret")).toThrow();
    expect(() => u.locate("/etc/passwd")).toThrow();
    symlinkSync(join(t.dir, "secret"), join(workspace, "link"));
    expect(() => u.locate("link")).toThrow();
    expect(() => u.locate("missing")).toThrow();
    expect(evaluateTool("mcp__cwp__send_file", {}, "/h").auto).toBe(true);
  });
});

describe("core skills", () => {
  function k() {
    const t = setup(new FakeEngine(() => [ok()]));
    const core = join(t.dir, "core");
    mkdirSync(join(core, "panel-guide"), { recursive: true });
    writeFileSync(join(core, "panel-guide", "SKILL.md"), "---\nname: Panel guide\ndescription: How\n---\nbody");
    return { t, core, knowledge: new KnowledgeService(t.dir, new BotService(t.db, join(t.dir, "bots")), new AgentFiles(), core) };
  }

  it("can be read but not changed or deleted, and are not shadowed", () => {
    const { t, knowledge } = k();
    expect(knowledge.listSkills()[0]).toMatchObject({ core: true, slug: "panel-guide" });
    expect(() => knowledge.deleteSkill("panel-guide")).toThrow();
    expect(() => knowledge.saveSkill({ name: "x", description: "y", body: "z" }, "panel-guide")).toThrow();
    mkdirSync(join(t.dir, "shared", "skills", "panel-guide"), { recursive: true });
    writeFileSync(join(t.dir, "shared", "skills", "panel-guide", "SKILL.md"), "---\nname: Fake\ndescription: bad\n---\n");
    expect(knowledge.listSkills().filter((s) => s.slug === "panel-guide")).toHaveLength(1);
    expect(knowledge.promptFor(t.bot)).not.toContain("Fake");
    expect(knowledge.promptFor(t.bot)).toContain(join("core", "panel-guide", "SKILL.md"));
  });

  it("gives a new skill with a core name its own folder", () => {
    const { knowledge } = k();
    expect(knowledge.saveSkill({ name: "Panel Guide", description: "d", body: "b" }).slug).toBe("panel-guide-2");
  });

  it("ships the file skill with the panel", () => {
    const t = setup(new FakeEngine(() => [ok()]));
    const real = new KnowledgeService(t.dir, new BotService(t.db, join(t.dir, "bots")), new AgentFiles());
    const names = real.listSkills().filter((s) => s.core).map((s) => s.slug);
    expect(names).toContain("send-and-receive-files");
    expect(names).toContain("panel-guide");
  });
});

describe("plan limits", () => {
  it("keeps the engine's report and forgets it after the reset", async () => {
    const resetsAt = Date.now() + 3_600_000;
    const t = setup(new FakeEngine(() => [{ kind: "rate_limit", status: "allowed_warning", resetsAt, limitType: "seven_day", utilization: 0.85 }, ok()]));
    t.orchestrator.submit(t.conv.id, "x");
    await t.orchestrator.idle();
    const [limit] = t.settings.planLimits();
    expect(limit).toMatchObject({ type: "seven_day", status: "allowed_warning", utilization: 0.85 });
    expect(t.settings.planLimits(resetsAt + 1)).toHaveLength(0);
  });

  it("ignores a report that names no limit", () => {
    const t = setup(new FakeEngine(() => [ok()]));
    t.settings.savePlanLimit({ status: "allowed", resetsAt: null });
    expect(t.settings.planLimits()).toHaveLength(0);
  });
});
