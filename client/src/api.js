const browserOrigin = typeof window !== "undefined" ? window.location.origin : "";

const ENV_API_BASE =
  process.env.REACT_APP_API_BASE_URL ||
  process.env.REACT_APP_API_URL ||
  "";

export const API_BASE =
  ENV_API_BASE ||
  (browserOrigin && !browserOrigin.includes("localhost:3000") ? browserOrigin : "") ||
  "http://localhost:3001";

function shouldNormalizeThroughApi(url) {
  return /^https?:\/\/localhost:3001/i.test(url) || /^\//.test(url);
}

function normalizeApiUrl(rawPath) {
  const base = typeof window !== "undefined" ? window.location.origin : API_BASE;
  const url = new URL(rawPath.startsWith('http://') || rawPath.startsWith('https://') ? rawPath : `${API_BASE}${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}` , base);
  if (/localhost:3001/i.test(url.origin)) {
    const targetBase = new URL(API_BASE, base);
    url.protocol = targetBase.protocol;
    url.host = targetBase.host;
  }
  if (url.searchParams.has('t')) url.searchParams.delete('t');
  return url.toString();
}

export function buildApiUrl(path) {
  if (!path) return API_BASE;
  if (typeof path === 'string' && shouldNormalizeThroughApi(path)) {
    return normalizeApiUrl(path);
  }
  return path;
}

function getCachePolicy(url) {
  try {
    const parsed = new URL(url, API_BASE);
    const pathname = parsed.pathname || '';
    if (pathname === '/designConfig') return 120000;
    if (pathname === '/characters-card-summary' || pathname.startsWith('/characters-card-summary/')) return 45000;
    if (pathname === '/characters-sd-summary' || pathname.startsWith('/characters-sd-summary/')) return 30000;
    if (pathname === '/characters-lite' || pathname.startsWith('/characters-lite/')) return 20000;
    if (pathname === '/shopItems' || pathname === '/shopConfig') return 30000;
    if (pathname === '/investigations' || pathname.startsWith('/investigations/')) return 3000;
    if (pathname.startsWith('/character/')) return 6000;
  } catch {}
  return 0;
}

const responseCache = typeof window !== 'undefined'
  ? (window.__PLC_RESPONSE_CACHE__ = window.__PLC_RESPONSE_CACHE__ || new Map())
  : new Map();

function buildCachedResponse(entry) {
  return new Response(entry.body, {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
  });
}

function cacheResponse(url, response) {
  const ttlMs = getCachePolicy(url);
  if (!ttlMs || !response || !response.ok) return;
  response.clone().text().then((body) => {
    responseCache.set(url, {
      body,
      status: response.status,
      statusText: response.statusText,
      headers: Array.from(response.headers.entries()),
      expiresAt: Date.now() + ttlMs,
    });
  }).catch(() => {});
}

export async function apiFetch(path, options = {}) {
  const res = await fetch(buildApiUrl(path), options);
  return res;
}

if (typeof window !== "undefined" && typeof window.fetch === "function" && !window.__PLC_FETCH_PATCHED__) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = undefined) => {
    let request = null;
    let url = '';
    if (typeof input === 'string') {
      url = buildApiUrl(input);
      request = null;
    } else if (input instanceof Request) {
      url = buildApiUrl(input.url);
      request = input;
    }

    const method = String(init?.method || request?.method || 'GET').toUpperCase();
    const normalizedUrl = url || input;
    const ttlMs = typeof normalizedUrl === 'string' ? getCachePolicy(normalizedUrl) : 0;
    if (method === 'GET' && ttlMs && typeof normalizedUrl === 'string') {
      const cached = responseCache.get(normalizedUrl);
      if (cached && cached.expiresAt > Date.now()) {
        return buildCachedResponse(cached);
      }
    }

    let response;
    if (typeof input === 'string') {
      const nextInit = init && typeof init === 'object' ? { ...init } : init;
      if (method === 'GET' && nextInit && nextInit.cache === 'no-store' && ttlMs) delete nextInit.cache;
      response = await originalFetch(normalizedUrl, nextInit);
    } else if (request) {
      const nextRequest = url && url !== input.url ? new Request(url, input) : input;
      const nextInit = init && typeof init === 'object' ? { ...init } : init;
      if (method === 'GET' && nextInit && nextInit.cache === 'no-store' && ttlMs) delete nextInit.cache;
      response = await originalFetch(nextRequest, nextInit);
    } else {
      response = await originalFetch(input, init);
    }

    if (method === 'GET' && ttlMs && typeof normalizedUrl === 'string') {
      cacheResponse(normalizedUrl, response);
    }
    return response;
  };
  window.__PLC_FETCH_PATCHED__ = true;
}
