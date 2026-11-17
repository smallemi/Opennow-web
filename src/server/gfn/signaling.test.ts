import { describe, expect, it } from "vitest";

import { buildPeerInfo, buildSignInUrl } from "./signaling";
import { resolveSignaling, webRtcSignalingUrl } from "./cloudmatchSignaling";
import type { CloudMatchResponse } from "./types";

describe("buildSignInUrl", () => {
  it("uses the v3 signaling contract", () => {
    expect(buildSignInUrl({
      signalingServer: "1.2.3.4:443",
      signalingUrl: "wss://1.2.3.4/nvst/",
      sessionId: "session-1",
      peerName: "peer-abc",
    })).toBe("wss://1.2.3.4/nvst/sign_in?peer_id=peer-abc&version=3.0&peer_role=1&pairing_id=session-1");
  });

  it("adds reconnect=1 and keeps an explicit port", () => {
    expect(buildSignInUrl({
      signalingServer: "ignored",
      signalingUrl: "wss://host.example:8443/nvst/sign_in?old=1",
      sessionId: "s",
      peerName: "peer-1",
      reconnect: true,
    })).toBe("wss://host.example:8443/nvst/sign_in?peer_id=peer-1&version=3.0&peer_role=1&pairing_id=s&reconnect=1");
  });

  it("falls back to the signaling server", () => {
    expect(buildSignInUrl({ signalingServer: "5.6.7.8", sessionId: "s", peerName: "p" }))
      .toBe("wss://5.6.7.8:443/nvst/sign_in?peer_id=p&version=3.0&peer_role=1&pairing_id=s");
  });
});

describe("buildPeerInfo", () => {
  it("sends v3 peer_info", () => {
    expect(buildPeerInfo(2, "peer-x", { width: 2560, height: 1440 })).toEqual({
      browser: "Chrome",
      browserVersion: "131.0.0.0",
      connected: true,
      id: 2,
      name: "peer-x",
      peer_role: 1,
      resolution: "2560x1440",
      version: 3,
      signalingVersion: "3.0",
    });
  });
});

function response(connectionInfo: NonNullable<CloudMatchResponse["session"]["connectionInfo"]>): CloudMatchResponse {
  return {
    session: { sessionId: "s", status: 2, connectionInfo },
    requestStatus: { statusCode: 1 },
  } as unknown as CloudMatchResponse;
}

describe("webRtcSignalingUrl", () => {
  it("keeps relative paths on port 443", () => {
    expect(webRtcSignalingUrl({ usage: 14, ip: "9.9.9.9", port: 49003, resourcePath: "/nvst/" })?.toString())
      .toBe("wss://9.9.9.9/nvst/");
  });

  it("maps rtsps descriptors to wss /nvst/", () => {
    expect(webRtcSignalingUrl({ usage: 14, port: 48322, resourcePath: "rtsps://80-1-2-3.host.net:48322" })?.toString())
      .toBe("wss://80-1-2-3.host.net/nvst/");
  });
});

describe("resolveSignaling", () => {
  it("prefers a WebRTC endpoint over an RTSP descriptor", () => {
    const resolved = resolveSignaling(response([
      { usage: 14, ip: "10.0.0.1", port: 48322, appLevelProtocol: 1, resourcePath: "rtsps://rtsp.host.net:48322" },
      { usage: 14, ip: "1.2.3.4", port: 443, resourcePath: "wss://sig.host.net/nvst/" },
      { usage: 2, ip: "1.2.3.4", port: 49005 },
    ]));
    expect(resolved.signalingUrl).toBe("wss://sig.host.net/nvst/");
    expect(resolved.signalingServer).toBe("sig.host.net:443");
    expect(resolved.serverIp).toBe("1.2.3.4");
    expect(resolved.mediaConnectionInfo).toEqual({ ip: "1.2.3.4", port: 49005, usage: 2 });
  });
});
