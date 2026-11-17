import { describe, expect, it } from "vitest";

import { applySiteBranding, readSiteBranding } from "./branding";

const html = `<head>
    <link rel="icon" href="/opennow-logo-mark.png" />
    <title>OpenNOW</title>
  </head>`;

describe("site branding", () => {
  it("leaves the page unchanged when nothing is configured", () => {
    expect(applySiteBranding(html, readSiteBranding({}))).toBe(html);
  });

  it("replaces the title and favicon", () => {
    const branded = applySiteBranding(html, readSiteBranding({
      OPENNOW_SITE_TITLE: "Emi's Cloud",
      OPENNOW_FAVICON_URL: "https://example.com/icon.png",
    }));
    expect(branded).toContain("<title>Emi&#39;s Cloud</title>");
    expect(branded).toContain('<link rel="icon" href="https://example.com/icon.png" />');
    expect(branded).not.toContain("opennow-logo-mark");
  });

  it("accepts site paths and escapes HTML", () => {
    const branding = readSiteBranding({ OPENNOW_SITE_TITLE: "<b>x</b>", OPENNOW_FAVICON_URL: "/custom.ico" });
    const branded = applySiteBranding(html, branding);
    expect(branded).toContain("<title>&lt;b&gt;x&lt;/b&gt;</title>");
    expect(branded).toContain('href="/custom.ico"');
  });

  it("rejects unsafe favicon URLs", () => {
    expect(readSiteBranding({ OPENNOW_FAVICON_URL: "javascript:alert(1)" }).faviconUrl).toBeNull();
    expect(readSiteBranding({ OPENNOW_FAVICON_URL: "//evil.example/icon.png" }).faviconUrl).toBeNull();
    expect(readSiteBranding({ OPENNOW_FAVICON_URL: "   " }).faviconUrl).toBeNull();
  });
});
