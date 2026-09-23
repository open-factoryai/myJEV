import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Dependency-free .env loader.
 * Real environment variables always win over file values (so Docker/Compose env wins).
 * Reads: .env  ->  .env.local  ->  .env.<NODE_ENV>
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseEnvFile(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  let count = 0;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let working = trimmed;
    if (working.startsWith("export ")) working = working.slice(7).trim();
    const eq = working.indexOf("=");
    if (eq <= 0) continue;
    const key = working.slice(0, eq).trim();
    let val = working.slice(eq + 1).trim();
    // strip trailing inline comments for unquoted values
    if (!/^["']/.test(val)) {
      const hash = val.indexOf(" #");
      if (hash > 0) val = val.slice(0, hash).trim();
    }
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
      count++;
    }
  }
  return count;
}

const files = [".env", ".env.local"];
if (process.env.NODE_ENV) files.push(`.env.${process.env.NODE_ENV}`);
if (process.env.MYJEV_ENV_FILE) files.push(process.env.MYJEV_ENV_FILE);

let loaded = 0;
for (const f of files) loaded += parseEnvFile(path.join(root, f)) || parseEnvFile(path.resolve(f));

if (loaded > 0 && process.env.MYJEV_QUIET_ENV !== "true") {
  console.log(`[myjev] loaded ${loaded} var(s) from ${files.join(", ")}`);
}

export { parseEnvFile };
