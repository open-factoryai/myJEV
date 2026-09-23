/**
 * Bundle the Node server (TS, ESM) into a single production-ready JS file.
 * Used by `npm run build:server`, the Docker images and CI.
 *
 *   node scripts/build-server.mjs [--outfile dist-server/server/index.js]
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const outFlag = argv.indexOf("--outfile");
const outfile =
  outFlag >= 0 && argv[outFlag + 1]
    ? path.resolve(root, argv[outFlag + 1])
    : path.join(root, "dist-server/server/index.js");

fs.mkdirSync(path.dirname(outfile), { recursive: true });

const deps = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const external = [...Object.keys(deps.dependencies ?? {}), "vite", "fsevents"];

await build({
  entryPoints: [path.join(root, "server/index.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: process.env.SERVER_SOURCEMAP === "true",
  minify: process.env.SERVER_MINIFY === "true",
  legalComments: "none",
  logLevel: "info",
  external,
  // NOTE: no banner needed — esbuild injects __dirname/__filename shims itself
  // for format=esm + platform=node, and the bundle must stay valid ESM.
  define: {
    "process.env.MYJEV_BUILD_TIME": JSON.stringify(new Date().toISOString()),
  },
});

console.log(`[build-server] → ${path.relative(root, outfile)} (external: ${external.join(", ")})`);
