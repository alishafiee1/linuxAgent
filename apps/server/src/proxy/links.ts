// Share links (vless/vmess/trojan/ss) → sing-box outbounds, and the full hermes sing-box config.

export interface ParsedLink {
  scheme: "vless" | "vmess" | "trojan" | "ss";
  host: string;
  port: number;
  remark: string;
  /** sing-box outbound without `server` (filled with the pinned IP). */
  outbound: Record<string, unknown>;
}

export class LinkError extends Error {}

function b64decode(s: string): string {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(norm + "=".repeat((4 - (norm.length % 4)) % 4), "base64").toString("utf8");
}

function transportFrom(type: string | null, path: string | null, host: string | null, serviceName: string | null): Record<string, unknown> | undefined {
  switch (type) {
    case null:
    case "":
    case "tcp":
    case "raw":
      return undefined;
    case "ws":
      return { type: "ws", path: path || "/", ...(host ? { headers: { Host: host } } : {}) };
    case "httpupgrade":
      return { type: "httpupgrade", path: path || "/", ...(host ? { host } : {}) };
    case "grpc":
      return { type: "grpc", service_name: serviceName || path || "" };
    case "http":
    case "h2":
      return { type: "http", path: path || "/", ...(host ? { host: [host] } : {}) };
    default:
      throw new LinkError(`unsupported transport: ${type}`);
  }
}

function tlsFrom(security: string | null, sni: string | null, host: string, q: URLSearchParams): Record<string, unknown> | undefined {
  if (security === "tls" || security === "xtls") {
    return {
      enabled: true,
      server_name: sni || host,
      insecure: q.get("allowInsecure") === "1",
      ...(q.get("fp") ? { utls: { enabled: true, fingerprint: q.get("fp") } } : {}),
      ...(q.get("alpn") ? { alpn: q.get("alpn")!.split(",") } : {}),
    };
  }
  if (security === "reality") {
    return {
      enabled: true,
      server_name: sni || host,
      utls: { enabled: true, fingerprint: q.get("fp") || "chrome" },
      reality: { enabled: true, public_key: q.get("pbk") ?? "", short_id: q.get("sid") ?? "" },
    };
  }
  return undefined;
}

function clean<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

export function parseLink(raw: string): ParsedLink {
  const link = raw.trim().replace(/&amp;/g, "&");
  const scheme = link.slice(0, link.indexOf("://"));
  if (scheme === "vmess") {
    let j: Record<string, string | number>;
    try {
      j = JSON.parse(b64decode(link.slice("vmess://".length))) as Record<string, string | number>;
    } catch {
      throw new LinkError("invalid vmess link");
    }
    const host = String(j.add ?? "");
    const port = Number(j.port);
    const q = new URLSearchParams({ fp: String(j.fp ?? ""), alpn: String(j.alpn ?? "") });
    return {
      scheme: "vmess",
      host,
      port,
      remark: String(j.ps ?? ""),
      outbound: clean({
        type: "vmess",
        tag: "proxy",
        server_port: port,
        uuid: String(j.id ?? ""),
        alter_id: Number(j.aid ?? 0),
        security: String(j.scy || "auto"),
        tls: tlsFrom(j.tls ? String(j.tls) : null, j.sni ? String(j.sni) : null, host, q),
        transport: transportFrom(String(j.net ?? ""), j.path ? String(j.path) : null, j.host ? String(j.host) : null, j.path ? String(j.path) : null),
      }),
    };
  }
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new LinkError("invalid link");
  }
  const q = url.searchParams;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = Number(url.port);
  const remark = decodeURIComponent(url.hash.replace(/^#/, ""));
  if (!host || !port) throw new LinkError("link has no host or port");
  const transport = (): Record<string, unknown> | undefined => transportFrom(q.get("type"), q.get("path"), q.get("host"), q.get("serviceName"));
  switch (scheme) {
    case "vless":
      return {
        scheme,
        host,
        port,
        remark,
        outbound: clean({
          type: "vless",
          tag: "proxy",
          server_port: port,
          uuid: decodeURIComponent(url.username),
          flow: q.get("flow") || undefined,
          tls: tlsFrom(q.get("security"), q.get("sni"), host, q),
          transport: transport(),
        }),
      };
    case "trojan":
      return {
        scheme,
        host,
        port,
        remark,
        outbound: clean({
          type: "trojan",
          tag: "proxy",
          server_port: port,
          password: decodeURIComponent(url.username),
          tls: tlsFrom(q.get("security") || "tls", q.get("sni"), host, q),
          transport: transport(),
        }),
      };
    case "ss": {
      const userinfo = decodeURIComponent(url.username);
      const decoded = url.password ? `${userinfo}:${decodeURIComponent(url.password)}` : b64decode(userinfo);
      const i = decoded.indexOf(":");
      if (i < 1) throw new LinkError("invalid ss link");
      return {
        scheme,
        host,
        port,
        remark,
        outbound: { type: "shadowsocks", tag: "proxy", server_port: port, method: decoded.slice(0, i), password: decoded.slice(i + 1) },
      };
    }
    default:
      throw new LinkError(`unsupported scheme: ${scheme}`);
  }
}

/** A subscription body is either plain lines or one base64 blob of lines. Unsupported lines are skipped. */
export function parseSubscription(body: string): ParsedLink[] {
  const text = body.includes("://") ? body : b64decode(body.trim());
  const out: ParsedLink[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("://")) continue;
    try {
      out.push(parseLink(line));
    } catch {
      // skip
    }
  }
  return out;
}

const PRIVATE = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "fc00::/7", "fe80::/10"];

/**
 * Full config for hermes (see deploy/proxy/README.md). `__CLASH_SECRET__` is replaced by the root helper,
 * which also runs `sing-box check` and keeps the old config if the new one is invalid.
 */
export function buildSingBoxConfig(link: ParsedLink, serverIp: string): Record<string, unknown> {
  const ipCidr = serverIp.includes(":") ? `${serverIp}/128` : `${serverIp}/32`;
  return {
    log: { level: "warn" },
    dns: {
      servers: [{ type: "tcp", tag: "remote", server: "1.1.1.1", detour: "proxy" }],
      final: "remote",
      strategy: "ipv4_only",
    },
    inbounds: [
      {
        type: "tun",
        tag: "tun-in",
        interface_name: "sbtun",
        address: ["198.18.0.1/30"],
        mtu: 1400,
        auto_route: true,
        strict_route: true,
        stack: "system",
        route_exclude_address: [...PRIVATE, ipCidr],
      },
    ],
    outbounds: [{ ...link.outbound, server: serverIp }, { type: "direct", tag: "direct" }],
    route: {
      rules: [{ action: "sniff" }, { protocol: "dns", action: "hijack-dns" }, { ip_cidr: [ipCidr, ...PRIVATE], outbound: "direct" }],
      final: "proxy",
      auto_detect_interface: true,
      default_domain_resolver: "remote",
    },
    experimental: { clash_api: { external_controller: "127.0.0.1:9090", secret: "__CLASH_SECRET__" } },
  };
}
