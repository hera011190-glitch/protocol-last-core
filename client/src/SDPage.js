import { useEffect, useMemo, useRef, useState } from "react";
import DesignPageFrame from "./DesignPageFrame";
import { buildApiUrl } from "./api";

function rand(min, max) { return Math.random() * (max - min) + min; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
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
  if (edge === "left") return { x: 8, y: rand(18, 76), dx: rand(4.8, 7.6), dy: rand(-2.1, 2.1) };
  if (edge === "right") return { x: 92, y: rand(18, 76), dx: rand(-7.6, -4.8), dy: rand(-2.1, 2.1) };
  if (edge === "up") return { x: rand(10, 88), y: 10, dx: rand(-2.2, 2.2), dy: rand(4.6, 7.1) };
  return { x: rand(10, 88), y: 78, dx: rand(-2.2, 2.2), dy: rand(-7.1, -4.6) };
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
    moveCooldownMs: typeof savedState?.moveCooldownMs === "number" ? savedState.moveCooldownMs : rand(4200, 7600),
    currentMap:
      [savedState?.currentMap, character.currentMap].find((candidate) => maps.some((map) => String(map.id) === String(candidate))) ||
      getStableDefaultMapId(character, maps, fallbackIndex) ||
      maps[0]?.id ||
      "",
  };
}

function getCharacterKey(character) {
  const ownerNameKey = `${String(character?.ownerId || "").trim()}:${String(character?.name || "").trim()}`;
  if (ownerNameKey !== ':') return ownerNameKey;
  return String(character?.id || character?.name || "").trim();
}

function mergeCharacterStates(prevList, freshList, maps) {
  const prevById = Object.fromEntries(dedupeCharacters(prevList || []).map((character) => [getCharacterKey(character), character]));
  const saved = readSavedPositions();
  return dedupeCharacters(freshList || []).map((character, index) => {
    const key = getCharacterKey(character);
    const prev = prevById[key];
    return buildCharacterState(character, prev || saved[key], maps, index);
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
    const key = getCharacterKey(character);
    if (!key) return;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, character);
      return;
    }
    merged.set(key, {
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
    });
  });
  return Array.from(merged.values());
}

function getSpriteImage(character) {
  return character?.spriteImage || character?.investigationImage || character?.image || character?.mainImage || "";
}

async function fetchCharactersWithFallback() {
  const now = Date.now();
  const urls = [
    buildApiUrl(`/characters-public`),
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
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
  const tintOpacity = Math.max(0, Math.min(0.82, corrosion / 100));
  return (
    <div onClick={onClick} style={{ position: "absolute", left: `${character.x}%`, top: `${character.y}%`, transform: "translate(-50%, -50%)", width: "148px", textAlign: "center", cursor: "pointer", zIndex: 4 }}>
      {quote?.text ? (
        <div style={{ marginBottom: "10px", display: "inline-block", maxWidth: "212px", padding: "10px 14px", borderRadius: "18px", background: "rgba(255,255,255,0.98)", color: "#16324a", boxShadow: "0 8px 20px rgba(0,0,0,0.16)", position: "relative", fontSize: "13px", lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "keep-all" }}>
          {quote.text}
          <div style={{ position: "absolute", left: "50%", bottom: "-6px", width: "12px", height: "12px", transform: "translateX(-50%) rotate(45deg)", background: "rgba(255,255,255,0.98)" }} />
        </div>
      ) : null}
      <div style={{ fontSize: "16px", fontWeight: 900, marginBottom: "6px", color: "#ffffff", textShadow: "0 2px 6px rgba(0,0,0,0.48)" }}>{character.name}</div>
      <div style={{ width: "132px", height: "132px", margin: "0 auto", transform: moving ? `translate3d(0,0,0) rotate(${character.dx >= 0 ? 1.2 : -1.2}deg)` : "translate3d(0,0,0) rotate(0deg)", transition: "transform 0.22s ease-out", willChange: "transform", position: "relative", filter: "drop-shadow(0 12px 18px rgba(0,0,0,0.22))" }}>
        {spriteImage ? (
          <>
            <img
              src={spriteImage}
              alt=""
              loading="eager"
              decoding="async"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                position: "absolute",
                inset: 0,
                zIndex: 1,
                filter: `saturate(${1 + tintOpacity * 0.45}) hue-rotate(${-corrosion * 0.35}deg)`,
              }}
            />
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 2,
                opacity: Math.max(0, tintOpacity * 0.35),
                pointerEvents: "none",
                borderRadius: "50%",
                background: "radial-gradient(circle at 50% 72%, rgba(255,78,78,0.38), rgba(120,0,0,0.18) 55%, rgba(120,0,0,0) 72%)",
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function SDPage({ activeCharacter, design, theme }) {
  const [characters, setCharacters] = useState(() => readCachedSdCharacters());
  const [activeMapId, setActiveMapId] = useState(() => readLastViewedMapId());
  const [quotes, setQuotes] = useState({});
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const lastFrameRef = useRef(0);
  const saveTickRef = useRef(0);
  const mapRoot = design?.siteContent?.maps || {};
  const collections = Array.isArray(mapRoot.collections) ? mapRoot.collections : [];
  const activeCollectionId = mapRoot.activeCollectionId || collections[0]?.id || "";
  const maps = useMemo(() => {
    if (collections.length > 0) {
      const found = collections.find((v) => String(v.id) === String(activeCollectionId)) || collections[0];
      return Array.isArray(found?.presets) ? found.presets : [];
    }
    return Array.isArray(mapRoot.presets) && mapRoot.presets.length > 0 ? mapRoot.presets : FALLBACK_MAPS;
  }, [mapRoot, collections, activeCollectionId]);

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
      const next = mergeCharacterStates([], finalRows, maps);
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
        const cached = mergeCharacterStates([], readCachedSdCharacters(), maps);
        return cached;
      });
      setActiveMapId((prev) => {
        const stored = prev || readLastViewedMapId();
        if (stored && maps.some((map) => String(map.id) === String(stored))) return stored;
        const cached = mergeCharacterStates([], readCachedSdCharacters(), maps);
        const mine = cached.find((v) => String(v.id) === String(activeCharacter?.id));
        return mine?.currentMap || maps[0]?.id || "";
      });
    });
    return () => { cancelled = true; };
  }, [activeCharacter?.id, maps]);

  useEffect(() => {
    if (!characters.length) return;
    if (Date.now() - saveTickRef.current < 1200) return;
    saveTickRef.current = Date.now();
    const payload = Object.fromEntries(dedupeCharacters(characters).map((character) => [getCharacterKey(character), { x: character.x, y: character.y, dx: character.dx, dy: character.dy, waitMs: character.waitMs, moveCooldownMs: character.moveCooldownMs, currentMap: character.currentMap }]));
    try {
      localStorage.setItem("plc-sd-positions", JSON.stringify(payload));
    } catch {}
  }, [characters]);

  useEffect(() => {
    if (!maps.length) return undefined;

    let rafId = 0;
    const step = (timestamp) => {
      if (!lastFrameRef.current) lastFrameRef.current = timestamp;
      const rawDt = timestamp - lastFrameRef.current;
      const dt = Math.min(72, Math.max(16, Number.isFinite(rawDt) ? rawDt : 16));
      if (dt < 24) {
        rafId = window.requestAnimationFrame(step);
        return;
      }
      lastFrameRef.current = timestamp;

      if (document.visibilityState === "visible") {
        setCharacters((prev) => dedupeCharacters(prev).map((character, _, arr) => {
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
            if (Math.random() < 0.46) {
              waitMs = rand(2200, 4200);
              dx *= 0.34;
              dy *= 0.34;
              moveCooldownMs = rand(4200, 7200);
            } else {
              dx = rand(-2.25, 2.25);
              dy = rand(-1.55, 1.55);
              if (Math.abs(dx) < 0.55) dx = dx >= 0 ? 0.55 : -0.55;
              if (Math.abs(dy) < 0.22) dy = dy >= 0 ? 0.22 : -0.22;
              moveCooldownMs = rand(5200, 8600);
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
              dx = -Math.max(0.55, Math.abs(dx || rand(0.8, 1.9)));
              dy = clamp(dy || rand(-0.9, 0.9), -1.6, 1.6);
              moveCooldownMs = rand(4200, 7200);
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
              dx = Math.max(0.55, Math.abs(dx || rand(0.8, 1.9)));
              dy = clamp(dy || rand(-0.9, 0.9), -1.6, 1.6);
              moveCooldownMs = rand(4200, 7200);
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
              dx = clamp(dx || rand(-1.0, 1.0), -2.2, 2.2);
              dy = -Math.max(0.55, Math.abs(dy || rand(0.8, 1.8)));
              moveCooldownMs = rand(4200, 7200);
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
              dx = clamp(dx || rand(-1.0, 1.0), -2.2, 2.2);
              dy = Math.max(0.55, Math.abs(dy || rand(0.8, 1.8)));
              moveCooldownMs = rand(4200, 7200);
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
        }));
      }

      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [maps]);

  useEffect(() => {
    const quoteTimer = setInterval(() => {
      setQuotes((prev) => {
        const next = {};
        const now = Date.now();
        Object.entries(prev).forEach(([id, payload]) => {
          if (payload?.expiresAt > now) next[id] = payload;
        });
        const visible = characters.filter((v) => (v.currentMap || maps[0]?.id) === activeMapId);
        const candidates = visible.filter((character) => {
          const pool = Array.isArray(character.sdQuotes) ? character.sdQuotes.filter(Boolean) : [];
          return pool.length > 0 && !next[getCharacterKey(character)];
        });
        if (candidates.length > 0) {
          const picked = candidates[Math.floor(Math.random() * candidates.length)];
          const pool = Array.isArray(picked.sdQuotes) ? picked.sdQuotes.filter(Boolean) : [];
          const text = pool[Math.floor(Math.random() * pool.length)];
          const hold = Math.max(5000, Math.min(9000, 4200 + String(text || "").length * 85));
          next[getCharacterKey(picked)] = { text, expiresAt: now + hold };
        }
        return next;
      });
    }, 5000);
    return () => clearInterval(quoteTimer);
  }, [characters, activeMapId, maps]);

  useEffect(() => {
    const handleCharacterUpdated = async (event) => {
      const updated = event?.detail?.character;
      if (updated?.id || updated?.name) {
        const updatedKey = getCharacterKey(updated);
        setCharacters((prev) => dedupeCharacters(prev).map((character, index) => getCharacterKey(character) === updatedKey ? buildCharacterState({ ...character, ...updated }, character, maps, index) : character));
        return;
      }
      try {
        const incoming = await fetchCharactersWithFallback();
        setCharacters((prev) => {
          const fallbackRows = prev.length > 0 ? prev : mergeCharacterStates([], readCachedSdCharacters(), maps);
          const sourceRows = incoming.length > 0 || fallbackRows.length === 0 ? incoming : fallbackRows;
          const next = mergeCharacterStates(prev, sourceRows, maps);
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
    setCharacters((prev) => dedupeCharacters(prev).map((character, index) => {
      const currentMap = maps.some((map) => String(map.id) === String(character.currentMap)) ? character.currentMap : maps[index % maps.length]?.id || maps[0]?.id || "";
      return currentMap === character.currentMap ? character : { ...character, currentMap };
    }));
  }, [maps, activeMapId]);

  useEffect(() => {
    if (!activeMapId) return;
    writeLastViewedMapId(activeMapId);
  }, [activeMapId]);

  const currentMap = useMemo(() => maps.find((map) => map.id === activeMapId) || maps[0] || null, [maps, activeMapId]);
  const mapCharacters = useMemo(() => {
    const targetMapId = String(currentMap?.id || "");
    const seen = new Set();
    return characters.filter((character) => {
      if (String(character?.currentMap || "") !== targetMapId) return false;
      const key = getCharacterKey(character);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [characters, currentMap]);
  const availableDirs = currentMap?.neighbors || {};
  const moveByArrow = (dir) => {
    const nextId = getNextMap(activeMapId, dir);
    if (!nextId || nextId === activeMapId) return;
    const spawn = spawnFromEdge(dir === "left" ? "right" : dir === "right" ? "left" : dir === "up" ? "down" : "up");
    setActiveMapId(nextId);
    const activeKey = getCharacterKey(activeCharacter);
    setCharacters((prev) => dedupeCharacters(prev).map((character) => getCharacterKey(character) === activeKey ? { ...character, currentMap: nextId, x: spawn.x, y: spawn.y, dx: spawn.dx * 0.82, dy: spawn.dy * 0.82, waitMs: 1400, moveCooldownMs: rand(3600, 6200) } : character));
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
