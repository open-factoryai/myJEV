/**
 * Minimal JSONL request logger with size-based rotation. No dependencies.
 * Disabled by default — enable with LOG_REQUESTS=true.
 */
import fs from "fs";
import path from "path";
import type { ServerConfig } from "./config";

export interface LogEntry {
  ts: string;
  request_id: string;
  route: string;
  mode?: string;
  model?: string;
  status: number;
  latency_ms: number;
  questions?: number;
  calls?: number;
  input_tokens?: number | null;
  output_tokens?: number | null;
  ip?: string;
  error?: string;
}

let stream: fs.WriteStream | null = null;
let currentFile = "";
let currentSize = 0;
let maxSize = 5 * 1024 * 1024;

function rotate(file: string) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.renameSync(file, `${file}.${stamp}`);
    const dir = path.dirname(file);
    const olds = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(path.basename(file) + "."))
      .sort();
    while (olds.length > 5) {
      const victim = olds.shift();
      if (victim) fs.rmSync(path.join(dir, victim), { force: true });
    }
  } catch {
    /* best effort */
  }
}

export function initLogger(cfg: ServerConfig) {
  if (!cfg.requestLog.enabled) return;
  currentFile = path.isAbsolute(cfg.requestLog.file)
    ? cfg.requestLog.file
    : path.resolve(process.cwd(), cfg.requestLog.file);
  maxSize = cfg.requestLog.maxSizeBytes;
  fs.mkdirSync(path.dirname(currentFile), { recursive: true });
  try {
    currentSize = fs.statSync(currentFile).size;
  } catch {
    currentSize = 0;
  }
  stream = fs.createWriteStream(currentFile, { flags: "a" });
  console.log(`[myjev] request log → ${currentFile} (rotate at ${Math.round(maxSize / 1024)} KB)`);
}

export function logRequest(entry: LogEntry) {
  if (!stream) return;
  const line = JSON.stringify(entry) + "\n";
  if (currentSize + line.length > maxSize) {
    stream.end();
    rotate(currentFile);
    currentSize = 0;
    stream = fs.createWriteStream(currentFile, { flags: "a" });
  }
  currentSize += line.length;
  stream.write(line);
}

export function closeLogger() {
  stream?.end();
  stream = null;
}
