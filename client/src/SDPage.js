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
  if (edge === "left") return { x: 8, y: rand(18, 76), dx: rand(3.8, 7.4), dy: rand(-2.2, 2.2) };
  if (edge === "right") return { x: 92, y: rand(18, 76), dx: rand(-7.4, -3.8), dy: rand(-2.2, 2.2) };
  if (edge === "up") return { x: rand(10, 88), y: 10, dx: rand(-2.2, 2.2), dy: rand(3.8, 6.8) };
  return { x: rand(10, 88), y: 78, dx: rand(-2.2, 2.2), dy: rand(-6.8, -3.8) };
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

function mergeCharacterStates(prevList, freshList, maps) {
  const prevById = Object.fromEntries((prevList || []).map((character) => [String(character.id), character]));
  return (freshList || []).map((character, index) => {
    const prev = prevById[String(character.id)];
    return buildCharacterState(character, prev || readSavedPositions()[character.id], maps, index);
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

function getSpriteImage(character) {
  return character?.spriteImage || character?.investigationImage || character?.image || character?.mainImage || "";
}

function preloadSprite(src) {
  const url = String(src || "").trim();
  if (!url || typeof window === "undefined") return;
  const img = new Image();
  img.decoding = "async";
  img.src = url;
}

async function fetchCharactersWithFallback() {
  const now = Date.now();
  const urls = [
    buildApiUrl(`/characters-lite?t=${now}`),
    buildApiUrl(`/characters?t=${now}`),
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
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
      <div style={{ width: "132px", height: "132px", margin: "0 auto", transform: moving ? `translate3d(0,0,0) rotate(${character.dx >= 0 ? 1.6 : -1.6}deg)` : "translate3d(0,0,0) rotate(0deg)", transition: "transform 0.16s linear", willChange: "transform", position: "relative", filter: "drop-shadow(0 12px 18px rgba(0,0,0,0.22))" }}>
        {spriteImage ? (
          <>
            <img src={spriteImage} alt="" loading="eager" decoding="sync" fetchPriority="high" style={{ width: "100%", height: "100%", objectFit: "contain", position: "absolute", inset: 0, zIndex: 1, filter: `drop-shadow(0 12px 18px rgba(0,0,0,0.22)) saturate(${1 + corrosion / 170})` }} />
            {tintOpacity > 0 ? (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: "12% 18% 6% 18%",
                  zIndex: 0,
                  opacity: Math.min(0.42, tintOpacity * 0.72),
                  pointerEvents: "none",
                  borderRadius: "50%",
                  background: "radial-gradient(circle at 50% 72%, rgba(255,84,84,0.72), rgba(190,0,0,0.18) 55%, rgba(190,0,0,0) 100%)",
                }}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function SDPage({ activeCharacter, design, theme, characters: sharedCharacters = [] }) {
  const [characters, setCharacters] = useState(() => (Array.isArray(sharedCharacters) && sharedCharacters.length > 0 ? sharedCharacters : readCachedSdCharacters()));
  const [activeMapId, setActiveMapId] = useState("");
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

    const applyRows = (rows) => {
      const next = mergeCharacterStates([], rows, maps);
      setCharacters((prev) => (next.length > 0 || prev.length === 0 ? next : prev));
      if (next.length > 0) {
        writeCachedSdCharacters(next);
        next.slice(0, 20).forEach((row) => preloadSprite(getSpriteImage(row)));
      }
      if (!activeMapId) {
        const sourceRows = next.length > 0 ? next : mergeCharacterStates([], readCachedSdCharacters(), maps);
        const mine = sourceRows.find((v) => String(v.id) === String(activeCharacter?.id));
        setActiveMapId((prev) => prev || mine?.currentMap || maps[0]?.id || "");
      }
    };

    if (Array.isArray(sharedCharacters) && sharedCharacters.length > 0) {
      applyRows(sharedCharacters);
      return () => { cancelled = true; };
    }

    const loadCharacters = async () => {
      const incoming = await fetchCharactersWithFallback();
      if (cancelled) return;
      const fallbackRows = readCachedSdCharacters();
      const finalRows = incoming.length > 0 || fallbackRows.length === 0 ? incoming : fallbackRows;
      applyRows(finalRows);
    };
    loadCharacters().catch(() => {
      if (cancelled) return;
      const cached = mergeCharacterStates([], readCachedSdCharacters(), maps);
      setCharacters((prev) => (Array.isArray(prev) && prev.length > 0 ? prev : cached));
      if (!activeMapId) {
        const mine = cached.find((v) => String(v.id) === String(activeCharacter?.id));
        setActiveMapId((prev) => prev || mine?.currentMap || maps[0]?.id || "");
      }
    });
    return () => { cancelled = true; };
  }, [activeCharacter?.id, maps, sharedCharacters]);

  useEffect(() => {
    if (!characters.length) return;
    if (Date.now() - saveTickRef.current < 1200) return;
    saveTickRef.current = Date.now();
    const payload = Object.fromEntries(characters.map((character) => [character.id, { x: character.x, y: character.y, dx: character.dx, dy: character.dy, waitMs: character.waitMs, moveCooldownMs: character.moveCooldownMs, currentMap: character.currentMap }]));
    try {
      localStorage.setItem("plc-sd-positions", JSON.stringify(payload));
    } catch {}
  }, [characters]);

  useEffect(() => {
    if (!maps.length) return undefined;
    const step = () => {
      if (document.visibilityState !== "visible") {
        lastFrameRef.current = Date.now();
        return;
      }
      const now = Date.now();
      if (!lastFrameRef.current) lastFrameRef.current = now;
      const dt = Math.min(95, Math.max(55, now - lastFrameRef.current || 90));
      lastFrameRef.current = now;
      setCharacters((prev) => prev.map((character, _, arr) => {
        let currentMap = character.currentMap || maps[0]?.id || "";
        let x = Number(character.x || 0);
        let y = Number(character.y || 0);
        let dx = Number(character.dx || 0);
        let dy = Number(character.dy || 0);
        let waitMs = Number(character.waitMs || 0);
        let moveCooldownMs = Number(character.moveCooldownMs || 0);

        if (waitMs > 0) {
          waitMs = Math.max(0, waitMs - dt);
          return { ...character, waitMs, dx: dx * 0.9, dy: dy * 0.9 };
        }

        moveCooldownMs -= dt;
        if (moveCooldownMs <= 0) {
          if (Math.random() < 0.68) {
            waitMs = rand(2400, 5200);
            dx *= 0.25;
            dy *= 0.25;
            moveCooldownMs = rand(4200, 7600);
          } else {
            dx = rand(-3.1, 3.1);
            dy = rand(-2.1, 2.1);
            if (Math.abs(dx) < 0.9) dx = dx >= 0 ? 0.9 : -0.9;
            if (Math.abs(dy) < 0.3) dy = dy >= 0 ? 0.3 : -0.3;
            moveCooldownMs = rand(4600, 8400);
          }
        }

        const speedFactor = dt / 1000;
        let nx = x + dx * speedFactor;
        let ny = y + dy * speedFactor;
        let crossed = null;
        if (nx <= 4) crossed = "left";
        else if (nx >= 92) crossed = "right";
        else if (ny <= 8) crossed = "up";
        else if (ny >= 78) crossed = "down";

        if (crossed) {
          const nextMapId = getNextMap(currentMap, crossed);
          if (nextMapId !== currentMap) {
            const spawn = spawnFromEdge(crossed === "left" ? "right" : crossed === "right" ? "left" : crossed === "up" ? "down" : "up");
            return { ...character, currentMap: nextMapId, x: spawn.x, y: spawn.y, dx: spawn.dx, dy: spawn.dy, waitMs: rand(1600, 3200), moveCooldownMs: rand(4200, 7600) };
          }
          dx *= -1;
          dy *= -1;
          nx = x + dx * speedFactor;
          ny = y + dy * speedFactor;
        }

        const nearby = arr.filter((other) => other.id !== character.id && (other.currentMap || maps[0]?.id) === currentMap);
        nearby.forEach((other) => {
          const ox = Number(other.x || 0);
          const oy = Number(other.y || 0);
          const distance = Math.hypot(nx - ox, ny - oy);
          if (distance < 8.8) {
            const push = (8.8 - distance) * 0.16;
            nx += nx >= ox ? push : -push;
            ny += ny >= oy ? push * 0.7 : -push * 0.7;
          }
        });

        return { ...character, x: clamp(nx, 4, 92), y: clamp(ny, 8, 78), dx, dy, waitMs, moveCooldownMs };
      }));

    };
    const timer = window.setInterval(step, 90);
    return () => window.clearInterval(timer);
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
          return pool.length > 0 && !next[character.id];
        });
        if (candidates.length > 0) {
          const picked = candidates[Math.floor(Math.random() * candidates.length)];
          const pool = Array.isArray(picked.sdQuotes) ? picked.sdQuotes.filter(Boolean) : [];
          const text = pool[Math.floor(Math.random() * pool.length)];
          const hold = Math.max(3400, Math.min(9800, 2600 + String(text || "").length * 120));
          next[picked.id] = { text, expiresAt: now + hold };
        }
        return next;
      });
    }, 5000);
    return () => clearInterval(quoteTimer);
  }, [characters, activeMapId, maps]);

  useEffect(() => {
    const handleCharacterUpdated = async (event) => {
      const updated = event?.detail?.character;
      if (updated?.id) {
        setCharacters((prev) => prev.map((character, index) => String(character.id) === String(updated.id) ? buildCharacterState({ ...character, ...updated }, character, maps, index) : character));
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
      setActiveMapId(maps[0].id);
    }
    setCharacters((prev) => prev.map((character, index) => {
      const currentMap = maps.some((map) => String(map.id) === String(character.currentMap)) ? character.currentMap : maps[index % maps.length]?.id || maps[0]?.id || "";
      return currentMap === character.currentMap ? character : { ...character, currentMap };
    }));
  }, [maps, activeMapId]);

  const currentMap = useMemo(() => maps.find((map) => map.id === activeMapId) || maps[0] || null, [maps, activeMapId]);
  const mapCharacters = useMemo(() => characters.filter((v) => (v.currentMap || maps[0]?.id) === (currentMap?.id || "")), [characters, currentMap, maps]);
  const availableDirs = currentMap?.neighbors || {};
  const moveByArrow = (dir) => {
    const nextId = getNextMap(activeMapId, dir);
    if (!nextId || nextId === activeMapId) return;
    const spawn = spawnFromEdge(dir === "left" ? "right" : dir === "right" ? "left" : dir === "up" ? "down" : "up");
    setActiveMapId(nextId);
    setCharacters((prev) => prev.map((character) => String(character.id) === String(activeCharacter?.id) ? { ...character, currentMap: nextId, x: spawn.x, y: spawn.y, dx: spawn.dx, dy: spawn.dy, waitMs: 900, moveCooldownMs: rand(2400, 4200) } : character));
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
            const q = quotes[character.id];
            const moving = Math.abs(Number(character.dx || 0)) > 1.1 || Math.abs(Number(character.dy || 0)) > 1.1;
            return <CharacterSprite key={character.id} character={character} quote={q} moving={moving} onClick={() => setSelectedCharacter(character)} />;
          })}
        </div>
      </div>
    </DesignPageFrame>
  );
}
