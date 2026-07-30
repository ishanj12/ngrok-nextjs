import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "./config.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ngrok-nextjs-test-"));
}

test("loadConfig: no config file falls back to a single default endpoint", async () => {
  const result = await loadConfig(tempDir(), 3000);
  assert.deepEqual(result.endpoints, [
    { upstream: 3000, env: { url: ["NEXTAUTH_URL", "NEXT_PUBLIC_APP_URL"] } },
  ]);
});

test("loadConfig: root-level fields fold into a single synthesized endpoint", async () => {
  const dir = tempDir();
  writeFileSync(
    join(dir, "ngrok.config.ts"),
    "export default { url: \"https://custom.ngrok.app\", pooling: true };",
  );
  const result = await loadConfig(dir, 3000);
  assert.deepEqual(result.endpoints, [
    {
      upstream: 3000,
      url: "https://custom.ngrok.app",
      pooling: true,
      env: { url: ["NEXTAUTH_URL", "NEXT_PUBLIC_APP_URL"] },
    },
  ]);
});

test("loadConfig: custom env.url overrides the defaults", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "ngrok.config.ts"), 'export default { env: { url: ["CUSTOM_URL"] } };');
  const result = await loadConfig(dir, 3000);
  assert.deepEqual(result.endpoints[0].env, { url: ["CUSTOM_URL"] });
});

test("loadConfig: explicit endpoints array supersedes root-level fields entirely", async () => {
  const dir = tempDir();
  writeFileSync(
    join(dir, "ngrok.config.ts"),
    `export default { url: "https://ignored.ngrok.app", endpoints: [
      { upstream: 3000, url: "https://a.ngrok.app" },
      { upstream: 4000, url: "https://b.ngrok.app" },
    ] };`,
  );
  const result = await loadConfig(dir, 3000);
  assert.equal(result.endpoints.length, 2);
  assert.equal(result.endpoints[0].url, "https://a.ngrok.app");
  assert.equal(result.endpoints[1].url, "https://b.ngrok.app");
});

test("loadConfig: multi-endpoint entries default to no env sync unless specified", async () => {
  const dir = tempDir();
  writeFileSync(
    join(dir, "ngrok.config.ts"),
    'export default { endpoints: [{ upstream: 3000, url: "https://a.ngrok.app" }] };',
  );
  const result = await loadConfig(dir, 3000);
  assert.equal(result.endpoints[0].env, undefined);
});

test("loadConfig: ngrok.config.local.ts takes precedence over ngrok.config.ts", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "ngrok.config.ts"), 'export default { url: "https://shared.ngrok.app" };');
  writeFileSync(
    join(dir, "ngrok.config.local.ts"),
    'export default { url: "https://personal.ngrok.app" };',
  );
  const result = await loadConfig(dir, 3000);
  assert.equal(result.endpoints[0].url, "https://personal.ngrok.app");
});
