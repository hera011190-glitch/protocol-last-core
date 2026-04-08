import { useEffect, useMemo, useRef, useState } from "react";
import CharacterProfile from "./CharacterProfile";
import DesignPageFrame from "./DesignPageFrame";
import socket from "./socket";
import { buildApiUrl } from "./api";
import { ProfileCard } from "./profileCardShared";

const CHARACTER_CACHE_KEY = "plc-cache-characters";
const WARM_CHARACTER_CACHE_KEY = "plc-warm-characters";

function readCachedCharacters() {
  try {
    const raw = sessionStorage.getItem(WARM_CHARACTER_CACHE_KEY) || localStorage.getItem(CHARACTER_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedCharacters(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  try {
    localStorage.setItem(CHARACTER_CACHE_KEY, JSON.stringify(safeRows));
  } catch {}
  try {
    sessionStorage.setItem(WARM_CHARACTER_CACHE_KEY, JSON.stringify(safeRows));
  } catch {}
}

function CharacterCard({ character, onClick, theme }) {
  return <ProfileCard character={{ ...character, image: character?.cardImage || character?.image || "" }} onClick={onClick} theme={theme} isOnline={!!character.isOnline} />;
}


async function fetchCharactersWithFallback() {
  const urls = [
    buildApiUrl(`/characters-public`),
    buildApiUrl(`/characters-lite`),
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

async function loadCharacterDetail(characterId) {
  const res = await fetch(buildApiUrl(`/character/${characterId}`));
  const data = await res.json();
  return data?.character || null;
}

function rankOrderValue(rank) {
  const value = String(rank || "").trim();
  if (value === "분대장") return 0;
  if (value === "선임대원") return 1;
  return 2;
}

export default function CharacterGallery({ user, activeCharacter, design, theme }) {
  const [characters, setCharacters] = useState(() => readCachedCharacters());
  const [search, setSearch] = useState("");
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [onlineKeys, setOnlineKeys] = useState([]);
  const [detailPendingId, setDetailPendingId] = useState(null);
  const onlineSeenRef = useRef({});
  const loadStampRef = useRef(0);
  const content = design?.siteContent?.characters || {};

  const loadCharacters = () => {
    fetchCharactersWithFallback()
      .then((incoming) => {
        setCharacters((prev) => {
          const fallbackRows = prev.length > 0 ? prev : readCachedCharacters();
          const next = incoming.length > 0 || fallbackRows.length === 0 ? incoming : fallbackRows;
          if (next.length > 0) writeCachedCharacters(next);
          return next.length > 0 || prev.length === 0 ? next : prev;
        });
      })
      .catch(() => {
        setCharacters((prev) => (Array.isArray(prev) && prev.length > 0 ? prev : readCachedCharacters()));
      });
  };

  useEffect(() => {
    if (!selectedCharacter?.id) return;
    const latest = characters.find((item) => String(item.id) === String(selectedCharacter.id));
    if (!latest) return;
    setSelectedCharacter((prev) => {
      if (!prev) return latest;
      return { ...latest, ...prev };
    });
  }, [characters, selectedCharacter?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const now = Date.now();
    [user.id, activeCharacter?.ownerId, activeCharacter?.id, activeCharacter?.name].forEach((value) => {
      if (value !== undefined && value !== null && String(value).trim()) {
        onlineSeenRef.current[String(value)] = now;
      }
    });
    setOnlineKeys(
      Object.entries(onlineSeenRef.current)
        .filter(([, seenAt]) => now - Number(seenAt || 0) < 30000)
        .map(([key]) => key)
    );
    socket.emit("register", {
      id: user.id,
      ownerId: activeCharacter?.ownerId || user.id,
      name: activeCharacter?.name || user.id,
      characterId: activeCharacter?.id || null,
    });
  }, [user?.id, activeCharacter?.id, activeCharacter?.ownerId, activeCharacter?.name]);

  useEffect(() => {
    const handleUsers = (users) => {
      const now = Date.now();
      const nextSeen = { ...onlineSeenRef.current };
      (users || []).forEach((item) => {
        [item?.accountKey, item?.ownerId, item?.id, item?.name, item?.characterId, item?.displayName].forEach((value) => {
          if (value !== undefined && value !== null && String(value).trim()) {
            nextSeen[String(value)] = now;
          }
        });
      });
      onlineSeenRef.current = nextSeen;
      setOnlineKeys(
        Object.entries(nextSeen)
          .filter(([, seenAt]) => now - Number(seenAt || 0) < 30000)
          .map(([key]) => key)
      );
    };
    const requestLoad = (force = false) => {
      const now = Date.now();
      if (!force && now - loadStampRef.current < 8000) return;
      loadStampRef.current = now;
      loadCharacters();
    };
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        requestLoad();
      }
    };
    const handleCharacterUpdated = () => requestLoad(true);
    requestLoad(true);
    socket.on("users", handleUsers);
    socket.on("onlineAccounts", handleUsers);
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);
    window.addEventListener("plc-character-updated", handleCharacterUpdated);
    const timer = setInterval(() => {
      const now = Date.now();
      setOnlineKeys(
        Object.entries(onlineSeenRef.current)
          .filter(([, seenAt]) => now - Number(seenAt || 0) < 30000)
          .map(([key]) => key)
      );
    }, 3000);
    return () => {
      socket.off("users", handleUsers);
      socket.off("onlineAccounts", handleUsers);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
      window.removeEventListener("plc-character-updated", handleCharacterUpdated);
      clearInterval(timer);
    };
  }, []);

  const filteredCharacters = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const list = characters.map((character) => ({
      ...character,
      isOnline:
        onlineKeys.includes(String(character.ownerId || "")) ||
        onlineKeys.includes(String(character.id || "")) ||
        onlineKeys.includes(String(character.name || "")),
    }));
    const filtered = !keyword ? list : list.filter((character) => String(character?.name || "").toLowerCase().includes(keyword));
    return [...filtered].sort((a, b) => {
      const rankDiff = rankOrderValue(a?.rank) - rankOrderValue(b?.rank);
      if (rankDiff !== 0) return rankDiff;
      return String(a?.name || "").localeCompare(String(b?.name || ""), "ko");
    });
  }, [characters, search, onlineKeys]);

  return (
    <DesignPageFrame design={design} pageKey="characters" handlers={{}} theme={theme} minHeight="100vh" contentStyle={{ padding: 0 }}>
      {selectedCharacter ? (
        <CharacterProfile character={selectedCharacter} goBack={() => setSelectedCharacter(null)} theme={theme} viewerUser={user} viewerCharacter={activeCharacter} design={design} pageKey="profileCharacter" />
      ) : (
        <div style={{ padding: "26px", color: theme?.textMain || "#13324b" }}>
          <div style={{ marginBottom: "18px" }}>
            <div className="section-eyebrow">{content?.eyebrow || "CHARACTER"}</div>
            <h2 style={{ marginTop: "10px", marginBottom: "8px" }}>{content?.title || "캐릭터"}</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", alignItems: "center", marginBottom: "20px" }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={content?.searchPlaceholder || "이름 검색"} style={{ width: "100%", padding: "14px 16px", borderRadius: "16px", border: `1px solid ${theme?.line || "rgba(98,176,220,0.18)"}`, background: theme?.inputBg || "#fff", color: theme?.inputText || "#16324a" }} />
            <div className="status-chip">등록 인원 {filteredCharacters.length}명</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "14px" }}>
            {filteredCharacters.map((character) => <CharacterCard key={character.id} character={character} onClick={async () => {
              if (!character?.id || detailPendingId) return;
              setDetailPendingId(String(character.id));
              try {
                const detail = await loadCharacterDetail(character.id);
                setSelectedCharacter(detail || character);
              } catch {
                setSelectedCharacter(character);
              } finally {
                setDetailPendingId(null);
              }
            }} theme={theme} />)}
          </div>
          {filteredCharacters.length === 0 ? <div style={{ marginTop: "18px", color: theme?.textSoft || "#4f7390" }}>표시할 캐릭터가 없습니다.</div> : null}
        </div>
      )}
    </DesignPageFrame>
  );
}
