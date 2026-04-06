import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Login from "./Login";
import HomePage from "./HomePage";
import SDPage from "./SDPage";
import CharacterGallery from "./CharacterGallery";
import InvestigationList from "./InvestigationList";
import InvestigationLobby from "./InvestigationLobby";
import InvestigationPage from "./InvestigationPage";
import CharacterSelect from "./CharacterSelect";
import MyPage from "./MyPage";
import AdminPage from "./AdminPage";
import AdminInvestigations from "./AdminInvestigations";
import AdminShopManager from "./AdminShopManager";
import AdminInvestigationBuilder from "./AdminInvestigationBuilder";
import AdminRelations from "./AdminRelations";
import ThemeEditor from "./ThemeEditor";
import AdminMapManager from "./AdminMapManager";
import defaultDesign from "./defaultDesign";
import DesignPageFrame from "./DesignPageFrame";
import renderElement from "./renderElement";
import ShopPage from "./ShopPage";
import { clearActiveCharacterStorage, readActiveCharacter, saveActiveCharacter } from "./storageHelpers";
import socket from "./socket";
import { applyDomOverrides } from "./designDomUtils";
import AppShellFrame, { mergeShellOverrideMaps, getSharedShellElementsFromDesign, getSharedShellOverridesFromDesign } from "./AppShellFrame";

const DESIGN_CACHE_KEY = "plc-design-cache";
const AUDIO_MUTE_KEY = "plc-audio-muted";
const AUDIO_VOLUME_KEY = "plc-audio-volume";
const WARM_CHARACTER_CACHE_KEY = "plc-warm-characters";
const SD_CHARACTER_CACHE_KEY = "plc-cache-sd-characters";
const CHARACTER_CACHE_KEY = "plc-cache-characters";

const PAGE = {
  HOME: "home",
  SD: "sd",
  CHARACTERS: "characters",
  INVESTIGATIONS: "investigations",
  SHOP: "shop",
  MY: "my",
  ADMIN: "admin",
  ADMIN_INVESTIGATIONS: "adminInvestigations",
  ADMIN_INVESTIGATION_BUILDER: "adminInvestigationBuilder",
  ADMIN_SHOP: "adminShop",
  ADMIN_RELATIONS: "adminRelations",
  ADMIN_DESIGN: "adminDesign",
  ADMIN_MAP: "adminMap",
  LOBBY: "lobby",
  INVESTIGATION: "investigation",
};

function safeReadJSON(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key) || localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeSessionJSON(key, value) {
  try {
    if (value === null || value === undefined || value === "") {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}




function readLocalArray(key) {
  try {
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCharacterCaches(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  try { localStorage.setItem(CHARACTER_CACHE_KEY, JSON.stringify(safeRows)); } catch {}
  try { localStorage.setItem(SD_CHARACTER_CACHE_KEY, JSON.stringify(safeRows)); } catch {}
  try { sessionStorage.setItem(WARM_CHARACTER_CACHE_KEY, JSON.stringify(safeRows)); } catch {}
}

function writeUserCharacterCache(userId, rows) {
  if (!userId) return;
  try { localStorage.setItem(`plc-cache-user-characters-${userId}`, JSON.stringify(Array.isArray(rows) ? rows : [])); } catch {}
}

function buildThemeVars(theme) {
  return {
    "--bg-main": theme.bgMain || "#eef9ff",
    "--panel": theme.panel || "rgba(255,255,255,0.78)",
    "--text-main": theme.textMain || "#13324b",
    "--accent": theme.accent || "#55c7ff",
    "--line": theme.line || "rgba(98, 176, 220, 0.18)",
    "--font-family": theme.fontFamily || '"Pretendard", "Noto Sans KR", sans-serif',
  };
}

function readStoredMuted() {
  try {
    return localStorage.getItem(AUDIO_MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function clampVolume(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.72;
  return Math.max(0, Math.min(1, num));
}

function readStoredVolume() {
  try {
    const raw = localStorage.getItem(AUDIO_VOLUME_KEY);
    if (raw == null || raw === "") return 0.72;
    return clampVolume(raw);
  } catch {
    return 0.72;
  }
}

function SpeakerButton({ muted, onToggle, position = "bottom-right" }) {
  const style = position === "profile"
    ? { position: "fixed", top: 20, right: 24, zIndex: 2400 }
    : { position: "fixed", right: 24, bottom: 24, zIndex: 2400 };
  return (
    <div style={style}>
      <button
        type="button"
        onClick={onToggle}
        title={muted ? "BGM 켜기" : "BGM 끄기"}
        aria-label={muted ? "BGM 켜기" : "BGM 끄기"}
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: "none",
          background: "transparent",
          color: "rgba(255,255,255,0.74)",
          boxShadow: "none",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          opacity: 1,
          transition: "transform 0.16s ease, opacity 0.16s ease",
          padding: 0,
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.18))" }}>
          <path d="M5 9.5H8.4L13.8 5.2V18.8L8.4 14.5H5V9.5Z" fill="currentColor" />
          {!muted ? (
            <>
              <path d="M16.2 8.2C17.1 9.1 17.6 10.4 17.6 12C17.6 13.6 17.1 14.9 16.2 15.8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M18.8 5.8C20.4 7.4 21.2 9.5 21.2 12C21.2 14.5 20.4 16.6 18.8 18.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </>
          ) : (
            <>
              <path d="M16.1 8.1L20.4 16.1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M20.4 8.1L16.1 16.1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}

function NeedCharacterCard({ openMy, design, theme, pageKey = "my" }) {
  return (
    <DesignPageFrame
      design={design}
      pageKey={pageKey}
      handlers={{ openMy, goHome: openMy }}
      theme={theme}
      minHeight="100vh"
      contentStyle={{ padding: 0 }}
    >
      <div style={{ padding: "28px" }}>
        <div
          style={{
            background: "rgba(8, 15, 30, 0.92)",
            borderRadius: "26px",
            border: "1px solid rgba(255,255,255,0.08)",
            padding: "24px",
            color: "white",
          }}
        >
          <div style={{ color: "#7dd3fc", fontSize: "12px", letterSpacing: "0.18em", marginBottom: "8px" }}>
            CHARACTER REQUIRED
          </div>
          <h2 style={{ marginTop: 0, marginBottom: "10px" }}>캐릭터 선택이 필요해</h2>
          <div style={{ color: "#94a3b8", lineHeight: 1.7, marginBottom: "16px" }}>
            현재 선택된 캐릭터가 없어.
          </div>
          <button onClick={openMy} className="home-primary-button">MY로 이동</button>
        </div>
      </div>
    </DesignPageFrame>
  );
}

function Shell({ user, activePage, shellPageKey, setActivePage, onLogout, onLogin, children, designConfig, myUnread }) {
  const navText = designConfig?.siteContent?.topNav || {};
  const shellRef = useRef(null);
  const resolvedShellPageKey = shellPageKey || activePage;
  const pageDesign = designConfig?.pages?.[resolvedShellPageKey] || defaultDesign.pages?.[resolvedShellPageKey] || {};
  const shellElements = (Array.isArray(getSharedShellElementsFromDesign(designConfig)) ? getSharedShellElementsFromDesign(designConfig) : [])
    .concat(Array.isArray(pageDesign?.shellElements) ? pageDesign.shellElements : [])
    .filter(Boolean)
    .filter((element, index, arr) => {
      const id = String(element?.id || "");
      if (!id) return true;
      return arr.findIndex((candidate) => String(candidate?.id || "") === id) === index;
    });
  const mergedShellOverrides = mergeShellOverrideMaps(getSharedShellOverridesFromDesign(designConfig), pageDesign?.shellOverrides || {});

  const shellHandlers = {
    goHome: () => setActivePage(PAGE.HOME),
    openMy: () => setActivePage(PAGE.MY),
    goCharacters: () => setActivePage(PAGE.CHARACTERS),
    goInvestigations: () => setActivePage(PAGE.INVESTIGATIONS),
    goShop: () => setActivePage(PAGE.SHOP),
    goSD: () => setActivePage(PAGE.SD),
    goAdmin: () => user?.isAdmin && setActivePage(PAGE.ADMIN),
    logout: onLogout,
    login: onLogin,
  };

  useLayoutEffect(() => {
    applyDomOverrides(shellRef.current, mergedShellOverrides);
  }, [mergedShellOverrides, children]);

  const menuItems = [
    [PAGE.HOME, navText.home || "홈"],
    [PAGE.SD, navText.sd || "맵"],
    [PAGE.CHARACTERS, navText.characters || "캐릭터"],
    [PAGE.INVESTIGATIONS, navText.investigations || "조사"],
    [PAGE.SHOP, navText.shop || "상점"],
  ];

  return (
    <div ref={shellRef} data-design-shell-root={resolvedShellPageKey} className="app-shell" style={{ overflow: "visible" }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 120, pointerEvents: "none" }}>
        {shellElements
          .slice()
          .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
          .map((element) => renderElement(element, shellHandlers, designConfig?.theme || defaultDesign.theme, "shell"))}
      </div>
      <header className="app-topbar" style={{ gridTemplateColumns: "1fr auto" }}>
        <nav className="app-nav" style={{ justifyContent: "flex-start" }}>
          {menuItems.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setActivePage(key)} className="ghost-button">
              {label}
            </button>
          ))}
        </nav>
        <div className="app-user-tools">
          {user?.isAdmin ? <button type="button" onClick={() => setActivePage(PAGE.ADMIN)} className="ghost-button">운영</button> : null}
          {user ? <button type="button" onClick={onLogout} className="ghost-button">로그아웃</button> : <button type="button" onClick={onLogin} className="ghost-button">로그인</button>}
          <button
            type="button"
            onClick={() => setActivePage(PAGE.MY)}
            className={`profile-button ${activePage === PAGE.MY ? "is-active" : ""}`}
            title={navText.my || "MY"}
            style={{ position: "relative" }}
          >
            {navText.my || "MY"}
            {myUnread > 0 ? <span style={{ position: "absolute", top: 4, right: 4, width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} /> : null}
          </button>
        </div>
      </header>
      <main className="app-content" style={{ paddingTop: 16 }}>{children}</main>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(() => safeReadJSON("plc-user", null));
  const [activePage, setActivePage] = useState(() => safeReadJSON("plc-page", PAGE.HOME));
  const [activeCharacter, setActiveCharacterState] = useState(readActiveCharacter());
  const [selectedInvestigationId, setSelectedInvestigationId] = useState(() => safeReadJSON("plc-investigation-id", null));
  const cachedDesign = safeReadJSON(DESIGN_CACHE_KEY, null);
  const [designConfig, setDesignConfig] = useState(() => cachedDesign || defaultDesign);
  const [designReady, setDesignReady] = useState(true);
  const [myUnread, setMyUnread] = useState(0);
  const [spectatorMode, setSpectatorMode] = useState(() => safeReadJSON("plc-spectator-mode", false));
  const [builderEditId, setBuilderEditId] = useState(() => safeReadJSON("plc-builder-edit-id", ""));
  const [audioOverride, setAudioOverride] = useState(null);
  const [audioMuted, setAudioMuted] = useState(() => readStoredMuted());
  const [audioVolume, setAudioVolume] = useState(() => readStoredVolume());
  const audioRef = useRef(null);
  const audioPositionMapRef = useRef({});
  const activeAudioSourceRef = useRef("");
  const characterRefreshStampRef = useRef(0);
  const presenceStampRef = useRef(0);

  const isAdmin = !!user?.isAdmin;

  const reloadUnread = async (character = activeCharacter) => {
    if (!character?.id) return setMyUnread(0);
    try {
      const res = await fetch(`http://localhost:3001/mails/unreadCount/${character.id}?t=${Date.now()}`);
      const data = await res.json();
      setMyUnread(Number(data.count || 0));
    } catch {
      setMyUnread(0);
    }
  };

  const applyActiveCharacter = (character) => {
    if (!character) {
      setActiveCharacterState(null);
      clearActiveCharacterStorage();
      return;
    }
    const saved = saveActiveCharacter(character);
    setActiveCharacterState(saved || character);
  };

  const refreshActiveCharacter = async (character = activeCharacter, options = {}) => {
    if (!character?.id || character.id === "admin") return;
    const now = Date.now();
    const cooldown = options.force ? 0 : 8000;
    if (now - characterRefreshStampRef.current < cooldown) return;
    characterRefreshStampRef.current = now;
    try {
      const res = await fetch(`http://localhost:3001/character/${character.id}?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      const next = data?.character || null;
      if (next) applyActiveCharacter(next);
    } catch {
      // ignore refresh errors
    }
  };

  const runtimeCharacter = activeCharacter || (isAdmin ? { id: "admin", name: "운영자", ownerId: "admin" } : null);

  const enterInvestigation = async (item, options = {}) => {
    if (!item) return;
    if (!runtimeCharacter && !isAdmin) {
      setActivePage(PAGE.MY);
      return;
    }

    if (options.mode === "daily") {
      try {
        const res = await fetch("http://localhost:3001/startDailyInvestigation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, character: runtimeCharacter }),
        });
        let data = {};
        try {
          data = await res.json();
        } catch {
          data = {};
        }
        if (!data.success) {
          try {
            const latestRes = await fetch(`http://localhost:3001/investigations/${item.id}?t=${Date.now()}`, { cache: "no-store" });
            const latest = await latestRes.json();
            const names = Array.isArray(latest?.participants) ? latest.participants.map((participant) => participant?.name) : [];
            if (latest?.started && (!runtimeCharacter?.name || names.includes(runtimeCharacter.name))) {
              setSelectedInvestigationId(item.id);
              setSpectatorMode(false);
              setActivePage(PAGE.INVESTIGATION);
              return;
            }
          } catch {
            // ignore fallback errors
          }
          setTimeout(async () => {
            try {
              const retryRes = await fetch(`http://localhost:3001/investigations/${item.id}?t=${Date.now()}`, { cache: "no-store" });
              const retryLatest = await retryRes.json();
              const retryNames = Array.isArray(retryLatest?.participants) ? retryLatest.participants.map((participant) => participant?.name) : [];
              if (retryLatest?.started && (!runtimeCharacter?.name || retryNames.includes(runtimeCharacter.name))) {
                setSelectedInvestigationId(item.id);
                setSpectatorMode(false);
                setActivePage(PAGE.INVESTIGATION);
                return;
              }
              alert(data.message || "일일조사를 시작할 수 없어.");
            } catch {
              alert(data.message || "일일조사를 시작할 수 없어.");
            }
          }, 450);
          return;
        }
        if (data.character) applyActiveCharacter(data.character);
        setSelectedInvestigationId(item.id);
        setSpectatorMode(false);
        setActivePage(PAGE.INVESTIGATION);
        return;
      } catch (err) {
        console.error("startDailyInvestigation error", err);
        try {
          const latestRes = await fetch(`http://localhost:3001/investigations/${item.id}?t=${Date.now()}`, { cache: "no-store" });
          const latest = await latestRes.json();
          const names = Array.isArray(latest?.participants) ? latest.participants.map((participant) => participant?.name) : [];
          if (latest?.started && (!runtimeCharacter?.name || names.includes(runtimeCharacter.name))) {
            setSelectedInvestigationId(item.id);
            setSpectatorMode(false);
            setActivePage(PAGE.INVESTIGATION);
          }
        } catch {
          // ignore fallback errors
        }
        return;
      }
    }

    setSelectedInvestigationId(item.id);
    setSpectatorMode(options.mode === "spectate");
    const directGroupEntry = options.mode === "group" && !!item?.started && !item?.ended;
    setActivePage(options.mode === "spectate" || directGroupEntry ? PAGE.INVESTIGATION : PAGE.LOBBY);
  };

  useEffect(() => {
    const cached = readLocalArray(CHARACTER_CACHE_KEY);
    if (cached.length > 0) {
      writeCharacterCaches(cached);
      if (user?.id && !user?.isAdmin) {
        writeUserCharacterCache(user.id, cached.filter((row) => String(row?.ownerId || "") === String(user.id)));
      }
    }
  }, [user?.id, user?.isAdmin]);

  useEffect(() => {
    let cancelled = false;
    let warmupTimer = null;

    const applyDesign = (nextDesign, { persist = false } = {}) => {
      const next = nextDesign || defaultDesign;
      if (cancelled) return;
      setDesignConfig(next);
      setDesignReady(true);
      if (persist) {
        try {
          localStorage.setItem(DESIGN_CACHE_KEY, JSON.stringify(next));
        } catch {}
      }
    };

    const fetchDesign = () => {
      fetch(`http://localhost:3001/designConfig?t=${Date.now()}`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => applyDesign(data || defaultDesign, { persist: true }))
        .catch(() => {
          const cached = safeReadJSON(DESIGN_CACHE_KEY, defaultDesign) || defaultDesign;
          applyDesign(cached, { persist: false });
        });
    };

    const handleDesignUpdated = (event) => {
      const immediate = event?.detail?.design;
      if (immediate) {
        applyDesign(immediate, { persist: true });
        return;
      }
      const cached = safeReadJSON(DESIGN_CACHE_KEY, defaultDesign) || defaultDesign;
      applyDesign(cached, { persist: false });
    };

    const handleStorage = (event) => {
      if (event?.key && event.key !== DESIGN_CACHE_KEY) return;
      if (typeof event?.newValue === "string" && event.newValue.trim()) {
        try {
          applyDesign(JSON.parse(event.newValue), { persist: false });
          return;
        } catch {}
      }
      const cached = safeReadJSON(DESIGN_CACHE_KEY, defaultDesign) || defaultDesign;
      applyDesign(cached, { persist: false });
    };

    const cached = safeReadJSON(DESIGN_CACHE_KEY, null);
    if (cached) {
      applyDesign(cached, { persist: false });
    } else {
      warmupTimer = window.setTimeout(fetchDesign, 1200);
    }

    window.addEventListener("plc-design-updated", handleDesignUpdated);
    window.addEventListener("storage", handleStorage);
    return () => {
      cancelled = true;
      if (warmupTimer) window.clearTimeout(warmupTimer);
      window.removeEventListener("plc-design-updated", handleDesignUpdated);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (user) localStorage.setItem("plc-user", JSON.stringify(user));
    else localStorage.removeItem("plc-user");
  }, [user]);

  useEffect(() => {
    const handleCharacterUpdated = (event) => {
      const updated = event?.detail?.character;
      if (updated && String(updated.id || "") === String(activeCharacter?.id || "")) {
        applyActiveCharacter(updated);
      } else {
        refreshActiveCharacter(activeCharacter, { force: true });
      }
    };
    window.addEventListener("plc-character-updated", handleCharacterUpdated);
    return () => window.removeEventListener("plc-character-updated", handleCharacterUpdated);
  }, [activeCharacter?.id]);

  useEffect(() => {
    if (!activeCharacter?.id || activeCharacter.id === "admin") return undefined;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") refreshActiveCharacter(activeCharacter);
    };
    refreshIfVisible();
    const timer = setInterval(refreshIfVisible, 30000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
    };
  }, [activeCharacter?.id]);

  useEffect(() => {
    writeSessionJSON("plc-page", activePage);
  }, [activePage]);

  useEffect(() => {
    writeSessionJSON("plc-builder-edit-id", builderEditId || null);
  }, [builderEditId]);

  useEffect(() => {
    writeSessionJSON("plc-investigation-id", selectedInvestigationId || null);
  }, [selectedInvestigationId]);

  useEffect(() => {
    writeSessionJSON("plc-spectator-mode", !!spectatorMode);
  }, [spectatorMode]);

  useEffect(() => {
    if (activeCharacter) saveActiveCharacter(activeCharacter);
    reloadUnread(activeCharacter);
  }, [activeCharacter]);

  useEffect(() => {
    if (!user?.id || user?.isAdmin || !activeCharacter?.ownerId) return;
    if (String(activeCharacter.ownerId) !== String(user.id)) {
      applyActiveCharacter(null);
    }
  }, [user?.id, user?.isAdmin, activeCharacter?.ownerId]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const registerPresence = (force = false) => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - presenceStampRef.current < 12000) return;
      presenceStampRef.current = now;
      socket.emit("register", {
        id: user.id,
        ownerId: activeCharacter?.ownerId || user.id,
        name: activeCharacter?.name || user.id,
        characterId: activeCharacter?.id || null,
      });
    };
    registerPresence(true);
    const timer = setInterval(() => registerPresence(false), 45000);
    document.addEventListener("visibilitychange", registerPresence);
    window.addEventListener("focus", registerPresence);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", registerPresence);
      window.removeEventListener("focus", registerPresence);
    };
  }, [user?.id, activeCharacter?.id, activeCharacter?.ownerId, activeCharacter?.name]);

  useEffect(() => {
    try {
      localStorage.setItem(AUDIO_MUTE_KEY, audioMuted ? "1" : "0");
    } catch {}
    window.dispatchEvent(new CustomEvent("plc-audio-muted-changed", { detail: { muted: audioMuted } }));
  }, [audioMuted]);

  useEffect(() => {
    const next = clampVolume(audioVolume);
    try {
      localStorage.setItem(AUDIO_VOLUME_KEY, String(next));
    } catch {}
    window.dispatchEvent(new CustomEvent("plc-audio-volume-changed", { detail: { volume: next } }));
  }, [audioVolume]);

  useEffect(() => {
    const handleOverride = (event) => {
      const detail = event?.detail || {};
      if (!detail?.url) return;
      activeAudioSourceRef.current = String(detail.scope || detail.source || "override");
      setAudioOverride({
        scope: String(detail.scope || detail.source || "override"),
        url: String(detail.url || ""),
        placement: String(detail.placement || "global"),
      });
    };
    const handleClear = (event) => {
      const scope = String(event?.detail?.scope || event?.detail?.source || "");
      if (!scope || !audioOverride || audioOverride.scope === scope || activeAudioSourceRef.current === scope) {
        activeAudioSourceRef.current = "";
        setAudioOverride(null);
      }
    };
    const handleMuteToggle = () => setAudioMuted((prev) => !prev);
    const handleMuteSet = (event) => setAudioMuted(!!event?.detail?.muted);
    const handleVolumeSet = (event) => setAudioVolume(clampVolume(event?.detail?.volume));
    window.addEventListener("plc-audio-override", handleOverride);
    window.addEventListener("plc-audio-clear", handleClear);
    window.addEventListener("plc-audio-mute-toggle", handleMuteToggle);
    window.addEventListener("plc-audio-mute-set", handleMuteSet);
    window.addEventListener("plc-audio-volume-set", handleVolumeSet);
    return () => {
      window.removeEventListener("plc-audio-override", handleOverride);
      window.removeEventListener("plc-audio-clear", handleClear);
      window.removeEventListener("plc-audio-mute-toggle", handleMuteToggle);
      window.removeEventListener("plc-audio-mute-set", handleMuteSet);
      window.removeEventListener("plc-audio-volume-set", handleVolumeSet);
    };
  }, [audioOverride]);


  const theme = designConfig?.theme || defaultDesign.theme;
  const siteBgmUrl = String(designConfig?.siteContent?.bgm?.site || designConfig?.siteContent?.bgm?.home || "");
  const siteBgmVolume = clampVolume(designConfig?.siteContent?.bgm?.siteVolume ?? designConfig?.siteContent?.bgm?.volume ?? 1);
  const effectiveAudio = useMemo(() => {
    if (audioOverride?.url) return { url: audioOverride.url, placement: audioOverride.placement || "global", volume: clampVolume(audioOverride?.volume ?? 1) };
    if (siteBgmUrl) return { url: siteBgmUrl, placement: "global", volume: siteBgmVolume };
    return { url: "", placement: "global", volume: 1 };
  }, [audioOverride, siteBgmUrl, siteBgmVolume]);


  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.loop = true;
    audio.preload = "auto";
    audio.muted = !!audioMuted;
    audio.volume = clampVolume(audioVolume) * clampVolume(effectiveAudio?.volume ?? 1);
    const nextUrl = String(effectiveAudio?.url || "");
    const prevUrl = audio.dataset.currentSrc || "";
    if (!nextUrl) {
      if (prevUrl) {
        audioPositionMapRef.current[prevUrl] = Number(audio.currentTime || 0);
      }
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.dataset.currentSrc = "";
      return;
    }
    if (prevUrl !== nextUrl) {
      if (prevUrl) audioPositionMapRef.current[prevUrl] = Number(audio.currentTime || 0);
      audio.src = nextUrl;
      audio.dataset.currentSrc = nextUrl;
      audio.load();
      const savedTime = Number(audioPositionMapRef.current[nextUrl] || 0);
      if (savedTime > 0) {
        const applySavedTime = () => {
          try { audio.currentTime = savedTime; } catch {}
        };
        audio.addEventListener("loadedmetadata", applySavedTime, { once: true });
      }
    }
    const tryPlay = () => {
      const result = audio.play();
      if (result && typeof result.catch === "function") result.catch(() => {});
    };
    tryPlay();
    const resumeOnGesture = () => tryPlay();
    window.addEventListener("pointerdown", resumeOnGesture);
    window.addEventListener("keydown", resumeOnGesture);
    return () => {
      window.removeEventListener("pointerdown", resumeOnGesture);
      window.removeEventListener("keydown", resumeOnGesture);
    };
  }, [effectiveAudio, audioMuted, audioVolume]);

  const handleLogin = (nextUser) => {
    if (!nextUser) return;
    setUser(nextUser);
    clearActiveCharacterStorage();
    setActiveCharacterState(null);
    if (nextUser?.isAdmin) {
      setActivePage(PAGE.ADMIN);
      return;
    }
    setActivePage(PAGE.MY);
  };

  const logout = () => {
    socket.emit("unregister");
    setUser(null);
    applyActiveCharacter(null);
    setSelectedInvestigationId(null);
    setSpectatorMode(false);
    setActivePage(PAGE.HOME);
    localStorage.removeItem("plc-user");
    sessionStorage.removeItem("plc-page");
    sessionStorage.removeItem("plc-builder-edit-id");
    sessionStorage.removeItem("plc-investigation-id");
    sessionStorage.removeItem("plc-spectator-mode");
  };

  useEffect(() => {
    const adminPages = new Set([PAGE.ADMIN, PAGE.ADMIN_INVESTIGATIONS, PAGE.ADMIN_INVESTIGATION_BUILDER, PAGE.ADMIN_SHOP, PAGE.ADMIN_RELATIONS, PAGE.ADMIN_DESIGN, PAGE.ADMIN_MAP]);
    if (adminPages.has(activePage) && !isAdmin) {
      setActivePage(user ? PAGE.HOME : PAGE.MY);
    }
  }, [activePage, isAdmin, user]);

  let content = null;

  switch (activePage) {
    case PAGE.HOME:
      content = <HomePage user={user} activeCharacter={runtimeCharacter} openMy={() => setActivePage(PAGE.MY)} goCharacters={() => setActivePage(PAGE.CHARACTERS)} goInvestigations={() => setActivePage(PAGE.INVESTIGATIONS)} goShop={() => setActivePage(PAGE.SHOP)} goSD={() => setActivePage(PAGE.SD)} theme={theme} design={designConfig} />;
      break;
    case PAGE.SD:
      content = <SDPage user={user} activeCharacter={runtimeCharacter} design={designConfig} theme={theme} />;
      break;
    case PAGE.CHARACTERS:
      content = <CharacterGallery user={user} activeCharacter={runtimeCharacter} design={designConfig} theme={theme} />;
      break;
    case PAGE.INVESTIGATIONS:
      content = runtimeCharacter || isAdmin
        ? <InvestigationList activeCharacter={runtimeCharacter} onEnter={enterInvestigation} onSpectate={(item) => enterInvestigation(item, { mode: "spectate" })} design={designConfig} theme={theme} />
        : <NeedCharacterCard openMy={() => setActivePage(PAGE.MY)} design={designConfig} theme={theme} pageKey="investigations" />;
      break;
    case PAGE.LOBBY:
      content = selectedInvestigationId && runtimeCharacter
        ? <InvestigationLobby investigationId={selectedInvestigationId} character={runtimeCharacter} isAdmin={isAdmin} goBack={() => setActivePage(PAGE.INVESTIGATIONS)} startGame={() => setActivePage(PAGE.INVESTIGATION)} reenterGame={() => setActivePage(PAGE.INVESTIGATION)} design={designConfig} theme={theme} />
        : <NeedCharacterCard openMy={() => setActivePage(PAGE.INVESTIGATIONS)} design={designConfig} theme={theme} pageKey="investigations" />;
      break;
    case PAGE.INVESTIGATION:
      content = selectedInvestigationId && runtimeCharacter
        ? <InvestigationPage investigationId={selectedInvestigationId} character={runtimeCharacter} isAdmin={isAdmin} isSpectator={spectatorMode} goBack={() => setActivePage(PAGE.INVESTIGATIONS)} design={designConfig} theme={theme} pageKey="investigationOverlay" />
        : <NeedCharacterCard openMy={() => setActivePage(PAGE.INVESTIGATIONS)} design={designConfig} theme={theme} pageKey="investigations" />;
      break;
    case PAGE.SHOP:
      content = runtimeCharacter || isAdmin
        ? <ShopPage activeCharacter={runtimeCharacter} onApplyCharacter={applyActiveCharacter} design={designConfig} theme={theme} />
        : <NeedCharacterCard openMy={() => setActivePage(PAGE.MY)} design={designConfig} theme={theme} pageKey="shop" />;
      break;
    case PAGE.MY:
      content = !user ? <Login setUser={handleLogin} design={designConfig} theme={theme} /> : isAdmin ? <AdminPage goBack={() => setActivePage(PAGE.HOME)} goInvestigations={() => setActivePage(PAGE.ADMIN_INVESTIGATIONS)} goInvestigationBuilder={() => { setBuilderEditId(""); setActivePage(PAGE.ADMIN_INVESTIGATION_BUILDER); }} goShopManager={() => setActivePage(PAGE.ADMIN_SHOP)} goRelations={() => setActivePage(PAGE.ADMIN_RELATIONS)} goDesignEditor={() => setActivePage(PAGE.ADMIN_DESIGN)} goMapManager={() => setActivePage(PAGE.ADMIN_MAP)} /> : activeCharacter ? <MyPage currentUser={activeCharacter} ownerUser={user} onUpdateUser={(character) => { applyActiveCharacter(character); reloadUnread(character); }} design={designConfig} theme={theme} /> : <CharacterSelect user={user} setCharacter={(character) => { applyActiveCharacter(character); reloadUnread(character); setActivePage(PAGE.MY); }} goBack={() => setActivePage(PAGE.HOME)} activeCharacter={activeCharacter} design={designConfig} theme={theme} />;
      break;
    case PAGE.ADMIN:
      content = isAdmin ? <AdminPage goBack={() => setActivePage(PAGE.HOME)} goInvestigations={() => setActivePage(PAGE.ADMIN_INVESTIGATIONS)} goInvestigationBuilder={() => { setBuilderEditId(""); setActivePage(PAGE.ADMIN_INVESTIGATION_BUILDER); }} goShopManager={() => setActivePage(PAGE.ADMIN_SHOP)} goRelations={() => setActivePage(PAGE.ADMIN_RELATIONS)} goDesignEditor={() => setActivePage(PAGE.ADMIN_DESIGN)} goMapManager={() => setActivePage(PAGE.ADMIN_MAP)} /> : null;
      break;
    case PAGE.ADMIN_INVESTIGATIONS:
      content = isAdmin ? <AdminInvestigations goBack={() => setActivePage(PAGE.ADMIN)} goBuilder={(investigationId = "") => { setBuilderEditId(investigationId || ""); setActivePage(PAGE.ADMIN_INVESTIGATION_BUILDER); }} /> : null;
      break;
    case PAGE.ADMIN_INVESTIGATION_BUILDER:
      content = isAdmin ? <AdminInvestigationBuilder initialInvestigationId={builderEditId} goBack={() => setActivePage(PAGE.ADMIN_INVESTIGATIONS)} /> : null;
      break;
    case PAGE.ADMIN_SHOP:
      content = isAdmin ? <AdminShopManager goBack={() => setActivePage(PAGE.ADMIN)} /> : null;
      break;
    case PAGE.ADMIN_RELATIONS:
      content = isAdmin ? <AdminRelations goBack={() => setActivePage(PAGE.ADMIN)} /> : null;
      break;
    case PAGE.ADMIN_DESIGN:
      content = isAdmin ? <ThemeEditor goBack={() => setActivePage(PAGE.ADMIN)} /> : null;
      break;
    case PAGE.ADMIN_MAP:
      content = isAdmin ? <AdminMapManager goBack={() => setActivePage(PAGE.ADMIN)} /> : null;
      break;
    default:
      content = <HomePage user={user} activeCharacter={runtimeCharacter} openMy={() => setActivePage(PAGE.MY)} goCharacters={() => setActivePage(PAGE.CHARACTERS)} goInvestigations={() => setActivePage(PAGE.INVESTIGATIONS)} goShop={() => setActivePage(PAGE.SHOP)} goSD={() => setActivePage(PAGE.SD)} theme={theme} design={designConfig} />;
      break;
  }

  if (!content) {
    content = <HomePage user={user} activeCharacter={runtimeCharacter} openMy={() => setActivePage(PAGE.MY)} goCharacters={() => setActivePage(PAGE.CHARACTERS)} goInvestigations={() => setActivePage(PAGE.INVESTIGATIONS)} goShop={() => setActivePage(PAGE.SHOP)} goSD={() => setActivePage(PAGE.SD)} theme={theme} design={designConfig} />;
  }

  const shellPageKey = (() => {
    if (activePage === PAGE.MY && !user) return "login";
    if (activePage === PAGE.LOBBY) return PAGE.INVESTIGATIONS;
    if (activePage === PAGE.INVESTIGATION) return "investigationOverlay";
    return activePage;
  })();

  return (
    <div style={buildThemeVars(theme)}>
      <audio ref={audioRef} style={{ display: "none" }} playsInline />
      <AppShellFrame user={user} activePage={activePage} shellPageKey={shellPageKey} onNavigate={setActivePage} onLogout={logout} onLogin={() => setActivePage(PAGE.MY)} designConfig={designConfig} myUnread={myUnread}>
        {content}
      </AppShellFrame>
      {effectiveAudio.url && effectiveAudio.placement !== "profile" ? (
        <SpeakerButton muted={audioMuted} onToggle={() => setAudioMuted((prev) => !prev)} />
      ) : null}
    </div>
  );
}

export default App;
