import type { BrowserInput, ConnectorsInput, RoutineInput, SkillInput, VaultInput } from "@linux-agent/shared";
import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { HttpError } from "./bots.js";
import type { BridgeService } from "./bridge.js";
import type { BrowserService } from "./browser/service.js";
import type { Connectors } from "./connectors.js";
import type { KnowledgeService } from "./knowledge.js";
import { PAGE_CSP, type PageService } from "./pages.js";
import type { RoutineService } from "./routines/service.js";
import type { VaultService } from "./vault.js";

export interface ExtDeps {
  routines: RoutineService;
  knowledge: KnowledgeService;
  vault: VaultService;
  browser: BrowserService;
  pages: PageService;
  connectors: Connectors;
  bridge: BridgeService;
}

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, "bad_request", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
};

const routineInput = z.object({
  botId: z.string(),
  name: z.string(),
  prompt: z.string().max(20_000),
  trigger: z.enum(["cron", "webhook"]),
  cron: z.string().max(100).nullable().optional(),
  timezone: z.string().max(60).optional(),
  enabled: z.boolean().optional(),
  notify: z.boolean().optional(),
});
const skillInput = z.object({ name: z.string(), description: z.string(), body: z.string() });
const vaultInput = z.object({ name: z.string(), username: z.string().max(200).nullable().optional(), secret: z.string().max(5000).optional(), site: z.string().max(300).nullable().optional() });
const browserInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), x: z.number(), y: z.number() }),
  z.object({ type: z.literal("scroll"), x: z.number(), y: z.number(), deltaY: z.number() }),
  z.object({ type: z.literal("text"), text: z.string().max(5000) }),
  z.object({ type: z.literal("key"), key: z.string().max(20) }),
  z.object({ type: z.literal("navigate"), url: z.string().max(2000) }),
]);

const html = (title: string, text: string): string =>
  `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>${title}</title><body style="font-family:sans-serif;padding:32px"><p>${text}</p></body></html>`;

/** Routes of cycles 002–006. `/p/`, `/hook/`, `/oauth/` and `/bridge/` sit outside /api: they have their own proof. */
export function registerExtRoutes(app: FastifyInstance, d: ExtDeps): void {
  // --- routines
  app.get("/api/routines", async () => d.routines.list());
  app.post("/api/routines", async (req) => d.routines.create(parse(routineInput, req.body) as RoutineInput));
  app.patch<{ Params: { id: string } }>("/api/routines/:id", async (req) => d.routines.update(req.params.id, parse(routineInput.omit({ trigger: true }).partial(), req.body) as Partial<RoutineInput>));
  app.delete<{ Params: { id: string } }>("/api/routines/:id", async (req) => {
    d.routines.delete(req.params.id);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/routines/:id/run", async (req) => {
    const run = d.routines.fire(req.params.id);
    if (!run) throw new HttpError(409, "busy", "اجرای قبلی این روتین هنوز تمام نشده است.");
    return { runId: run.id };
  });
  // Outside services send every kind of body, or none, so here it is only text.
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => done(null, body));
    scope.post<{ Params: { token: string } }>("/hook/:token", async (req, reply) => {
      const run = d.routines.fireWebhook(req.params.token, typeof req.body === "string" ? req.body : "");
      return reply.status(202).send({ accepted: run !== null });
    });
  });

  // --- skills and memory
  app.get("/api/skills", async () => d.knowledge.listSkills());
  app.post("/api/skills", async (req) => d.knowledge.saveSkill(parse(skillInput, req.body) as SkillInput));
  app.put<{ Params: { slug: string } }>("/api/skills/:slug", async (req) => d.knowledge.saveSkill(parse(skillInput, req.body) as SkillInput, req.params.slug));
  app.delete<{ Params: { slug: string } }>("/api/skills/:slug", async (req) => {
    d.knowledge.deleteSkill(req.params.slug);
    return { ok: true };
  });
  app.get("/api/memory", async () => d.knowledge.listMemory());
  app.put<{ Params: { scope: string } }>("/api/memory/:scope", async (req) => d.knowledge.writeMemory(req.params.scope, parse(z.object({ content: z.string() }), req.body).content));

  // --- vault: no route returns a value
  app.get("/api/vault", async () => d.vault.list());
  app.post("/api/vault", async (req) => d.vault.create(parse(vaultInput, req.body) as VaultInput));
  app.patch<{ Params: { id: string } }>("/api/vault/:id", async (req) => d.vault.update(req.params.id, parse(vaultInput.partial(), req.body) as Partial<VaultInput>));
  app.delete<{ Params: { id: string } }>("/api/vault/:id", async (req) => {
    d.vault.delete(req.params.id);
    return { ok: true };
  });

  // --- browser
  app.get<{ Params: { botId: string } }>("/api/browser/:botId", async (req) => d.browser.status(req.params.botId));
  app.post<{ Params: { botId: string } }>("/api/browser/:botId/open", async (req) => d.browser.open(req.params.botId));
  app.post<{ Params: { botId: string } }>("/api/browser/:botId/close", async (req) => {
    await d.browser.close(req.params.botId);
    return { ok: true };
  });
  app.get<{ Params: { botId: string } }>("/api/browser/:botId/screenshot", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return reply.type("image/jpeg").send(await d.browser.screenshot(req.params.botId));
  });
  app.post<{ Params: { botId: string } }>("/api/browser/:botId/input", async (req) => {
    await d.browser.input(req.params.botId, parse(browserInput, req.body) as BrowserInput);
    return { ok: true };
  });
  app.post<{ Params: { botId: string } }>("/api/browser/:botId/fill", async (req) => {
    const b = parse(z.object({ itemId: z.string(), field: z.enum(["username", "password"]) }), req.body);
    await d.browser.fillFromVault(req.params.botId, b.itemId, b.field);
    return { ok: true };
  });

  // --- pages
  app.get("/api/pages", async () => d.pages.list());
  app.post<{ Params: { id: string } }>("/api/pages/:id/share", async (req) => d.pages.setShared(req.params.id, parse(z.object({ shared: z.boolean() }), req.body).shared));
  app.delete<{ Params: { id: string } }>("/api/pages/:id", async (req) => {
    d.pages.delete(req.params.id);
    return { ok: true };
  });
  app.get<{ Params: { token: string } }>("/p/:token", async (req, reply) => {
    const content = d.pages.read(req.params.token);
    reply.header("content-security-policy", PAGE_CSP);
    reply.header("x-robots-tag", "noindex");
    reply.header("referrer-policy", "no-referrer");
    if (content === null) return reply.status(404).type("text/html; charset=utf-8").send(html("پیدا نشد", "این صفحه پیدا نشد یا اشتراکش بسته شده است."));
    return reply.type("text/html; charset=utf-8").send(content);
  });

  // --- connectors
  app.get("/api/connectors", async () => d.connectors.status());
  app.put("/api/connectors", async (req) =>
    d.connectors.apply(parse(z.object({ githubToken: z.string().max(500).nullable().optional(), googleClientId: z.string().max(300).nullable().optional(), googleClientSecret: z.string().max(300).nullable().optional() }), req.body) as ConnectorsInput),
  );
  app.post("/api/connectors/google/start", async () => ({ url: d.connectors.googleAuthUrl() }));
  app.post("/api/connectors/google/disconnect", async () => {
    d.connectors.googleDisconnect();
    return d.connectors.status();
  });
  app.get<{ Querystring: { state?: string; code?: string } }>("/oauth/google/callback", async (req, reply) => {
    reply.type("text/html; charset=utf-8");
    try {
      await d.connectors.googleCallback(req.query.state ?? "", req.query.code ?? "");
      return html("وصل شد", "گوگل وصل شد. این صفحه را ببندید.");
    } catch (e) {
      return reply.status(400).send(html("خطا", e instanceof HttpError ? e.message : "اتصال ناموفق بود."));
    }
  });

  // --- desktop bridge
  app.get("/api/bridge/devices", async () => d.bridge.list());
  app.post("/api/bridge/devices", async (req) => {
    const b = parse(z.object({ name: z.string(), folders: z.array(z.string().max(500)).max(20) }), req.body);
    return d.bridge.create(b.name, b.folders);
  });
  app.delete<{ Params: { id: string } }>("/api/bridge/devices/:id", async (req) => {
    d.bridge.delete(req.params.id);
    return { ok: true };
  });
  app.get("/api/bridge/script", async (_req, reply) => {
    reply.header("content-disposition", 'attachment; filename="bridge.mjs"');
    return reply.type("text/javascript; charset=utf-8").send(readFileSync(new URL("../../../deploy/desktop-bridge/bridge.mjs", import.meta.url)));
  });
  const bearer = (h: string | undefined): string | undefined => h?.replace(/^Bearer\s+/i, "");
  app.get("/bridge/poll", async (req) => ({ next: await d.bridge.poll(bearer(req.headers.authorization)) }));
  app.post("/bridge/result", async (req) => {
    const b = parse(z.object({ id: z.string(), ok: z.boolean(), output: z.string() }), req.body);
    d.bridge.result(bearer(req.headers.authorization), b.id, b.ok, b.output);
    return { ok: true };
  });
}
