#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import qrcode from "qrcode-terminal";
import { loadConfig } from "./config.js";
import { syncEnvLocal } from "./env-sync.js";
import { isFirstRunForProject } from "./first-run.js";
import { openTunnels } from "./tunnels.js";

async function main() {
  const cwd = process.cwd();
  // .env.local is where NGROK_AUTHTOKEN/NGROK_DOMAIN are expected to live
  // (see DESIGN.md "Config") — Next.js loads it for the `next dev` child
  // process automatically, but that doesn't put it in *this* process's env,
  // so without this, NGROK_AUTHTOKEN silently "isn't found" even when it's
  // sitting right there in the file. Doesn't override already-exported
  // shell env vars.
  loadDotenv({ path: resolve(cwd, ".env.local"), quiet: true });

  const port = Number(process.env.PORT ?? 3000);
  const config = await loadConfig(cwd, port);

  // NGROK_DOMAIN wins over config so a personal reserved domain never has to
  // be hardcoded into a file — see DESIGN.md "Config" for why that matters
  // once more than one person shares an ngrok account. Only applies to the
  // endpoint next dev itself is running on. `url` requires a scheme (see
  // tunnels.ts) — default to https:// if the env var is a bare domain.
  if (process.env.NGROK_DOMAIN) {
    const primaryEntry = config.endpoints.find((e) => e.upstream === port);
    if (primaryEntry) {
      primaryEntry.url = process.env.NGROK_DOMAIN.includes("://")
        ? process.env.NGROK_DOMAIN
        : `https://${process.env.NGROK_DOMAIN}`;
    }
  }

  if (!process.env.NGROK_AUTHTOKEN) {
    console.error(
      "\nNo NGROK_AUTHTOKEN found.\n" +
        "Get a free one at https://dashboard.ngrok.com/authtokens, then run:\n" +
        "  NGROK_AUTHTOKEN=<token> npx @ngrok/nextjs dev\n",
    );
    process.exit(1);
  }

  const next = spawn("npx", ["next", "dev", "--port", String(port)], {
    stdio: "inherit",
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
  });

  const killNext = () => {
    if (next.exitCode !== null || next.pid === undefined) return;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(next.pid), "/T", "/F"]);
    } else {
      // next dev spawns its own child processes (Turbopack workers, etc.);
      // killing just `next.pid` leaves those running and holding the port.
      // The negative pid targets the whole process group instead.
      try {
        process.kill(-next.pid, "SIGTERM");
      } catch {
        // group may already be gone
      }
    }
  };

  let tunnels;
  try {
    tunnels = await openTunnels(config.endpoints);
  } catch (err) {
    // next dev is already running at this point — if the tunnel setup fails
    // (e.g. bad config, domain collision), it must not be left orphaned.
    killNext();
    throw err;
  }

  for (const endpoint of tunnels.endpoints) {
    console.log(`\n  Public (${endpoint.upstream}): ${endpoint.url}\n`);
    syncEnvLocal(cwd, endpoint.envVars, endpoint.url);
  }

  // QR code only for the primary endpoint (the one next dev is actually
  // running on) — printing one per endpoint would just be noise. Only
  // matches when upstream is the plain port number next dev runs on; if the
  // primary entry's upstream is written as a string instead, it won't be
  // detected as primary — an accepted edge case, not worth parsing for.
  const primary = tunnels.endpoints.find((e) => e.upstream === port) ?? tunnels.endpoints[0];
  if (primary && process.env.NGROK_QR !== "false") {
    qrcode.generate(primary.url, { small: true });
  }

  if (primary && isFirstRunForProject(cwd)) {
    console.log(
      "  First run for this project — register these URLs once with your OAuth/webhook\n" +
        "  providers. They won't change again as long as you keep using these domains:\n" +
        tunnels.endpoints.map((e) => `    ${e.url}`).join("\n") +
        "\n",
    );
  }

  const shutdown = async () => {
    await tunnels.close();
    killNext();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  next.on("exit", (code) => {
    tunnels.close().finally(() => process.exit(code ?? 0));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
