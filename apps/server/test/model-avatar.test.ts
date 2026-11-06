import { AVATAR_COUNT as SHARED_AVATAR_COUNT } from "@linux-agent/shared";
import { authenticator } from "otplib";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/service.js";
import { buildApp, COOKIE } from "../src/app.js";
import { AVATAR_COUNT } from "../src/bots.js";
import { FakeEngine, KEY, ok, setup, tick } from "./helpers.js";

async function makeApp() {
  const t = setup(new FakeEngine(() => [{ kind: "text", text: "hello" }, ok()]));
  const auth = new AuthService(t.db, KEY);
  const { secret } = await auth.createUser("masoud", "correct horse battery");
  const workspace = join(t.dir, "workspace");
  mkdirSync(workspace, { recursive: true });
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
  return { t, app, h: { cookie: `${COOKIE}=${cookie.value}`, "x-cwp": "1" } };
}

describe("bot avatar and effort (cycle 022)", () => {
  it("keeps the server and shared avatar counts equal (R2)", () => {
    expect(AVATAR_COUNT).toBe(SHARED_AVATAR_COUNT);
  });

  it("gives every new bot a stored avatar in range and no effort (R1, R2)", () => {
    const t = setup(new FakeEngine(() => [ok()]));
    const bots = Array.from({ length: 12 }, (_, i) => t.bots.create({ name: `bot${i}` }));
    for (const b of bots) {
      expect(b.avatar).toBeGreaterThanOrEqual(1);
      expect(b.avatar).toBeLessThanOrEqual(AVATAR_COUNT);
      expect(b.effort).toBeNull();
    }
    expect(t.bots.get(bots[0]!.id).avatar).toBe(bots[0]!.avatar);
  });

  it("falls back to a stable avatar for a bot made before avatars existed (R2)", () => {
    const t = setup(new FakeEngine(() => [ok()]));
    t.db.prepare("UPDATE bots SET avatar = NULL WHERE id = ?").run(t.bot.id);
    const first = t.bots.get(t.bot.id).avatar;
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(AVATAR_COUNT);
    expect(t.bots.get(t.bot.id).avatar).toBe(first);
  });

  it("stores effort and a new avatar on update, and keeps them when other fields change (R1, R2)", () => {
    const t = setup(new FakeEngine(() => [ok()]));
    const a = t.bots.update(t.bot.id, { effort: "high", avatar: 7 });
    expect(a).toMatchObject({ effort: "high", avatar: 7 });
    const b = t.bots.update(t.bot.id, { persona: "short" });
    expect(b).toMatchObject({ effort: "high", avatar: 7, persona: "short" });
    expect(t.bots.update(t.bot.id, { effort: null }).effort).toBeNull();
  });

  it("sends effort to the engine only when the bot has one (R1)", async () => {
    const engine = new FakeEngine(() => [ok()]);
    const t = setup(engine);
    t.orchestrator.submit(t.conv.id, "one");
    await t.orchestrator.idle();
    expect(engine.calls[0]!.effort).toBeUndefined();
    t.bots.update(t.bot.id, { effort: "max" });
    t.orchestrator.submit(t.conv.id, "two");
    await t.orchestrator.idle();
    expect(engine.calls[1]!.effort).toBe("max");
  });

  it("refuses a bad effort or avatar over http (R1, R2)", async () => {
    const { app, h, t } = await makeApp();
    const patch = (payload: object) => app.inject({ method: "PATCH", url: `/api/bots/${t.bot.id}`, headers: h, payload });
    expect((await patch({ effort: "extreme" })).statusCode).toBe(400);
    expect((await patch({ avatar: 0 })).statusCode).toBe(400);
    expect((await patch({ avatar: AVATAR_COUNT + 1 })).statusCode).toBe(400);
    expect((await patch({ avatar: 1.5 })).statusCode).toBe(400);
    const good = await patch({ effort: "low", avatar: 3, model: "sonnet" });
    expect(good.statusCode).toBe(200);
    expect(good.json()).toMatchObject({ effort: "low", avatar: 3, model: "sonnet" });
  });

  it("names the bot on every pending approval (R3)", async () => {
    const engine = new FakeEngine(() => [{ gate: "Bash", input: { command: "git push origin main" } }, ok()]);
    const t = setup(engine);
    const run = t.orchestrator.submit(t.conv.id, "go");
    await tick(10);
    const pending = t.approvals.list("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ botId: t.bot.id, botName: "Coder" });
    t.approvals.decide(pending[0]!.id, true, "panel");
    await t.orchestrator.idle();
    expect(t.orchestrator.get(run.id).state).toBe("done");
  });
});
