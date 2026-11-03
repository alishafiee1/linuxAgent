import { describe, expect, it } from "vitest";
import { PushService } from "../src/push.js";
import { FakeEngine, ok, setup } from "./helpers.js";

const sub = (n: number) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "p", auth: "a" } });

function make(send: (endpoint: string) => Promise<unknown>) {
  const t = setup(new FakeEngine(() => [ok()]));
  const sent: string[] = [];
  const push = new PushService(t.db, t.settings, "https://panel.example", async (s, payload) => {
    sent.push(`${s.endpoint} ${payload}`);
    return send(s.endpoint);
  });
  return { push, sent };
}

describe("push", () => {
  it("makes the key once and keeps it (R2)", () => {
    const { push } = make(async () => ({}));
    expect(push.publicKey()).toBe(push.publicKey());
  });

  it("stores each device once and sends to all (R3, R4)", async () => {
    const { push, sent } = make(async () => ({}));
    push.subscribe(sub(1), "ua");
    push.subscribe(sub(1), "ua");
    push.subscribe(sub(2), "ua");
    expect(push.count()).toBe(2);
    await push.notify("عنوان", "متن");
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain("عنوان");
  });

  it("drops a dead device and ignores other failures (R4, R5)", async () => {
    const { push } = make(async (endpoint) => {
      throw Object.assign(new Error("x"), { statusCode: endpoint.endsWith("/1") ? 410 : 500 });
    });
    push.subscribe(sub(1), "ua");
    push.subscribe(sub(2), "ua");
    await expect(push.notify("a", "b")).resolves.toBeUndefined();
    expect(push.count()).toBe(1);
  });
});
