import type { PlatformCategory, PlatformInfo, PlatformField } from "@linux-agent/shared";
import { HttpError, slugify } from "./bots.js";
import type { SettingsStore } from "./settings.js";

const RESPONSE_LIMIT = 30_000;
const TEXT_TYPE = /^text\/|json|xml|javascript|yaml|x-www-form-urlencoded/i;
const EXTENSIONS: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "application/pdf": "pdf", "application/zip": "zip" };

interface PlatformDef {
  id: string;
  name: string;
  category: PlatformCategory;
  /** google uses the OAuth flow in connectors.ts; the rest use the fields below. */
  kind: "token" | "google";
  fields: PlatformField[];
  helpUrl: string;
  steps: string[];
  /** May hold {field}. */
  baseUrl?: string;
  header?: string;
  /** {field} placeholders; {basic:a:b} is HTTP Basic of two fields. */
  template?: string;
  extraHeaders?: Record<string, string>;
  testPath?: string;
}

const TOKEN: PlatformField = { key: "token", label: "توکن", secret: true };
const bearer = { header: "authorization", template: "Bearer {token}" };

const CATALOG: PlatformDef[] = [
  { id: "google", name: "Gmail و Google Calendar", category: "communication", kind: "google", fields: [{ key: "clientId", label: "Client ID", secret: false }, { key: "clientSecret", label: "Client Secret", secret: true }], helpUrl: "https://console.cloud.google.com/apis/credentials", steps: ["در Google Cloud یک پروژه بسازید و Gmail API و Calendar API را فعال کنید.", "یک OAuth Client از نوع Web بسازید و نشانی بازگشت پایین را در آن بگذارید.", "Client ID و Secret را اینجا بگذارید، ذخیره کنید و «اتصال به گوگل» را بزنید."] },
  { id: "slack", name: "Slack", category: "communication", kind: "token", fields: [{ ...TOKEN, label: "Bot Token" }], helpUrl: "https://api.slack.com/apps", steps: ["یک Slack App بسازید و دسترسی‌های لازم را در OAuth & Permissions بدهید.", "آن را در فضای کارتان نصب کنید و Bot User OAuth Token را کپی کنید."], baseUrl: "https://slack.com/api", ...bearer, testPath: "/auth.test" },
  { id: "discord", name: "Discord", category: "communication", kind: "token", fields: [{ ...TOKEN, label: "Bot Token" }], helpUrl: "https://discord.com/developers/applications", steps: ["یک Application بسازید، بخش Bot را باز کنید و توکن را بگیرید."], baseUrl: "https://discord.com/api/v10", header: "authorization", template: "Bot {token}", testPath: "/users/@me" },
  { id: "x", name: "X", category: "communication", kind: "token", fields: [{ ...TOKEN, label: "Bearer Token" }], helpUrl: "https://developer.x.com/en/portal/dashboard", steps: ["در پنل توسعه‌دهندهٔ X یک App بسازید و Bearer Token را بگیرید. این توکن بیشتر برای خواندن است."], baseUrl: "https://api.x.com/2", ...bearer, testPath: "/tweets/search/recent?query=linux" },
  { id: "github", name: "GitHub", category: "code", kind: "token", fields: [TOKEN], helpUrl: "https://github.com/settings/personal-access-tokens/new", steps: ["یک Fine-grained token بسازید و فقط مخزن‌ها و دسترسی‌های لازم را انتخاب کنید."], baseUrl: "https://api.github.com", ...bearer, extraHeaders: { accept: "application/vnd.github+json", "user-agent": "linuxAgent" }, testPath: "/user" },
  { id: "gitlab", name: "GitLab", category: "code", kind: "token", fields: [TOKEN], helpUrl: "https://gitlab.com/-/user_settings/personal_access_tokens", steps: ["یک Personal Access Token با دسترسی api بسازید."], baseUrl: "https://gitlab.com/api/v4", ...bearer, testPath: "/user" },
  { id: "vercel", name: "Vercel", category: "code", kind: "token", fields: [TOKEN], helpUrl: "https://vercel.com/account/tokens", steps: ["در بخش Tokens یک توکن تازه بسازید."], baseUrl: "https://api.vercel.com", ...bearer, testPath: "/v2/user" },
  { id: "cloudflare", name: "Cloudflare", category: "code", kind: "token", fields: [{ ...TOKEN, label: "API Token" }], helpUrl: "https://dash.cloudflare.com/profile/api-tokens", steps: ["یک API Token با کمترین دسترسی لازم بسازید."], baseUrl: "https://api.cloudflare.com/client/v4", ...bearer, testPath: "/user/tokens/verify" },
  { id: "notion", name: "Notion", category: "work", kind: "token", fields: [{ ...TOKEN, label: "Internal Integration Secret" }], helpUrl: "https://www.notion.so/my-integrations", steps: ["یک Integration بسازید و Secret را کپی کنید.", "صفحه‌های لازم را در Notion با آن Integration به اشتراک بگذارید."], baseUrl: "https://api.notion.com/v1", ...bearer, extraHeaders: { "notion-version": "2022-06-28" }, testPath: "/users/me" },
  { id: "linear", name: "Linear", category: "work", kind: "token", fields: [{ ...TOKEN, label: "API Key" }], helpUrl: "https://linear.app/settings/account/security", steps: ["در بخش Security & access یک Personal API Key بسازید."], baseUrl: "https://api.linear.app", header: "authorization", template: "{token}" },
  { id: "jira", name: "Jira", category: "work", kind: "token", fields: [{ key: "domain", label: "نام فضای کار (بخش اول آدرس atlassian.net)", secret: false }, { key: "email", label: "ایمیل", secret: false }, { ...TOKEN, label: "API Token" }], helpUrl: "https://id.atlassian.com/manage-profile/security/api-tokens", steps: ["یک API Token بسازید و ایمیل حساب و نام فضای کار را هم بنویسید."], baseUrl: "https://{domain}.atlassian.net", header: "authorization", template: "{basic:email:token}", testPath: "/rest/api/3/myself" },
  { id: "airtable", name: "Airtable", category: "work", kind: "token", fields: [{ ...TOKEN, label: "Personal Access Token" }], helpUrl: "https://airtable.com/create/tokens", steps: ["یک توکن با دسترسی پایگاه‌های لازم بسازید."], baseUrl: "https://api.airtable.com", ...bearer, testPath: "/v0/meta/whoami" },
  { id: "hubspot", name: "HubSpot", category: "work", kind: "token", fields: [{ ...TOKEN, label: "Private App Token" }], helpUrl: "https://app.hubspot.com/", steps: ["در تنظیمات، بخش Private Apps یک برنامه بسازید و توکن را بگیرید."], baseUrl: "https://api.hubapi.com", ...bearer, testPath: "/crm/v3/owners?limit=1" },
  { id: "stripe", name: "Stripe", category: "work", kind: "token", fields: [{ ...TOKEN, label: "Restricted Key" }], helpUrl: "https://dashboard.stripe.com/apikeys", steps: ["یک Restricted Key فقط با دسترسی خواندن بسازید. کلید اصلی را ندهید."], baseUrl: "https://api.stripe.com/v1", ...bearer, testPath: "/balance" },
  { id: "openai", name: "OpenAI", category: "ai", kind: "token", fields: [{ ...TOKEN, label: "API Key" }], helpUrl: "https://platform.openai.com/api-keys", steps: ["یک API Key تازه بسازید."], baseUrl: "https://api.openai.com/v1", ...bearer, testPath: "/models" },
  { id: "elevenlabs", name: "ElevenLabs", category: "ai", kind: "token", fields: [{ ...TOKEN, label: "API Key" }], helpUrl: "https://elevenlabs.io/app/settings/api-keys", steps: ["در بخش API Keys یک کلید تازه بسازید."], baseUrl: "https://api.elevenlabs.io/v1", header: "xi-api-key", template: "{token}", testPath: "/user" },
  { id: "huggingface", name: "Hugging Face", category: "ai", kind: "token", fields: [{ ...TOKEN, label: "Access Token" }], helpUrl: "https://huggingface.co/settings/tokens", steps: ["یک Access Token بسازید."], baseUrl: "https://huggingface.co/api", ...bearer, testPath: "/whoami-v2" },
];

export interface CustomConnection {
  name: string;
  baseUrl: string;
  header: string;
  template: string;
  description?: string;
}

function checkBaseUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, "bad_url", "نشانی سرویس نامعتبر است.");
  }
  if (u.protocol !== "https:") throw new HttpError(400, "bad_url", "نشانی سرویس باید https باشد.");
  return u.origin + u.pathname.replace(/\/$/, "");
}

/**
 * Spec 008: connections live encrypted in settings. A bot names a connection and a path; the panel adds
 * the secret and sends it only to that service's own address, so a bot can use a key without seeing it.
 */
export class PlatformService {
  constructor(
    private settings: SettingsStore,
    private publicBaseUrl: string,
    private fetchFn: typeof fetch = fetch,
    /** Saves a binary answer in the shared workspace and returns its path. */
    private saveFile?: (name: string, data: Buffer) => string,
  ) {}

  private key(id: string, f: PlatformField): string {
    return `platform.${id}.${f.key}${f.secret ? ".secret" : ""}`;
  }

  private customDef(id: string): CustomConnection | null {
    const raw = this.settings.get(`platform.${id}.meta`);
    return raw ? (JSON.parse(raw) as CustomConnection) : null;
  }

  private def(id: string): PlatformDef {
    const known = CATALOG.find((p) => p.id === id);
    if (known) return known;
    const c = id.startsWith("custom-") ? this.customDef(id) : null;
    if (!c) throw new HttpError(404, "no_platform", `پلتفرمی به نام ${id} در فهرست نیست.`);
    return { id, name: c.name, category: "custom", kind: "token", fields: [TOKEN], helpUrl: "", steps: c.description ? [c.description] : [], baseUrl: c.baseUrl, header: c.header, template: c.template };
  }

  private connected(p: PlatformDef): boolean {
    if (p.kind === "google") return this.settings.get("google.refresh.secret") !== null;
    return p.fields.every((f) => this.settings.get(this.key(p.id, f)) !== null);
  }

  private info = (p: PlatformDef): PlatformInfo => ({
    id: p.id,
    name: p.name,
    category: p.category,
    kind: p.kind,
    connected: this.connected(p),
    fields: p.fields,
    values: Object.fromEntries(p.fields.filter((f) => !f.secret).map((f) => [f.key, this.settings.get(this.key(p.id, f)) ?? ""])),
    helpUrl: p.helpUrl,
    steps: p.steps,
    testable: Boolean(p.testPath),
    redirectUri: p.kind === "google" ? `${this.publicBaseUrl}/oauth/google/callback` : null,
  });

  list(): PlatformInfo[] {
    const custom = this.settings.keys("platform.custom-").filter((k) => k.endsWith(".meta")).map((k) => this.def(k.slice("platform.".length, -".meta".length)));
    return [...CATALOG, ...custom].map(this.info);
  }

  get(id: string): PlatformInfo {
    return this.info(this.def(id));
  }

  connectedNames(): string[] {
    return this.list().filter((p) => p.connected && p.kind === "token").map((p) => p.id);
  }

  connect(id: string, values: Record<string, string>): PlatformInfo {
    const p = this.def(id);
    if (p.kind === "google") {
      if (values.clientId?.trim()) this.settings.set("google.clientId", values.clientId.trim());
      if (values.clientSecret?.trim()) this.settings.set("google.clientSecret.secret", values.clientSecret.trim());
      return this.info(p);
    }
    for (const f of p.fields) {
      const v = values[f.key]?.trim();
      if (v) {
        if (f.key === "domain" && !/^[a-z0-9-]+$/i.test(v)) throw new HttpError(400, "bad_field", "نام فضای کار نامعتبر است.");
        this.settings.set(this.key(id, f), v);
      } else if (this.settings.get(this.key(id, f)) === null) throw new HttpError(400, "missing_field", `${f.label} را وارد کنید.`);
    }
    return this.info(p);
  }

  /** A key for a service outside the catalog, usually asked for by a bot. */
  addCustom(c: CustomConnection, token: string): PlatformInfo {
    const name = c.name.trim();
    if (!name || name.length > 60) throw new HttpError(400, "bad_name", "نام باید ۱ تا ۶۰ نویسه باشد.");
    if (!token.trim()) throw new HttpError(400, "missing_field", "توکن را وارد کنید.");
    if (!/^[a-z0-9-]{1,60}$/i.test(c.header || "x")) throw new HttpError(400, "bad_header", "نام سربرگ نامعتبر است.");
    const slug = slugify(name) === "bot" ? `k${Date.now().toString(36)}` : slugify(name);
    const id = `custom-${slug}`;
    const meta: CustomConnection = { name, baseUrl: checkBaseUrl(c.baseUrl), header: (c.header || "authorization").toLowerCase(), template: c.template?.includes("{token}") ? c.template : "Bearer {token}", description: c.description };
    this.settings.set(`platform.${id}.meta`, JSON.stringify(meta));
    this.settings.set(this.key(id, TOKEN), token.trim());
    return this.get(id);
  }

  disconnect(id: string): void {
    const p = this.def(id);
    if (p.kind === "google") {
      this.settings.set("google.refresh.secret", null);
      return;
    }
    for (const f of p.fields) this.settings.set(this.key(id, f), null);
    this.settings.set(`platform.${id}.meta`, null);
  }

  private field(p: PlatformDef, key: string): string {
    const f = p.fields.find((x) => x.key === key);
    return (f && this.settings.get(this.key(p.id, f))) ?? "";
  }

  private fill(p: PlatformDef, template: string): string {
    return template
      .replace(/\{basic:(\w+):(\w+)\}/g, (_m, a: string, b: string) => `Basic ${Buffer.from(`${this.field(p, a)}:${this.field(p, b)}`).toString("base64")}`)
      .replace(/\{(\w+)\}/g, (_m, k: string) => this.field(p, k));
  }

  /** The address is fixed by the connection: a path cannot move the secret to another host. */
  async call(id: string, method: string, path: string, body?: string): Promise<{ status: number; text: string }> {
    const p = this.def(id);
    if (p.kind !== "token" || !p.baseUrl) throw new HttpError(400, "not_api", "این اتصال ابزار خودش را دارد.");
    if (!this.connected(p)) throw new HttpError(409, "not_connected", `${p.name} وصل نشده است؛ از request_connection استفاده کن.`);
    if (!path.startsWith("/")) throw new HttpError(400, "bad_path", "مسیر باید با / شروع شود.");
    const base = new URL(this.fill(p, p.baseUrl));
    const url = new URL(`${base.origin}${base.pathname.replace(/\/$/, "")}${path}`);
    if (url.origin !== base.origin) throw new HttpError(400, "bad_path", "مسیر نمی‌تواند به نشانی دیگری برود.");
    const secret = this.fill(p, p.template ?? "{token}");
    const res = await this.fetchFn(url, {
      method,
      redirect: "error",
      headers: { ...(p.extraHeaders ?? {}), [p.header ?? "authorization"]: secret, ...(body ? { "content-type": "application/json" } : {}) },
      body: body || undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const type = res.headers.get("content-type") ?? "";
    if (type && !TEXT_TYPE.test(type)) {
      const data = Buffer.from(await res.arrayBuffer());
      if (!this.saveFile) return { status: res.status, text: `(binary answer, ${data.length} bytes, ${type})` };
      const ext = EXTENSIONS[type.split(";")[0]!.trim().toLowerCase()] ?? "bin";
      const path = this.saveFile(`${id}-${Date.now()}.${ext}`, data);
      return { status: res.status, text: `Binary answer (${type}, ${data.length} bytes) saved to ${path}` };
    }
    let text = (await res.text()).slice(0, RESPONSE_LIMIT);
    for (const f of p.fields) {
      const v = f.secret ? this.field(p, f.key) : "";
      if (v) text = text.split(v).join("[hidden]");
    }
    return { status: res.status, text };
  }

  async test(id: string): Promise<{ ok: boolean; status: number | null; message: string }> {
    const p = this.def(id);
    if (!p.testPath) return { ok: this.connected(p), status: null, message: "برای این سرویس آزمون خودکار نداریم." };
    try {
      const { status } = await this.call(id, "GET", p.testPath);
      return { ok: status >= 200 && status < 300, status, message: status < 300 ? "اتصال سالم است." : `سرویس پاسخ ${status} داد؛ کلید را بررسی کنید.` };
    } catch (e) {
      return { ok: false, status: null, message: (e as Error).message };
    }
  }

  promptFor(): string {
    const on = this.list().filter((p) => p.connected);
    const catalog = CATALOG.map((p) => p.id).join(", ");
    return `Connected services you may use: ${on.length ? on.map((p) => p.id).join(", ") : "none"}. Use call_api with a connected id; the panel adds the key and you never see it. If the work needs a service that is not connected, call request_connection (known ids: ${catalog}; for anything else give its name and API address). Never ask for a key or password in chat.`;
  }
}
