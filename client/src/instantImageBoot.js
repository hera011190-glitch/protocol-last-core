import { buildApiUrl } from "./api";

const IMAGE_MEMORY_KEY = "plc-instant-image-manifest-v2";
const PRELOADED = new Set();
const MAX_EAGER_IMAGES = 90;
const MAX_PARALLEL = 8;

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(data:|blob:)/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return buildApiUrl(raw);
  if (raw.startsWith("/")) return buildApiUrl(raw);
  return buildApiUrl(`/${raw}`);
}

function collectImages(value, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    const src = normalizeUrl(value);
    if (
      src &&
      (
        src.startsWith("data:image/") ||
        /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(src) ||
        src.includes("/asset/") ||
        src.includes("/uploads/") ||
        src.includes("/design-assets/")
      )
    ) out.push(src);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectImages(item, out));
    return out;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => {
      const lower = String(key || "").toLowerCase();
      if (typeof child === "string" && /(image|img|src|sprite|card|profile|background|portrait)/.test(lower)) {
        collectImages(child, out);
      } else {
        collectImages(child, out);
      }
    });
  }
  return out;
}

function uniqueImages(list) {
  return Array.from(new Set((list || []).map(normalizeUrl).filter(Boolean)));
}

function readSavedManifestImages() {
  try {
    const raw = sessionStorage.getItem(IMAGE_MEMORY_KEY) || localStorage.getItem(IMAGE_MEMORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveManifestImages(images) {
  const payload = JSON.stringify(uniqueImages(images).slice(0, MAX_EAGER_IMAGES));
  try { sessionStorage.setItem(IMAGE_MEMORY_KEY, payload); } catch {}
  try { localStorage.setItem(IMAGE_MEMORY_KEY, payload); } catch {}
}

function preloadOne(src, priority = "auto") {
  const url = normalizeUrl(src);
  if (!url || PRELOADED.has(url)) return Promise.resolve(false);
  PRELOADED.add(url);

  try {
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = url;
    if (priority === "high") link.fetchPriority = "high";
    document.head.appendChild(link);
  } catch {}

  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = priority === "high" ? "sync" : "async";
    img.loading = priority === "high" ? "eager" : "lazy";
    if (priority === "high") img.fetchPriority = "high";
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function preloadQueue(images, { highCount = 24 } = {}) {
  const urls = uniqueImages(images).filter((url) => !PRELOADED.has(url)).slice(0, MAX_EAGER_IMAGES);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(MAX_PARALLEL, Math.max(1, urls.length)) }, async () => {
    while (cursor < urls.length) {
      const index = cursor;
      cursor += 1;
      await preloadOne(urls[index], index < highCount ? "high" : "auto");
    }
  });

  await Promise.all(workers);
}

async function fetchJson(path, options = {}) {
  const res = await fetch(buildApiUrl(path), {
    cache: "force-cache",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export function startInstantImageBoot() {
  if (typeof window === "undefined" || window.__PLC_INSTANT_IMAGE_BOOT__) return;
  window.__PLC_INSTANT_IMAGE_BOOT__ = true;

  // 지난 접속에서 이미 알게 된 이미지부터 즉시 요청합니다.
  const saved = readSavedManifestImages();
  if (saved.length > 0) preloadQueue(saved, { highCount: 36 });

  const run = async () => {
    try {
      const manifest = await fetchJson("/image-manifest");
      const fromManifest = [
        ...(manifest?.characters || []).flatMap((character) => [
          character?.cardImage,
          character?.spriteImage,
          character?.profileImage,
        ]),
        ...collectImages(manifest?.maps || {}),
      ];
      const urls = uniqueImages(fromManifest);
      if (urls.length > 0) {
        saveManifestImages(urls);
        await preloadQueue(urls, { highCount: 42 });
      }
    } catch {
      try {
        const [characters, maps] = await Promise.all([
          fetchJson("/characters-public"),
          fetchJson("/designMapsPublic"),
        ]);
        const urls = uniqueImages([
          ...(Array.isArray(characters) ? characters : []).flatMap((character) => [
            character?.cardImage,
            character?.mainImage,
            character?.spriteImage,
            character?.investigationImage,
            character?.profileImage,
            character?.image,
          ]),
          ...collectImages(maps),
        ]);
        if (urls.length > 0) {
          saveManifestImages(urls);
          await preloadQueue(urls, { highCount: 42 });
        }
      } catch {}
    }
  };

  // React가 그리기 전에 너무 막지 않게, 하지만 거의 즉시 시작합니다.
  window.setTimeout(run, 30);
}

export function warmVisibleImagesFromRows(rows = []) {
  const urls = uniqueImages(collectImages(rows)).slice(0, MAX_EAGER_IMAGES);
  preloadQueue(urls, { highCount: 36 });
}
