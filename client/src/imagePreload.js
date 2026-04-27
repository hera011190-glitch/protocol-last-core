import { buildApiUrl } from "./api";

const PRELOADED_IMAGES = new Set();
const FAILED_IMAGES = new Set();
const IN_FLIGHT_IMAGES = new Map();
const MANIFEST_CACHE_KEY = "plc-image-manifest-v2";
const DEFAULT_LIMIT = 220;

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
      text.includes("/asset/") ||
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
      if (typeof child === "string" && (lowerKey.includes("image") || lowerKey.includes("img") || lowerKey.includes("src") || lowerKey.includes("portrait") || lowerKey.includes("background"))) {
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

function loadOneImage(url, { highPriority = false } = {}) {
  const src = normalizeUrl(url);
  if (!src || PRELOADED_IMAGES.has(src)) return Promise.resolve(src);
  if (IN_FLIGHT_IMAGES.has(src)) return IN_FLIGHT_IMAGES.get(src);

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.decoding = highPriority ? "sync" : "async";
    img.loading = "eager";
    try { img.fetchPriority = highPriority ? "high" : "auto"; } catch {}
    img.onload = () => {
      PRELOADED_IMAGES.add(src);
      FAILED_IMAGES.delete(src);
      IN_FLIGHT_IMAGES.delete(src);
      resolve(src);
    };
    img.onerror = () => {
      FAILED_IMAGES.add(src);
      IN_FLIGHT_IMAGES.delete(src);
      resolve(src);
    };
    img.src = src;
  });

  IN_FLIGHT_IMAGES.set(src, promise);
  return promise;
}

export function preloadImages(urls = [], { highPriority = false, limit = DEFAULT_LIMIT } = {}) {
  if (typeof window === "undefined") return Promise.resolve([]);
  const unique = [...new Set((Array.isArray(urls) ? urls : []).map(normalizeUrl).filter(Boolean))]
    .filter((url) => !PRELOADED_IMAGES.has(url))
    .slice(0, limit);

  unique.forEach((url) => {
    try {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = url;
      if (highPriority) link.fetchPriority = "high";
      document.head.appendChild(link);
      setTimeout(() => {
        try { link.remove(); } catch {}
      }, 45000);
    } catch {}
  });

  return Promise.all(unique.map((url) => loadOneImage(url, { highPriority })));
}

export function warmImageCache(sources = [], options = {}) {
  const urls = collectImageUrls(...(Array.isArray(sources) ? sources : [sources]));
  return preloadImages(urls, options);
}

export async function preloadImageManifest({ highPriority = true, limit = DEFAULT_LIMIT } = {}) {
  if (typeof window === "undefined") return [];
  let cached = [];
  try {
    const raw = sessionStorage.getItem(MANIFEST_CACHE_KEY) || localStorage.getItem(MANIFEST_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    cached = Array.isArray(parsed?.urls) ? parsed.urls : [];
  } catch {}
  if (cached.length > 0) preloadImages(cached, { highPriority, limit });

  try {
    const res = await fetch(buildApiUrl("/image-manifest"), { cache: "force-cache" });
    if (!res.ok) return cached;
    const data = await res.json();
    const urls = Array.isArray(data?.urls) ? data.urls : [];
    try {
      const payload = JSON.stringify({ urls, savedAt: Date.now() });
      sessionStorage.setItem(MANIFEST_CACHE_KEY, payload);
      localStorage.setItem(MANIFEST_CACHE_KEY, payload);
    } catch {}
    await preloadImages(urls, { highPriority, limit });
    return urls;
  } catch {
    return cached;
  }
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
    id = window.requestIdleCallback(run, { timeout: 900 });
    return () => {
      cancelled = true;
      try { window.cancelIdleCallback(id); } catch {}
    };
  }
  id = window.setTimeout(run, 120);
  return () => {
    cancelled = true;
    window.clearTimeout(id);
  };
}
