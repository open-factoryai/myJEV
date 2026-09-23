/**
 * Tiny bearer-token auth + fixed-window rate limiter. Both optional.
 *
 *   MYJEV_API_TOKEN=secret   -> clients must send `Authorization: Bearer secret`
 *   REQUIRE_AUTH=true          -> reject unauthenticated calls even without a token set
 *   RATE_LIMIT_MAX=120         -> requests per window per IP (0 disables)
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ServerConfig } from "./config";

export function authMiddleware(cfg: ServerConfig): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!cfg.apiToken && !cfg.requireAuth) return next();

    const header = req.header("authorization") || "";
    const token = header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : (req.query.token as string | undefined) ?? "";

    if (!cfg.apiToken) {
      // REQUIRE_AUTH=true but no token configured -> lock everything down.
      return res.status(503).json({
        error: "Auth is required (REQUIRE_AUTH=true) but MYJEV_API_TOKEN is not set on the server.",
      });
    }
    if (token !== cfg.apiToken) {
      return res.status(401).json({ error: "Unauthorized: invalid or missing bearer token" });
    }
    next();
  };
}

interface Bucket {
  count: number;
  reset: number;
}

export function rateLimitMiddleware(cfg: ServerConfig): RequestHandler {
  const { windowMs, max } = cfg.rateLimit;
  const buckets = new Map<string, Bucket>();

  if (!max || max <= 0) return (_req, _res, next) => next();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) if (b.reset < now) buckets.delete(key);
  }, Math.max(windowMs, 30_000));
  sweep.unref?.();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${req.ip || "unknown"}:${req.path}`;
    const bucket = buckets.get(key);
    if (!bucket || bucket.reset < now) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(max - 1));
      return next();
    }
    bucket.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil((bucket.reset - now) / 1000)));
    if (bucket.count > max) {
      return res.status(429).json({
        error: `Rate limit exceeded (${max} req / ${Math.round(windowMs / 1000)}s). Raise RATE_LIMIT_MAX or put a real proxy in front.`,
        retry_after_s: Math.ceil((bucket.reset - now) / 1000),
      });
    }
    next();
  };
}
