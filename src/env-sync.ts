import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Updates (or appends) the given keys in .env.local with the tunnel URL,
// preserving every other line in the file untouched.
export function syncEnvLocal(cwd: string, keys: string[], url: string): void {
  if (keys.length === 0) return;

  const path = resolve(cwd, ".env.local");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing.length > 0 ? existing.split("\n") : [];

  const seen = new Set<string>();
  const updated = lines.map((line) => {
    const match = line.match(/^([A-Za-z0-9_]+)=/);
    if (match && keys.includes(match[1])) {
      seen.add(match[1]);
      return `${match[1]}=${url}`;
    }
    return line;
  });

  for (const key of keys) {
    if (!seen.has(key)) updated.push(`${key}=${url}`);
  }

  const output = updated.join("\n").replace(/\n*$/, "\n");
  writeFileSync(path, output);
}
