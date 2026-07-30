import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { syncEnvLocal } from "./env-sync.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ngrok-nextjs-test-"));
}

test("syncEnvLocal: creates .env.local when missing", () => {
  const dir = tempDir();
  syncEnvLocal(dir, ["FOO_URL"], "https://example.com");
  assert.equal(readFileSync(join(dir, ".env.local"), "utf8"), "FOO_URL=https://example.com\n");
});

test("syncEnvLocal: preserves unrelated existing lines", () => {
  const dir = tempDir();
  writeFileSync(join(dir, ".env.local"), "SECRET=abc123\n");
  syncEnvLocal(dir, ["FOO_URL"], "https://example.com");
  const content = readFileSync(join(dir, ".env.local"), "utf8");
  assert.match(content, /SECRET=abc123/);
  assert.match(content, /FOO_URL=https:\/\/example\.com/);
});

test("syncEnvLocal: updates an existing key in place instead of duplicating", () => {
  const dir = tempDir();
  writeFileSync(join(dir, ".env.local"), "FOO_URL=https://old.example.com\n");
  syncEnvLocal(dir, ["FOO_URL"], "https://new.example.com");
  const content = readFileSync(join(dir, ".env.local"), "utf8");
  assert.equal(content.match(/FOO_URL=/g)?.length, 1);
  assert.match(content, /FOO_URL=https:\/\/new\.example\.com/);
});

test("syncEnvLocal: empty keys array is a no-op", () => {
  const dir = tempDir();
  syncEnvLocal(dir, [], "https://example.com");
  assert.throws(() => readFileSync(join(dir, ".env.local"), "utf8"));
});
