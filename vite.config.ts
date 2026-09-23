import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vite is used two ways:
 *  1. `npm run dev`            -> middleware mode, mounted inside the Express server (server/index.ts)
 *  2. `npm run build:client`   -> static bundle in dist/, served by nginx (docker) or Express (single image)
 *
 * The dev proxy only matters for `npm run dev:client` (standalone Vite on :5173).
 */
const API_TARGET = process.env.VITE_PROXY_TARGET || "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  root: ".",
  publicDir: "public",
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: process.env.VITE_SOURCEMAP === "true",
    target: "es2020",
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: process.env.VITE_HOST || "127.0.0.1",
    port: Number(process.env.VITE_PORT) || 5173,
    strictPort: false,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: false },
    },
  },
  preview: { host: "0.0.0.0", port: 4173 },
});
