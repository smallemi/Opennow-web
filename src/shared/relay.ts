/** Proxy (relay) mode: stream media through the instance's TURN relay. */

export interface RelayLimits {
  maxWidth: number;
  maxHeight: number;
  maxFps: number;
  maxBitrateMbps: number;
}

export interface RelayStatus {
  /** A TURN relay is configured on this instance. */
  available: boolean;
  /** Every stream is relayed; visitors can't turn it off. */
  forced: boolean;
  limits: RelayLimits;
}

export interface RelayIceConfig {
  iceServers: Array<{ urls: string[]; username?: string; credential?: string }>;
  iceTransportPolicy: "relay";
  expires: number | null;
}

export const DEFAULT_RELAY_LIMITS: RelayLimits = {
  maxWidth: 1280,
  maxHeight: 720,
  maxFps: 60,
  maxBitrateMbps: 10,
};

function parseResolution(value: string): { width: number; height: number } | null {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(value.trim());
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

/** Cap resolution, fps and bitrate to the relay limits; values already below them are kept. */
export function clampToRelayLimits<T extends { resolution: string; fps: number; maxBitrateMbps: number }>(
  settings: T,
  limits: RelayLimits,
): T {
  const parsed = parseResolution(settings.resolution);
  const resolution = !parsed || parsed.width > limits.maxWidth || parsed.height > limits.maxHeight
    ? `${limits.maxWidth}x${limits.maxHeight}`
    : settings.resolution;
  const fps = Number.isFinite(settings.fps) && settings.fps > 0 ? Math.min(settings.fps, limits.maxFps) : limits.maxFps;
  const maxBitrateMbps = Number.isFinite(settings.maxBitrateMbps) && settings.maxBitrateMbps > 0
    ? Math.min(settings.maxBitrateMbps, limits.maxBitrateMbps)
    : limits.maxBitrateMbps;
  return { ...settings, resolution, fps, maxBitrateMbps };
}

const NVST_BITRATE_KEYS = [
  "video.initialBitrateKbps",
  "video.initialPeakBitrateKbps",
  "vqos.bw.maximumBitrateKbps",
  "vqos.bw.peakBitrateKbps",
  "vqos.bw.serverPeakBitrateKbps",
  "vqos.grc.maximumBitrateKbps",
];

/** Caps the bitrate and fps NVIDIA is asked for in the nvstSdp of a relayed stream. */
export function clampNvstSdpToRelayLimits(nvstSdp: string, limits: RelayLimits): string {
  const maxKbps = Math.floor(limits.maxBitrateMbps * 1000);
  return nvstSdp.replace(/^a=([\w.]+):(\d+)(\r?)$/gm, (line, key: string, value: string, cr: string) => {
    if (NVST_BITRATE_KEYS.includes(key)) return `a=${key}:${Math.min(Number(value), maxKbps)}${cr}`;
    if (key === "video.maxFPS") return `a=${key}:${Math.min(Number(value), limits.maxFps)}${cr}`;
    return line;
  });
}
