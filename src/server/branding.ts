/**
 * Optional site branding from the environment:
 * - OPENNOW_SITE_TITLE: text shown in the browser tab.
 * - OPENNOW_FAVICON_URL: an absolute http(s) URL or a site path such as /my-icon.png.
 */

export interface SiteBranding {
  title: string | null;
  faviconUrl: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeFaviconUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    // fall through
  }
  console.warn(`[Branding] Ignoring OPENNOW_FAVICON_URL "${trimmed}": use an http(s) URL or a path starting with /.`);
  return null;
}

export function readSiteBranding(env: NodeJS.ProcessEnv = process.env): SiteBranding {
  const title = env.OPENNOW_SITE_TITLE?.trim();
  return {
    title: title ? title.slice(0, 200) : null,
    faviconUrl: normalizeFaviconUrl(env.OPENNOW_FAVICON_URL),
  };
}

export function applySiteBranding(html: string, branding: SiteBranding): string {
  let result = html;
  if (branding.title) {
    result = result.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(branding.title)}</title>`);
  }
  if (branding.faviconUrl) {
    result = result.replace(/<link\s+rel="icon"[^>]*>/i, `<link rel="icon" href="${escapeHtml(branding.faviconUrl)}" />`);
  }
  return result;
}

export const siteBranding = readSiteBranding();
