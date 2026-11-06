import { describe, expect, it } from "vitest";
import { FAILOVER_COOLDOWN_MS, MAX_SAVED_LINKS, ProxyService, SYNC_EVERY_MS } from "../src/proxy/service.js";
import { FakeEngine, ok, setup, tick } from "./helpers.js";

const link = (host: string, tag: string) => `vless://11111111-2222-3333-4444-555555555555@${host}:4433?encryption=none&security=none&type=ws&path=%2F${tag}#${tag}`;
const A = link("a.example.com", "A");
const B = link("b.example.com", "B");
const C = link("c.example.com", "C");
const D = link("d.example.com", "D");
const SUB = "https://sub.test/token";
const IPS: Record<string, string> = { "a.example.com": "10.0.0.1", "b.example.com": "10.0.0.2", "c.example.com": "10.0.0.3", "d.example.com": "10.0.0.4" };

/** A proxy service with a fake sing-box: a server answers only while its IP is in `alive`. */
function make(opts: { alive?: string[]; blocked?: string[]; engineDown?: boolean } = {}) {
  const t = setup(new FakeEngine(() => [ok()]));
  const state = { current: "", alive: new Set(opts.alive ?? []), blocked: new Set(opts.blocked ?? []), engineDown: opts.engineDown ?? false, applied: [] as string[], now: 1_000_000, sub: "", subFails: false, subFetches: 0 };
  const fetchFn = (async (url: string) => {
    if (String(url).startsWith("https://sub.test")) {
      state.subFetches++;
      if (state.subFails) throw new Error("blocked by the kill switch");
      return new Response(state.sub, { status: 200 });
    }
    if (state.engineDown) throw new Error("connection refused");
    const path = String(url).replace("http://clash.test", "");
    if (path.startsWith("/proxies/") && path.includes("/delay")) {
      if (!state.alive.has(state.current)) throw new Error("timeout");
      return new Response(JSON.stringify({ delay: 42 }), { status: 200 });
    }
    return new Response(JSON.stringify({ proxies: { proxy: { type: "VLESS" } } }), { status: 200 });
  }) as unknown as typeof fetch;
  const proxy = new ProxyService({
    settings: t.settings,
    clashApiUrl: "http://clash.test",
    clashSecretPath: "/nonexistent",
    applyCommand: ["helper"],
    fetchFn,
    resolve: async (h) => IPS[h] ?? "10.9.9.9",
    runHelper: async (cmd) => {
      const ip = cmd[1]!;
      if (state.blocked.has(ip)) return { code: 3, stderr: "not allowed" };
      state.current = ip;
      state.applied.push(ip);
      return { code: 0, stderr: "" };
    },
    sleep: async () => {},
    nowMs: () => state.now,
  });
  return { proxy, state, settings: t.settings };
}

describe("saved proxy connections (cycle 023)", () => {
  it("adds, renames and removes links, and never shows a full link (R1, R3, R4, R6)", async () => {
    const { proxy } = make();
    await proxy.addConnection(A, "اصلی");
    const list = await proxy.addConnection(B);
    expect(list.map((c) => c.name)).toEqual(["اصلی", "B"]);
    expect(list[0]).toMatchObject({ scheme: "vless", host: "a.example.com", port: 4433, ip: "10.0.0.1", active: false });
    expect(JSON.stringify(list)).not.toContain("11111111-2222");
    await expect(proxy.addConnection(A)).rejects.toMatchObject({ status: 409, code: "duplicate" });
    await expect(proxy.addConnection("not a link")).rejects.toMatchObject({ status: 400, code: "bad_link" });
    const renamed = await proxy.renameConnection(list[1]!.id, "یدکی");
    expect(renamed[1]!.name).toBe("یدکی");
    expect((await proxy.removeConnection(list[1]!.id)).map((c) => c.name)).toEqual(["اصلی"]);
    await expect(proxy.removeConnection("missing")).rejects.toMatchObject({ status: 404 });
  });

  it("limits the list (R3)", async () => {
    const { proxy } = make();
    for (let i = 0; i < MAX_SAVED_LINKS; i++) await proxy.addConnection(link(`h${i}.example.com`, `n${i}`));
    await expect(proxy.addConnection(link("extra.example.com", "x"))).rejects.toMatchObject({ status: 409, code: "too_many" });
  });

  it("imports the link in use and refuses to delete it (R2, R4)", async () => {
    const { proxy } = make({ alive: ["10.0.0.1"] });
    await proxy.applyLink(A);
    const list = await proxy.listConnections();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ host: "a.example.com", active: true });
    await expect(proxy.removeConnection(list[0]!.id)).rejects.toMatchObject({ status: 409, code: "active" });
  });

  it("activates a saved link through the helper and passes its refusal on (R5)", async () => {
    const { proxy, state } = make({ blocked: ["10.0.0.2"] });
    await proxy.addConnection(A);
    const list = await proxy.addConnection(B);
    await proxy.activateConnection(list[0]!.id);
    expect(state.applied).toEqual(["10.0.0.1"]);
    await expect(proxy.activateConnection(list[1]!.id)).rejects.toMatchObject({ status: 409, code: "not_allowed" });
    expect((await proxy.listConnections()).find((c) => c.active)?.host).toBe("a.example.com");
  });

  it("says why the proxy is down (R7)", async () => {
    const down = make({ alive: [] });
    await down.proxy.applyLink(A);
    for (let i = 0; i < 3; i++) await down.proxy.check();
    expect(down.proxy.current()).toMatchObject({ state: "disconnected", reason: "server_unreachable" });

    const engine = make({ engineDown: true });
    await engine.proxy.applyLink(A);
    await engine.proxy.check();
    expect(engine.proxy.current().reason).toBe("engine_down");

    const good = make({ alive: ["10.0.0.1"] });
    await good.proxy.applyLink(A);
    await good.proxy.check();
    expect(good.proxy.current()).toMatchObject({ state: "connected", reason: null, latencyMs: 42 });
  });

  it("does nothing on its own while failover is off (R8)", async () => {
    const { proxy, state } = make({ alive: [] });
    await proxy.applyLink(A);
    await proxy.addConnection(C);
    state.applied.length = 0;
    for (let i = 0; i < 4; i++) await proxy.check();
    await tick(20);
    expect(state.applied).toEqual([]);
    expect(proxy.current().failover).toMatchObject({ enabled: false, lastAt: null });
  });

  it("moves to the first working link and skips one the kill switch blocks (R8)", async () => {
    const { proxy, state } = make({ alive: ["10.0.0.3"], blocked: ["10.0.0.2"] });
    await proxy.applyLink(A);
    await proxy.addConnection(B);
    await proxy.addConnection(C);
    proxy.setFailover(true);
    state.applied.length = 0;
    await proxy.failover();
    expect(state.applied).toEqual(["10.0.0.3"]);
    const cur = proxy.current();
    expect(cur.state).toBe("connected");
    expect(cur.failover).toMatchObject({ enabled: true, lastResult: "switched:C" });
    expect((await proxy.listConnections()).find((c) => c.active)?.host).toBe("c.example.com");
  });

  it("reports when no other link works, and waits before trying again (R8)", async () => {
    const { proxy, state } = make({ alive: [] });
    await proxy.applyLink(A);
    await proxy.addConnection(B);
    proxy.setFailover(true);
    for (let i = 0; i < 3; i++) await proxy.check();
    await tick(20);
    expect(proxy.current().failover.lastResult).toBe("none_worked");
    const tries = state.applied.length;
    for (let i = 0; i < 3; i++) await proxy.check();
    await tick(20);
    expect(state.applied.length).toBe(tries);
    state.now += FAILOVER_COOLDOWN_MS + 1;
    await proxy.check();
    await tick(20);
    expect(state.applied.length).toBeGreaterThan(tries);
  });

  it("says so when there is nothing to switch to (R8)", async () => {
    const { proxy } = make({ alive: [] });
    await proxy.applyLink(A);
    proxy.setFailover(true);
    await proxy.failover();
    expect(proxy.current().failover.lastResult).toBe("no_other_connection");
  });

  it("adds new subscription links, drops old ones, and keeps hand-added and active links (R1, R3, R7)", async () => {
    const { proxy, state } = make({ alive: ["10.0.0.2"] });
    proxy.setSubscription(SUB);
    await proxy.addConnection(A, "دستی");
    state.sub = [B, C].join("\n");
    let list = await proxy.syncSubscription();
    expect(list.map((c) => [c.name, c.fromSubscription])).toEqual([["دستی", false], ["B", true], ["C", true]]);
    expect(proxy.current().subscriptionSync.lastResult).toBe("ok:2:0");

    await proxy.applyLink(B);
    state.sub = [C, D].join("\n");
    list = await proxy.syncSubscription();
    expect(list.map((c) => c.host)).toEqual(["a.example.com", "b.example.com", "c.example.com", "d.example.com"]);
    state.sub = [D].join("\n");
    list = await proxy.syncSubscription();
    expect(list.map((c) => c.host)).toEqual(["a.example.com", "b.example.com", "d.example.com"]);
    expect(list.find((c) => c.active)?.host).toBe("b.example.com");
    expect(proxy.current().subscriptionSync.lastResult).toBe("ok:0:1");
  });

  it("does not treat a changed remark as a new link (R1)", async () => {
    const { proxy, state } = make();
    proxy.setSubscription(SUB);
    state.sub = `${C}`;
    await proxy.syncSubscription();
    state.sub = C.replace("#C", "#C%7C6.50GB");
    const list = await proxy.syncSubscription();
    expect(list).toHaveLength(1);
    expect(proxy.current().subscriptionSync.lastResult).toBe("ok:0:0");
  });

  it("changes nothing when the subscription cannot be read (R2)", async () => {
    const { proxy, state } = make();
    await expect(proxy.syncSubscription()).rejects.toMatchObject({ status: 400, code: "no_subscription" });
    expect(proxy.current().subscriptionSync.lastResult).toBeNull();
    proxy.setSubscription(SUB);
    state.sub = [B].join("\n");
    await proxy.syncSubscription();
    state.subFails = true;
    await expect(proxy.syncSubscription()).rejects.toMatchObject({ status: 502, code: "subscription_fetch" });
    expect(proxy.current().subscriptionSync.lastResult).toBe("failed");
    state.subFails = false;
    state.sub = "<html>error</html>";
    await expect(proxy.syncSubscription()).rejects.toMatchObject({ status: 502 });
    expect((await proxy.listConnections()).map((c) => c.host)).toEqual(["b.example.com"]);
  });

  it("refreshes the subscription before trying the saved links when the proxy goes down (R5)", async () => {
    const { proxy, state } = make({ alive: ["10.0.0.4"] });
    proxy.setSubscription(SUB);
    await proxy.applyLink(A);
    state.sub = D;
    proxy.setFailover(true);
    await proxy.failover();
    expect(state.subFetches).toBe(1);
    expect(proxy.current().failover.lastResult).toBe("switched:D");
    expect(state.applied.at(-1)).toBe("10.0.0.4");
  });

  it("still tries the saved links when the subscription cannot be reached (R5)", async () => {
    const { proxy, state } = make({ alive: ["10.0.0.3"] });
    proxy.setSubscription(SUB);
    state.subFails = true;
    await proxy.applyLink(A);
    await proxy.addConnection(C);
    proxy.setFailover(true);
    await proxy.failover();
    expect(proxy.current().failover.lastResult).toBe("switched:C");
    expect(proxy.current().subscriptionSync.lastResult).toBe("failed");
  });

  it("refreshes the subscription now and then while healthy, only when switching is on (R4)", async () => {
    const off = make({ alive: ["10.0.0.1"] });
    off.proxy.setSubscription(SUB);
    off.state.sub = B;
    await off.proxy.applyLink(A);
    await off.proxy.check();
    await tick(20);
    expect(off.state.subFetches).toBe(0);

    const { proxy, state } = make({ alive: ["10.0.0.1"] });
    proxy.setSubscription(SUB);
    state.sub = B;
    await proxy.applyLink(A);
    proxy.setFailover(true);
    await proxy.check();
    await tick(20);
    expect(state.subFetches).toBe(1);
    await proxy.check();
    await tick(20);
    expect(state.subFetches).toBe(1);
    state.now += SYNC_EVERY_MS + 1;
    await proxy.check();
    await tick(20);
    expect(state.subFetches).toBe(2);
  });
});
