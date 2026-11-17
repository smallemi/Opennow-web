import { createHash, createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { parseCookies } from "./sessionStore";

/**
 * Optional private-instance gate. When OPENNOW_INSTANCE_PASSWORD is set, every API
 * route and the signaling bridge require an unlock cookie obtained with that password.
 */

const COOKIE_NAME = "opennow_instance";
const TOKEN_VERSION = "v1";
const DEFAULT_REMEMBER_DAYS = 30;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_WINDOW = 10;
const MAX_PASSWORD_LENGTH = 1024;

/** API paths reachable while the instance is locked. */
const PUBLIC_API_PATHS = new Set(["/api/health", "/api/instance/status", "/api/instance/unlock"]);

export interface InstanceAccessConfig {
  password: string | null;
  rememberDays: number;
  /** Mixed into the signing key so tokens from another deployment are rejected. */
  secret: string;
}

export function readInstanceAccessConfig(env: NodeJS.ProcessEnv = process.env): InstanceAccessConfig {
  const password = env.OPENNOW_INSTANCE_PASSWORD ?? "";
  const days = Number(env.OPENNOW_INSTANCE_REMEMBER_DAYS);
  return {
    password: password.length > 0 ? password : null,
    rememberDays: Number.isFinite(days) && days > 0 ? days : DEFAULT_REMEMBER_DAYS,
    secret: env.SESSION_SECRET?.trim() ?? "",
  };
}

export class InstanceAccess {
  private readonly signingKey: Buffer | null;
  private readonly passwordDigest: Buffer | null;
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly config: InstanceAccessConfig) {
    if (config.password) {
      // Derived from the password, so changing the password signs everyone out and
      // unlock sessions survive server restarts. scrypt keeps a leaked cookie from
      // being an easy offline password oracle.
      this.signingKey = scryptSync(config.password, `opennow-instance:${config.secret}`, 32);
      this.passwordDigest = createHash("sha256").update(config.password, "utf8").digest();
    } else {
      this.signingKey = null;
      this.passwordDigest = null;
    }
  }

  get enabled(): boolean {
    return this.signingKey !== null;
  }

  get rememberMs(): number {
    return this.config.rememberDays * 24 * 60 * 60 * 1000;
  }

  checkPassword(candidate: unknown): boolean {
    if (!this.passwordDigest || typeof candidate !== "string" || candidate.length > MAX_PASSWORD_LENGTH) return false;
    const digest = createHash("sha256").update(candidate, "utf8").digest();
    return timingSafeEqual(digest, this.passwordDigest);
  }

  issueToken(now = Date.now()): string {
    if (!this.signingKey) throw new Error("Private instance mode is disabled.");
    const payload = `${TOKEN_VERSION}.${now + this.rememberMs}`;
    return `${payload}.${this.sign(payload)}`;
  }

  verifyToken(token: string | undefined, now = Date.now()): boolean {
    if (!this.signingKey || !token) return false;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return false;
    const expiresAt = Number(parts[1]);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
    const expected = Buffer.from(this.sign(`${parts[0]}.${parts[1]}`));
    const actual = Buffer.from(parts[2] ?? "");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  isUnlocked(request: Pick<IncomingMessage, "headers">): boolean {
    if (!this.enabled) return true;
    return this.verifyToken(parseCookies(request.headers.cookie)[COOKIE_NAME]);
  }

  /** Returns seconds until retry is allowed, or 0 when the client may try again. */
  retryAfterSeconds(clientKey: string, now = Date.now()): number {
    const entry = this.failures.get(clientKey);
    if (!entry || entry.resetAt <= now) return 0;
    return entry.count >= MAX_FAILURES_PER_WINDOW ? Math.ceil((entry.resetAt - now) / 1000) : 0;
  }

  recordFailure(clientKey: string, now = Date.now()): void {
    const entry = this.failures.get(clientKey);
    if (!entry || entry.resetAt <= now) {
      this.failures.set(clientKey, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
    } else {
      entry.count += 1;
    }
    if (this.failures.size > 10_000) {
      for (const [key, value] of this.failures) if (value.resetAt <= now) this.failures.delete(key);
    }
  }

  clearFailures(clientKey: string): void {
    this.failures.delete(clientKey);
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.signingKey as Buffer).update(payload).digest("base64url");
  }
}

export const instanceAccess = new InstanceAccess(readInstanceAccessConfig());

function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

function clientKey(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? "unknown";
}

export function registerInstanceAccessRoutes(app: import("express").Express, access = instanceAccess): void {
  app.get("/api/instance/status", (request, response) => {
    response.json({ private: access.enabled, unlocked: access.isUnlocked(request) });
  });

  app.post("/api/instance/unlock", (request, response) => {
    if (!access.enabled) {
      response.json({ private: false, unlocked: true });
      return;
    }
    const key = clientKey(request);
    const retryAfter = access.retryAfterSeconds(key);
    if (retryAfter > 0) {
      response.setHeader("Retry-After", String(retryAfter));
      response.status(429).json({ error: "Too many attempts. Try again later.", code: "INSTANCE_RATE_LIMITED", retryAfter });
      return;
    }
    if (!access.checkPassword(request.body?.password)) {
      access.recordFailure(key);
      response.status(401).json({ error: "Incorrect password.", code: "INSTANCE_BAD_PASSWORD" });
      return;
    }
    access.clearFailures(key);
    // "Remember" keeps the unlock across browser restarts; otherwise it lasts until
    // the browser is closed (reopening a tab still works). The token itself always expires.
    const remember = request.body?.remember !== false;
    response.cookie(COOKIE_NAME, access.issueToken(), cookieOptions(remember ? access.rememberMs : undefined));
    response.json({ private: true, unlocked: true });
  });
}

export function instanceGateMiddleware(access = instanceAccess): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!access.enabled || !request.path.startsWith("/api/") || PUBLIC_API_PATHS.has(request.path)) {
      next();
      return;
    }
    if (access.isUnlocked(request)) {
      next();
      return;
    }
    response.status(401).json({ error: "This OpenNOW instance is private. Enter the instance password.", code: "INSTANCE_LOCKED" });
  };
}
