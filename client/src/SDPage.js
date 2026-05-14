import { memo, useEffect, useMemo, useRef, useState } from "react";
import DesignPageFrame from "./DesignPageFrame";
import { buildApiUrl } from "./api";
import { startInstantImageBoot, warmVisibleImagesFromRows } from "./instantImageBoot";

function rand(min, max) { return Math.random() * (max - min) + min; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function normalizeKeyPart(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, " "); }
function buttonLook(theme, kind = "ghost") {
  return kind === "primary"
    ? { background: theme?.buttonPrimaryBg || "linear-gradient(135deg, #7fdbff 0%, #39bfff 55%, #1d9dff 100%)", color: theme?.buttonPrimaryText || "#ffffff", border: "none" }
    : { background: theme?.buttonGhostBg || "rgba(255,255,255,0.72)", color: theme?.buttonGhostText || "#18405f", border: `1px solid ${theme?.line || "rgba(98,176,220,0.18)"}` };
}
function arrowStyle(position, theme) {
  return {
    position: "absolute",
    zIndex: 8,
    width: "58px",
    height: "58px",
    borderRadius: "18px",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    fontSize: "22px",
    fontWeight: 900,
    backdropFilter: "blur(14px)",
    boxShadow: "0 14px 28px rgba(0,0,0,0.12)",
    ...buttonLook(theme, "ghost"),
    ...position,
  };
}
function spawnFromEdge(edge) {
  if (edge === "left") return { x: 8, y: rand(18, 76), dx: rand(0.68, 1.08), dy: rand(-0.24, 0.24) };
  if (edge === "right") return { x: 92, y: rand(18, 76), dx: rand(-1.08, -0.68), dy: rand(-0.24, 0.24) };
  if (edge === "up") return { x: rand(10, 88), y: 10, dx: rand(-0.26, 0.26), dy: rand(0.64, 1.02) };
  return { x: rand(10, 88), y: 78, dx: rand(-0.26, 0.26), dy: rand(-1.02, -0.64) };
}

function chooseLocalMotion(currentMap, maps, currentDx = 0, currentDy = 0) {
  const mapDef = (maps || []).find((item) => String(item.id) === String(currentMap)) || null;
  const linkedDirs = Object.entries(mapDef?.neighbors || {}).filter(([, nextId]) => nextId && (maps || []).some((item) => String(item.id) === String(nextId)));
  const wantsPause = Math.random() < 0.14;
  const wantsMapChange = linkedDirs.length > 0 && Math.random() < 0.18;

  if (wantsPause) {
    return {
      dx: Number(currentDx || 0) * 0.24,
      dy: Number(currentDy || 0) * 0.24,
      waitMs: Math.round(rand(800, 1700)),
      moveCooldownMs: Math.round(rand(3400, 6200)),
    };
  }

  if (wantsMapChange) {
    const [dir] = linkedDirs[Math.floor(Math.random() * linkedDirs.length)];
    if (dir === "left") {
      return { dx: -rand(1.38, 2.05), dy: rand(-0.42, 0.42), waitMs: 0, moveCooldownMs: Math.round(rand(3200, 6000)) };
    }
    if (dir === "right") {
      return { dx: rand(1.38, 2.05), dy: rand(-0.42, 0.42), waitMs: 0, moveCooldownMs: Math.round(rand(3200, 6000)) };
    }
    if (dir === "up") {
      return { dx: rand(-0.42, 0.42), dy: -rand(1.24, 1.88), waitMs: 0, moveCooldownMs: Math.round(rand(3200, 6000)) };
    }
    return { dx: rand(-0.42, 0.42), dy: rand(1.24, 1.88), waitMs: 0, moveCooldownMs: Math.round(rand(3200, 6000)) };
  }

  let dx = rand(-1.62, 1.62);
  let dy = rand(-0.88, 0.88);
  if (Math.abs(dx) < 0.68) dx = dx >= 0 ? 0.68 : -0.68;
  if (Math.abs(dy) < 0.28) dy = dy >= 0 ? 0.28 : -0.28;
  return {
    dx,
    dy,
    waitMs: 0,
    moveCooldownMs: Math.round(rand(4000, 7200)),
  };
}


function readSavedPositions() {
  try {
    const raw = localStorage.getItem("plc-sd-positions");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}


function getStableDefaultMapId(character, maps, fallbackIndex = 0) {
  if (!Array.isArray(maps) || maps.length === 0) return "";
  const seedSource = String(character?.id || character?.ownerId || character?.name || fallbackIndex || 0);
  let hash = 0;
  for (let i = 0; i < seedSource.length; i += 1) {
    hash = ((hash * 31) + seedSource.charCodeAt(i)) >>> 0;
  }
  return maps[hash % maps.length]?.id || maps[0]?.id || "";
}

function buildCharacterState(character, savedState, maps, fallbackIndex = 0) {
  const spawn = spawnFromEdge(fallbackIndex % 2 === 0 ? "down" : "up");
  return {
    ...character,
    x: typeof savedState?.x === "number" ? savedState.x : typeof character.x === "number" ? character.x : spawn.x,
    y: typeof savedState?.y === "number" ? savedState.y : typeof character.y === "number" ? character.y : spawn.y,
    dx: typeof savedState?.dx === "number" ? savedState.dx : typeof character.dx === "number" ? character.dx : spawn.dx,
    dy: typeof savedState?.dy === "number" ? savedState.dy : typeof character.dy === "number" ? character.dy : spawn.dy,
    waitMs: typeof savedState?.waitMs === "number" ? savedState.waitMs : 0,
    moveCooldownMs: typeof savedState?.moveCooldownMs === "number" ? savedState.moveCooldownMs : rand(9200, 14800),
    currentMap:
      [savedState?.currentMap, character.currentMap].find((candidate) => maps.some((map) => String(map.id) === String(candidate))) ||
      getStableDefaultMapId(character, maps, fallbackIndex) ||
      maps[0]?.id ||
      "",
  };
}

function getCharacterKey(character) {
  const idKey = normalizeKeyPart(character?.id);
  if (idKey) return `id:${idKey}`;
  const ownerKey = normalizeKeyPart(character?.ownerId);
  const nameKey = normalizeKeyPart(character?.name);
  if (ownerKey && nameKey) return `owner:${ownerKey}::${nameKey}`;
  if (nameKey) return `name:${nameKey}`;
  return `${Date.now()}-${Math.random()}`;
}

function getCharacterAliases(character) {
  const idKey = normalizeKeyPart(character?.id);
  const ownerKey = normalizeKeyPart(character?.ownerId);
  const nameKey = normalizeKeyPart(character?.name);
  const aliases = [
    idKey ? `id:${idKey}` : "",
    ownerKey && nameKey ? `owner:${ownerKey}::${nameKey}` : "",
    nameKey ? `name:${nameKey}` : "",
  ].filter(Boolean);
  return Array.from(new Set(aliases));
}

function findStateByAliases(source, character) {
  const aliases = getCharacterAliases(character);
  for (const alias of aliases) {
    if (source?.[alias]) return source[alias];
  }
  return null;
}

function buildVisualStateFromServer(character, prev, savedState) {
  const remoteMap = String(character?.currentMap || savedState?.currentMap || "").trim();
  const prevMap = String(prev?.currentMap || "").trim();
  const prevX = Number(prev?.x);
  const prevY = Number(prev?.y);
  const hasPrevPosition = Number.isFinite(prevX) && Number.isFinite(prevY);

  if (prev && (hasPrevPosition || prevMap)) {
    return {
      ...character,
      x: hasPrevPosition ? prev?.x : character?.x,
      y: hasPrevPosition ? prev?.y : character?.y,
      dx: typeof prev?.dx === "number" ? prev.dx : character?.dx,
      dy: typeof prev?.dy === "number" ? prev.dy : character?.dy,
      waitMs: typeof prev?.waitMs === "number" ? prev.waitMs : character?.waitMs,
      moveCooldownMs: typeof prev?.moveCooldownMs === "number" ? prev.moveCooldownMs : character?.moveCooldownMs,
      currentMap: prev?.currentMap || remoteMap || character?.currentMap || savedState?.currentMap || "",
      localMapLockUntil: Number(prev?.localMapLockUntil || 0),
    };
  }

  const remoteX = Number(character?.x);
  const remoteY = Number(character?.y);
  const hasRemotePosition = Number.isFinite(remoteX) && Number.isFinite(remoteY);

  return {
    ...character,
    x: hasRemotePosition ? remoteX : character?.x,
    y: hasRemotePosition ? remoteY : character?.y,
    dx: typeof character?.dx === "number" ? character.dx : prev?.dx,
    dy: typeof character?.dy === "number" ? character.dy : prev?.dy,
    waitMs: typeof character?.waitMs === "number" ? character.waitMs : prev?.waitMs,
    moveCooldownMs: typeof character?.moveCooldownMs === "number" ? character.moveCooldownMs : prev?.moveCooldownMs,
    currentMap: remoteMap || character?.currentMap || prev?.currentMap || savedState?.currentMap || "",
    localMapLockUntil: Number(character?.localMapLockUntil || prev?.localMapLockUntil || 0),
  };
}

function persistCharacterPositions(rows) {
  const safeRows = dedupeCharacters(rows || []);
  const payload = {};
  safeRows.forEach((character) => {
    const snapshot = {
      x: character.x,
      y: character.y,
      dx: character.dx,
      dy: character.dy,
      waitMs: character.waitMs,
      moveCooldownMs: character.moveCooldownMs,
      currentMap: character.currentMap,
    };
    getCharacterAliases(character).forEach((alias) => {
      payload[alias] = snapshot;
    });
  });
  try {
    localStorage.setItem("plc-sd-positions", JSON.stringify(payload));
  } catch {}
}

function mergeCharacterStates(prevList, freshList, maps, activeCharacter = null) {
  const prevRows = dedupeCharacters(prevList || []);
  const prevAliasMap = Object.fromEntries(prevRows.flatMap((row) => getCharacterAliases(row).map((alias) => [alias, row])));
  const prevById = Object.fromEntries(prevRows.map((character) => [getCharacterKey(character), character]));
  const saved = readSavedPositions();
  return dedupeCharacters(freshList || []).map((character, index) => {
    const key = getCharacterKey(character);
    const prev = prevById[key] || findStateByAliases(prevAliasMap, character);
    const savedState = findStateByAliases(saved, character) || saved[key] || null;
    const visualSource = buildVisualStateFromServer(character, prev, savedState);
    const fallbackState = {
      x: typeof visualSource?.x === "number" ? visualSource.x : savedState?.x,
      y: typeof visualSource?.y === "number" ? visualSource.y : savedState?.y,
      dx: typeof visualSource?.dx === "number" ? visualSource.dx : savedState?.dx,
      dy: typeof visualSource?.dy === "number" ? visualSource.dy : savedState?.dy,
      waitMs: typeof visualSource?.waitMs === "number" ? visualSource.waitMs : savedState?.waitMs,
      moveCooldownMs: typeof visualSource?.moveCooldownMs === "number" ? visualSource.moveCooldownMs : savedState?.moveCooldownMs,
      currentMap: visualSource?.currentMap || savedState?.currentMap,
    };
    return buildCharacterState(visualSource, fallbackState, maps, index);
  });
}

function SDInfoModal({ character, onClose, theme }) {
  if (!character) return null;
  const corrosion = clamp(Number(character?.corrosion || 0), 0, 100);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.44)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "24px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "520px", maxWidth: "100%", borderRadius: "28px", background: theme?.panelStrong || "rgba(255,255,255,0.94)", border: `1px solid ${theme?.line || "rgba(98,176,220,0.18)"}`, boxShadow: theme?.shadow || "0 24px 60px rgba(73,132,170,0.16)", color: theme?.textMain || "#13324b", padding: "24px" }}>
        <h2 style={{ marginTop: 0, marginBottom: "18px" }}>{character.name}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "108px 1fr", gap: "16px", alignItems: "center", marginBottom: "18px" }}>
          <div style={{ width: "108px", height: "108px", borderRadius: "24px", overflow: "hidden", background: "rgba(255,255,255,0.72)" }}>
            {character.image ? <img src={resolveAssetUrl(character.image)} alt={character.name} onError={(event) => { event.currentTarget.style.display = "none"; }} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#88a0b8" }}>IMG</div>}
          </div>
          <div>
            <div style={{ marginBottom: "8px", fontWeight: 800 }}>{character.rank || "대원"}</div>
            <div style={{ color: theme?.textSoft || "#4f7390", lineHeight: 1.8 }}>{character.oneLine || character.profile || ""}</div>
          </div>
        </div>
        <div style={{ marginBottom: "8px", display: "flex", justifyContent: "space-between", fontSize: "13px" }}><span>침식 진행도</span><span>{corrosion}%</span></div>
        <div style={{ height: "12px", borderRadius: "999px", overflow: "hidden", background: "rgba(255,255,255,0.72)" }}><div style={{ width: `${corrosion}%`, height: "100%", background: "linear-gradient(90deg, #93c5fd, #ef4444)" }} /></div>
        <button type="button" onClick={onClose} style={{ marginTop: "20px", width: "100%", padding: "12px 16px", borderRadius: "16px", cursor: "pointer", fontWeight: 800, ...buttonLook(theme, "primary") }}>닫기</button>
      </div>
    </div>
  );
}

const SD_CHARACTER_CACHE_KEY = "plc-cache-sd-characters";
const CHARACTER_CACHE_KEY = "plc-cache-characters";
const WARM_CHARACTER_CACHE_KEY = "plc-warm-characters";
const SD_ACTIVE_MAP_KEY = "plc-sd-active-map";
const SD_MAP_CONFIG_CACHE_KEY = "plc-sd-map-config";
const SD_POSITIONS_KEY = "plc-sd-positions";
const SD_CHARACTERS_KEY = SD_CHARACTER_CACHE_KEY;
const SD_IMAGE_CACHE_TOKEN = "stable";

function readCachedMapConfig() {
  try {
    const raw = sessionStorage.getItem(SD_MAP_CONFIG_CACHE_KEY) || localStorage.getItem(SD_MAP_CONFIG_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedMapConfig(value) {
  try { sessionStorage.setItem(SD_MAP_CONFIG_CACHE_KEY, JSON.stringify(value || {})); } catch {}
  try { localStorage.setItem(SD_MAP_CONFIG_CACHE_KEY, JSON.stringify(value || {})); } catch {}
}

function clearCachedMapConfig() {
  try { sessionStorage.removeItem(SD_MAP_CONFIG_CACHE_KEY); } catch {}
  try { localStorage.removeItem(SD_MAP_CONFIG_CACHE_KEY); } catch {}
}

function readCachedSdCharacters() {
  try {
    const raw =
      sessionStorage.getItem(WARM_CHARACTER_CACHE_KEY) ||
      localStorage.getItem(SD_CHARACTER_CACHE_KEY) ||
      localStorage.getItem(CHARACTER_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedSdCharacters(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  try {
    localStorage.setItem(SD_CHARACTER_CACHE_KEY, JSON.stringify(safeRows));
  } catch {}
  try {
    localStorage.setItem(CHARACTER_CACHE_KEY, JSON.stringify(safeRows));
  } catch {}
  try {
    sessionStorage.setItem(WARM_CHARACTER_CACHE_KEY, JSON.stringify(safeRows));
  } catch {}
}

function readLastViewedMapId() {
  try {
    return String(sessionStorage.getItem(SD_ACTIVE_MAP_KEY) || localStorage.getItem(SD_ACTIVE_MAP_KEY) || "").trim();
  } catch {
    return "";
  }
}

function writeLastViewedMapId(mapId) {
  const value = String(mapId || "").trim();
  if (!value) return;
  try { sessionStorage.setItem(SD_ACTIVE_MAP_KEY, value); } catch {}
  try { localStorage.setItem(SD_ACTIVE_MAP_KEY, value); } catch {}
}

function dedupeCharacters(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const merged = new Map();
  list.forEach((character) => {
    const aliases = getCharacterAliases(character);
    const primaryKey = aliases[0] || getCharacterKey(character);
    if (!primaryKey) return;
    const prev = aliases.map((alias) => merged.get(alias)).find(Boolean) || null;
    const next = !prev ? character : {
      ...prev,
      ...character,
      currentMap: character?.currentMap || prev?.currentMap || "",
      spriteImage: character?.spriteImage || prev?.spriteImage || "",
      investigationImage: character?.investigationImage || prev?.investigationImage || "",
      mainImage: character?.mainImage || prev?.mainImage || "",
      image: character?.image || prev?.image || "",
      x: typeof character?.x === "number" ? character.x : prev?.x,
      y: typeof character?.y === "number" ? character.y : prev?.y,
      dx: typeof character?.dx === "number" ? character.dx : prev?.dx,
      dy: typeof character?.dy === "number" ? character.dy : prev?.dy,
      waitMs: typeof character?.waitMs === "number" ? character.waitMs : prev?.waitMs,
      moveCooldownMs: typeof character?.moveCooldownMs === "number" ? character.moveCooldownMs : prev?.moveCooldownMs,
    };
    if (prev) {
      getCharacterAliases(prev).forEach((alias) => merged.delete(alias));
    }
    getCharacterAliases(next).forEach((alias) => merged.set(alias, next));
  });
  return Array.from(new Map(Array.from(merged.values()).map((character) => [getCharacterKey(character) || getCharacterAliases(character)[0], character])).values());
}

function normalizeImageValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return String(value.url || value.src || value.path || value.fileUrl || value.image || "").trim();
  }
  return String(value || "").trim();
}

function getSpriteImageCandidates(character) {
  const candidates = [
    character?.spriteImage,
    character?.sdImage,
    character?.sdImageUrl,
    character?.sdUrl,
    character?.sd,
    character?.characterSdImage,
    character?.investigationImage,
    character?.profileImage,
    character?.image,
    character?.mainImage,
    character?.cardImage,
    character?.fullBodyImage,
    character?.portraitImage,
    character?.avatar,
    character?.thumbnail,
  ].map(normalizeImageValue).filter(Boolean);
  return Array.from(new Set(candidates));
}

function getSpriteImage(character) {
  return getSpriteImageCandidates(character)[0] || "";
}

function appendImageCacheBuster(url) {
  return url || "";
}

function resolveAssetUrl(value) {
  let src = normalizeImageValue(value).replace(/\\/g, "/").trim();
  if (!src) return "";
  if (/^(data:|blob:|https?:\/\/)/i.test(src)) return appendImageCacheBuster(src);
  if (src.startsWith("./")) src = src.slice(2);
  if (src.startsWith("/")) return appendImageCacheBuster(buildApiUrl(src));
  return appendImageCacheBuster(buildApiUrl("/" + src));
}

function isAdminCharacter(character) {
  if (!character) return false;
  if (character.isAdmin || character.admin || character.isOperator || character.operator) return true;
  const roleFields = [character.role, character.userRole, character.accountRole, character.ownerRole, character.permission]
    .map((value) => normalizeKeyPart(value));
  if (roleFields.some((value) => ["admin", "operator", "manager", "운영", "운영자", "관리자"].includes(value))) return true;
  const typeValue = normalizeKeyPart(character.type);
  if (["admin", "operator", "manager", "운영", "운영자", "관리자"].includes(typeValue)) return true;
  const idFields = [character.id, character.ownerId, character.userId, character.accountId, character.loginId, character.username]
    .map((value) => normalizeKeyPart(value));
  return idFields.some((value) => value === "plc" || value === "admin" || value === "operator" || value === "master" || value === "운영자" || value === "관리자");
}

function filterVisibleSdCharacters(rows) {
  return (Array.isArray(rows) ? rows : []).filter((character) => !isAdminCharacter(character));
}

function BrokenSdFallback({ name }) {
  return (
    <div
      aria-label={name || "SD"}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
        display: "grid",
        placeItems: "center",
        borderRadius: "28px",
        background: "linear-gradient(180deg, rgba(236,248,255,0.94), rgba(177,219,246,0.86))",
        border: "1px solid rgba(93,173,226,0.35)",
        color: "#24506c",
        fontWeight: 900,
        fontSize: "15px",
        boxShadow: "inset 0 0 28px rgba(255,255,255,0.54)",
      }}
    >
      SD
    </div>
  );
}

function getCharacterQuotePool(character) {
  const directQuotes = Array.isArray(character?.sdQuotes) ? character.sdQuotes.map((quote) => String(quote || "").trim()).filter(Boolean) : [];
  const fallbackQuotes = [String(character?.oneLine || "").trim()]
    .filter(Boolean);
  return Array.from(new Set([...directQuotes, ...fallbackQuotes]));
}

function matchesActiveCharacter(candidate, activeCharacter) {
  if (!candidate || !activeCharacter) return false;
  const activeAliases = new Set(getCharacterAliases(activeCharacter));
  if (getCharacterAliases(candidate).some((alias) => activeAliases.has(alias))) return true;
  const activeId = normalizeKeyPart(activeCharacter?.id);
  const ownerKey = normalizeKeyPart(activeCharacter?.ownerId);
  const nameKey = normalizeKeyPart(activeCharacter?.name);
  const candidateId = normalizeKeyPart(candidate?.id);
  const candidateOwner = normalizeKeyPart(candidate?.ownerId);
  const candidateName = normalizeKeyPart(candidate?.name);
  if (activeId && candidateId && activeId === candidateId) return true;
  if (ownerKey && nameKey && candidateOwner === ownerKey && candidateName === nameKey) return true;
  if (nameKey && candidateName && candidateName === nameKey) return true;
  return false;
}

function stabilizeCharacterRows(rows, activeCharacter, maps) {
  const base = dedupeCharacters(rows || []);
  if (!activeCharacter) return base;
  const others = [];
  const activeRows = [];
  base.forEach((row) => {
    if (matchesActiveCharacter(row, activeCharacter)) {
      activeRows.push(row);
      return;
    }
    others.push(row);
  });
  const saved = findStateByAliases(readSavedPositions(), activeCharacter) || null;
  const merged = activeRows.sort((a, b) => {
    const aMotion = Math.abs(Number(a?.dx || 0)) + Math.abs(Number(a?.dy || 0));
    const bMotion = Math.abs(Number(b?.dx || 0)) + Math.abs(Number(b?.dy || 0));
    if (aMotion !== bMotion) return bMotion - aMotion;
    const aHasMap = String(a?.currentMap || "").trim() ? 1 : 0;
    const bHasMap = String(b?.currentMap || "").trim() ? 1 : 0;
    return bHasMap - aHasMap;
  })[0] || null;
  const source = merged || activeCharacter;
  const normalized = buildCharacterState({
    ...source,
    id: activeCharacter?.id ?? source?.id,
    ownerId: activeCharacter?.ownerId || source?.ownerId || "",
    name: activeCharacter?.name || source?.name || "",
    image: source?.image || activeCharacter?.image || "",
    profileImage: source?.profileImage || activeCharacter?.profileImage || source?.image || "",
    mainImage: source?.mainImage || activeCharacter?.mainImage || source?.profileImage || source?.image || "",
    cardImage: source?.cardImage || source?.mainImage || source?.profileImage || source?.image || "",
    investigationImage: source?.investigationImage || activeCharacter?.investigationImage || source?.mainImage || source?.profileImage || source?.image || "",
    spriteImage: source?.spriteImage || activeCharacter?.investigationImage || activeCharacter?.mainImage || activeCharacter?.image || source?.investigationImage || source?.mainImage || source?.profileImage || source?.image || "",
    currentMap: source?.currentMap || activeCharacter?.currentMap || saved?.currentMap || "",
    x: typeof source?.x === "number" ? source.x : saved?.x,
    y: typeof source?.y === "number" ? source.y : saved?.y,
    dx: typeof source?.dx === "number" ? source.dx : saved?.dx,
    dy: typeof source?.dy === "number" ? source.dy : saved?.dy,
    waitMs: typeof source?.waitMs === "number" ? source.waitMs : saved?.waitMs,
    moveCooldownMs: typeof source?.moveCooldownMs === "number" ? source.moveCooldownMs : saved?.moveCooldownMs,
  }, source || saved || activeCharacter, maps, 0);
  return dedupeCharacters([...others, normalized]);
}

async function fetchCharactersWithFallback() {
  const now = Date.now();
  const urls = [
    buildApiUrl(`/characters-public`),
  ];
  for (const url of urls) {
    try {
      const requestUrl = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
      const res = await fetch(requestUrl, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) { warmVisibleImagesFromRows(data); return data; }
    } catch {}
  }
  return [];
}

const FALLBACK_MAPS = [
  { id: "sector-01", name: "구역 1", background: "linear-gradient(180deg, #dff4ff, #cceaff)", neighbors: { right: "sector-02" } },
  { id: "sector-02", name: "구역 2", background: "linear-gradient(180deg, #eaf7ff, #d8efff)", neighbors: { left: "sector-01" } },
];

function measureSpriteVisibleBounds(img, fallbackSize = 132) {
  const width = img?.naturalWidth || fallbackSize;
  const height = img?.naturalHeight || fallbackSize;
  const fallbackBounds = { left: 0, top: 0, width, height };
  try {
    if (!width || !height || typeof document === "undefined") return { width, height, alphaBounds: fallbackBounds };
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { width, height, alphaBounds: fallbackBounds };
    ctx.drawImage(img, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha > 8) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return { width, height, alphaBounds: fallbackBounds };
    return {
      width,
      height,
      alphaBounds: {
        left: minX,
        top: minY,
        width: Math.max(1, maxX - minX + 1),
        height: Math.max(1, maxY - minY + 1),
      },
    };
  } catch {
    return { width, height, alphaBounds: fallbackBounds };
  }
}

const CharacterSprite = memo(function CharacterSprite({ character, quote, moving, onClick }) {
  const spriteCandidates = useMemo(() => getSpriteImageCandidates(character), [character]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [spriteNaturalSize, setSpriteNaturalSize] = useState({ width: 0, height: 0, alphaBounds: null });

  useEffect(() => {
    setCandidateIndex(0);
    setSpriteNaturalSize({ width: 0, height: 0, alphaBounds: null });
  }, [spriteCandidates.join("|")]);

  const rawSpriteCandidate = candidateIndex < spriteCandidates.length ? spriteCandidates[candidateIndex] : "";
  const spriteImage = resolveAssetUrl(rawSpriteCandidate);
  const showSpriteImage = !!spriteImage;
  const handleSpriteError = () => {
    setCandidateIndex((prev) => {
      const nextIndex = prev + 1;
      return nextIndex < spriteCandidates.length ? nextIndex : spriteCandidates.length;
    });
  };
  const corrosion = clamp(Number(character?.corrosion || 0), 0, 100);
  const tintReveal = Math.max(0, Math.min(100, corrosion));
  const boxSize = 132;
  const naturalWidth = Number(spriteNaturalSize.width || 0);
  const naturalHeight = Number(spriteNaturalSize.height || 0);
  const spriteScale = naturalWidth > 0 && naturalHeight > 0 ? Math.min(boxSize / naturalWidth, boxSize / naturalHeight, 1) : 1;
  const renderedSpriteWidth = naturalWidth > 0 ? Math.max(1, Math.round(naturalWidth * spriteScale)) : boxSize;
  const renderedSpriteHeight = naturalHeight > 0 ? Math.max(1, Math.round(naturalHeight * spriteScale)) : boxSize;
  const visibleBounds = spriteNaturalSize.alphaBounds || { left: 0, top: 0, width: naturalWidth || boxSize, height: naturalHeight || boxSize };
  const visibleLeft = Math.max(0, Math.round(Number(visibleBounds.left || 0) * spriteScale));
  const visibleTop = Math.max(0, Math.round(Number(visibleBounds.top || 0) * spriteScale));
  const visibleWidth = Math.max(1, Math.round(Number(visibleBounds.width || naturalWidth || boxSize) * spriteScale));
  const visibleHeight = Math.max(1, Math.round(Number(visibleBounds.height || naturalHeight || boxSize) * spriteScale));
  const visibleRevealHeight = tintReveal > 0 ? Math.max(1, Math.ceil((visibleHeight * tintReveal) / 100)) : 0;
  const tintFeatherHeight = tintReveal > 0 ? Math.max(10, Math.ceil(visibleHeight * 0.16)) : 0;
  const tintLayerHeight = tintReveal > 0 ? Math.min(visibleHeight, visibleRevealHeight + tintFeatherHeight) : 0;
  const tintLayerTop = Math.max(0, visibleTop + visibleHeight - tintLayerHeight);
  const tintSolidStop = tintLayerHeight > 0 ? Math.max(18, Math.min(92, Math.round((visibleRevealHeight / tintLayerHeight) * 100))) : 100;
  const tintGradient = tintReveal >= 99.5
    ? "linear-gradient(to top, rgba(70,0,0,0.99) 0%, rgba(118,0,0,0.98) 62%, rgba(76,0,0,0.9) 100%)"
    : `linear-gradient(to top, rgba(70,0,0,0.99) 0%, rgba(118,0,0,0.98) ${tintSolidStop}%, rgba(92,0,0,0.62) ${Math.min(100, tintSolidStop + 4)}%, rgba(55,0,0,0) 100%)`;
  return (
    <div onClick={onClick} style={{ position: "absolute", left: `${character.x}%`, top: `${character.y}%`, transform: "translate3d(-50%, -50%, 0)", transition: "none", width: "148px", height: "204px", textAlign: "center", cursor: "pointer", zIndex: 4, pointerEvents: "auto", willChange: "left, top, transform", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}>
      {quote?.text ? (
        <div style={{ position: "absolute", left: "50%", bottom: "164px", transform: "translate3d(-50%, 0, 0)", display: "inline-block", width: "max-content", maxWidth: "460px", minWidth: "150px", padding: "11px 18px", borderRadius: "20px", background: "linear-gradient(180deg, rgba(246,251,255,0.98) 0%, rgba(225,241,255,0.98) 100%)", color: "#14344d", border: "1px solid rgba(91,170,224,0.30)", boxShadow: "0 10px 24px rgba(37,99,235,0.12)", fontSize: "13px", lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "keep-all", overflowWrap: "break-word", backdropFilter: "blur(8px)" }}>
          {quote.text}
          <div style={{ position: "absolute", left: "50%", bottom: "-7px", width: "14px", height: "14px", transform: "translateX(-50%) rotate(45deg)", background: "linear-gradient(180deg, rgba(225,241,255,0.98) 0%, rgba(206,233,255,0.98) 100%)", borderRight: "1px solid rgba(91,170,224,0.22)", borderBottom: "1px solid rgba(91,170,224,0.22)" }} />
        </div>
      ) : null}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 138, fontSize: "16px", fontWeight: 900, color: "#ffffff", textShadow: "0 2px 6px rgba(0,0,0,0.48)" }}>{character.name}</div>
      <div style={{ position: "absolute", left: "50%", bottom: 0, width: "132px", height: "132px", margin: "0 auto", transform: `translate3d(-50%, 0, 0) ${moving ? `rotate(${character.dx >= 0 ? 0.22 : -0.22}deg)` : "rotate(0deg)"}`, transition: "transform 0.14s linear", willChange: "transform", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", filter: "drop-shadow(0 12px 18px rgba(0,0,0,0.22))" }}>
        {showSpriteImage ? (
          <div style={{ position: "absolute", left: "50%", top: "50%", width: renderedSpriteWidth, height: renderedSpriteHeight, transform: "translate(-50%, -50%)", overflow: "hidden" }}>
            <img
              src={spriteImage}
              alt=""
              loading="eager"
              decoding="sync"
              fetchPriority="high"
              onError={handleSpriteError}
              onLoad={(event) => {
                const img = event.currentTarget;
                setSpriteNaturalSize(measureSpriteVisibleBounds(img, boxSize));
              }}
              style={{ width: "100%", height: "100%", objectFit: "contain", position: "absolute", inset: 0, zIndex: 1 }}
            />
            {tintReveal > 0 ? (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: visibleLeft,
                  top: visibleTop,
                  width: visibleWidth,
                  height: visibleHeight,
                  zIndex: 2,
                  pointerEvents: "none",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    bottom: 0,
                    width: visibleWidth,
                    height: tintLayerHeight,
                    background: tintGradient,
                    WebkitMaskImage: `url(${spriteImage})`,
                    maskImage: `url(${spriteImage})`,
                    WebkitMaskSize: `${renderedSpriteWidth}px ${renderedSpriteHeight}px`,
                    maskSize: `${renderedSpriteWidth}px ${renderedSpriteHeight}px`,
                    WebkitMaskPosition: `${-visibleLeft}px ${-tintLayerTop}px`,
                    maskPosition: `${-visibleLeft}px ${-tintLayerTop}px`,
                    WebkitMaskRepeat: "no-repeat",
                    maskRepeat: "no-repeat",
                    mixBlendMode: "multiply",
                    opacity: 1,
                    transition: "height 0.28s ease, background 0.28s ease, mask-position 0.28s ease, -webkit-mask-position 0.28s ease",
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <BrokenSdFallback name={character?.name} />
        )}
      </div>
    </div>
  );
});

export default function SDPage({ activeCharacter, design, theme, isActive = true }) {
  const [characters, setCharacters] = useState(() => readCachedSdCharacters());
  const [activeMapId, setActiveMapId] = useState(() => readLastViewedMapId());
  const [quotes, setQuotes] = useState({});
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [remoteMapRoot, setRemoteMapRoot] = useState(() => design?.siteContent?.maps || readCachedMapConfig() || null);
  const lastFrameRef = useRef(0);
  const saveTickRef = useRef(0);
  const lastServerSyncRef = useRef("");
  const lastServerSyncAtRef = useRef(0);
  const lastServerSyncPayloadRef = useRef(null);
  const charactersRef = useRef(characters);
  const activeMapRef = useRef(activeMapId);
  const quotesRef = useRef(quotes);
  const manualMapMoveRef = useRef(0);
  const mapRoot = remoteMapRoot || design?.siteContent?.maps || {};
  const collections = Array.isArray(mapRoot.collections) ? mapRoot.collections : [];
  const activeCollectionId = mapRoot.activeCollectionId || collections[0]?.id || "";
  const maps = useMemo(() => {
    if (collections.length > 0) {
      const found = collections.find((v) => String(v.id) === String(activeCollectionId)) || collections[0];
      return Array.isArray(found?.presets) && found.presets.length > 0 ? found.presets : FALLBACK_MAPS;
    }
    return Array.isArray(mapRoot.presets) && mapRoot.presets.length > 0 ? mapRoot.presets : FALLBACK_MAPS;
  }, [mapRoot, collections, activeCollectionId]);

  const syncActiveCharacterToServer = (row) => {
    if (!activeCharacter?.id || !row || !matchesActiveCharacter(row, activeCharacter)) return;
    const payload = {
      charId: activeCharacter.id,
      currentMap: row.currentMap || "",
      x: Number.isFinite(Number(row.x)) ? Number(row.x) : 50,
      y: Number.isFinite(Number(row.y)) ? Number(row.y) : 50,
      dx: Number.isFinite(Number(row.dx)) ? Number(row.dx) : 0,
      dy: Number.isFinite(Number(row.dy)) ? Number(row.dy) : 0,
      waitMs: Number.isFinite(Number(row.waitMs)) ? Number(row.waitMs) : 0,
      moveCooldownMs: Number.isFinite(Number(row.moveCooldownMs)) ? Number(row.moveCooldownMs) : 0,
    };
    const syncKey = JSON.stringify(payload);
    if (lastServerSyncRef.current === syncKey) return;
    const now = Date.now();
    const previousPayload = lastServerSyncPayloadRef.current;
    const sameMap = previousPayload && String(previousPayload.currentMap || "") === String(payload.currentMap || "");
    if (sameMap && now - lastServerSyncAtRef.current < 4500) return;
    lastServerSyncRef.current = syncKey;
    lastServerSyncAtRef.current = now;
    lastServerSyncPayloadRef.current = payload;
    fetch(buildApiUrl("/updateCharacter"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  };


  useEffect(() => {
    startInstantImageBoot();
  }, []);

  useEffect(() => {
    if (!isActive) setSelectedCharacter(null);
  }, [isActive]);

  useEffect(() => {
    if (!activeCharacter) return;
    setCharacters((prev) => {
      const cached = readCachedSdCharacters();
      const seedRows = mergeCharacterStates(prev && prev.length > 0 ? prev : cached, [activeCharacter], maps, activeCharacter);
      const next = stabilizeCharacterRows(seedRows, activeCharacter, maps);
      if (next.length > 0) {
        writeCachedSdCharacters(next);
        warmVisibleImagesFromRows(next);
      }
      return next.length > 0 ? next : prev;
    });
  }, [activeCharacter?.id, activeCharacter?.updatedAt, activeCharacter?.assetVersion, maps]);

  useEffect(() => {
    charactersRef.current = stabilizeCharacterRows(characters, activeCharacter, maps);
  }, [characters, activeCharacter, maps]);

  useEffect(() => {
    activeMapRef.current = activeMapId;
  }, [activeMapId]);

  useEffect(() => {
    quotesRef.current = quotes;
  }, [quotes]);

  useEffect(() => {
    const cached = stabilizeCharacterRows(readCachedSdCharacters(), activeCharacter, maps);
    if (cached.length > 0) {
      warmVisibleImagesFromRows(cached);
      setCharacters((prev) => (Array.isArray(prev) && prev.length > 0 ? prev : cached));
    }
  }, []);

  useEffect(() => {
    if (design?.siteContent?.maps && Object.keys(design.siteContent.maps || {}).length > 0) {
      setRemoteMapRoot(design.siteContent.maps);
    }
  }, [design?.siteContent?.maps]);

  useEffect(() => {
    let cancelled = false;
    let controller = null;
    let timeout = null;

    const loadMapConfig = (force = false) => {
      if (controller) {
        try { controller.abort(); } catch {}
      }
      if (timeout) window.clearTimeout(timeout);
      controller = new AbortController();
      timeout = window.setTimeout(() => controller.abort(), 5000);
      const cacheBuster = force ? `?v=${Date.now()}` : "";
      fetch(buildApiUrl(`/designMapsPublic${cacheBuster}`), { cache: "no-store", signal: controller.signal })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (cancelled || !data || typeof data !== "object") return;
          setRemoteMapRoot(data);
          writeCachedMapConfig(data);
        })
        .catch(() => {
          if (cancelled || force) return;
          const cached = readCachedMapConfig();
          if (cached && typeof cached === "object") setRemoteMapRoot(cached);
        })
        .finally(() => {
          if (timeout) window.clearTimeout(timeout);
        });
    };

    const handleDesignUpdated = () => {
      clearCachedMapConfig();
      loadMapConfig(true);
    };

    loadMapConfig(false);
    window.addEventListener("plc-design-updated", handleDesignUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("plc-design-updated", handleDesignUpdated);
      if (timeout) window.clearTimeout(timeout);
      if (controller) {
        try { controller.abort(); } catch {}
      }
    };
  }, []);

  const getNextMap = (currentMap, dir) => {
    const byId = maps.find((m) => m.id === currentMap);
    const linked = byId?.neighbors?.[dir];
    return linked && maps.some((m) => m.id === linked) ? linked : currentMap;
  };

  useEffect(() => {
    let cancelled = false;
    const loadCharacters = async () => {
      const incoming = await fetchCharactersWithFallback();
      if (cancelled) return;
      const fallbackRows = readCachedSdCharacters();
      const finalRows = incoming.length > 0 || fallbackRows.length === 0 ? incoming : fallbackRows;
      const next = stabilizeCharacterRows(mergeCharacterStates([], finalRows, maps, activeCharacter), activeCharacter, maps);
      setCharacters((prev) => (next.length > 0 || prev.length === 0 ? next : prev));
      if (next.length > 0) writeCachedSdCharacters(next);
      setActiveMapId((prev) => {
        const stored = prev || readLastViewedMapId();
        if (stored && maps.some((map) => String(map.id) === String(stored))) return stored;
        const sourceRows = next.length > 0 ? next : mergeCharacterStates([], fallbackRows, maps, activeCharacter);
        const mine = sourceRows.find((v) => String(v.id) === String(activeCharacter?.id));
        return mine?.currentMap || maps[0]?.id || "";
      });
    };
    loadCharacters().catch(() => {
      setCharacters((prev) => {
        if (Array.isArray(prev) && prev.length > 0) return prev;
        const cached = stabilizeCharacterRows(mergeCharacterStates([], readCachedSdCharacters(), maps, activeCharacter), activeCharacter, maps);
        return cached;
      });
      setActiveMapId((prev) => {
        const stored = prev || readLastViewedMapId();
        if (stored && maps.some((map) => String(map.id) === String(stored))) return stored;
        const cached = stabilizeCharacterRows(mergeCharacterStates([], readCachedSdCharacters(), maps, activeCharacter), activeCharacter, maps);
        const mine = cached.find((v) => String(v.id) === String(activeCharacter?.id));
        return mine?.currentMap || maps[0]?.id || "";
      });
    });
    return () => { cancelled = true; };
  }, [activeCharacter?.id, maps]);

  useEffect(() => {
    if (!characters.length) return;
    const stableRows = stabilizeCharacterRows(characters, activeCharacter, maps);
    writeCachedSdCharacters(stableRows);
    if (Date.now() - saveTickRef.current < 700) return;
    saveTickRef.current = Date.now();
    persistCharacterPositions(stableRows);
    const mine = activeCharacter ? stableRows.find((character) => matchesActiveCharacter(character, activeCharacter)) : null;
    if (mine) syncActiveCharacterToServer(mine);
  }, [characters, activeCharacter, maps]);

  useEffect(() => () => {
    const latest = stabilizeCharacterRows(charactersRef.current || [], activeCharacter, maps);
    if (!latest.length) return;
    writeCachedSdCharacters(latest);
    persistCharacterPositions(latest);
    writeLastViewedMapId(activeMapRef.current);
  }, [activeCharacter, maps]);

  useEffect(() => {
    if (!maps.length) return undefined;

    let rafId = 0;
    const step = (timestamp) => {
      if (!lastFrameRef.current) lastFrameRef.current = timestamp;
      const rawDt = timestamp - lastFrameRef.current;
      const dt = Math.min(32, Math.max(8, Number.isFinite(rawDt) ? rawDt : 16));
      lastFrameRef.current = timestamp;

      if (document.visibilityState === "visible") {
        setCharacters((prev) => stabilizeCharacterRows(dedupeCharacters(prev).map((character, _, arr) => {
          let currentMap = character.currentMap || maps[0]?.id || "";
          let x = Number(character.x || 0);
          let y = Number(character.y || 0);
          let dx = Number(character.dx || 0);
          let dy = Number(character.dy || 0);
          let waitMs = Number(character.waitMs || 0);
          const moveCooldownMs = Number(character.moveCooldownMs || 0);

          if (waitMs > 0) {
            waitMs = Math.max(0, waitMs - dt);
            dx *= 0.94;
            dy *= 0.94;
            return { ...character, waitMs, dx, dy, moveCooldownMs, currentMap };
          }

          let nextCooldownMs = moveCooldownMs - dt;
          if (!Number.isFinite(nextCooldownMs)) nextCooldownMs = 0;
          if (nextCooldownMs <= 0 || (Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02)) {
            const nextMotion = chooseLocalMotion(currentMap, maps, dx, dy);
            dx = nextMotion.dx;
            dy = nextMotion.dy;
            waitMs = Number(nextMotion.waitMs || 0);
            nextCooldownMs = Number(nextMotion.moveCooldownMs || 0);
            if (waitMs > 0) {
              return { ...character, waitMs, dx, dy, moveCooldownMs: nextCooldownMs, currentMap };
            }
          }

          const speedFactor = (dt / 1000) * 1.32;
          let nx = x + dx * speedFactor;
          let ny = y + dy * speedFactor;

          const selfKey = getCharacterKey(character);
          const nearby = arr.filter((other) => getCharacterKey(other) !== selfKey && String(other.currentMap || maps[0]?.id || "") === String(currentMap));
          nearby.forEach((other) => {
            const ox = Number(other.x || 0);
            const oy = Number(other.y || 0);
            const distance = Math.hypot(nx - ox, ny - oy);
            if (distance < 8.6) {
              const push = (8.6 - distance) * 0.12;
              nx += nx >= ox ? push : -push;
              ny += ny >= oy ? push * 0.68 : -push * 0.68;
            }
          });

          if (nx <= 4) {
            const nextMap = getNextMap(currentMap, "left");
            if (nextMap && nextMap !== currentMap) {
              currentMap = nextMap;
              nx = 91.2;
              ny = clamp(ny, 10, 76);
              dx = -Math.max(0.62, Math.abs(dx || rand(0.72, 1.12)));
              dy = clamp(dy || rand(-0.30, 0.30), -0.54, 0.54);
              nextCooldownMs = Math.round(rand(3200, 6000));
              character = { ...character, localMapLockUntil: Date.now() + 4200 };
            } else {
              dx *= -1;
              nx = clamp(nx, 4, 92);
            }
          } else if (nx >= 92) {
            const nextMap = getNextMap(currentMap, "right");
            if (nextMap && nextMap !== currentMap) {
              currentMap = nextMap;
              nx = 8.8;
              ny = clamp(ny, 10, 76);
              dx = Math.max(0.62, Math.abs(dx || rand(0.72, 1.12)));
              dy = clamp(dy || rand(-0.30, 0.30), -0.54, 0.54);
              nextCooldownMs = Math.round(rand(3200, 6000));
              character = { ...character, localMapLockUntil: Date.now() + 4200 };
            } else {
              dx *= -1;
              nx = clamp(nx, 4, 92);
            }
          }

          if (ny <= 8) {
            const nextMap = getNextMap(currentMap, "up");
            if (nextMap && nextMap !== currentMap) {
              currentMap = nextMap;
              nx = clamp(nx, 8, 92);
              ny = 77.2;
              dx = clamp(dx || rand(-0.30, 0.30), -0.54, 0.54);
              dy = -Math.max(0.62, Math.abs(dy || rand(0.72, 1.12)));
              nextCooldownMs = Math.round(rand(3200, 6000));
              character = { ...character, localMapLockUntil: Date.now() + 4200 };
            } else {
              dy *= -1;
              ny = clamp(ny, 8, 78);
            }
          } else if (ny >= 78) {
            const nextMap = getNextMap(currentMap, "down");
            if (nextMap && nextMap !== currentMap) {
              currentMap = nextMap;
              nx = clamp(nx, 8, 92);
              ny = 8.8;
              dx = clamp(dx || rand(-0.30, 0.30), -0.54, 0.54);
              dy = Math.max(0.62, Math.abs(dy || rand(0.72, 1.12)));
              nextCooldownMs = Math.round(rand(3200, 6000));
              character = { ...character, localMapLockUntil: Date.now() + 4200 };
            } else {
              dy *= -1;
              ny = clamp(ny, 8, 78);
            }
          }

          return { ...character, x: clamp(nx, 4, 92), y: clamp(ny, 8, 78), dx, dy, waitMs, moveCooldownMs: nextCooldownMs, currentMap, localMapLockUntil: Number(character?.localMapLockUntil || 0) };
        }), activeCharacter, maps));
      }

      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [maps]);

  useEffect(() => {
    const quoteTimer = setInterval(() => {
      const now = Date.now();
      const visible = stabilizeCharacterRows(charactersRef.current || [], activeCharacter, maps)
        .filter((character) => String(character?.currentMap || maps[0]?.id || "") === String(activeMapRef.current || ""));

      setQuotes((prev) => {
        const visibleKeySet = new Set(visible.map((character) => getCharacterKey(character)).filter(Boolean));
        const next = {};
        Object.entries(prev || {}).forEach(([id, payload]) => {
          if (payload?.expiresAt > now && visibleKeySet.has(id)) next[id] = payload;
        });

        const visibleKeys = visible.map((character) => getCharacterKey(character)).filter(Boolean);
        const existingVisibleKeys = visibleKeys.filter((key) => next[key]);
        if (existingVisibleKeys.length > 0 && Math.random() < 0.10) {
          const removeKey = existingVisibleKeys[Math.floor(Math.random() * existingVisibleKeys.length)];
          delete next[removeKey];
        }

        const maxVisible = Math.min(2, Math.max(1, visible.length));
        const visibleQuoteCount = visibleKeys.filter((key) => next[key]).length;
        const candidates = visible.filter((character) => getCharacterQuotePool(character).length > 0 && !next[getCharacterKey(character)]);

        if (candidates.length > 0 && visibleQuoteCount < maxVisible && (visibleQuoteCount === 0 ? Math.random() < 0.12 : Math.random() < 0.04)) {
          const picked = candidates[Math.floor(Math.random() * candidates.length)];
          const pool = getCharacterQuotePool(picked);
          const text = pool[Math.floor(Math.random() * pool.length)];
          const hold = Math.max(11000, Math.min(18200, 11800 + String(text || "").length * 120));
          next[getCharacterKey(picked)] = { text, expiresAt: now + hold };
        }
        return next;
      });
    }, 10000);
    return () => clearInterval(quoteTimer);
  }, [activeCharacter, maps]);

  useEffect(() => {
    if (!maps.length) return undefined;
    const timer = setInterval(async () => {
      try {
        const incoming = await fetchCharactersWithFallback();
        setCharacters((prev) => {
          if (!Array.isArray(incoming) || incoming.length === 0) return prev;
          const next = stabilizeCharacterRows(mergeCharacterStates(charactersRef.current || [], incoming, maps, activeCharacter), activeCharacter, maps);
          if (next.length > 0) {
            writeCachedSdCharacters(next);
            persistCharacterPositions(next);
          }
          return next.length > 0 ? next : prev;
        });
      } catch {}
    }, 3000);
    return () => clearInterval(timer);
  }, [maps, activeCharacter]);

  useEffect(() => {
    const handleCharacterUpdated = async (event) => {
      const updated = event?.detail?.character;
      if (updated?.id || updated?.name) {
        const updatedKey = getCharacterKey(updated);
        setCharacters((prev) => {
          const baseRows = dedupeCharacters(prev);
          const nextRows = matchesActiveCharacter(updated, activeCharacter)
            ? [
                ...baseRows.filter((character) => !matchesActiveCharacter(character, updated)),
                buildCharacterState({
                  ...(baseRows.find((character) => matchesActiveCharacter(character, updated)) || activeCharacter || {}),
                  ...updated,
                }, baseRows.find((character) => matchesActiveCharacter(character, updated)) || activeCharacter || updated, maps, 0),
              ]
            : baseRows.map((character, index) => getCharacterKey(character) === updatedKey ? buildCharacterState({ ...character, ...updated }, character, maps, index) : character);
          const next = stabilizeCharacterRows(nextRows, activeCharacter, maps);
          if (next.length > 0) writeCachedSdCharacters(next);
          return next;
        });
        return;
      }
      try {
        const incoming = await fetchCharactersWithFallback();
        setCharacters((prev) => {
          const fallbackRows = prev.length > 0 ? prev : mergeCharacterStates([], readCachedSdCharacters(), maps, activeCharacter);
          const sourceRows = incoming.length > 0 || fallbackRows.length === 0 ? incoming : fallbackRows;
          const next = stabilizeCharacterRows(mergeCharacterStates([], sourceRows, maps, activeCharacter), activeCharacter, maps);
          if (next.length > 0) writeCachedSdCharacters(next);
          return next.length > 0 || prev.length === 0 ? next : prev;
        });
      } catch {}
    };
    window.addEventListener("plc-character-updated", handleCharacterUpdated);
    return () => window.removeEventListener("plc-character-updated", handleCharacterUpdated);
  }, [maps]);

  useEffect(() => {
    if (!maps.length) return;
    if (!maps.some((map) => String(map.id) === String(activeMapId))) {
      const stored = readLastViewedMapId();
      setActiveMapId(maps.some((map) => String(map.id) === String(stored)) ? stored : maps[0].id);
    }
    setCharacters((prev) => stabilizeCharacterRows(dedupeCharacters(prev).map((character, index) => {
      const currentMap = maps.some((map) => String(map.id) === String(character.currentMap)) ? character.currentMap : maps[index % maps.length]?.id || maps[0]?.id || "";
      return currentMap === character.currentMap ? character : { ...character, currentMap };
    }), activeCharacter, maps));
  }, [maps, activeMapId, activeCharacter]);

  useEffect(() => {
    if (!activeMapId) return;
    writeLastViewedMapId(activeMapId);
  }, [activeMapId]);

  const currentMap = useMemo(() => maps.find((map) => map.id === activeMapId) || maps[0] || null, [maps, activeMapId]);
  const stableCharacters = useMemo(() => filterVisibleSdCharacters(stabilizeCharacterRows(characters, activeCharacter, maps)), [characters, activeCharacter, maps]);
  const canonicalActiveCharacter = useMemo(() => {
    if (!activeCharacter) return null;
    return stableCharacters.find((character) => matchesActiveCharacter(character, activeCharacter)) || null;
  }, [stableCharacters, activeCharacter]);
  const mapCharacters = useMemo(() => {
    const targetMapId = String(currentMap?.id || "");
    return stableCharacters.filter((character) => {
      if (String(character?.currentMap || "") !== targetMapId) return false;
      if (activeCharacter && matchesActiveCharacter(character, activeCharacter)) {
        if (!canonicalActiveCharacter) return false;
        const canonicalKey = getCharacterKey(canonicalActiveCharacter);
        const currentKey = getCharacterKey(character);
        return !!canonicalKey && canonicalKey === currentKey;
      }
      return true;
    });
  }, [stableCharacters, currentMap, activeCharacter, canonicalActiveCharacter]);
  const availableDirs = currentMap?.neighbors || {};

  useEffect(() => {
    if (!maps.length || !stableCharacters.length || !currentMap?.id) return;
    if (Date.now() - manualMapMoveRef.current < 9000) return;
    const hasCharacterOnCurrentMap = stableCharacters.some((character) => String(character?.currentMap || "") === String(currentMap.id));
    if (hasCharacterOnCurrentMap) return;
    const preferredMapId = canonicalActiveCharacter?.currentMap || stableCharacters[0]?.currentMap || maps[0]?.id || "";
    if (preferredMapId && String(preferredMapId) !== String(currentMap.id) && maps.some((map) => String(map.id) === String(preferredMapId))) {
      setActiveMapId(preferredMapId);
    }
  }, [maps, stableCharacters, currentMap?.id, canonicalActiveCharacter?.currentMap]);

  const moveByArrow = (dir) => {
    const nextId = getNextMap(activeMapId, dir);
    if (!nextId || nextId === activeMapId) return;
    manualMapMoveRef.current = Date.now();
    setActiveMapId(nextId);
  };

  return (
    <DesignPageFrame design={design} pageKey="sd" handlers={{}} theme={theme} minHeight="calc(100vh - 94px)" contentStyle={{ padding: 0 }}>
      {selectedCharacter ? <SDInfoModal character={selectedCharacter} onClose={() => setSelectedCharacter(null)} theme={theme} /> : null}
      <div style={{ color: theme?.textMain || "#13324b", height: "calc(100vh - 94px)", display: "grid" }}>
        <div style={{ position: "relative", height: "100%", overflow: "hidden", background: currentMap?.background || "#dff4ff", boxShadow: theme?.shadow || "0 24px 60px rgba(73,132,170,0.16)" }}>
          {currentMap?.backgroundImage ? (
            <img
              src={resolveAssetUrl(currentMap.backgroundImage)}
              onError={(event) => { event.currentTarget.style.display = "none"; }}
              alt={currentMap?.name || "맵 배경"}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: `${Number(currentMap.backgroundPositionX ?? 50)}% ${Number(currentMap.backgroundPositionY ?? 50)}%`,
                transform: `scale(${Math.max(1, Number(currentMap.backgroundScale ?? 100) / 100)})`,
                transformOrigin: "center center",
              }}
            />
          ) : null}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.54), rgba(255,255,255,0.18) 30%, rgba(255,255,255,0.26))" }} />
          <div style={{ position: "absolute", left: 26, top: 24, zIndex: 9, padding: "10px 16px", borderRadius: 999, background: "rgba(255,255,255,0.72)", color: "#0f172a", fontWeight: 900, backdropFilter: "blur(8px)" }}>{currentMap?.name || "맵"}</div>
          {availableDirs.up ? <button type="button" onClick={() => moveByArrow("up")} style={arrowStyle({ top: 18, left: "50%", transform: "translateX(-50%)" }, theme)}>▲</button> : null}
          {availableDirs.down ? <button type="button" onClick={() => moveByArrow("down")} style={arrowStyle({ bottom: 18, left: "50%", transform: "translateX(-50%)" }, theme)}>▼</button> : null}
          {availableDirs.left ? <button type="button" onClick={() => moveByArrow("left")} style={arrowStyle({ left: 18, top: "50%", transform: "translateY(-50%)" }, theme)}>◀</button> : null}
          {availableDirs.right ? <button type="button" onClick={() => moveByArrow("right")} style={arrowStyle({ right: 18, top: "50%", transform: "translateY(-50%)" }, theme)}>▶</button> : null}
          {mapCharacters.map((character) => {
            const q = quotes[getCharacterKey(character)];
            const moving = Math.abs(Number(character.dx || 0)) > 0.42 || Math.abs(Number(character.dy || 0)) > 0.42;
            return <CharacterSprite key={getCharacterKey(character)} character={character} quote={q} moving={moving} onClick={() => setSelectedCharacter(character)} />;
          })}
        </div>
      </div>
    </DesignPageFrame>
  );
}
