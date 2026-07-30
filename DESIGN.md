# ngrok + Next.js Integration — Design Sketch (v1)

## Research: who this is actually for

Next.js usage splits roughly into two buckets, but the value here isn't scoped by bucket —
it's layered:

- **Base layer, useful to nearly everyone**: a public URL for your local `next dev` with no
  setup. This has nothing to do with auth or webhooks — it's the same core ngrok value
  (share WIP with a client, test on a real phone, get feedback without waiting on a deploy)
  applied to any Next.js app, including static marketing/content sites. This is arguably the
  widest possible audience and the most natural distribution wedge, since it needs zero
  config to be useful.
- **SaaS-specific layer, additive**: env var sync and OAuth/webhook callback registration.
  Only relevant to **SaaS/B2B dashboards and e-commerce** — the fastest-growing Next.js
  segment (App Router, Server Components/Actions, edge middleware for auth), and the one
  with real integration surface: OAuth sign-in, third-party "connect your account" flows,
  payment webhooks.

Within that second layer, the single most common pain point isn't payment webhooks — it's
**OAuth callback URLs**. Nearly every SaaS dashboard has a "Sign in with Google/GitHub/Slack"
or "Connect your X" flow (commonly via Auth.js/NextAuth), and OAuth providers require a
public HTTPS redirect URI registered in their dashboard, even for local dev. This is also
more tractable than webhooks: OAuth dev credentials are almost always per-developer (each
engineer makes their own Google/GitHub OAuth client for local testing), unlike a shared team
webhook endpoint — so automation here doesn't risk stepping on a teammate's config.

## Problem, revised

Originally framed as "ngrok URLs change on every restart, breaking registered
webhooks/callbacks." That's no longer accurate: **every ngrok account, including free tier,
now gets one permanent dev domain** (`abc123xyz.ngrok-free.dev`) that doesn't change on
restart and doesn't expire. Register a callback URL against it once, and it stays valid
indefinitely. (Source: [ngrok.com/blog/free-static-domains-ngrok-users](https://ngrok.com/blog/free-static-domains-ngrok-users))

So the real friction isn't "URLs drift, build sync logic" — it's smaller and more honest:

1. Two commands/terminals instead of one.
2. Manually finding your dev domain and wiring it into `.env.local` (`NEXTAUTH_URL`,
   `NEXT_PUBLIC_APP_URL`, etc.) every time you start a new project.
3. Remembering to register it with each OAuth/webhook provider *once* — easy to forget, but
   a one-time cost, not a recurring one.

**Confirmed empirically** (free-tier account, live test): the interstitial is gated on
looking like a browser, not applied to every request. A plain non-browser client (e.g. curl,
or any typical webhook sender) gets the real response immediately — `200`, full page body, no
warning, with or without the `ngrok-skip-browser-warning` header. A browser-like User-Agent
gets back `ngrok-error-code: ERR_NGROK_6024` and a small interstitial page instead of the real
one. So: webhook/OAuth server-to-server traffic (the SaaS-layer use case) is unaffected either
way — no header workaround needed there. The base sharing layer (a human opening the link in
an actual browser) does hit a one-time click-through page on free tier; paid plans remove it
entirely.

## Goal

A thin dev-time layer that (a) starts the tunnel bound to your permanent dev domain alongside
`next dev` as one command, (b) keeps your env vars pointed at it automatically, and (c) tells
you clearly, once, what to register where.

Non-goal: replacing ngrok's traffic policy/auth/production ingress features, or building
any "watch for drift and re-sync" machinery — dev domains already solved that.

## Shape of the package

`@ngrok/nextjs` — a CLI wrapper, not a Next.js plugin (see prior discussion: no lifecycle
hook in `next.config.js` for managing a long-running sibling process, and it stays
bundler-agnostic across webpack/Turbopack).

```
npx @ngrok/nextjs dev
```

Wraps `next dev`: starts it, opens a tunnel bound to the account's dev domain (or a
paid-plan reserved domain, if configured), writes the resulting URL into `.env.local`, prints
setup instructions, and passes through any `next dev` flags untouched.

## How it connects

Built on `@ngrok/ngrok`, ngrok's official JS SDK — not the classic CLI. This matters for the
DX story:

- **No separate binary.** The SDK is a native module (Rust core compiled via NAPI-RS) that
  runs inside the Node process itself — it's described as "the ngrok agent packaged as a
  Node.js library." There's no `brew install ngrok`, no CLI on the PATH, no second process to
  manage. `npm install` is the entire install step.
- **Account + authtoken is still required**, on every tier including free — that's an ngrok
  platform policy (since Dec 2023), not something this tool can smooth over. First-run UX
  should detect a missing `NGROK_AUTHTOKEN` and print a direct link to the dashboard's
  authtoken page rather than failing with a raw SDK error.
- **Minimal core call**: `ngrok.forward({ addr: port, authtoken_from_env: true, domain })` —
  the wrapper is a thin layer over this plus the dev-domain lookup and `.env.local` write.

Net onboarding: `npm install @ngrok/nextjs` → sign up free, paste authtoken once
(`NGROK_AUTHTOKEN=...` or a config prompt) → `npx @ngrok/nextjs dev`. No system-level install
step at any point.
([ngrok.com/blog/ngrok-js](https://ngrok.com/blog/ngrok-js), [github.com/ngrok/ngrok-javascript](https://github.com/ngrok/ngrok-javascript))

## Multiple endpoints (paid accounts)

Two different scenarios both fall under "I need more than one endpoint," and they map to
different parts of the SDK:

1. **Several separate local projects/apps running at once** (e.g. a monorepo with a main
   app, an admin dashboard, a docs site — each wants its own public URL). Each
   `npx @ngrok/nextjs dev` invocation is its own process with its own SDK session bound to
   its own reserved domain. This just needs the account's *concurrent endpoint* limit to be
   high enough — free/Hobbyist caps at 3 concurrent endpoints, Personal/Pro raise that, and
   Pay-as-you-go removes the cap entirely. No special coordination logic needed in the
   wrapper; it's purely an account-tier ceiling.
2. **One Next.js dev command that should expose more than one local service** (e.g. the
   Next.js app itself plus a co-located API server, websocket process, or Storybook
   instance). This is where the SDK's session/listener split matters: one authenticated
   `SessionBuilder` connection can open multiple `listen()` calls, each forwarding a
   different local port to its own reserved domain — one session, many listeners, instead of
   one session per port. Config would extend to a list:

   ```ts
   export default {
     endpoints: [
       { upstream: 3000, url: "https://app.mycompany.ngrok.app" },
       { upstream: 4000, url: "https://api.mycompany.ngrok.app" },
     ],
   }
   ```

   The wrapper opens one session, then one listener per configured endpoint, and syncs each
   resulting URL into env vars as configured. This only makes sense on a paid plan with
   multiple reserved domains — free tier's single dev domain has nothing to multiplex across.

**Confirmed empirically — a real silent-failure footgun.** Opening two listeners in the same
session without an explicit `url` on each does not error. ngrok quietly reuses the
account's single dev domain for both, and only the most recently opened listener actually
receives traffic — the other becomes completely unreachable with no warning anywhere. In
testing, this meant the actual Next.js app silently stopped receiving traffic entirely while
a trivial second service on another port silently took over its domain. Verified this is a
genuine SDK gap, not just our wrapper's assumption, by calling the SDK directly (bypassing our
own code entirely): two `listenAndForward()` calls on the same session, no domain, no
pooling — both resolved successfully, both returned the identical URL, zero exceptions either
time.

The real fix is ngrok's own **endpoint pooling** feature (`poolingEnabled` on the listener
builder) — it lets multiple listeners intentionally share one domain with genuine
load-balanced routing, confirmed live by alternating responses from two different local
backends on repeated requests to the same URL. So `tunnels.ts` validates url groups before
opening anything: any two endpoints that would land on the same url (explicit or the
implicit default dev domain) must all set `pooling: true`, or it throws immediately naming
the colliding endpoints — the SDK won't catch this, so the wrapper has to.

Reserved domains themselves start on the Personal plan ($20/mo, one custom domain included);
higher tiers add more domains, team seats, and remove the concurrent-endpoint cap.
([ngrok.com/pricing](https://webflow.ngrok.com/pricing))

## Config

Three separate surfaces — conflating them is how you'd leak a secret or have two teammates
collide on the same domain.

**1. Account-level secret (authtoken) — never committed.** Either `NGROK_AUTHTOKEN` in the
shell env / a gitignored `.env.local`, or a first-run interactive prompt ("no authtoken
found — paste yours from the ngrok dashboard") that caches it in a **user-level** dotfile,
e.g. `~/.config/ngrok-nextjs/authtoken` — same pattern as `gh auth login`. Set once per
machine, not per project.

Caught in manual testing: the CLI loads `.env.local` itself (via `dotenv`, `quiet: true` to
suppress its own promotional console output) before checking for the token. Without this, a
token sitting in `.env.local` was invisible to the wrapper — Next.js auto-loads that file for
the `next dev` *child* process, but that never puts it in the wrapper's own `process.env`, so
it printed "no authtoken found" even with a valid token right there in the file. Doesn't
override an already-exported shell var (dotenv's default).

**2. Project-level config — committed, shared with the team.** `ngrok.config.ts`:

```ts
export default {
  // url omitted = falls back to the account's default dev domain
  env: {
    url: ["NEXTAUTH_URL", "NEXT_PUBLIC_APP_URL"],  // which env vars get the tunnel URL written in
  },
}
```

Safe to commit because it holds no secrets — just intent. Omitting `url` works cleanly for a solo
developer on their own personal ngrok account. It does **not** solve collisions for a real
team: ngrok's dev domains and reserved domains are owned at the **account level**, not per
invited member. A company's normal setup — one shared ngrok team account, engineers invited
in as members — means everyone on that account shares the *same* dev domain, not one each.
So omitting `url` on a team account has the identical exclusivity problem as a hardcoded
reserved domain: one domain, one active listener, whoever's running it holds it.

The only way to get genuinely collision-free, one-per-developer domains on a team account is
to buy one reserved domain per developer and assign each individually — there's no free path
to this once more than one person shares an account.

**3. Personal override — gitignored, not committed.** This is where each developer's
individually-assigned domain lives, whether that's a paid reserved domain (the team case
above) or a specific dev domain (the rare case of someone intentionally using a personal,
non-team account). Needed because hardcoding any specific domain into the shared config
means the second teammate to run the tool that day gets a conflict instead of a tunnel. So
domain assignment needs to live somewhere personal: an `NGROK_DOMAIN` env var, or a gitignored
`ngrok.config.local.ts` (mirroring the `.env.local` convention Next.js devs already know),
taking precedence over the shared file. `NGROK_DOMAIN` accepts a bare domain (defaults to
`https://` automatically) or a full scheme-qualified URL.

Resolution order: `NGROK_DOMAIN` env var (applies to whichever endpoint next dev itself runs
on) → `ngrok.config.local.ts` → `ngrok.config.ts`'s `url` field → fall back to the account
default dev domain.

No provider adapters, no API keys for third-party services required for the core tool —
that was the riskiest and least necessary part of the earlier design.

### The full config surface: deliberately small

Root-level fields (or per-entry in `endpoints[]` for the multi-endpoint case) are just:
`upstream`, `url`, `pooling`, `env.url`, `trafficPolicy`, and `binding`. That's it.

- `upstream` — a bare port number (forwarded to as `http://localhost:<port>`), or a raw
  address string accepted by the SDK's own `listenAndForward()` — `"localhost:4000"`, a full
  `"https://localhost:8443"`, a unix socket path, whatever it takes.
- `url` — the public endpoint address, as a real URL. Both the **endpoint type** (HTTP, TCP,
  or TLS — three genuinely different SDK builders, `session.httpEndpoint()` /
  `tcpEndpoint()` / `tlsEndpoint()`) and the **domain**/**edge scheme** are inferred from its
  own scheme, rather than being separate fields:
  - `http://`/`https://` → `httpEndpoint()`, with `.domain(hostname)` and `.scheme("HTTP"|"HTTPS")`
    both set from the URL — this is also how edge scheme (a real, separate SDK setting with no
    Traffic Policy equivalent — confirmed by checking the actions reference directly) gets
    specified at all, without needing its own field.
  - `tls://` → `tlsEndpoint()` with `.domain(hostname)`.
  - `tcp://` → `tcpEndpoint()` with `.remoteAddr(host)` — TCP addresses are a `host:port` pair
    (e.g. `2.tcp.ngrok.io:21746`), not a bare domain, since `TcpListenerBuilder` has no
    `.domain()` method at all; confirmed by reading its actual type definition rather than
    assuming it mirrors the HTTP builder.
  - Omit `url` entirely to fall back to the account's default dev domain as an HTTP(S)
    endpoint — matches the original zero-config behavior. If provided, it must include a
    scheme or the wrapper throws immediately rather than silently guessing one.
- `binding` — `"public" | "internal" | "kubernetes"`, ngrok's ingress configuration. Also kept
  standalone despite the trafficPolicy-only decision, for the same reason `url`'s scheme
  inference exists: checked ngrok's Traffic Policy actions reference directly, and there's no
  equivalent there either — "Forward Internal" routes traffic *to* an internal endpoint, it
  doesn't declare *this* endpoint internal. Confirmed live that `binding: "internal"` has a
  real, enforced constraint: ngrok itself rejects it unless `url` ends in `.internal`
  (`ERR_NGROK_9029`) — a clear, specific error, not a silent failure, so no extra guard needed
  on our side beyond documenting it.

ngrok's `HttpListenerBuilder` in the JS SDK also exposes ~15 more granular fields —
`oauth`, `basicAuth`, `allowCidr`/`denyCidr`, `requestHeader`/`responseHeader`, `circuitBreaker`,
`webhookVerification`, `allowUserAgent`/`denyUserAgent`, etc. These map to what ngrok used to
call "Edge Modules." Deliberately not wrapped here: the SDK's flat `policy` field is explicitly
marked `DEPRECATED: use TrafficPolicy instead` in its own type definitions, and ngrok's blog
describes Traffic Policy as the deliberate architectural successor to the whole per-module
system. Wrapping ~15 fields that mirror a paradigm ngrok itself is moving away from would just
be surface area that goes stale. `trafficPolicy` — a raw YAML/JSON string, passed straight to
`builder.trafficPolicy()` — covers auth, IP restrictions, header manipulation, webhook
verification, and circuit breaking instead, confirmed **in the JS SDK specifically**: live-tested
a Traffic Policy document enforcing basic auth through `ngrok.config.ts`'s `trafficPolicy` field
— no credentials → `401`, correct credentials → `200`, no terminating action needed since this
is an agent endpoint forwarding to a real upstream (unlike ngrok's own Cloud Endpoint docs
examples, which require one).

Confirmed gap, smaller than first thought: checking ngrok's Traffic Policy actions reference
turned up no dedicated action for user-agent allow/deny filtering or WebSocket-to-TCP
conversion. Mutual TLS is *not* a gap — `terminate-tls` supports real client-cert
verification (`mutual_tls_certificate_authorities`, `mutual_tls_verification_strategy` with
`require-and-verify`/`require-any`/`request` modes), confirmed by reading the action's actual
config schema rather than its summary description. So the only real hole is those two
filtering/protocol-conversion cases — small and unlikely enough not to design around now, but
not nothing.

## Flow

1. `npx @ngrok/nextjs dev` starts.
2. Looks up the account's dev domain via the ngrok agent/API (or uses a configured reserved
   domain).
3. Spawns `next dev` as a child process, opens the tunnel bound to that domain.
4. Writes/updates `.env.local` with the tunnel URL under the configured env var names.
5. Prints local URL, public URL, and — **only on first run for this project** — a short
   checklist: "Register this URL with your OAuth/webhook providers. It won't change again."
   with direct deep-links to the relevant provider dashboard pages where feasible.
6. Nothing to watch for after that — the domain is permanent for the life of the account.

## Optional enhancement (v2, not core)

For OAuth providers where dev-mode apps are provisioned per-developer (Google, GitHub,
Slack), an opt-in adapter could auto-write the redirect URI via the provider's API on first
run, instead of the dev copy-pasting it into a dashboard. Safe to automate because it's
personal config, not shared team/production state. Explicitly **not** doing this for
production-shared webhook endpoints (e.g. a repo-level GitHub webhook, a team Stripe
endpoint) — those stay manual, or use a relay model instead (e.g. Stripe's own
`stripe listen`, which never touches persisted config at all).

## Open questions / things to validate before building

- **Multiple local projects, one free dev domain**: free tier gives one dev domain per
  account, not per project. If someone runs two Next.js projects locally at once, they can't
  both use the same dev domain concurrently in the naive case — needs a clear story (paid
  reserved domains, or a "which project owns the dev domain right now" prompt).
- **Interstitial header handling**: confirm which real OAuth/webhook flows are actually
  affected by the free-tier warning page, and whether the wrapper should inject
  `ngrok-skip-browser-warning` guidance automatically in printed setup steps.
- **Distribution**: still the main open question from before — value is contingent on this
  showing up in Next.js's own docs/examples or ranking for relevant searches, not just living
  in ngrok's docs.

## Phasing

- **v0 — base layer, ships value to everyone**: CLI wrapper, dev-domain binding, print
  public URL, QR code for mobile testing. No env sync, no provider awareness at all — this
  is just "one command to share your local Next.js app," useful whether it's a marketing
  site, a dashboard, or anything else.
- **v1 — SaaS layer**: `.env.local` sync, first-run setup checklist for OAuth/webhook
  registration. This is where the tool starts being specific to the auth/integration-heavy
  segment.
- **v2**: optional, opt-in OAuth redirect-URI automation for per-developer dev credentials
  only (Google/GitHub/Slack). Never for shared/production-scoped webhook config.
