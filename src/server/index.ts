import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";

import { registerApi } from "./api";
import { applySiteBranding, siteBranding } from "./branding";
import { SessionError } from "./gfn/errorCodes";
import { queueAdsBlocked } from "./gfn/cloudmatchSessionParsing";
import { toSerializedSessionError } from "@shared/sessionError";
import { instanceAccess, instanceGateMiddleware, registerInstanceAccessRoutes } from "./instanceAccess";
import { attachSignalingBridge } from "./signalingBridge";
import { cacheManager } from "./services/cacheManager";
import { cookieSessionMiddleware } from "./sessionStore";

const app = express();
const server = createServer(app);
const port = Number(process.env.PORT ?? 3000);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use("/api", cookieSessionMiddleware);
app.use((request, response, next) => {
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "microphone=(self), fullscreen=(self), camera=()");
  if (process.env.NODE_ENV === "production") {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https: ws: wss:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
  }
  if (request.path.startsWith("/api/")) response.setHeader("Cache-Control", "no-store");
  next();
});
app.use((request, _response, next) => {
  if (request.method !== "GET" && request.path.startsWith("/api/") && request.header("x-opennow-client") !== "web") {
    next(Object.assign(new Error("Invalid same-origin request."), { statusCode: 403 }));
    return;
  }
  next();
});

registerInstanceAccessRoutes(app);
app.use(instanceGateMiddleware());
if (siteBranding.title || siteBranding.faviconUrl) {
  console.log(`[Branding] title=${siteBranding.title ?? "(default)"} favicon=${siteBranding.faviconUrl ?? "(default)"}`);
}
if (queueAdsBlocked()) console.log("[QueueAds] OPENNOW_BLOCK_QUEUE_ADS is on: queue ads are stripped from session responses.");
if (instanceAccess.enabled) console.log("[Instance] Private mode enabled: a password is required to use this instance.");

registerApi(app);
attachSignalingBridge(server);

if (process.env.NODE_ENV === "production") {
  const staticDir = resolve("dist");
  const indexHtml = applySiteBranding(readFileSync(resolve(staticDir, "index.html"), "utf8"), siteBranding);
  const sendIndex = (_request: express.Request, response: express.Response) => {
    response.setHeader("Cache-Control", "no-cache");
    response.type("html").send(indexHtml);
  };
  app.get("/index.html", sendIndex);
  app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
  app.get("/{*path}", sendIndex);
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
    plugins: [{ name: "opennow-site-branding", transformIndexHtml: (html) => applySiteBranding(html, siteBranding) }],
  });
  app.use(vite.middlewares);
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599;
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  // CloudMatch errors carry NVIDIA's own statusCode (e.g. 69 = queue abandoned), which
  // is not an HTTP status. Pass their details to the client so it can show the real reason.
  if (error instanceof SessionError) {
    const status = isHttpStatus(error.httpStatus) ? error.httpStatus : 502;
    console.warn(`[Server] CloudMatch error ${error.errorType} (statusCode=${error.statusCode}, code=${error.gfnErrorCode}): ${error.message}`);
    response.status(status).json({ error: error.message, sessionError: toSerializedSessionError({
      httpStatus: error.httpStatus,
      statusCode: error.statusCode,
      statusDescription: error.statusDescription,
      unifiedErrorCode: error.unifiedErrorCode,
      sessionErrorCode: error.sessionErrorCode,
      gfnErrorCode: error.gfnErrorCode,
      title: error.title,
      description: error.message,
    }) });
    return;
  }
  const candidate = typeof error === "object" && error && "statusCode" in error ? error.statusCode : undefined;
  const status = isHttpStatus(candidate) ? candidate : 500;
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  if (status >= 500) console.error("[Server]", error);
  response.status(status).json({ error: message });
});

await cacheManager.initialize();
server.listen(port, () => {
  console.log(`OpenNOW Web is running at http://localhost:${port}`);
});
