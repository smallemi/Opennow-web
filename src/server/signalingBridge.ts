import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";

import type { IceCandidatePayload, KeyframeRequest, SendAnswerRequest, SignalingConnectRequest } from "@shared/gfn";
import { GfnSignalingClient } from "./gfn/signaling";
import { instanceAccess } from "./instanceAccess";
import { getExistingSession } from "./sessionStore";

type ClientMessage =
  | { type: "connect"; payload: SignalingConnectRequest }
  | { type: "answer"; payload: SendAnswerRequest }
  | { type: "ice"; payload: IceCandidatePayload }
  | { type: "keyframe"; payload: KeyframeRequest }
  | { type: "disconnect" }
  | { type: "pong" };

const BRIDGE_KEEPALIVE_MS = 25_000;

function parseResolution(value: unknown): { width: number; height: number } | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{3,5})x(\d{3,5})$/.exec(value.trim());
  if (!match) return undefined;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return process.env.NODE_ENV !== "production";
  if (process.env.OPENNOW_ORIGIN) return origin === process.env.OPENNOW_ORIGIN;
  const host = request.headers.host;
  return origin === `http://${host}` || origin === `https://${host}`;
}

export function attachSignalingBridge(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

  server.on("upgrade", (request, socket: Duplex, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/api/signaling" || !originAllowed(request) || !instanceAccess.isUnlocked(request)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  wss.on("connection", (socket: WebSocket, request) => {
    const browserSession = getExistingSession(request as never);
    if (!browserSession) {
      socket.close(4401, "Authentication required");
      return;
    }

    let signaling: GfnSignalingClient | null = null;
    let unsubscribe: (() => void) | null = null;
    const send = (payload: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };

    socket.on("message", (raw) => {
      void (async () => {
        const message = JSON.parse(raw.toString("utf8")) as ClientMessage;
        if (message.type === "connect") {
          const input = message.payload;
          if (!browserSession.ownsActiveSession(input.sessionId)) {
            throw new Error("Stream ownership check failed.");
          }
          signaling?.disconnect();
          unsubscribe?.();
          signaling = new GfnSignalingClient(input.signalingServer, input.sessionId, input.signalingUrl, {
            reconnect: input.reconnect === true,
            resolution: parseResolution(input.resolution),
          });
          unsubscribe = signaling.onEvent((event) => send({ type: "event", payload: event }));
          await signaling.connect();
        } else if (message.type === "answer") {
          await signaling?.sendAnswer(message.payload);
        } else if (message.type === "ice") {
          await signaling?.sendIceCandidate(message.payload);
        } else if (message.type === "keyframe") {
          await signaling?.requestKeyframe(message.payload);
        } else if (message.type === "disconnect") {
          signaling?.disconnect();
        }
      })().catch((error) => send({ type: "event", payload: { type: "error", message: error instanceof Error ? error.message : String(error) } }));
    });

    // Reverse proxies (Cloudflare closes WebSockets after ~100 s without data) would
    // otherwise drop this mostly idle bridge mid-stream, so keep data flowing.
    const keepalive = setInterval(() => send({ type: "ping", at: Date.now() }), BRIDGE_KEEPALIVE_MS);
    keepalive.unref?.();

    socket.on("close", () => {
      clearInterval(keepalive);
      unsubscribe?.();
      signaling?.disconnect();
    });
  });
}
