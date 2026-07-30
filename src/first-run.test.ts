import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isFirstRunForProject } from "./first-run.js";

test("isFirstRunForProject: true on first call, false on subsequent calls", () => {
  const dir = mkdtempSync(join(tmpdir(), "ngrok-nextjs-test-"));
  assert.equal(isFirstRunForProject(dir), true);
  assert.equal(isFirstRunForProject(dir), false);
  assert.equal(isFirstRunForProject(dir), false);
});

test("isFirstRunForProject: separate projects are tracked independently", () => {
  const dirA = mkdtempSync(join(tmpdir(), "ngrok-nextjs-test-"));
  const dirB = mkdtempSync(join(tmpdir(), "ngrok-nextjs-test-"));
  assert.equal(isFirstRunForProject(dirA), true);
  assert.equal(isFirstRunForProject(dirB), true);
});
