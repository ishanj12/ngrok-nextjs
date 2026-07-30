import ngrok from "@ngrok/ngrok";
import type { Session } from "@ngrok/ngrok";
import type { EndpointConfig } from "./config.js";

export interface OpenedEndpoint {
  upstream: number | string;
  url: string;
  envVars: string[];
}

export interface Tunnels {
  endpoints: OpenedEndpoint[];
  close(): Promise<void>;
}

export type ParsedEndpoint =
  | { kind: "default" }
  | { kind: "http"; hostname: string; scheme: "HTTP" | "HTTPS" }
  | { kind: "tls"; hostname: string }
  | { kind: "tcp"; remoteAddr: string };

// Pure — no SDK calls — so the scheme-inference rules can be unit tested
// without a live session. The endpoint type (HTTP/TCP/TLS) and its
// domain-equivalent setting aren't separate config fields — both come from
// `url`'s own scheme, since that's already how everyone writes URLs.
export function parseEndpointUrl(url: string | undefined): ParsedEndpoint {
  if (!url) return { kind: "default" };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `Endpoint url "${url}" must include a scheme (http://, https://, tcp://, or ` +
        "tls://) so the endpoint type and domain can be inferred from it.",
    );
  }

  const proto = parsed.protocol.replace(":", "");
  switch (proto) {
    case "http":
    case "https":
      return { kind: "http", hostname: parsed.hostname, scheme: proto.toUpperCase() as "HTTP" | "HTTPS" };
    case "tls":
      return { kind: "tls", hostname: parsed.hostname };
    case "tcp":
      // TCP addresses are host:port, not a bare domain — e.g. "2.tcp.ngrok.io:21746".
      return { kind: "tcp", remoteAddr: parsed.host };
    default:
      throw new Error(`Endpoint url "${url}" has unsupported proto "${proto}:" — expected http, https, tcp, or tls.`);
  }
}

// tcp/tls are genuinely different SDK builders from http, with different
// address-setting methods — this is the only place that matters.
function buildListener(session: Session, entry: EndpointConfig) {
  const parsed = parseEndpointUrl(entry.url);

  const builder =
    parsed.kind === "default"
      ? session.httpEndpoint()
      : parsed.kind === "http"
        ? session.httpEndpoint().domain(parsed.hostname).scheme(parsed.scheme)
        : parsed.kind === "tls"
          ? session.tlsEndpoint().domain(parsed.hostname)
          : session.tcpEndpoint().remoteAddr(parsed.remoteAddr);

  if (entry.pooling) builder.poolingEnabled(true);
  if (entry.trafficPolicy) builder.trafficPolicy(entry.trafficPolicy);
  return builder;
}

export function forwardAddr(upstream: number | string): string {
  return typeof upstream === "number" ? `http://localhost:${upstream}` : upstream;
}

// ngrok does not reject or warn when two listeners in the same session end
// up on the same public url — it silently lets the most recently opened
// listener win, and the other becomes unreachable with zero indication of
// why. Confirmed empirically, isolated from this wrapper's own code (a raw
// SDK script showed both listenAndForward() calls resolving successfully
// with identical URLs, no exception either time). An endpoint with no
// explicit `url` falls back to the account's default dev domain, so two
// url-less endpoints collide there just as surely as two hardcoding the
// same string. Either case is fine *if* every endpoint sharing that url
// opts into `pooling: true` (ngrok's real mechanism for intentionally
// sharing an endpoint with load-balanced routing, confirmed live — repeated
// requests alternated between two different local backends) — otherwise
// it's the silent-failure footgun, so fail fast instead.
export function validateUrlGroups(endpoints: EndpointConfig[]): void {
  const groups = new Map<string, EndpointConfig[]>();
  for (const entry of endpoints) {
    const key = entry.url ?? "";
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  for (const [url, group] of groups) {
    if (group.length <= 1) continue;
    if (group.every((e) => e.pooling)) continue;

    const label = url || "the account's default dev domain";
    const upstreams = group.map((e) => e.upstream).join(", ");
    throw new Error(
      `Upstreams ${upstreams} would all share ${label}. Without endpoint pooling, only the ` +
        "most recently opened listener actually receives traffic — the rest go silently " +
        'unreachable. Set "pooling: true" on each of these endpoints to share it ' +
        "intentionally, or give each its own url.",
    );
  }
}

// Always goes through a single explicit Session, even for the common
// one-endpoint case — this is what lets every option apply uniformly
// regardless of how many endpoints are configured or what proto each uses.
export async function openTunnels(endpoints: EndpointConfig[]): Promise<Tunnels> {
  validateUrlGroups(endpoints);
  const session = await new ngrok.SessionBuilder().authtokenFromEnv().connect();

  const opened: OpenedEndpoint[] = [];
  for (const entry of endpoints) {
    const builder = buildListener(session, entry);
    const listener = await builder.listenAndForward(forwardAddr(entry.upstream));
    const url = listener.url();
    if (!url) throw new Error(`ngrok listener for upstream ${entry.upstream} returned no URL`);

    opened.push({ upstream: entry.upstream, url, envVars: entry.env?.url ?? [] });
  }

  return { endpoints: opened, close: () => session.close() };
}
