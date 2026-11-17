import { describe, expect, it } from "vitest";

import { InstanceAccess, readInstanceAccessConfig } from "./instanceAccess";

const secret = "x".repeat(32);

function makeAccess(password: string | null = "hunter2", rememberDays = 30): InstanceAccess {
  return new InstanceAccess({ password, rememberDays, secret });
}

describe("readInstanceAccessConfig", () => {
  it("is public when no password is set", () => {
    expect(readInstanceAccessConfig({}).password).toBeNull();
    expect(readInstanceAccessConfig({ OPENNOW_INSTANCE_PASSWORD: "" }).password).toBeNull();
  });

  it("reads password and remember days, with a default", () => {
    const config = readInstanceAccessConfig({ OPENNOW_INSTANCE_PASSWORD: "pw", OPENNOW_INSTANCE_REMEMBER_DAYS: "7" });
    expect(config.password).toBe("pw");
    expect(config.rememberDays).toBe(7);
    expect(readInstanceAccessConfig({ OPENNOW_INSTANCE_REMEMBER_DAYS: "nope" }).rememberDays).toBe(30);
  });
});

describe("InstanceAccess", () => {
  it("treats every request as unlocked when disabled", () => {
    const access = makeAccess(null);
    expect(access.enabled).toBe(false);
    expect(access.isUnlocked({ headers: {} })).toBe(true);
    expect(access.checkPassword("anything")).toBe(false);
  });

  it("checks the password", () => {
    const access = makeAccess();
    expect(access.checkPassword("hunter2")).toBe(true);
    expect(access.checkPassword("hunter3")).toBe(false);
    expect(access.checkPassword(undefined)).toBe(false);
    expect(access.checkPassword(42)).toBe(false);
  });

  it("issues tokens that verify until they expire", () => {
    const access = makeAccess("hunter2", 1);
    const now = 1_000_000;
    const token = access.issueToken(now);
    expect(access.verifyToken(token, now)).toBe(true);
    expect(access.verifyToken(token, now + access.rememberMs - 1)).toBe(true);
    expect(access.verifyToken(token, now + access.rememberMs)).toBe(false);
  });

  it("unlocks requests carrying a valid cookie", () => {
    const access = makeAccess();
    const token = access.issueToken();
    expect(access.isUnlocked({ headers: { cookie: `other=1; opennow_instance=${token}` } })).toBe(true);
    expect(access.isUnlocked({ headers: {} })).toBe(false);
  });

  it("rejects tampered tokens and tokens signed with another password", () => {
    const access = makeAccess();
    const token = access.issueToken();
    const [version, expiresAt, signature] = token.split(".");
    expect(access.verifyToken(`${version}.${Number(expiresAt) + 1000}.${signature}`)).toBe(false);
    expect(access.verifyToken(`${version}.${expiresAt}.${signature}x`)).toBe(false);
    expect(access.verifyToken("garbage")).toBe(false);
    expect(makeAccess("different").verifyToken(token)).toBe(false);
  });

  it("keeps tokens valid across instances with the same password", () => {
    expect(makeAccess().verifyToken(makeAccess().issueToken())).toBe(true);
  });

  it("rate limits repeated failures", () => {
    const access = makeAccess();
    const now = 5_000;
    for (let i = 0; i < 9; i += 1) access.recordFailure("ip", now);
    expect(access.retryAfterSeconds("ip", now)).toBe(0);
    access.recordFailure("ip", now);
    expect(access.retryAfterSeconds("ip", now)).toBeGreaterThan(0);
    expect(access.retryAfterSeconds("other-ip", now)).toBe(0);
    expect(access.retryAfterSeconds("ip", now + 15 * 60 * 1000)).toBe(0);
    access.clearFailures("ip");
    expect(access.retryAfterSeconds("ip", now)).toBe(0);
  });
});
