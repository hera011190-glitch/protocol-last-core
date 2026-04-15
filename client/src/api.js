const browserOrigin = typeof window !== "undefined" ? window.location.origin : "";

const ENV_API_BASE =
  process.env.REACT_APP_API_BASE_URL ||
  process.env.REACT_APP_API_URL ||
  "";

export const API_BASE =
  ENV_API_BASE ||
  (browserOrigin && !browserOrigin.includes("localhost:3000") ? browserOrigin : "") ||
  "http://localhost:3001";

export function buildApiUrl(path) {
  if (!path) return API_BASE;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path.replace("http://localhost:3001", API_BASE);
  }
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function apiFetch(path, options = {}) {
  const isGetLike = !options?.method || String(options.method || "GET").toUpperCase() === "GET"
  const nextOptions = {
    ...(options || {}),
    cache: options?.cache || (isGetLike ? "no-store" : "no-cache"),
    headers: {
      ...(options?.headers || {}),
      ...(isGetLike ? { "Cache-Control": "no-cache" } : {}),
    },
  };
  const res = await fetch(buildApiUrl(path), nextOptions);
  return res;
}

if (typeof window !== "undefined" && typeof window.fetch === "function" && !window.__PLC_FETCH_PATCHED__) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string") {
      return originalFetch(buildApiUrl(input), init);
    }
    if (input instanceof Request) {
      const nextUrl = buildApiUrl(input.url);
      if (nextUrl !== input.url) {
        const nextRequest = new Request(nextUrl, input);
        return originalFetch(nextRequest, init);
      }
    }
    return originalFetch(input, init);
  };
  window.__PLC_FETCH_PATCHED__ = true;
}


const __jsonCache = new Map();

export async function apiJson(path, options = {}) {
  const res = await apiFetch(path, options);
  return res.json();
}

export async function apiJsonCached(path, { ttlMs = 10000, force = false, storageKey = "" } = {}) {
  const key = storageKey || String(path || "");
  const now = Date.now();
  const cached = __jsonCache.get(key);
  if (!force && cached && now - cached.at < ttlMs) return cached.value;
  try {
    if (!force && storageKey) {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && now - Number(parsed.at || 0) < ttlMs) {
          __jsonCache.set(key, { at: Number(parsed.at || now), value: parsed.value });
          return parsed.value;
        }
      }
    }
  } catch {}
  const value = await apiJson(path);
  __jsonCache.set(key, { at: now, value });
  if (storageKey) {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ at: now, value })); } catch {}
  }
  return value;
}
