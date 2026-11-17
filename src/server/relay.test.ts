import { describe, expect, it } from "vitest";

import { clampNvstSdpToRelayLimits, clampToRelayLimits, DEFAULT_RELAY_LIMITS } from "@shared/relay";
import { readRelayConfig } from "./relay";

describe("readRelayConfig", () => {
  it("is off by default with 720p60 10 Mbps limits", () => {
    const config = readRelayConfig({});
    expect(config.mode).toBe("off");
    expect(config.port).toBe(3478);
    expect(config.limits).toEqual(DEFAULT_RELAY_LIMITS);
  });

  it("reads mode and limits from env", () => {
    const config = readRelayConfig({
      OPENNOW_RELAY: "always",
      OPENNOW_RELAY_HOST: "turn.example.com",
      OPENNOW_RELAY_PORT: "5349",
      OPENNOW_RELAY_MAX_RESOLUTION: "1920x1080",
      OPENNOW_RELAY_MAX_FPS: "30",
      OPENNOW_RELAY_MAX_BITRATE_MBPS: "20",
    });
    expect(config.mode).toBe("always");
    expect(config.port).toBe(5349);
    expect(config.limits).toEqual({ maxWidth: 1920, maxHeight: 1080, maxFps: 30, maxBitrateMbps: 20 });
    expect(readRelayConfig({ OPENNOW_RELAY: "true" }).mode).toBe("optional");
    expect(config.publicPort).toBe(5349);
    expect(readRelayConfig({ OPENNOW_RELAY_PORT: "3478", OPENNOW_RELAY_PUBLIC_PORT: "443" }).publicPort).toBe(443);
  });
});

describe("relay limits", () => {
  it("caps stream settings but keeps lower values", () => {
    expect(clampToRelayLimits({ resolution: "2560x1440", fps: 120, maxBitrateMbps: 75 }, DEFAULT_RELAY_LIMITS))
      .toEqual({ resolution: "1280x720", fps: 60, maxBitrateMbps: 10 });
    expect(clampToRelayLimits({ resolution: "1024x576", fps: 30, maxBitrateMbps: 5 }, DEFAULT_RELAY_LIMITS))
      .toEqual({ resolution: "1024x576", fps: 30, maxBitrateMbps: 5 });
  });

  it("caps bitrate and fps in the nvstSdp", () => {
    const sdp = "a=video.maxFPS:120\r\na=vqos.bw.maximumBitrateKbps:75000\r\na=video.initialBitrateKbps:2000\r\na=video.clientViewportWd:2560";
    expect(clampNvstSdpToRelayLimits(sdp, DEFAULT_RELAY_LIMITS)).toBe(
      "a=video.maxFPS:60\r\na=vqos.bw.maximumBitrateKbps:10000\r\na=video.initialBitrateKbps:2000\r\na=video.clientViewportWd:2560",
    );
  });
});
