# @ngrok/nextjs

Run `next dev` with a public ngrok URL, in one command — no separate binary, no manual
`ngrok http 3000` in a second terminal.

```
npx @ngrok/nextjs dev
```

Built on [`@ngrok/ngrok`](https://www.npmjs.com/package/@ngrok/ngrok), ngrok's official
JavaScript SDK — a native module, not a wrapper around a downloaded CLI binary. There's
nothing to install besides this package.

## Setup

1. Sign up free at [ngrok.com](https://ngrok.com) and grab an authtoken from
   [the dashboard](https://dashboard.ngrok.com/authtokens).
2. Put it in `.env.local` in your Next.js project root:
   ```
   NGROK_AUTHTOKEN=your_token_here
   ```
   (Never commit this file — it's gitignored by `create-next-app` by default.)
3. Run it:
   ```
   npx @ngrok/nextjs dev
   ```

That's it. You'll get a public URL bound to your ngrok account's dev domain — permanent, so
you only need to register it with OAuth/webhook providers once, ever.

## What it does

- Spawns `next dev` and opens an ngrok tunnel to it as one process, so stopping it
  (`Ctrl+C`) cleanly tears down both — including `next dev`'s own child processes.
- Defaults to your account's dev domain (`abc123.ngrok-free.dev`), no config needed.
- Syncs the tunnel URL into `.env.local` under `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` by
  default, so auth libraries and client code pick it up automatically.
- Prints a QR code so you can open the tunnel on your phone. Disable with `NGROK_QR=false`.
- Prints a one-time setup checklist on first run per project, reminding you to register the
  URL with your OAuth/webhook providers.

## Config

Optional `ngrok.config.ts` (or `.js`/`.mjs`) in your project root. Safe to commit — it holds
no secrets, just intent:

```ts
export default {
  url: "https://your-reserved-domain.ngrok.app", // omit for the account's default dev domain
  env: { url: ["NEXTAUTH_URL", "NEXT_PUBLIC_APP_URL"] },
  trafficPolicy: `
on_http_request:
  - actions:
      - type: basic-auth
        config:
          credentials:
            - "user:password123"
`,
};
```

| Field | Type | Description |
|---|---|---|
| `url` | `string?` | Public endpoint URL, with scheme. The endpoint type (HTTP/TCP/TLS) and edge scheme are both inferred from it — `https://…` and `http://…` open an HTTP endpoint; `tls://…` a TLS endpoint; `tcp://host:port` a TCP endpoint. Omit for the account's default dev domain. |
| `pooling` | `boolean?` | Opt in to ngrok endpoint pooling so multiple endpoints can intentionally share one `url` with load-balanced routing. Required when two endpoints would otherwise collide on the same URL. |
| `trafficPolicy` | `string?` | A raw [ngrok Traffic Policy](https://ngrok.com/docs/traffic-policy/) document (YAML or JSON) — the mechanism for auth, IP restrictions, header manipulation, webhook verification, and more. |
| `env.url` | `string[]?` | Which env vars in `.env.local` get this endpoint's URL. |
| `binding` | `"public" \| "internal" \| "kubernetes"?` | Ingress configuration. Not part of Traffic Policy — checked directly against ngrok's actions reference, there's no equivalent action, so this stays a standalone field. `"internal"` requires `url` to end in `.internal`, enforced by ngrok itself (`ERR_NGROK_9029` if it doesn't). |
| `endpoints` | `EndpointConfig[]?` | Paid-plan multi-endpoint case — front more than one local service from a single command. Supersedes the root-level fields above entirely. Each entry also takes `upstream` (a port number or raw address string) alongside `url`/`pooling`/`trafficPolicy`/`env`/`binding`. |

### Personal overrides

Two ways to override the shared config without editing a committed file — needed because a
specific reserved domain is exclusive; if it's hardcoded into `ngrok.config.ts`, the second
teammate to run this on the same day gets a conflict instead of a tunnel:

- `NGROK_DOMAIN` env var (bare domain or full URL)
- `ngrok.config.local.ts` — same shape as `ngrok.config.ts`, gitignore it

Resolution order: `NGROK_DOMAIN` → `ngrok.config.local.ts` → `ngrok.config.ts` → account
default dev domain.

### Multiple endpoints (paid plans)

```ts
export default {
  endpoints: [
    { upstream: 3000, url: "https://app.mycompany.ngrok.app" },
    { upstream: 4000, url: "https://api.mycompany.ngrok.app" },
  ],
};
```

Each endpoint needs its own distinct `url`, or `pooling: true` on every endpoint sharing one.

## Requirements

- Node.js 18+
- An ngrok account (free tier works) and authtoken — required on every plan, no exceptions.

## Development

```
pnpm install
pnpm run build   # compiles src/ -> dist/
pnpm test         # runs the unit test suite
```

See [`examples/test-app`](examples/test-app) for a working Next.js app to test against, and
[`DESIGN.md`](DESIGN.md) for the design rationale and everything confirmed empirically along
the way.

## License

[MIT](LICENSE)
