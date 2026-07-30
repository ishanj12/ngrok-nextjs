import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Marker lives under node_modules so it never needs its own gitignore entry —
// node_modules is already universally ignored.
function markerPath(cwd: string): string {
  return resolve(cwd, "node_modules/.cache/ngrok-nextjs/first-run");
}

export function isFirstRunForProject(cwd: string): boolean {
  const path = markerPath(cwd);
  if (existsSync(path)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
  return true;
}
