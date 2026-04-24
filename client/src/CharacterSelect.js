import { useEffect, useMemo, useState } from "react";
import CharacterProfile from "./CharacterProfile";
import DesignPageFrame from "./DesignPageFrame";
import { buildApiUrl } from "./api";


const GLOBAL_WARM_CHARACTER_CACHE_KEY = "plc-warm-characters";

function getUserCharacterCacheKey(userId) {
  return `plc-cache-user-characters-${userId}`;
}

function unwrapCachedArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.value)) return value.value;
  return [];
}

function readCachedUserCharacters(user) {
  try {
    const scoped = user?.id ? localStorage.getItem(getUserCharacterCacheKey(user.id)) : "";
    const warmRaw = sessionStorage.getItem(GLOBAL_WARM_CHARACTER_CACHE_KEY) || localStorage.getItem(GLOBAL_WARM_CHARACTER_CACHE_KEY) || localStorage.getItem("plc-cache-characters");
    const scopedRows = unwrapCachedArray(scoped ? JSON.parse(scoped) : null);
    if (scopedRows.length > 0) return scopedRows;
    const warmRows = unwrapCachedArray(warmRaw ? JSON.parse(warmRaw) : []);
    return warmRows.filter((character) => String(character?.ownerId || "") === String(user?.id || ""));
  } catch {
    return [];
  }
}

function writeCachedUserCharacters(userId, rows) {
  try {
    localStorage.setItem(getUserCharacterCacheKey(userId), JSON.stringify(Array.isArray(rows) ? rows : []));
  } catch {}
}


async function fetchUserCharactersWithFallback(userId) {
  const urls = [
    buildApiUrl(`/characters-public/${userId}`),
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "default" });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data)) {
        return data;
      }
    } catch {}
  }
  return [];
}

function CharacterCard({ character, onSelect, onProfile, current }) {  const safeCharacter = character || {};
  return (
    <div style={{ display: "grid", gridTemplateColumns: "72px 1fr auto auto", gap: "12px", alignItems: "center", padding: "14px", borderRadius: "20px", background: current ? "rgba(125,211,252,0.16)" : "rgba(255,255,255,0.78)", border: `1px solid ${current ? "rgba(56,189,248,0.38)" : "rgba(98,176,220,0.18)"}` }}>
      <div style={{ width: "72px", height: "72px", borderRadius: "18px", overflow: "hidden", background: "rgba(255,255,255,0.65)" }}>
        {safeCharacter.image ? <img src={safeCharacter.image} alt={safeCharacter.name || "character"} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#88a0b8" }}>IMG</div>}
      </div>
      <div>
        <div style={{ fontWeight: 900, fontSize: "18px" }}>{safeCharacter.name || "-"}</div>
        <div style={{ color: "#64748b", marginTop: "4px" }}>{safeCharacter.rank || "대원"}</div>
      </div>
      <button type="button" className="ghost-button" onClick={onProfile}>프로필</button>
      <button type="button" className="home-primary-button" onClick={onSelect}>선택</button>
    </div>
  );
}

async function loadCharacterDetail(characterId) {
  const res = await fetch(buildApiUrl(`/character-public/${characterId}`));
  const data = await res.json();
  return data?.character || null;
}

export default function CharacterSelect({ user, setCharacter, goBack, design, theme, activeCharacter }) {
  const [chars, setChars] = useState(() => readCachedUserCharacters(user));
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [selectPendingId, setSelectPendingId] = useState(null);

  const loadChars = () => {
    if (!user?.id) {
      setChars(readCachedUserCharacters(user));
      return;
    }
    fetchUserCharactersWithFallback(user.id)
      .then((incoming) => {
        setChars((prev) => {
          const fallbackRows = Array.isArray(prev) && prev.length > 0 ? prev : readCachedUserCharacters(user);
          const next = incoming.length > 0 || fallbackRows.length === 0 ? incoming : fallbackRows;
          if (next.length > 0) writeCachedUserCharacters(user.id, next);
          return next.length > 0 || fallbackRows.length > 0 ? next : [];
        });
      })
      .catch(() => setChars((prev) => (Array.isArray(prev) && prev.length > 0 ? prev : readCachedUserCharacters(user))));
  };

  useEffect(() => {
    loadChars();
  }, [user?.id]);

  useEffect(() => {
    const refresh = () => loadChars();
    window.addEventListener("plc-character-updated", refresh);
    return () => window.removeEventListener("plc-character-updated", refresh);
  }, [user?.id]);

  const filteredChars = useMemo(
    () => chars.filter((character) => character && character.id != null && String(character.name || "").trim()),
    [chars]
  );

  return (
    <DesignPageFrame design={design} pageKey="my" handlers={{ goHome: goBack }} theme={theme} minHeight="100vh">
      <div style={{ color: theme?.textMain || "#13324b" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "18px" }}>
          <div>
            <div className="section-eyebrow">MY CHARACTERS</div>
            <h2 style={{ marginTop: "10px", marginBottom: "8px" }}>내 캐릭터</h2>
          </div>
          <button type="button" className="ghost-button" onClick={goBack}>홈으로</button>
        </div>

        <div style={{ display: "grid", gap: "14px" }}>
          {filteredChars.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              current={String(activeCharacter?.id) === String(character.id)}
              onProfile={async () => {
                try {
                  const detail = await loadCharacterDetail(character.id);
                  setSelectedProfile(detail || character);
                } catch {
                  setSelectedProfile(character);
                }
              }}
              onSelect={async () => {
                if (!character?.id || selectPendingId) return;
                setSelectPendingId(String(character.id));
                try {
                  const detail = await loadCharacterDetail(character.id);
                  setCharacter(detail || character);
                } catch {
                  setCharacter(character);
                } finally {
                  setSelectPendingId(null);
                }
              }}
            />
          ))}
          {filteredChars.length === 0 ? <div style={{ color: theme?.textSoft || "#4f7390" }}>캐릭터가 없습니다.</div> : null}
        </div>

        {selectedProfile ? (
          <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(2,6,23,0.56)", backdropFilter: "blur(10px)" }}>
            <CharacterProfile character={selectedProfile} goBack={() => setSelectedProfile(null)} theme={theme} design={design} pageKey="profileTemplate" />
          </div>
        ) : null}
      </div>
    </DesignPageFrame>
  );
}
