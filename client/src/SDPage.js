import { useEffect, useMemo, useRef, useState } from "react";
import DesignPageFrame from "./DesignPageFrame";
import { buildApiUrl } from "./api";

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
    moveCooldownMs: typeof savedState?.moveCooldownMs === "number" ? savedState.moveCooldownMs : rand(7200, 11800),
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

function mergeCharacterStates(prevList, freshList, maps) {
  const prevRows = dedupeCharacters(prevList || []);
  const prevById = Object.fromEntries(prevRows.map((character) => [getCharacterKey(character), character]));
  const saved = readSavedPositions();
  return dedupeCharacters(freshList || []).map((character, index) => {
    const key = getCharacterKey(character);
    const prev = prevById[key] || findStateByAliases(Object.fromEntries(prevRows.flatMap((row) => getCharacterAliases(row).map((alias) => [alias, row]))), character);
    const savedState = findStateByAliases(saved, character) || saved[key];
    return buildCharacterState(character, prev || savedState, maps, index);
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
            {character.image ? <img src={character.image} alt={character.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#88a0b8" }}>IMG</div>}
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
const WARM_CHARACTER_CACHE_KEY = "plc-warm-characters";
const SD_ACTIVE_MAP_KEY = "plc-sd-active-map";
const SD_MAP_CONFIG_CACHE_KEY = "plc-sd-map-config";

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

function readCachedSdCharacters() {
  try {
    const raw = sessionStorage.getItem(WARM_CHARACTER_CACHE_KEY) || localStorage.getItem(SD_CHARACTER_CACHE_KEY);
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

function getSpriteImage(character) {
  return character?.spriteImage || character?.investigationImage || character?.image || character?.mainImage || "";
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
  const ownerKey = normalizeKeyPart(activeCharacter?.ownerId);
  const nameKey = normalizeKeyPart(activeCharacter?.name);
  return !!ownerKey && !!nameKey && normalizeKeyPart(candidate?.ownerId) === ownerKey && normalizeKeyPart(candidate?.name) === nameKey;
}

function stabilizeCharacterRows(rows, activeCharacter, maps) {
  const base = dedupeCharacters(rows || []);
  if (!activeCharacter) return base;
  const others = [];
  let merged = null;
  base.forEach((row) => {
    if (matchesActiveCharacter(row, activeCharacter)) {
      merged = merged ? { ...merged, ...row } : { ...row };
      return;
    }
    others.push(row);
  });
  const saved = findStateByAliases(readSavedPositions(), activeCharacter) || null;
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
    currentMap: saved?.currentMap || source?.currentMap || activeCharacter?.currentMap || "",
    x: typeof saved?.x === "number" ? saved.x : source?.x,
    y: typeof saved?.y === "number" ? saved.y : source?.y,
    dx: typeof saved?.dx === "number" ? saved.dx : source?.dx,
    dy: typeof saved?.dy === "number" ? saved.dy : source?.dy,
    waitMs: typeof saved?.waitMs === "number" ? saved.waitMs : source?.waitMs,
    moveCooldownMs: typeof saved?.moveCooldownMs === "number" ? saved.moveCooldownMs : source?.moveCooldownMs,
  }, saved || source, maps, 0);
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
      if (Array.isArray(data)) return data;
    } catch {}
  }
  return [];
}

const FALLBACK_MAPS = [
  { id: "sector-01", name: "구역 1", background: "linear-gradient(180deg, #dff4ff, #cceaff)", neighbors: { right: "sector-02" } },
  { id: "sector-02", name: "구역 2", background: "linear-gradient(180deg, #eaf7ff, #d8efff)", neighbors: { left: "sector-01" } },
];

function CharacterSprite({ character, quote, moving, onClick }) {
  const spriteImage = getSpriteImage(character);
  if (!spriteImage) return null;
  const corrosion = clamp(Number(character?.corrosion || 0), 0, 100);
  const tintOpacity = Math.max(0, Math.min(0.9, corrosion / 100));
  const maskImage = `url(${spriteImage})`;
  return (
    <div onClick={onClick} style={{ position: "absolute", left: `${character.x}%`, top: `${character.y}%`, transform: "translate(-50%, -50%)", width: "148px", height: "204px", textAlign: "center", cursor: "pointer", zIndex: 4, pointerEvents: "auto" }}>
      {quote?.text ? (
        <div style={{ position: "absolute", left: "50%", bottom: "164px", transform: "translateX(-50%)", display: "inline-block", maxWidth: "220px", padding: "11px 15px", borderRadius: "20px", background: "linear-gradient(180deg, rgba(246,251,255,0.98) 0%, rgba(225,241,255,0.98) 100%)", color: "#14344d", border: "1px solid rgba(91,170,224,0.30)", boxShadow: "0 10px 24px rgba(37,99,235,0.12)", fontSize: "13px", lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "keep-all", backdropFilter: "blur(8px)" }}>
          {quote.text}
          <div style={{ position: "absolute", left: "50%", bottom: "-7px", width: "14px", height: "14px", transform: "translateX(-50%) rotate(45deg)", background: "linear-gradient(180deg, rgba(225,241,255,0.98) 0%, rgba(206,233,255,0.98) 100%)", borderRight: "1px solid rgba(91,170,224,0.22)", borderBottom: "1px solid rgba(91,170,224,0.22)" }} />
        </div>
      ) : null}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 138, fontSize: "16px", fontWeight: 900, color: "#ffffff", textShadow: "0 2px 6px rgba(0,0,0,0.48)" }}>{character.name}</div>
      <div style={{ position: "absolute", left: "50%", bottom: 0, width: "132px", height: "132px", margin: "0 auto", transform: `translateX(-50%) ${moving ? `rotate(${character.dx >= 0 ? 0.32 : -0.32}deg)` : "rotate(0deg)"}`, transition: "transform 0.42s ease-out", willChange: "transform", filter: "drop-shadow(0 12px 18px rgba(0,0,0,0.22))" }}>
        <img
          src={spriteImage}
          alt=""
          loading="eager"
          decoding="async"
          style={{ width: "100%", height: "100%", objectFit: "contain", position: "absolute", inset: 0, zIndex: 1 }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            opacity: Math.max(0, tintOpacity * 0.82),
            pointerEvents: "none",
            background: "linear-gradient(0deg, rgba(239,68,68,0.96) 0%, rgba(239,68,68,0.76) 22%, rgba(239,68,68,0.42) 42%, rgba(239,68,68,0.14) 60%, rgba(239,68,68,0) 78%)",
            WebkitMaskImage: maskImage,
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            WebkitMaskSize: "contain",
            maskImage: maskImage,
            maskRepeat: "no-repeat",
            maskPosition: "center",
            maskSize: "contain",
            mixBlendMode: "multiply",
          }}
        />
      </div>
    </div>
  );
}

export default function SDPage({ activeCharacter, design, theme }) {
  const [characters, setCharacters] = useState(() => readCachedSdCharacters());
  const [activeMapId, setActiveMapId] = useState(() => readLastViewedMapId());
  const [quotes, setQuotes] = useState({});
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [remoteMapRoot, setRemoteMapRoot] = useState(() => readCachedMapConfig() || design?.siteContent?.maps || null);
  const lastFrameRef = useRef(0);
  const saveTickRef = useRef(0);
  const charactersRef = useRef(characters);
  const activeMapRef = useRef(activeMapId);
  const quotesRef = useRef(quotes);
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

  useEffect(() => {
    charactersRef.current = characters;
  }, [characters]);

  useEffect(() => {
    activeMapRef.current = activeMapId;
  }, [activeMapId]);

  useEffect(() => {
    quotesRef.current = quotes;
  }, [quotes]);

  useEffect(() => {
    if (design?.siteContent?.maps && Object.keys(design.siteContent.maps || {}).length > 0) {
      setRemoteMapRoot((prev) => (prev && Object.keys(prev || {}).length > 0 ? prev : design.siteContent.maps));
    }
  }, [design?.siteContent?.maps]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    fetch(buildApiUrl(`/designMapsPublic?t=${Date.now()}`), { cache: "no-store", signal: controller.signal })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled || !data || typeof data !== "object") return;
        setRemoteMapRoot(data);
        writeCachedMapConfig(data);
      })
      .catch(() => {
        if (cancelled) return;
        const cached = readCachedMapConfig();
        if (cached && typeof cached === "object") setRemoteMapRoot(cached);
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      try { controller.abort(); } catch {}
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
      const next = stabilizeCharacterRows(mergeCharacterStates([], finalRows, maps), activeCharacter, maps);
      setCharacters((prev) => (next.length > 0 || prev.length === 0 ? next : prev));
      if (next.length > 0) writeCachedSdCharacters(next);
      setActiveMapId((prev) => {
        const stored = prev || readLastViewedMapId();
        if (stored && maps.some((map) => String(map.id) === String(stored))) return stored;
        const sourceRows = next.length > 0 ? next : mergeCharacterStates([], fallbackRows, maps);
        const mine = sourceRows.find((v) => String(v.id) === String(activeCharacter?.id));
        return mine?.currentMap || maps[0]?.id || "";
      });
    };
    loadCharacters().catch(() => {
      setCharacters((prev) => {
        if (Array.isArray(prev) && prev.length > 0) return prev;
        const cached = stabilizeCharacterRows(mergeCharacterStates([], readCachedSdCharacters(), maps), activeCharacter, maps);
        return cached;
      });
      setActiveMapId((prev) => {
        const stored = prev || readLastViewedMapId();
        if (stored && maps.some((map) => String(map.id) === String(stored))) return stored;
        const cached = stabilizeCharacterRows(mergeCharacterStates([], readCachedSdCharacters(), maps), activeCharacter, maps);
        const mine = cached.find((v) => String(v.id) === String(activeCharacter?.id));
        return mine?.currentMap || maps[0]?.id || "";
      });
    });
    return () => { cancelled = true; };
  }, [activeCharacter?.id, maps]);

  useEffect(() => {
    if (!characters.length) return;
    writeCachedSdCharacters(stabilizeCharacterRows(characters, activeCharacter, maps));
    if (Date.now() - saveTickRef.current < 700) return;
    saveTickRef.current = Date.now();
    persistCharacterPositions(characters);
  }, [characters]);

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
      const dt = Math.min(56, Math.max(16, Number.isFinite(rawDt) ? rawDt : 16));
      lastFrameRef.current = timestamp;

      if (document.visibilityState === "visible") {
        setCharacters((prev) => stabilizeCharacterRows(dedupeCharacters(prev).map((character, _, arr) => {
          let currentMap = character.currentMap || maps[0]?.id || "";
          let x = Number(character.x || 0);
          let y = Number(character.y || 0);
          let dx = Number(character.dx || 0);
          let dy = Number(character.dy || 0);
          let waitMs = Number(character.waitMs || 0);
          let moveCooldownMs = Number(character.moveCooldownMs || 0);

          if (waitMs > 0) {
            waitMs = Math.max(0, waitMs - dt);
            return { ...character, waitMs, dx: dx * 0.92, dy: dy * 0.92 };
          }

          moveCooldownMs -= dt;
          if (moveCooldownMs <= 0) {
            const mapDef = maps.find((map) => String(map.id) === String(currentMap)) || null;
            const linkedDirs = Object.entries(mapDef?.neighbors || {}).filter(([dir, nextId]) => nextId && maps.some((map) => String(map.id) === String(nextId)));
            const wantsPause = Math.random() < 0.34;
            const wantsMapChange = linkedDirs.length > 0 && Math.random() < 0.12;
            if (wantsPause) {
              waitMs = rand(3400, 6200);
              dx *= 0.12;
              dy *= 0.12;
              moveCooldownMs = rand(7800, 12400);
            } else if (wantsMapChange) {
              const [dir] = linkedDirs[Math.floor(Math.random() * linkedDirs.length)];
              if (dir === "left") {
                dx = -rand(0.78, 1.16);
                dy = rand(-0.34, 0.34);
              } else if (dir === "right") {
                dx = rand(0.78, 1.16);
                dy = rand(-0.34, 0.34);
              } else if (dir === "up") {
                dx = rand(-0.22, 0.22);
                dy = -rand(0.74, 1.08);
              } else {
                dx = rand(-0.22, 0.22);
                dy = rand(0.74, 1.08);
              }
              moveCooldownMs = rand(7600, 12200);
            } else {
              dx = rand(-0.72, 0.72);
              dy = rand(-0.42, 0.42);
              if (Math.abs(dx) < 0.22) dx = dx >= 0 ? 0.22 : -0.22;
              if (Math.abs(dy) < 0.08) dy = dy >= 0 ? 0.08 : -0.08;
              moveCooldownMs = rand(8200, 13800);
            }
          }

          const speedFactor = dt / 1000;
          let nx = x + dx * speedFactor;
          let ny = y + dy * speedFactor;

          if (nx <= 4) {
            const nextMap = getNextMap(currentMap, "left");
            if (nextMap && nextMap !== currentMap) {
              currentMap = nextMap;
              nx = 91.2;
              ny = clamp(ny, 10, 76);
              dx = -Math.max(0.18, Math.abs(dx || rand(0.22, 0.38)));
              dy = clamp(dy || rand(-0.14, 0.14), -0.24, 0.24);
              moveCooldownMs = rand(7600, 12200);
            } else {
              dx *= -1;
              nx = clamp(x + dx * speedFactor, 4, 92);
            }
          } else if (nx >= 92) {
            const nextMap = getNextMap(currentMap, "right");
            if (nextMap && nextMap !== currentMap) {
              currentMap = nextMap;
              nx = 8.8;
              ny = clamp(ny, 10, 76);
              dx = Math.max(0.18, Math.abs(dx || rand(0.22, 0.38)));
              dy = clamp(dy || rand(-0.14, 0.14), -0.24, 0.24);
              moveCooldownMs = rand(7600, 12200);
            } else {
              dx *= -1;
              nx = clamp(x + dx * speedFactor, 4, 92);
            }
          }
          if (ny <= 8) {
            const nextMap = getNextMap(currentMap, "up");
            if (nextMap && nextMap !== currentMap) {
              currentMap = nextMap;
              nx = clamp(nx, 8, 92);
              ny = 77.2;
              dx = clamp(dx || rand(-0.14, 0.14), -0.24, 0.24);
              dy = -Math.max(0.18, Math.abs(dy || rand(0.22, 0.38)));
              moveCooldownMs = rand(7600, 12200);
            } else {
              dy *= -1;
              ny = clamp(y + dy * speedFactor, 8, 78);
            }
          } else if (ny >= 78) {
            const nextMap = getNextMap(currentMap, "down");
            if (nextMap && nextMap !== currentMap) {
              currentMap = nextMap;
              nx = clamp(nx, 8, 92);
              ny = 10.8;
              dx = clamp(dx || rand(-0.14, 0.14), -0.24, 0.24);
              dy = Math.max(0.18, Math.abs(dy || rand(0.22, 0.38)));
              moveCooldownMs = rand(7600, 12200);
            } else {
              dy *= -1;
              ny = clamp(y + dy * speedFactor, 8, 78);
            }
          }

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

          return { ...character, x: clamp(nx, 4, 92), y: clamp(ny, 8, 78), dx, dy, waitMs, moveCooldownMs, currentMap };
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
      const visible = dedupeCharacters(charactersRef.current || [])
        .filter((character) => String(character?.currentMap || maps[0]?.id || "") === String(activeMapRef.current || ""));

      setQuotes((prev) => {
        const visibleKeySet = new Set(visible.map((character) => getCharacterKey(character)).filter(Boolean));
        const next = {};
        Object.entries(prev || {}).forEach(([id, payload]) => {
          if (payload?.expiresAt > now && visibleKeySet.has(id)) next[id] = payload;
        });

        const visibleKeys = visible.map((character) => getCharacterKey(character)).filter(Boolean);
        const existingVisibleKeys = visibleKeys.filter((key) => next[key]);
        if (existingVisibleKeys.length > 0 && Math.random() < 0.08) {
          const removeKey = existingVisibleKeys[Math.floor(Math.random() * existingVisibleKeys.length)];
          delete next[removeKey];
        }

        const maxVisible = Math.min(2, Math.max(1, visible.length));
        const visibleQuoteCount = visibleKeys.filter((key) => next[key]).length;
        const candidates = visible.filter((character) => getCharacterQuotePool(character).length > 0 && !next[getCharacterKey(character)]);

        if (candidates.length > 0 && visibleQuoteCount < maxVisible && (visibleQuoteCount === 0 ? Math.random() < 0.28 : Math.random() < 0.12)) {
          const picked = candidates[Math.floor(Math.random() * candidates.length)];
          const pool = getCharacterQuotePool(picked);
          const text = pool[Math.floor(Math.random() * pool.length)];
          const hold = Math.max(5200, Math.min(10800, 5600 + String(text || "").length * 96));
          next[getCharacterKey(picked)] = { text, expiresAt: now + hold };
        }
        return next;
      });
    }, 4300);
    return () => clearInterval(quoteTimer);
  }, [activeCharacter, maps]);

  useEffect(() => {
    const handleCharacterUpdated = async (event) => {
      const updated = event?.detail?.character;
      if (updated?.id || updated?.name) {
        const updatedKey = getCharacterKey(updated);
        setCharacters((prev) => stabilizeCharacterRows(dedupeCharacters(prev).map((character, index) => getCharacterKey(character) === updatedKey ? buildCharacterState({ ...character, ...updated }, character, maps, index) : character), activeCharacter, maps));
        return;
      }
      try {
        const incoming = await fetchCharactersWithFallback();
        setCharacters((prev) => {
          const fallbackRows = prev.length > 0 ? prev : mergeCharacterStates([], readCachedSdCharacters(), maps);
          const sourceRows = incoming.length > 0 || fallbackRows.length === 0 ? incoming : fallbackRows;
          const next = stabilizeCharacterRows(mergeCharacterStates(prev, sourceRows, maps), activeCharacter, maps);
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
  const mapCharacters = useMemo(() => {
    const targetMapId = String(currentMap?.id || "");
    const seen = new Set();
    let activeShown = false;
    return characters.filter((character) => {
      if (String(character?.currentMap || "") !== targetMapId) return false;
      const key = getCharacterKey(character);
      if (!key || seen.has(key)) return false;
      if (activeCharacter && matchesActiveCharacter(character, activeCharacter)) {
        if (activeShown) return false;
        activeShown = true;
      }
      seen.add(key);
      return true;
    });
  }, [characters, currentMap, activeCharacter]);
  const availableDirs = currentMap?.neighbors || {};
  const moveByArrow = (dir) => {
    const nextId = getNextMap(activeMapId, dir);
    if (!nextId || nextId === activeMapId) return;
    const spawn = spawnFromEdge(dir === "left" ? "right" : dir === "right" ? "left" : dir === "up" ? "down" : "up");
    setActiveMapId(nextId);
    const activeKey = getCharacterKey(activeCharacter);
    setCharacters((prev) => stabilizeCharacterRows(dedupeCharacters(prev).map((character) => getCharacterKey(character) === activeKey ? { ...character, currentMap: nextId, x: spawn.x, y: spawn.y, dx: spawn.dx * 0.72, dy: spawn.dy * 0.72, waitMs: 1700, moveCooldownMs: rand(4600, 7600) } : character), activeCharacter, maps));
    if (activeCharacter?.id) {
      fetch(buildApiUrl("/updateCharacter"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ charId: activeCharacter.id, currentMap: nextId, x: spawn.x, y: spawn.y }) }).catch(() => {});
      window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { character: { ...activeCharacter, currentMap: nextId, x: spawn.x, y: spawn.y } } }));
    }
  };

  return (
    <DesignPageFrame design={design} pageKey="sd" handlers={{}} theme={theme} minHeight="calc(100vh - 94px)" contentStyle={{ padding: 0 }}>
      {selectedCharacter ? <SDInfoModal character={selectedCharacter} onClose={() => setSelectedCharacter(null)} theme={theme} /> : null}
      <div style={{ color: theme?.textMain || "#13324b", height: "calc(100vh - 94px)", display: "grid" }}>
        <div style={{ position: "relative", height: "100%", overflow: "hidden", background: currentMap?.background || "#dff4ff", boxShadow: theme?.shadow || "0 24px 60px rgba(73,132,170,0.16)" }}>
          {currentMap?.backgroundImage ? (
            <img
              src={currentMap.backgroundImage}
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
            const moving = Math.abs(Number(character.dx || 0)) > 1.1 || Math.abs(Number(character.dy || 0)) > 1.1;
            return <CharacterSprite key={getCharacterKey(character)} character={character} quote={q} moving={moving} onClick={() => setSelectedCharacter(character)} />;
          })}
        </div>
      </div>
    </DesignPageFrame>
  );
}
