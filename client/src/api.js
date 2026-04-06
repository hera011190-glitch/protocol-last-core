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
  const res = await fetch(buildApiUrl(path), options);
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
