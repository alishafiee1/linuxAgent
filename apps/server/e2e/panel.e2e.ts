// End-to-end: a real browser against the real server and web app. Only the AI engine is scripted,
// so these tests use no subscription. Needs a built web app and Chromium. Run: pnpm e2e
import { authenticator } from "otplib";
import { chromium, type Browser, type Page } from "playwright-core";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApprovalService } from "../src/approval/service.js";
import { AuthService } from "../src/auth/service.js";
import { buildApp, COOKIE } from "../src/app.js";
import { BotService } from "../src/bots.js";
import { BridgeService } from "../src/bridge.js";
import { BrowserService } from "../src/browser/service.js";
import { Connectors } from "../src/connectors.js";
import { openDb } from "../src/db.js";
import type { Engine, EngineEvent, EngineStartOptions } from "../src/engine/types.js";
import { AgentFiles, KnowledgeService } from "../src/knowledge.js";
import { PageService } from "../src/pages.js";
import { buildPanelTools } from "../src/panelTools.js";
import { PlatformService } from "../src/platforms.js";
import { RequestService } from "../src/requests.js";
import { RoutineService } from "../src/routines/service.js";
import { EventStore } from "../src/runs/events.js";
import { Orchestrator } from "../src/runs/orchestrator.js";
import { SettingsStore } from "../src/settings.js";
import { VaultService } from "../src/vault.js";

const CHROMIUM = process.env.CWP_CHROMIUM ?? "/usr/bin/chromium";
const WEB = resolve(import.meta.dirname, "../../web/dist");
const QUESTIONS = [
  { question: "چه رنگی می‌پسندید؟", options: [{ label: "گرم" }, { label: "آبی ارغوانی" }] },
  { question: "سطح انیمیشن؟", options: [{ label: "ملایم" }, { label: "فعال" }], multiSelect: true },
];

/** Reads a keyword in the prompt and uses the real panel tools, as a bot would. */
class ScriptedEngine implements Engine {
  readonly name = "scripted";
  async *start(o: EngineStartOptions): AsyncIterable<EngineEvent> {
    const tool = (name: string) => o.panelTools!.find((t) => t.name === name)!;
    const text = (t: string): EngineEvent => ({ kind: "text", text: t });
    yield { kind: "session", sessionId: "s" };
    const gate = async (name: string, input: Record<string, unknown>): Promise<boolean> => (await o.canUseTool(`mcp__cwp__${name}`, input, o.abortController.signal)).allow;
    let out = "**بله** تمام شد";
    if (o.prompt.includes("ASK")) out = await tool("ask_user").run({ questions: QUESTIONS });
    if (o.prompt.includes("CONNECT")) out = await tool("request_connection").run({ platform: "notion", reason: "برای خواندن صفحه‌ها" });
    if (o.prompt.includes("TAKEOVER")) out = await tool("request_browser_takeover").run({ reason: "لطفاً وارد شوید" });
    if (o.prompt.includes("SEND")) out = await tool("send_message_to_bot").run({ bot: "دوم", message: "سلام" });
    if (o.prompt.includes("WRITE")) {
      const input = { connection: "github", method: "POST", path: "/repos/a/b/issues" };
      out = (await gate("call_api", input)) ? "allowed" : "refused";
    }
    yield text(out);
    yield { kind: "result", ok: true, subtype: "success", turns: 1, inputTokens: 1, outputTokens: 1, costUsd: 0, text: out, errorKind: null };
  }
}

let browser: Browser;
let page: Page;
let base: string;
let requests: RequestService;
let bots: BotService;
let close: () => Promise<void>;
let login: { password: string; secret: string };
const fetched: string[] = [];
const available = existsSync(CHROMIUM) && existsSync(join(WEB, "index.html"));

beforeAll(async () => {
  if (!available) return;
  const dir = mkdtempSync(join(tmpdir(), "cwp-e2e-"));
  const key = Buffer.alloc(32, 9);
  const db = openDb(":memory:");
  const settings = new SettingsStore(db, key);
  const files = new AgentFiles();
  bots = new BotService(db, join(dir, "bots"));
  const approvals = new ApprovalService(db);
  const events = new EventStore(db);
  requests = new RequestService(db);
  const vault = new VaultService(db, key);
  const browserSvc = new BrowserService({ bots, vault, files, agentHome: dir, agentExec: [], chromium: CHROMIUM, extraArgs: process.getuid?.() === 0 ? ["--no-sandbox"] : [] });
  const pages = new PageService(db, files, join(dir, "workspace"), "http://localhost");
  const connectors = new Connectors(settings, "http://localhost");
  const bridge = new BridgeService(db);
  const platforms = new PlatformService(settings, "http://localhost", (async (url: URL) => {
    fetched.push(String(url));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch);
  const knowledge = new KnowledgeService(dir, bots, files);
  const orchestrator: Orchestrator = new Orchestrator({
    db,
    engine: new ScriptedEngine(),
    bots,
    approvals,
    events,
    settings,
    requests,
    workspaceDir: join(dir, "workspace"),
    agentHome: dir,
    toolsFor: (ctx) => buildPanelTools({ bots, orchestrator: () => orchestrator, pages, connectors, browser: browserSvc, bridge, platforms }, ctx),
  });
  approvals.onChange({
    created: (a) => events.activity({ kind: "approval", approvalId: a.id, state: a.state }),
    decided: (a) => events.activity({ kind: "approval", approvalId: a.id, state: a.state }),
  });
  const routines = new RoutineService({ db, bots, orchestrator });
  const auth = new AuthService(db, key);
  const password = "e2e-only-password";
  const { secret } = await auth.createUser("e2e", password);
  login = { password, secret };
  const app = await buildApp({
    config: { cookieSecure: false, workspaceDir: join(dir, "workspace"), botsDir: join(dir, "bots"), agentHome: dir, webDist: WEB },
    db,
    auth,
    bots,
    orchestrator,
    approvals,
    events,
    settings,
    notifier: null,
    proxy: null,
    ext: { routines, knowledge, vault, browser: browserSvc, pages, connectors, bridge, platforms, requests },
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
  bots.create({ name: "اول", browser: true });
  bots.create({ name: "دوم" });
  close = async () => {
    for (const b of bots.list()) await browserSvc.close(b.id).catch(() => {});
    await browser.close();
    await orchestrator.shutdown();
    await app.close();
  };
}, 60_000);

afterAll(async () => {
  await close?.();
});

async function signIn(viewport = { width: 1400, height: 900 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  await p.goto(base);
  await p.fill('input[autocomplete="username"]', "e2e");
  await p.fill('input[type="password"]', login.password);
  await p.fill('input[autocomplete="one-time-code"]', authenticator.generate(login.secret));
  await p.click("button.primary");
  await p.waitForSelector(".nav button", { state: "attached" });
  return p;
}

const send = async (text: string): Promise<void> => {
  await page.locator(".composer textarea").fill(text);
  await page.locator(".composer button.primary").click();
};
const openPage = (name: string) => page.locator(".nav button", { hasText: name }).click();

describe.skipIf(!available)("panel end to end", () => {
  beforeEach(async () => {
    await page?.context().close();
    page = await signIn();
  });

  it("renders Markdown with no raw markers", async () => {
    await send("سلام");
    const reply = page.locator(".bubble.assistant").last();
    await reply.locator("strong", { hasText: "بله" }).waitFor();
    expect(await reply.innerText()).not.toContain("**");
    expect(await reply.locator("p").getAttribute("dir")).toBe("auto");
  });

  it("asks several questions on one card and returns the answers, with free text", async () => {
    await send("ASK");
    const card = page.locator(".request-card");
    await card.waitFor();
    expect(await card.locator("fieldset").count()).toBe(2);
    expect(await card.innerText()).not.toContain("{");
    expect(await card.locator('input[type="radio"]').count()).toBe(2);
    expect(await card.locator('input[type="checkbox"]').count()).toBe(2);

    await card.locator("button.primary").click();
    await page.locator(".request-card .err").waitFor();

    await card.locator("label.q-option", { hasText: "گرم" }).click();
    await card.locator("label.q-option", { hasText: "ملایم" }).click();
    await card.locator("label.q-option", { hasText: "فعال" }).click();
    await card.locator("fieldset").nth(1).locator('input[dir="auto"]').last().fill("با صدا");
    await card.locator("button.primary").click();
    await card.waitFor({ state: "detached" });
    const reply = page.locator(".bubble.assistant", { hasText: "با صدا" });
    await reply.waitFor();
    const text = await reply.innerText();
    expect(text).toContain("گرم");
    expect(text).toContain("ملایم");
    expect(text).toContain("فعال");
  });

  it("shows waiting questions on the approvals page and from a notification link", async () => {
    await send("ASK");
    await page.locator(".request-card").waitFor();
    const ctx = page.context();
    const other = await ctx.newPage();
    await other.goto(`${base}/?inbox=1`);
    await other.locator(".request-card").waitFor();
    expect(await other.locator(".request-card").innerText()).toContain("چه رنگی");
    await other.locator(".request-card .ghost").click();
    await other.close();
    await expect.poll(() => page.locator(".msg.state").last().innerText()).toBeTruthy();
    await page.locator(".request-card").waitFor({ state: "detached" });
  });

  it("collects a key in a card, tests it, and the bot never sees it", async () => {
    await send("CONNECT");
    const card = page.locator(".request-card");
    await card.locator('input[type="password"]').fill("ntn_E2E_SECRET");
    await card.locator("button.primary").click();
    await card.waitFor({ state: "detached" });
    await expect.poll(() => page.locator(".bubble.assistant").last().innerText()).toContain("Connected");
    expect(await page.content()).not.toContain("ntn_E2E_SECRET");
    expect(fetched.at(-1)).toBe("https://api.notion.com/v1/users/me");

    await openPage("اتصال‌ها");
    const row = page.locator(".platform", { hasText: "Notion" });
    await row.locator(".connected-mark").waitFor();
    page.on("dialog", (d) => void d.accept());
    await row.locator("button").click();
    await page.locator(".platform", { hasText: "Notion" }).locator("button", { hasText: "اتصال" }).waitFor();
  });

  it("connects from the page, adds a custom service, and shows how to get a key", async () => {
    await openPage("اتصال‌ها");
    await page.locator(".platform", { hasText: "Slack" }).locator("button").click();
    const dlg = page.locator("dialog[open]");
    expect(await dlg.locator(".connect-steps li").count()).toBeGreaterThan(0);
    expect(await dlg.locator("a.dl").getAttribute("href")).toContain("api.slack.com");
    await dlg.locator('input[type="password"]').fill("xoxb-e2e");
    await dlg.locator("button.primary").click();
    await page.locator(".platform", { hasText: "Slack" }).locator(".connected-mark").waitFor();

    await page.locator("button", { hasText: "سرویس دیگر" }).click();
    await dlg.locator("input").nth(0).fill("CRM");
    await dlg.locator("input").nth(1).fill("http://insecure.test");
    await dlg.locator('input[type="password"]').fill("k");
    await dlg.locator("button.primary").click();
    await dlg.locator(".err").waitFor();
    await dlg.locator("input").nth(1).fill("https://crm.test");
    await dlg.locator("button.primary").click();
    await page.locator(".platform", { hasText: "CRM" }).locator(".connected-mark").waitFor();

    await page.locator('input[aria-label="جست‌وجوی سرویس"]').fill("gith");
    expect(await page.locator(".platform").count()).toBe(1);
  });

  it("hands the live browser to the person and continues after Done", async () => {
    await send("TAKEOVER");
    const card = page.locator(".request-card");
    await card.locator(".browser-frame").waitFor({ timeout: 30_000 });
    expect(await card.innerText()).toContain("لطفاً وارد شوید");
    await card.locator("button.primary").click();
    await card.waitFor({ state: "detached" });
    await expect.poll(() => page.locator(".bubble.assistant").last().innerText()).toContain("done");
  }, 60_000);

  it("lets one bot message another without waiting", async () => {
    await send("SEND");
    await expect.poll(() => page.locator(".bubble.assistant").last().innerText()).toContain("Sent");
    await page.locator(".msg.state", { hasText: "پیام فرستاده شد" }).waitFor();
    await page.locator(".bot-item", { hasText: "دوم" }).click();
    await expect.poll(async () => (await page.locator(".chat-head select option").allInnerTexts()).join()).toContain("پیام از اول");
  });

  it("asks before a change through a service", async () => {
    await send("WRITE");
    const approval = page.locator(".approval", { hasText: "تغییر در github" });
    await approval.waitFor();
    await approval.locator("button.danger").click();
    await expect.poll(() => page.locator(".bubble.assistant").last().innerText()).toContain("refused");
  });

  it("keeps every page inside the screen on desktop and phone", async () => {
    for (const viewport of [{ width: 1400, height: 900 }, { width: 390, height: 800 }]) {
      const p = await signIn(viewport);
      const count = await p.locator(".nav button").count();
      expect(count).toBe(10);
      for (let i = 0; i < count; i++) {
        await p.locator(".nav button").nth(i).evaluate((b: HTMLElement) => b.click());
        await p.waitForTimeout(150);
        const over = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(over, `page ${i} at ${viewport.width}`).toBe(false);
      }
      await p.context().close();
    }
  }, 60_000);

  it("needs a session for the API", async () => {
    const r = await fetch(`${base}/api/platforms`);
    expect(r.status).toBe(401);
    expect(COOKIE).toBeTruthy();
    expect(requests.pending().filter((q) => q.state !== "pending")).toHaveLength(0);
  });
});
