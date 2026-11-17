import { readFileSync } from "node:fs";
import { connect, createServer as createNetServer } from "node:net";
import { createServer as createTlsServer, type Server as TlsServer } from "node:tls";

import { DEFAULT_RELAY_LIMITS, type RelayIceConfig, type RelayLimits, type RelayStatus } from "@shared/relay";

/**
 * Proxy mode: media goes browser -> TURN relay on this server -> NVIDIA, for visitors
 * whose network blocks direct WebRTC. The relay (dlpcc's TURN server) listens on its own
 * TCP port so nothing has to change in a reverse proxy that owns 443.
 */

export type RelayMode = "off" | "optional" | "always";

export interface RelayConfig {
  mode: RelayMode;
  /** Hostname browsers use to reach TURN. Behind Cloudflare this must be a DNS-only record. */
  host: string;
  /** TCP port the relay listens on (TURN, or TURN over TLS when a certificate is set). */
  port: number;
  /** Port browsers are told to use, when a firewall redirect or nginx forwards e.g. 443 to `port`. */
  publicPort: number;
  tlsCert: string | null;
  tlsKey: string | null;
  relayIp: string | undefined;
  udpPorts: string;
  limits: RelayLimits;
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readRelayConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const rawMode = env.OPENNOW_RELAY?.trim().toLowerCase() ?? "";
  const mode: RelayMode = rawMode === "always" || rawMode === "forced"
    ? "always"
    : /^(optional|on|true|1|yes)$/.test(rawMode) ? "optional" : "off";
  const resolution = /^(\d{3,5})x(\d{3,5})$/.exec(env.OPENNOW_RELAY_MAX_RESOLUTION?.trim() ?? "");
  return {
    mode,
    host: env.OPENNOW_RELAY_HOST?.trim() ?? "",
    port: Math.trunc(positive(env.OPENNOW_RELAY_PORT, 3478)),
    publicPort: Math.trunc(positive(env.OPENNOW_RELAY_PUBLIC_PORT, positive(env.OPENNOW_RELAY_PORT, 3478))),
    tlsCert: env.OPENNOW_RELAY_TLS_CERT?.trim() || null,
    tlsKey: env.OPENNOW_RELAY_TLS_KEY?.trim() || null,
    relayIp: env.OPENNOW_RELAY_IP?.trim() || undefined,
    udpPorts: env.OPENNOW_RELAY_UDP_PORTS?.trim() || "49152-65535",
    limits: {
      maxWidth: resolution ? Number(resolution[1]) : DEFAULT_RELAY_LIMITS.maxWidth,
      maxHeight: resolution ? Number(resolution[2]) : DEFAULT_RELAY_LIMITS.maxHeight,
      maxFps: Math.trunc(positive(env.OPENNOW_RELAY_MAX_FPS, DEFAULT_RELAY_LIMITS.maxFps)),
      maxBitrateMbps: positive(env.OPENNOW_RELAY_MAX_BITRATE_MBPS, DEFAULT_RELAY_LIMITS.maxBitrateMbps),
    },
  };
}

type DlpccRelay = import("dlpcc").Relay;

const RELAYED_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

class StreamRelay {
  readonly config = readRelayConfig();
  private relay: DlpccRelay | null = null;
  private tlsServer: TlsServer | null = null;
  private readonly relayedSessions = new Map<string, number>();

  get available(): boolean {
    return this.relay !== null;
  }

  get forced(): boolean {
    return this.available && this.config.mode === "always";
  }

  status(): RelayStatus {
    return { available: this.available, forced: this.forced, limits: this.config.limits };
  }

  /** Whether a create/claim request should run through the relay. */
  wants(requested: unknown): boolean {
    return this.available && (this.forced || requested === true);
  }

  markRelayed(sessionId: string): void {
    const now = Date.now();
    for (const [id, expiresAt] of this.relayedSessions) if (expiresAt < now) this.relayedSessions.delete(id);
    this.relayedSessions.set(sessionId, now + RELAYED_SESSION_TTL_MS);
  }

  isRelayed(sessionId: string | undefined): boolean {
    return Boolean(sessionId && (this.relayedSessions.get(sessionId) ?? 0) > Date.now());
  }

  forget(sessionId: string): void {
    this.relayedSessions.delete(sessionId);
  }

  iceConfig(): RelayIceConfig | null {
    const config = this.relay?.iceConfig(this.config.host);
    if (!config) return null;
    return { iceServers: config.iceServers, iceTransportPolicy: "relay", expires: config.expires ?? null };
  }

  async start(): Promise<void> {
    const { config } = this;
    if (config.mode === "off") return;
    if (!config.host) {
      console.warn("[Relay] OPENNOW_RELAY is set but OPENNOW_RELAY_HOST is empty; proxy mode stays off.");
      return;
    }
    if (Boolean(config.tlsCert) !== Boolean(config.tlsKey)) {
      console.warn("[Relay] Set both OPENNOW_RELAY_TLS_CERT and OPENNOW_RELAY_TLS_KEY, or neither; proxy mode stays off.");
      return;
    }
    const useTls = Boolean(config.tlsCert && config.tlsKey);
    // With TLS, Node terminates it on the public port and hands plain TURN to the relay on loopback.
    const turnListen = useTls ? `127.0.0.1:${await freeLoopbackPort()}` : `0.0.0.0:${config.port}`;

    let createRelay: typeof import("dlpcc").createRelay;
    try {
      ({ createRelay } = await import("dlpcc"));
    } catch (error) {
      console.error("[Relay] Could not load the dlpcc relay package; proxy mode stays off.", error);
      return;
    }
    const relay = createRelay({
      enabled: true,
      turnListen,
      publicPort: config.publicPort,
      tls: useTls,
      relayIp: config.relayIp,
      relayPorts: config.udpPorts,
    });
    try {
      await relay.start();
    } catch (error) {
      console.error("[Relay] TURN relay failed to start; proxy mode stays off.", error);
      return;
    }

    if (useTls) {
      try {
        this.tlsServer = await this.listenTls(turnListen, config);
      } catch (error) {
        console.error("[Relay] Could not open the TURN TLS port; proxy mode stays off.", error);
        await relay.stop();
        return;
      }
    }

    this.relay = relay;
    const limits = config.limits;
    console.log(
      `[Relay] Proxy mode ${config.mode === "always" ? "forced for every stream" : "available"}: ` +
        `${useTls ? "turns" : "turn"}:${config.host}:${config.publicPort} (TCP` +
        `${config.publicPort !== config.port ? `, listening on ${config.port}` : ""}), media UDP ${config.udpPorts}, ` +
        `limits ${limits.maxWidth}x${limits.maxHeight}@${limits.maxFps} ${limits.maxBitrateMbps} Mbps`,
    );
    const stop = () => void this.stop();
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  }

  async stop(): Promise<void> {
    this.tlsServer?.close();
    this.tlsServer = null;
    await this.relay?.stop();
    this.relay = null;
  }

  private listenTls(turnListen: string, config: RelayConfig): Promise<TlsServer> {
    const [host, port] = [turnListen.slice(0, turnListen.lastIndexOf(":")), Number(turnListen.slice(turnListen.lastIndexOf(":") + 1))];
    const server = createTlsServer(
      { cert: readFileSync(config.tlsCert as string), key: readFileSync(config.tlsKey as string) },
      (socket) => {
        const upstream = connect(port, host);
        const close = () => {
          socket.destroy();
          upstream.destroy();
        };
        socket.setNoDelay(true);
        upstream.setNoDelay(true);
        socket.on("error", close).on("close", close);
        upstream.on("error", close).on("close", close);
        socket.pipe(upstream).pipe(socket);
      },
    );
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, () => {
        server.off("error", reject);
        resolve(server);
      });
    });
  }
}

export const streamRelay = new StreamRelay();
