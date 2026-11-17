import { describe, expect, it } from "vitest";

import { queueAdsBlocked } from "./cloudmatchSessionParsing";

describe("queueAdsBlocked", () => {
  it("is off unless explicitly enabled", () => {
    expect(queueAdsBlocked({})).toBe(false);
    expect(queueAdsBlocked({ OPENNOW_BLOCK_QUEUE_ADS: "false" })).toBe(false);
    expect(queueAdsBlocked({ OPENNOW_BLOCK_QUEUE_ADS: "true" })).toBe(true);
    expect(queueAdsBlocked({ OPENNOW_BLOCK_QUEUE_ADS: " 1 " })).toBe(true);
  });
});
