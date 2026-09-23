#!/usr/bin/env node
/**
 * Container HEALTHCHECK probe — zero dependencies, works in node:alpine.
 * Exits 0 when GET /api/health answers 2xx/3xx within MYJEV_HEALTH_TIMEOUT_MS.
 */
import http from "node:http";
import https from "node:https";

const port = Number(process.env.PORT || 3001);
const rawHost = process.env.HOST || "0.0.0.0";
const host = rawHost === "0.0.0.0" || rawHost === "::" ? "127.0.0.1" : rawHost;
const path = process.env.MYJEV_HEALTH_PATH || "/api/health";
const timeout = Number(process.env.MYJEV_HEALTH_TIMEOUT_MS || 4000);
const lib = /^https:/.test(path) ? https : http;

const req = lib.request(
  { host, port, path, method: "GET", timeout, headers: { accept: "application/json" } },
  (res) => {
    res.resume();
    process.exit(res.statusCode && res.statusCode < 400 ? 0 : 1);
  }
);

req.on("timeout", () => {
  req.destroy();
  process.exit(1);
});
req.on("error", () => process.exit(1));
req.end();
