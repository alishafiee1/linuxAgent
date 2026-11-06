import webpush from "web-push";
import type { Db } from "./db.js";
import { now } from "./db.js";
import type { SettingsStore } from "./settings.js";

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

type Sender = (sub: PushSubscriptionInput, payload: string, options: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number }) => Promise<unknown>;

/** Web Push to phones that installed the panel. A failure here never blocks the other channels. */
export class PushService {
  constructor(
    private db: Db,
    private settings: SettingsStore,
    private baseUrl: string,
    private send: Sender = webpush.sendNotification as unknown as Sender,
    private log: (msg: string) => void = () => {},
  ) {}

  private keys(): { publicKey: string; privateKey: string } {
    let publicKey = this.settings.get("push.vapidPublic");
    let privateKey = this.settings.get("push.vapidPrivate.secret");
    if (!publicKey || !privateKey) {
      ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
      this.settings.set("push.vapidPublic", publicKey);
      this.settings.set("push.vapidPrivate.secret", privateKey);
    }
    return { publicKey, privateKey };
  }

  publicKey(): string {
    return this.keys().publicKey;
  }

  subscribe(sub: PushSubscriptionInput, userAgent: string): void {
    this.db
      .prepare(
        "INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent",
      )
      .run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent.slice(0, 200), now());
  }

  unsubscribe(endpoint: string): void {
    this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n;
  }

  /** `url` is a path inside the panel that opens when the notification is tapped. */
  async notify(title: string, body: string, url = "/"): Promise<void> {
    const rows = this.db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions").all() as { endpoint: string; p256dh: string; auth: string }[];
    if (rows.length === 0) return;
    const { publicKey, privateKey } = this.keys();
    const payload = JSON.stringify({ title, body, url });
    await Promise.all(
      rows.map(async (r) => {
        try {
          await this.send({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload, {
            vapidDetails: { subject: this.baseUrl, publicKey, privateKey },
            TTL: 3600,
          });
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) this.unsubscribe(r.endpoint);
          else this.log(`push failed: ${(e as Error).message}`);
        }
      }),
    );
  }
}
