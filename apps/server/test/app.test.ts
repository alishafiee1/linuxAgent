import { authenticator } from "otplib";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/service.js";
import { buildApp, COOKIE } from "../src/app.js";
import { FakeEngine, KEY, ok, setup } from "./helpers.js";

async function makeApp() {
  const t = setup(new FakeEngine(() => [{ kind: "text", text: "hello" }, ok()]));
  const auth = new AuthService(t.db, KEY);
  const { secret } = await auth.createUser("masoud", "correct horse battery");
  const workspace = join(t.dir, "workspace");
  mkdirSync(join(workspace, "sub"), { recursive: true });
  writeFileSync(join(workspace, "sub", "a.txt"), "A");
  symlinkSync("/etc", join(workspace, "escape"));
  const app = await buildApp({
    config: { cookieSecure: false, workspaceDir: workspace, botsDir: join(t.dir, "bots"), agentHome: t.dir, webDist: null },
    db: t.db,
    auth,
    bots: t.bots,
    orchestrator: t.orchestrator,
    approvals: t.approvals,
    events: t.events,
    settings: t.settings,
    notifier: null,
    proxy: null,
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "x-cwp": "1" },
    payload: { username: "masoud", password: "correct horse battery", code: authenticator.generate(secret) },
  });
  const cookie = login.cookies.find((c) => c.name === COOKIE)!;
  const h = { cookie: `${COOKIE}=${cookie.value}`, "x-cwp": "1" };
  return { t, app, h, login };
}

describe("http api", () => {
  it("requires a session and the CSRF header", async () => {
    const { app, h, login } = await makeApp();
    expect(login.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/bots" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/bots", headers: { cookie: h.cookie }, payload: { name: "x" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/bots", headers: h })).statusCode).toBe(200);
  });

  it("creates a bot, sends a message and replays events after a given seq", async () => {
    const { t, app, h } = await makeApp();
    const bot = (await app.inject({ method: "POST", url: "/api/bots", headers: h, payload: { name: "Writer", persona: "short answers" } })).json();
    const conv = (await app.inject({ method: "POST", url: `/api/bots/${bot.id}/conversations`, headers: h, payload: {} })).json();
    const { runId } = (await app.inject({ method: "POST", url: `/api/conversations/${conv.id}/messages`, headers: h, payload: { text: "سلام" } })).json();
    await t.orchestrator.idle();
    const all = (await app.inject({ method: "GET", url: `/api/runs/${runId}/events`, headers: h })).json() as { seq: number }[];
    const tail = (await app.inject({ method: "GET", url: `/api/runs/${runId}/events?after=2`, headers: h })).json() as { seq: number }[];
    expect(tail.map((e) => e.seq)).toEqual(all.filter((e) => e.seq > 2).map((e) => e.seq));
    expect((await app.inject({ method: "GET", url: `/api/runs/${runId}`, headers: h })).json().state).toBe("done");
  });

  it("serves files only inside the roots (R15)", async () => {
    const { app, h } = await makeApp();
    const list = (await app.inject({ method: "GET", url: "/api/files?root=workspace&path=sub", headers: h })).json();
    expect(list).toMatchObject([{ name: "a.txt", path: "sub/a.txt", type: "file" }]);
    expect((await app.inject({ method: "GET", url: "/api/files/download?root=workspace&path=sub/a.txt", headers: h })).body).toBe("A");
    expect((await app.inject({ method: "GET", url: "/api/files?root=workspace&path=../../", headers: h })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/files/download?root=workspace&path=escape/passwd", headers: h })).statusCode).toBe(404);
  });

  it("never returns notification tokens", async () => {
    const { app, h } = await makeApp();
    const r = await app.inject({ method: "PUT", url: "/api/settings", headers: h, payload: { telegram: { token: "999:SECRET", chatId: "1" } } });
    expect(r.body).not.toContain("SECRET");
    expect(r.json().telegram).toEqual({ configured: true, chatId: "1" });
  });
});
