import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createJiti } from "jiti";

// Deliberately minimal. ngrok's HttpListenerBuilder also exposes ~15 granular
// per-module fields (oauth, basicAuth, allowCidr, requestHeader, etc.) that
// map to what ngrok used to call "Edge Modules" — but Traffic Policy is the
// confirmed current replacement for that whole system (the SDK's flat
// `policy` field is explicitly marked "DEPRECATED: use TrafficPolicy
// instead", and ngrok's own blog describes Traffic Policy as the deliberate
// architectural successor to per-module config). Rather than wrap a paradigm
// ngrok itself is moving away from, auth/routing/headers/IP-restrictions/etc.
// all go through `trafficPolicy` — a raw pass-through string this wrapper
// doesn't interpret, so it can't go stale as ngrok's policy language grows.
export interface HttpEndpointOptions {
  // The public URL/domain to request for this endpoint. Omit to fall back
  // to the account's default dev domain — fine for a single such endpoint,
  // but a second one that also omits it lands on the same default and needs
  // `pooling: true` to share it intentionally (see DESIGN.md "Multiple
  // endpoints"). Passed straight through to the SDK's `.domain()` builder
  // call — this is just this config's name for it.
  url?: string;
  // Opt in to ngrok's endpoint pooling so multiple listeners can legitimately
  // share one url with load-balanced routing, instead of colliding.
  pooling?: boolean;
  // Raw ngrok Traffic Policy document (YAML or JSON, per ngrok's own
  // format) — the recommended mechanism for auth, IP restrictions, header
  // manipulation, webhook verification, and everything else at the edge.
  // See https://ngrok.com/docs/traffic-policy/.
  trafficPolicy?: string;
}

export interface EndpointConfig extends HttpEndpointOptions {
  // A bare port (forwarded to as `http://localhost:<port>`), or a raw
  // address string — anything the SDK's own forward()/listenAndForward()
  // accept, e.g. "localhost:4000", "https://localhost:8443", or a unix
  // socket path.
  upstream: number | string;
  env?: { url?: string[] };
}

export interface NgrokNextConfig extends HttpEndpointOptions {
  env?: { url?: string[] };
  // Paid-plan multi-endpoint case: fronting more than one local service
  // (e.g. the Next.js app plus a co-located API server) from one command.
  // Supersedes the root-level options above entirely when present — see
  // DESIGN.md "Multiple endpoints (paid accounts)".
  endpoints?: EndpointConfig[];
}

interface ResolvedConfig {
  endpoints: EndpointConfig[];
}

// Only applied to the synthesized single-endpoint case (no explicit
// `endpoints` array in the user's config) — a user-specified multi-endpoint
// entry that omits `env` stays un-synced on purpose, since e.g. a secondary
// API-server endpoint usually shouldn't claim NEXTAUTH_URL.
const DEFAULT_ENV_VARS = ["NEXTAUTH_URL", "NEXT_PUBLIC_APP_URL"];

// Checked in this order: personal override first, then shared/committed config.
// See DESIGN.md "Config" — ngrok.config.local.ts must never be committed.
const CONFIG_FILENAMES = [
  "ngrok.config.local.ts",
  "ngrok.config.local.js",
  "ngrok.config.local.mjs",
  "ngrok.config.ts",
  "ngrok.config.js",
  "ngrok.config.mjs",
];

export async function loadConfig(cwd: string, defaultPort: number): Promise<ResolvedConfig> {
  const jiti = createJiti(import.meta.url);

  for (const filename of CONFIG_FILENAMES) {
    const path = resolve(cwd, filename);
    if (!existsSync(path)) continue;

    const config = (await jiti.import(path, { default: true })) as NgrokNextConfig;
    const { env, endpoints, ...httpOptions } = config;

    return {
      endpoints: endpoints ?? [
        { upstream: defaultPort, env: { url: env?.url ?? DEFAULT_ENV_VARS }, ...httpOptions },
      ],
    };
  }

  return { endpoints: [{ upstream: defaultPort, env: { url: DEFAULT_ENV_VARS } }] };
}
