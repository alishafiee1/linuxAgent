// End-to-end: a real browser against the real server and web app. Only the AI engine is scripted,
// so these tests use no subscription. Needs a built web app and Chromium. Run: pnpm e2e
import { authenticator } from "otplib";
import { chromium, type Browser, type Page } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
import { UploadService } from "../src/uploads.js";
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
    if (o.prompt.includes("GIVEFILE")) {
      writeFileSync(join(o.cwd, "report.txt"), "report body");
      writeFileSync(join(o.cwd, "chart.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAAMBAQAY3Y2wAAAAAElFTkSuQmCC", "base64"));
      await tool("send_file").run({ path: "report.txt", caption: "گزارش آماده است" });
      out = await tool("send_file").run({ path: "chart.png" });
    }
    if (o.prompt.includes("/uploads/")) out = `I got ${o.prompt.match(/\/uploads\/\S+/)?.[0] ?? ""}`;
    if (o.prompt.includes("SLOWSTEP")) {
      const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
      await pause(1200);
      yield { kind: "tool_use", id: "t1", name: "Read", input: { file_path: "/home/agent/workspace/گزارش.md" } };
      await pause(1200);
      yield { kind: "tool_result", toolUseId: "t1", content: "x", isError: false };
      await pause(1200);
      yield { kind: "tool_use", id: "t2", name: "Bash", input: { command: "ls", description: "فهرست فایل‌ها" } };
      await pause(1200);
      yield { kind: "tool_result", toolUseId: "t2", content: "x", isError: false };
    }
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
let workspace: string;
let settingsStore: SettingsStore;
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
  settingsStore = settings;
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
  mkdirSync(join(dir, "workspace"), { recursive: true });
  mkdirSync(join(dir, "bots"), { recursive: true });
  workspace = join(dir, "workspace");
  const uploads = new UploadService(join(dir, "tmp"), files, workspace, join(dir, "bots"));
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
    toolsFor: (ctx) => buildPanelTools({ bots, orchestrator: () => orchestrator, pages, connectors, browser: browserSvc, bridge, platforms, uploads }, ctx),
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
    ext: { routines, knowledge, vault, browser: browserSvc, pages, connectors, bridge, platforms, requests, uploads },
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

/** With CWP_E2E_SHOTS set to a folder, keeps a picture of each new card for a person to look at. */
const shot = async (name: string, target: Page = page): Promise<void> => {
  if (process.env.CWP_E2E_SHOTS) await target.screenshot({ path: join(process.env.CWP_E2E_SHOTS, `${name}.png`) });
};

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
    await shot("question-card");

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
    await page.locator(".platform").first().waitFor();
    await shot("connections");
    await page.locator(".platform", { hasText: "Slack" }).locator("button").click();
    const dlg = page.locator("dialog[open]");
    await dlg.locator(".connect-steps").waitFor();
    await shot("connect-dialog");
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
    await shot("takeover-card");
    await card.locator("button.primary").click();
    await card.waitFor({ state: "detached" });
    await expect.poll(() => page.locator(".bubble.assistant").last().innerText()).toContain("done");
  }, 60_000);

  it("attaches a file with progress, can remove it, and the bot gets its path", async () => {
    const picker = page.locator('[data-testid="file-picker"]');
    await picker.setInputFiles({ name: "حذف.txt", mimeType: "text/plain", buffer: Buffer.from("remove me") });
    const first = page.locator(".upload-item", { hasText: "حذف.txt" });
    await first.locator(".upload-meta", { hasText: "آماده" }).waitFor();
    await first.locator("button").click();
    await first.waitFor({ state: "detached" });

    const big = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
    await picker.setInputFiles({ name: "big.bin", mimeType: "application/octet-stream", buffer: big });
    await page.locator(".upload-item.done", { hasText: "big.bin" }).waitFor({ timeout: 20_000 });
    await shot("upload-ready");
    await page.locator(".composer button.primary").click();
    await page.locator(".upload-item").waitFor({ state: "detached" });
    const reply = page.locator(".bubble.assistant", { hasText: "big.bin" }).last();
    await reply.waitFor();
    const rel = (await reply.innerText()).match(/uploads\/\S+/)![0];
    expect(readFileSync(join(workspace, rel)).equals(big)).toBe(true);
    await page.locator(".bubble.user a.dl").last().waitFor();
  }, 40_000);

  it("takes a pasted file with Ctrl+V and leaves pasted text alone", async () => {
    const box = page.locator(".composer textarea");
    await box.evaluate((el) => {
      const data = new DataTransfer();
      data.items.add(new File(["shot"], "screenshot.png", { type: "image/png" }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await page.locator(".upload-item.done", { hasText: "screenshot.png" }).waitFor();
    expect(await box.inputValue()).toBe("");
    await page.locator(".upload-item button").click();
  });

  it("shows an error for a file that is too big, and it can be dismissed", async () => {
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="file-picker"]')!;
      const data = new DataTransfer();
      const huge = new File([new ArrayBuffer(1)], "huge.bin");
      Object.defineProperty(huge, "size", { value: 60 * 1024 * 1024 });
      data.items.add(huge);
      Object.defineProperty(input, "files", { value: [huge], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const row = page.locator(".upload-item.error", { hasText: "huge.bin" });
    await row.waitFor();
    expect(await row.innerText()).toContain("مگابایت");
    await row.locator("button.icon-btn").click();
    await row.waitFor({ state: "detached" });
  });

  it("lets a bot give the person files to download, with a preview", async () => {
    await send("GIVEFILE");
    const card = page.locator(".file-card", { hasText: "report.txt" });
    await card.waitFor();
    expect(await card.innerText()).toContain("گزارش آماده است");
    const [download] = await Promise.all([page.waitForEvent("download"), card.locator("a.dl").click()]);
    expect(download.suggestedFilename()).toBe("report.txt");
    const image = page.locator(".file-card img");
    await image.waitFor();
    await expect.poll(() => image.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
    await shot("file-cards");
    const script = await page.evaluate(async () => {
      const r = await fetch("/api/files/download?root=workspace&path=report.txt&inline=1");
      return r.headers.get("content-disposition");
    });
    expect(script).toContain("attachment");
  });

  it("shows core skills as locked and refuses to delete them", async () => {
    await openPage("حافظه");
    const row = page.locator(".row", { hasText: "Panel guide" });
    await row.locator(".pill").waitFor();
    expect(await row.locator("button").count()).toBe(0);
    const status = await page.evaluate(async () => (await fetch("/api/skills/panel-guide", { method: "DELETE", headers: { "x-cwp": "1" } })).status);
    expect(status).toBe(403);
  });

  it("shows plan limits and top usage on the usage page", async () => {
    await page.evaluate(() => undefined);
    settingsStore.savePlanLimit({ status: "allowed_warning", resetsAt: Date.now() + 86_400_000, limitType: "seven_day", utilization: 0.85 });
    await send("سلام");
    await page.locator(".activity").waitFor({ state: "detached" });
    await openPage("مصرف");
    const limit = page.locator(".plan-limit", { hasText: "سقف هفتگی" });
    await limit.waitFor();
    expect(await limit.locator('[role="progressbar"]').getAttribute("aria-valuenow")).toBe("85");
    await page.locator(".top-usage").first().waitFor();
    await shot("usage");
  });

  it("says what the bot is doing while it works, with time and steps", async () => {
    await send("SLOWSTEP");
    const label = page.locator(".activity").last();
    await label.locator(".activity-text", { hasText: "در حال فکر کردن" }).waitFor();
    await label.locator(".activity-text", { hasText: "خواندن فایل گزارش.md" }).waitFor();
    await shot("activity");
    await label.locator(".activity-text", { hasText: "اجرای دستور: فهرست فایل‌ها" }).waitFor();
    expect(await label.innerText()).toContain("2 قدم");
    expect(await label.locator('.activity-meta[dir="ltr"]').innerText()).toMatch(/^\d+:\d\d$/);
    await page.locator(".activity").waitFor({ state: "detached" });
  });

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

  it("fits the question card on a phone", async () => {
    const p = await signIn({ width: 390, height: 800 });
    await p.locator(".composer textarea").fill("ASK");
    await p.locator(".composer button.primary").click();
    const card = p.locator(".request-card");
    await card.waitFor();
    await shot("question-card-phone", p);
    expect(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await card.locator(".ghost").click();
    await p.context().close();
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
