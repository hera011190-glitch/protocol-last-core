import { buildApiUrl } from "./api";

const PRELOADED_IMAGES = new Set();
const FAILED_IMAGES = new Set();
const MAX_PRELOAD_AT_ONCE = 6;

function normalizeUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  if (url.startsWith("data:image/")) return url;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")) return buildApiUrl(url);
  return url;
}

function pushImageUrl(list, value) {
  const url = normalizeUrl(value);
  if (!url) return;
  list.push(url);
}

function collectFromValue(value, list, depth = 0) {
  if (depth > 5 || value == null) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return;
    if (
      text.startsWith("data:image/") ||
      /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(text) ||
      text.includes("/uploads/") ||
      text.includes("/design-assets/") ||
      text.includes("image")
    ) {
      pushImageUrl(list, text);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectFromValue(item, list, depth + 1));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => {
      const lowerKey = String(key || "").toLowerCase();
      if (typeof child === "string" && (lowerKey.includes("image") || lowerKey.includes("img") || lowerKey.includes("src") || lowerKey.includes("portrait"))) {
        pushImageUrl(list, child);
        return;
      }
      collectFromValue(child, list, depth + 1);
    });
  }
}

export function collectImageUrls(...sources) {
  const list = [];
  sources.forEach((source) => collectFromValue(source, list, 0));
  return [...new Set(list)].filter(Boolean);
}

export function preloadImages(urls = [], { highPriority = false, limit = MAX_PRELOAD_AT_ONCE } = {}) {
  if (typeof window === "undefined") return;
  const unique = [...new Set((Array.isArray(urls) ? urls : []).map(normalizeUrl).filter(Boolean))]
    .filter((url) => !PRELOADED_IMAGES.has(url) && !FAILED_IMAGES.has(url))
    .slice(0, limit);

  unique.forEach((url) => {
    PRELOADED_IMAGES.add(url);
    const img = new Image();
    img.decoding = "async";
    img.loading = highPriority ? "eager" : "lazy";
    if (highPriority) img.fetchPriority = "high";
    img.onload = () => PRELOADED_IMAGES.add(url);
    img.onerror = () => {
      PRELOADED_IMAGES.delete(url);
      FAILED_IMAGES.add(url);
      window.setTimeout(() => FAILED_IMAGES.delete(url), 10000);
    };
    if (typeof window.requestIdleCallback === "function" && !highPriority) {
      window.requestIdleCallback(() => { img.src = url; }, { timeout: 1800 });
    } else {
      window.setTimeout(() => { img.src = url; }, highPriority ? 0 : 120);
    }
  });
}

export function warmImageCache(sources = [], options = {}) {
  const urls = collectImageUrls(...(Array.isArray(sources) ? sources : [sources]));
  preloadImages(urls, options);
}

export function scheduleImageWarmup(callback) {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    try { callback(); } catch {}
  };
  let id = null;
  if (typeof window.requestIdleCallback === "function") {
    id = window.requestIdleCallback(run, { timeout: 1400 });
    return () => {
      cancelled = true;
      try { window.cancelIdleCallback(id); } catch {}
    };
  }
  id = window.setTimeout(run, 250);
  return () => {
    cancelled = true;
    window.clearTimeout(id);
  };
}
