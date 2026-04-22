import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DesignPageFrame from "./DesignPageFrame";
import socket, { ensureSocketConnected } from "./socket";
import { apiFetch } from "./api";

function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function markDailyAttempt(investigation) {
  if (!investigation || investigation.type !== "daily") return;
  const key = `plc-daily-attempt-${investigation.id}`;
  const today = getTodayKey();
  try {
    localStorage.setItem(key, JSON.stringify({ date: today, used: 1 }));
  } catch {}
}

function getDailyResumeStorageKeys(investigationId, character) {
  if (!investigationId || !character) return [];
  const ownerKeys = [
    character.id,
    `${character.ownerId || 'owner'}:${character.name || ''}`,
    character.name,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return Array.from(new Set(ownerKeys)).map((ownerKey) => `plc-daily-resume-${investigationId}-${ownerKey}`);
}

function markDailyResume(investigationId, character) {
  getDailyResumeStorageKeys(investigationId, character).forEach((key) => {
    try {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), investigationId }));
    } catch {}
  });
}

function clearDailyResume(investigationId, character) {
  getDailyResumeStorageKeys(investigationId, character).forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {}
  });
}

function formatTime(time) {
  if (!time) return "";
  try {
    return new Date(time).toLocaleString();
  } catch {
    return "";
  }
}

function formatRouteTime(time) {
  return formatTime(time);
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function getSkillCooldown(state, skill) {
  const key = String(skill?.key || skill?.name || "");
  const cooldowns = state?.skillCooldowns || {};
  return Number(cooldowns?.[key] || 0);
}

function OverlayPanel({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1160, background: "rgba(2,6,23,0.62)", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "min(980px, calc(100vw - 48px))", maxHeight: "calc(100vh - 48px)", overflow: "auto", borderRadius: 24, background: "rgba(8,15,30,0.96)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 24px 56px rgba(0,0,0,0.34)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: "white" }}>{title}</div>
          <button type="button" className="ghost-button" onClick={onClose}>닫기</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const BATTLE_ACTIONS = ["공격", "방어", "스킬", "아이템"];
const BATTLE_TURN_LIMIT_MS = 5 * 60 * 1000;
const CHAT_PANEL_WIDTH = 320;
const RIGHT_PANEL_WIDTH = 278;
const LEFT_SIDE_PANEL_TOP = 152;
const LEFT_CHAT_PANEL_HEIGHT = "calc(100% - 404px)";
const CENTER_TOP_CHIP_RESERVED_WIDTH = "688px";

function buildFallbackParticipants(investigation) {
  const roster = new Map();
  (Array.isArray(investigation?.participants) ? investigation.participants : []).forEach((participant) => {
    if (!participant?.name) return;
    roster.set(String(participant.name), participant);
  });
  Object.entries(investigation?.participantStates || {}).forEach(([name, state]) => {
    const existing = roster.get(String(name)) || {};
    const maxHp = Number(state?.maxHp || 100);
    roster.set(String(name), {
      id: existing.id || String(name),
      ownerId: existing.ownerId || String(name),
      name: existing.name || String(name),
      image: existing.image || state?.image || "",
      investigationImage: existing.investigationImage || existing.image || state?.image || "",
      level: existing.level || 1,
      stats: existing.stats || {
        hp: Math.max(0, Math.round((maxHp - 100) / 10)),
        atk: Number(state?.atk || 0),
        def: Number(state?.def || 0),
        agi: Number(state?.agi || 0),
      },
      ...existing,
    });
  });
  return Array.from(roster.values());
}

function InvestigationPage({ investigationId, character = {}, isAdmin, isSpectator = false, goBack, design, theme, pageKey = "investigationOverlay", previewData = null, previewChat = null, previewInventory = null }) {
  const previewMode = !!previewData;
  const investigationCacheKey = useMemo(() => `investigation-cache:${investigationId}:${character?.name || "guest"}`, [investigationId, character?.name]);
  const readCachedInvestigation = useCallback(() => {
    if (previewData || typeof window === "undefined") return previewData || null;
    try {
      const raw = window.localStorage.getItem(investigationCacheKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [previewData, investigationCacheKey]);
  const cachedInvestigation = readCachedInvestigation();
  const [investigation, setInvestigation] = useState(() => previewData || cachedInvestigation || null);
  const [currentNodeId, setCurrentNodeId] = useState(() => previewData?.currentNodeId || cachedInvestigation?.currentNodeId || previewData?.data?.start || cachedInvestigation?.data?.start || Object.keys(previewData?.data?.nodes || {})[0] || Object.keys(cachedInvestigation?.data?.nodes || {})[0] || null);
  const [logs, setLogs] = useState(() => ((Array.isArray(previewData?.sharedLogs) && previewData.sharedLogs.length > 0 ? previewData.sharedLogs : Array.isArray(cachedInvestigation?.sharedLogs) ? cachedInvestigation.sharedLogs : []).slice(-160)));
  const [chat, setChat] = useState(() => ((Array.isArray(previewChat) ? previewChat : Array.isArray(previewData?.previewChat) ? previewData.previewChat : []).slice(-120)));
  const [input, setInput] = useState("");
  const [onlineAccounts, setOnlineAccounts] = useState([]);
  const onlineSeenRef = useRef({});
  const [showItems, setShowItems] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showClues, setShowClues] = useState(false);
  const [inventoryItems, setInventoryItems] = useState(() => Array.isArray(previewInventory) ? previewInventory : Array.isArray(previewData?.previewInventory) ? previewData.previewInventory : Array.isArray(character?.items) ? character.items : []);
  const [showResult, setShowResult] = useState(true);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [stickLogsToBottom, setStickLogsToBottom] = useState(true);
  const [showNewChatCue, setShowNewChatCue] = useState(false);
  const [showNewLogCue, setShowNewLogCue] = useState(false);
  const [myBattleAction, setMyBattleAction] = useState("");
  const [actionPicker, setActionPicker] = useState("");
  const [stagedBattleLogs, setStagedBattleLogs] = useState([]);
  const [battlePlaybackLocked, setBattlePlaybackLocked] = useState(false);
  const [playbackState, setPlaybackState] = useState(null);
  const [editingSavedAction, setEditingSavedAction] = useState(true);
  const skipAutoActionSyncRef = useRef(false);
  const [battleActionSubmitting, setBattleActionSubmitting] = useState(false);
  const [battleReadyUntil, setBattleReadyUntil] = useState(0);
  const [battleTurnStartedAt, setBattleTurnStartedAt] = useState(0);
  const [localPendingActions, setLocalPendingActions] = useState({});
  const [nowTick, setNowTick] = useState(Date.now());
  const chatScrollRef = useRef(null);
  const logScrollRef = useRef(null);
  const autoBattleSubmitRef = useRef("");
  const prevChatLengthRef = useRef(0);
  const prevLogLengthRef = useRef(0);
  const dailyRewardAutoRef = useRef("");
  const battlePlaybackLockStartedRef = useRef(0);
  const battleTimeoutHandlingRef = useRef("");
  const handledBattleRoundKeyRef = useRef("");
  const prevBattleTurnRef = useRef(0);
  const postPlaybackRefreshRef = useRef(false);
  const playbackSourceRef = useRef(null);
  const queuedStateUpdateRef = useRef(null);
  const endedResultOpenedRef = useRef(false);
  const currentNode = investigation?.data?.nodes?.[currentNodeId] || null;
  const displayBattle = playbackState?.battle || (currentNode?.battle ? JSON.parse(JSON.stringify(currentNode.battle)) : null);
  const playbackBattleActive = !!playbackState?.battle;
  const battleActive = playbackBattleActive || (!investigation?.ended && !!currentNode?.battle);
  const liveDisplayLogs = useMemo(() => {
    if (!(battlePlaybackLocked && stagedBattleLogs.length > 0)) return logs;
    const visibleStagedLogs = stagedBattleLogs
      .filter((entry) => Number(entry?.appearedAt || 0) <= nowTick)
      .map((entry, idx) => ({ id: `staged-${idx}-${entry.appearedAt || idx}`, text: entry.text, time: "" }));
    return [...logs, ...visibleStagedLogs];
  }, [battlePlaybackLocked, stagedBattleLogs, logs, nowTick]);

  const getBattleRoundKey = (source) => {
    const rounds = Array.isArray(source?.lastBattleRound) ? source.lastBattleRound : [];
    if (!rounds.length) return "";
    return `${Number(source?.battleTurn || 0)}:${rounds.map((entry) => `${entry?.phase || ""}:${entry?.actor || ""}:${entry?.target || ""}:${entry?.effect || ""}:${entry?.text || ""}`).join("|")}`;
  };

  const applyInvestigation = (data) => {
    if (!data) return;
    if (data.type === "daily") setChat([]);
    const hasRoundPlayback = Array.isArray(data?.lastBattleRound) && data.lastBattleRound.length > 0;
    if (data?.ended && hasRoundPlayback) setShowResult(false);
    handledBattleRoundKeyRef.current = hasRoundPlayback ? getBattleRoundKey(data) : "";
    const nodeId = data.currentNodeId || data.data?.start || Object.keys(data?.data?.nodes || {})[0] || null;
    if (Number(data?.battleTurn || 0) <= 1 || !data?.currentNodeId || (data?.ended && !hasRoundPlayback)) {
      playbackSourceRef.current = null;
      setPlaybackState(null);
      battlePlaybackLockStartedRef.current = 0;
      setBattlePlaybackLocked(false);
      setTimeout(() => setStagedBattleLogs([]), 120);
      setLocalPendingActions({});
      setMyBattleAction("");
      setActionPicker("");
      setBattleActionSubmitting(false);
    }
    if (hasRoundPlayback) {
      const prevNodeId = investigation?.currentNodeId || currentNodeId || investigation?.data?.start || nodeId;
      const prevNode = investigation?.data?.nodes?.[prevNodeId] || null;
      const nextNode = data?.data?.nodes?.[nodeId] || null;
      playbackSourceRef.current = {
        participantStates: JSON.parse(JSON.stringify(investigation?.participantStates || data?.participantStates || {})),
        battle: JSON.parse(JSON.stringify(prevNode?.battle || nextNode?.battle || null)),
      };
    } else {
      playbackSourceRef.current = null;
      queuedStateUpdateRef.current = null;
    }
    setInvestigation(data);
    setCurrentNodeId(nodeId);
    if (!previewMode && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(investigationCacheKey, JSON.stringify(data));
      } catch {}
    }
    setLogs(
      (Array.isArray(data.sharedLogs) && data.sharedLogs.length > 0
        ? data.sharedLogs
        : [{ id: "fallback", text: data.sharedLog || data.data?.nodes?.[nodeId]?.log || "", time: "" }]).slice(-160)
    );
    if (data.type === "daily") {
      markDailyAttempt(data);
      const joined = Array.isArray(data?.participants) && !!character?.name && data.participants.some((participant) => participant?.name === character.name);
      if (joined || data?.ended) clearDailyResume(data.id || investigationId, character);
    }
  };


  useEffect(() => {
    if (!previewMode) return;
    const source = previewData || null;
    setInvestigation(source);
    setCurrentNodeId(source?.currentNodeId || source?.data?.start || null);
    setLogs((Array.isArray(source?.sharedLogs) && source.sharedLogs.length > 0 ? source.sharedLogs : []).slice(-160));
    setChat((Array.isArray(previewChat) ? previewChat : Array.isArray(source?.previewChat) ? source.previewChat : []).slice(-120));
    setInventoryItems(Array.isArray(previewInventory) ? previewInventory : Array.isArray(source?.previewInventory) ? source.previewInventory : Array.isArray(character?.items) ? character.items : []);
  }, [previewMode, previewData, previewChat, previewInventory, character?.items]);


  useEffect(() => {
    const bgmUrl = String(investigation?.bgmUrl || investigation?.data?.bgmUrl || "");
    const bgmVolume = Math.max(0, Math.min(1, Number(investigation?.bgmVolume ?? investigation?.data?.bgmVolume ?? 1) || 1));
    if (!bgmUrl) return undefined;
    window.dispatchEvent(new CustomEvent("plc-audio-override", { detail: { scope: "investigation", url: bgmUrl, placement: "global", volume: bgmVolume } }));
    return () => {
      window.dispatchEvent(new CustomEvent("plc-audio-clear", { detail: { scope: "investigation" } }));
    };
  }, [investigation?.id, investigation?.bgmUrl, investigation?.data?.bgmUrl, investigation?.bgmVolume, investigation?.data?.bgmVolume]);

  const loadInvestigation = async () => {
    if (previewMode) return;
    try {
      const res = await apiFetch(`/investigationView/${investigationId}`);
      const data = await res.json();
      applyInvestigation(data);
      if (!(data?.currentNodeId || data?.data?.start || Object.keys(data?.data?.nodes || {})[0])) {
        window.setTimeout(() => {
          loadInvestigation();
        }, 220);
      }
    } catch (err) {
      console.error("loadInvestigation error", err);
    }
  };

  const loadChats = async () => {
    if (previewMode) return;
    try {
      const res = await apiFetch(`/investigationChats/${investigationId}`);
      const data = await res.json();
      setChat((Array.isArray(data) ? data : []).slice(-120));
    } catch (err) {
      console.error("loadChats error", err);
      setChat([]);
    }
  };

  const loadCharacterInventory = async () => {
    if (previewMode) return;
    if (!character?.id && !character?.name) return;
    try {
      if (character?.id) {
        const res = await apiFetch(`/character-items/${character.id}`);
        const data = await res.json();
        setInventoryItems(Array.isArray(data?.items) ? data.items : Array.isArray(character?.items) ? character.items : []);
      } else {
        setInventoryItems(Array.isArray(character?.items) ? character.items : []);
      }
    } catch (err) {
      console.error("loadCharacterInventory error", err);
      setInventoryItems(Array.isArray(character?.items) ? character.items : []);
    }
  };

  const loadAll = () => {
    loadInvestigation();
    loadChats();
    loadCharacterInventory();
  };

  useEffect(() => {
    if (previewMode) return;
    loadAll();
  }, [investigationId, previewMode]);

  useEffect(() => {
    if (previewMode) return undefined;
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      if (!battlePlaybackLocked && !currentNode?.battle) {
        loadInvestigation();
        if (investigation?.type !== "daily") loadChats();
      }
      if (showInventory || showItems) loadCharacterInventory();
    };
    const loadAllTimer = setInterval(tick, 3600);
    return () => clearInterval(loadAllTimer);
  }, [investigationId, investigation?.type, showInventory, showItems, previewMode, battlePlaybackLocked, investigation?.data?.nodes?.[currentNodeId]?.battle]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      setNowTick(Date.now());
    };
    tick();
    const timer = window.setInterval(tick, battleActive ? 80 : 140);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [battleActive]);

  const pendingActionsEarly = investigation?.pendingBattleActions || {};

  useEffect(() => {
    if (!character?.name) return;
    if (!pendingActionsEarly?.[character.name]) {
      setEditingSavedAction(true);
      return;
    }
    setEditingSavedAction(false);
  }, [investigation?.battleTurn, character?.name, pendingActionsEarly?.[character?.name]]);

useEffect(() => {
  if (previewMode) return undefined;
  if (!character || !investigationId) return;

  const handleInit = (data) => {
    setChat(Array.isArray(data) ? data : []);
  };

  const handleChat = (message) => {
    if (!message) return;
    setChat((prev) => [...prev, message].slice(-120));
  };

  const handleStateUpdated = (payload) => {
    if (payload.investigationId !== investigationId) return;

    const hasRoundPlayback = Array.isArray(payload.lastBattleRound) && payload.lastBattleRound.length > 0;
    const incomingBattleRoundKey = hasRoundPlayback ? getBattleRoundKey(payload) : "";
    const alreadyHandledRound = !!incomingBattleRoundKey && incomingBattleRoundKey === handledBattleRoundKeyRef.current;

    if (battlePlaybackLocked) {
      queuedStateUpdateRef.current = payload;
      return;
    }

    if (hasRoundPlayback && !alreadyHandledRound) {
      if (payload?.ended) setShowResult(false);
      postPlaybackRefreshRef.current = true;
      applyInvestigation(payload);
      return;
    }

    if (!battlePlaybackLocked) setCurrentNodeId(payload.currentNodeId);

    if (Array.isArray(payload.sharedLogs) && payload.sharedLogs.length > 0) {
      setLogs(payload.sharedLogs.slice(-160));
    } else if (payload.sharedLog && !hasRoundPlayback && !battlePlaybackLocked) {
      setLogs((prev) => [
        ...prev,
        { id: Date.now() + Math.random(), text: payload.sharedLog, time: "" },
      ]);
    }

    setInvestigation((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        leaders: payload.leaders || prev.leaders || [],
        participants: payload.participants || prev.participants || [],
        currentNodeId: payload.currentNodeId,
        sharedLog: payload.sharedLog || prev.sharedLog || "",
        sharedLogs: payload.sharedLogs || prev.sharedLogs || [],
        routeHistory: payload.routeHistory || prev.routeHistory || [],
        foundItems: payload.foundItems || prev.foundItems || [],
        foundNPCs: payload.foundNPCs || prev.foundNPCs || [],
        rewards: payload.rewards || prev.rewards || [],
        points:
          typeof payload.points === "number"
            ? payload.points
            : typeof prev.points === "number"
            ? prev.points
            : 0,
        participantStates: payload.participantStates || prev.participantStates || {},
        discoveredFlags: payload.discoveredFlags || prev.discoveredFlags || {},
        activeNpcScene: payload.activeNpcScene !== undefined ? payload.activeNpcScene : (prev.activeNpcScene || null),
        npcLineIndex: typeof payload.npcLineIndex === "number" ? payload.npcLineIndex : (typeof prev.npcLineIndex === "number" ? prev.npcLineIndex : 0),
        pendingReward: payload.pendingReward !== undefined ? payload.pendingReward : (prev.pendingReward || null),
        clues: payload.clues || prev.clues || [],
        totalNodeCount: typeof payload.totalNodeCount === "number" ? payload.totalNodeCount : prev.totalNodeCount,
        visitedNodeCount: typeof payload.visitedNodeCount === "number" ? payload.visitedNodeCount : prev.visitedNodeCount,
        visitProgressPercent: typeof payload.visitProgressPercent === "number" ? payload.visitProgressPercent : prev.visitProgressPercent,
        totalInvestigationActionCount: typeof payload.totalInvestigationActionCount === "number" ? payload.totalInvestigationActionCount : prev.totalInvestigationActionCount,
        completedInvestigationActionCount: typeof payload.completedInvestigationActionCount === "number" ? payload.completedInvestigationActionCount : prev.completedInvestigationActionCount,
        overallProgressPercent: typeof payload.overallProgressPercent === "number" ? payload.overallProgressPercent : prev.overallProgressPercent,
        readyToEnd: payload.readyToEnd ?? prev.readyToEnd,
        endNoticeDismissed: payload.endNoticeDismissed ?? prev.endNoticeDismissed,
        eventBanner: payload.eventBanner ?? prev.eventBanner,
        eventBannerType: payload.eventBannerType || prev.eventBannerType,
        eventBannerUntil: Number(payload.eventBannerUntil ?? prev.eventBannerUntil ?? 0),
        endConfirmations: payload.endConfirmations || prev.endConfirmations || [],
        ended: payload.ended ?? prev.ended,
        endedAt: payload.endedAt || prev.endedAt || "",
        endedReason: payload.endedReason || prev.endedReason || "",
        resultSummary: payload.resultSummary || prev.resultSummary || "",
        battleTurn: payload.battleTurn || prev.battleTurn || 1,
        pendingBattleActions: payload.pendingBattleActions || prev.pendingBattleActions || {},
        lastBattleRound: payload.lastBattleRound || prev.lastBattleRound || [],
        data: payload.data || prev.data,
      };
    });
  };

  const handleOnlineAccounts = (list) => {
    const now = Date.now();
    const safeList = Array.isArray(list) ? list : [];
    const nextSeen = { ...onlineSeenRef.current };
    safeList.forEach((item) => {
      const safeItem = item || {};
      [safeItem?.accountKey, safeItem?.ownerId, safeItem?.id, safeItem?.name, safeItem?.characterId, safeItem?.displayName].forEach((value) => {
        if (value !== undefined && value !== null && String(value).trim()) {
          nextSeen[String(value)] = now;
        }
      });
    });
    onlineSeenRef.current = nextSeen;
    setOnlineAccounts(safeList);
  };

  const handleParticipantsUpdated = (allInvestigations) => {
    const found = (allInvestigations || []).find((v) => v.id === investigationId);
    if (!found) return;

    setInvestigation((prev) => {
      if (!prev) return found;
      return {
        ...prev,
        leaders: found.leaders || [],
        participants: found.participants || [],
        started: found.started,
        ended: found.ended,
        endedReason: found.endedReason || prev.endedReason || "",
        resultSummary: found.resultSummary || prev.resultSummary || "",
        routeHistory: found.routeHistory || prev.routeHistory || [],
        foundItems: found.foundItems || prev.foundItems || [],
        foundNPCs: found.foundNPCs || prev.foundNPCs || [],
        rewards: found.rewards || prev.rewards || [],
        points:
          typeof found.points === "number"
            ? found.points
            : typeof prev.points === "number"
            ? prev.points
            : 0,
        participantStates: found.participantStates || prev.participantStates || {},
      };
    });
  };

  ensureSocketConnected();
  socket.on("init", handleInit);
  socket.on("chat", handleChat);
  socket.on("investigationStateUpdated", handleStateUpdated);
  socket.on("onlineAccounts", handleOnlineAccounts);
  socket.on("usersUpdate", handleOnlineAccounts);
  socket.on("participantsUpdated", handleParticipantsUpdated);

  socket.emit("register", character);
  socket.emit("joinRoom", investigationId);

  const onlineTrimTimer = setInterval(() => {
    const now = Date.now();
    onlineSeenRef.current = Object.fromEntries(
      Object.entries(onlineSeenRef.current).filter(([, seenAt]) => now - Number(seenAt || 0) < 30000)
    );
    setOnlineAccounts((prev) => (Array.isArray(prev) ? [...prev] : []));
  }, 3000);

  return () => {
    socket.emit("leaveRoom");
    socket.off("init", handleInit);
    socket.off("chat", handleChat);
    socket.off("investigationStateUpdated", handleStateUpdated);
    socket.off("onlineAccounts", handleOnlineAccounts);
    socket.off("usersUpdate", handleOnlineAccounts);
    socket.off("participantsUpdated", handleParticipantsUpdated);
    clearInterval(onlineTrimTimer);
  };
}, [character, investigationId]);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    if (!stickToBottom) return;
    requestAnimationFrame(() => {
      if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    });
  }, [chat, stickToBottom]);

  useEffect(() => {
    if (!logScrollRef.current) return;
    if (!stickLogsToBottom) return;
    requestAnimationFrame(() => {
      if (logScrollRef.current) logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    });
  }, [liveDisplayLogs, stickLogsToBottom]);

  useEffect(() => {
    if (stickToBottom) {
      setShowNewChatCue(false);
      prevChatLengthRef.current = chat.length;
      return;
    }
    if (chat.length > prevChatLengthRef.current) setShowNewChatCue(true);
    prevChatLengthRef.current = chat.length;
  }, [chat, stickToBottom]);

  useEffect(() => {
    if (stickLogsToBottom) {
      setShowNewLogCue(false);
      prevLogLengthRef.current = liveDisplayLogs.length;
      return;
    }
    if (liveDisplayLogs.length > prevLogLengthRef.current) setShowNewLogCue(true);
    prevLogLengthRef.current = liveDisplayLogs.length;
  }, [liveDisplayLogs, stickLogsToBottom]);

  const leaders = investigation?.leaders || [];
  const fallbackParticipants = useMemo(() => buildFallbackParticipants(investigation), [investigation]);
  const isDaily = investigation?.type === "daily";
  const isDailyParticipant = !!(isDaily && character?.name && fallbackParticipants.some((participant) => participant?.name === character.name));
  const isLeader = character ? leaders.includes(character.name) || isDailyParticipant : false;
  const canControl = isLeader || isAdmin;

  const participants = useMemo(() => {
    const raw = fallbackParticipants;
    return [...raw].sort((a, b) => {
      const aLeader = leaders.includes(a.name);
      const bLeader = leaders.includes(b.name);
      if (aLeader && !bLeader) return -1;
      if (!aLeader && bLeader) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [fallbackParticipants, leaders]);

  const isParticipantOnline = (participant) => {
    const now = Date.now();
    const keys = [participant?.ownerId, participant?.id, participant?.name]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return keys.some((key) => now - Number(onlineSeenRef.current[key] || 0) < 30000);
  };

  const blocked = () => alert("리더 또는 운영자만 사용할 수 있습니다.");

  const selfState = investigation?.participantStates?.[character?.name || ""] || null;
  const muted = !!(selfState?.mutedUntil && Number(selfState.mutedUntil) > Date.now());
  const canSpeak = (!selfState || Number(selfState.hp || 0) > 0) && !muted && investigation?.type !== "daily";
  const livePendingBattleActions = investigation?.pendingBattleActions || {};

  useEffect(() => {
    if (previewMode || !battleActive || !investigationId) {
      setBattleTurnStartedAt(0);
      return;
    }
    setBattleTurnStartedAt(Date.now());
  }, [previewMode, battleActive, investigationId, investigation?.battleTurn, currentNodeId]);

  useEffect(() => {
    battleTimeoutHandlingRef.current = "";
  }, [investigationId, investigation?.battleTurn, battleActive]);

  const sendAdminNotice = async () => {
    const text = input.trim();
    if (!isAdmin || !text) return;
    setInput("");
    const message = {
      name: "운영",
      text,
      image: "",
      createdAt: new Date().toISOString(),
      isAdminNotice: true,
    };
    const res = await apiFetch("/investigationChat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ investigationId, message }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "공지 전송에 실패했습니다.");
      return;
    }
    setStickToBottom(true);
    loadChats();
  };

  const sendChat = async () => {
    if (endedReadonly) return;
    const text = input.trim();
    if (!text) return;
    if (!character) return;
    if (!canSpeak) {
      alert(muted ? "현재 채팅할 수 없는 상태입니다." : "HP가 0인 상태에서는 채팅할 수 없습니다.");
      return;
    }
    setInput("");
    const message = { name: character.name, text, image: character.image || "", createdAt: new Date().toISOString(), isAdminNotice: false };
    const res = await apiFetch("/investigationChat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ investigationId, message }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "채팅 전송에 실패했습니다.");
      return;
    }
    setStickToBottom(true);
    loadChats();
  };

  const leaveInvestigationView = async () => {
    try {
      if (investigation?.type === "daily" && investigation?.started && !investigation?.ended) {
        markDailyResume(investigationId, character);
      }
      if (!previewMode && !isSpectator && character?.name && investigationId) {
        await apiFetch("/leaveInvestigation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: investigationId, characterName: character.name }),
        });
      }
    } catch (err) {
      console.error("leaveInvestigation error", err);
    } finally {
      goBack?.();
    }
  };

  const moveTo = async (target) => {
    if (!canControl) return blocked();
    const res = await apiFetch("/moveInvestigation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ investigationId, targetNodeId: target }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "이동에 실패했습니다.");
      return;
    }
    loadInvestigation();
    loadCharacterInventory();
  };

  const runInvestigationButton = async (label) => {
    if (!canControl) return blocked();
    const res = await apiFetch("/investigationAction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ investigationId, actionName: label }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "조사 실행에 실패했습니다.");
      return;
    }
    loadInvestigation();
    loadCharacterInventory();
  };

  const fleeFromBattle = async () => {
    if (!canControl) return blocked();
    const res = await apiFetch("/battleAction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ investigationId, actionName: "도주" }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "도주 처리에 실패했습니다.");
      return;
    }
    if (data.character) {
      window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { character: data.character } }));
    }
    if (data.investigation) applyInvestigation(data.investigation);
    else loadInvestigation();
  };

  const saveMyBattleAction = async (actionOverride = "") => {
    if (!character || battleActionSubmitting) return;
    if (!selfState || Number(selfState.hp || 0) <= 0) {
      alert("행동할 수 없는 상태입니다.");
      return;
    }
    const nextAction = String(actionOverride || myBattleAction || "");
    if (!nextAction) {
      alert("행동을 먼저 골라주세요.");
      return;
    }
    setLocalPendingActions((prev) => ({ ...(prev || {}), [character.name]: nextAction }));
    setInvestigation((prev) => prev ? ({
      ...prev,
      pendingBattleActions: { ...(prev.pendingBattleActions || {}), [character.name]: nextAction },
    }) : prev);
    setEditingSavedAction(false);
    setBattleActionSubmitting(true);
    try {
      const res = await apiFetch("/setBattleAction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ investigationId, characterName: character.name, actionName: nextAction }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.message || "행동 저장에 실패했습니다.");
        loadInvestigation();
        return;
      }
      if (data.autoSubmitted && Array.isArray(data.lastBattleRound) && data.lastBattleRound.length > 0) {
        postPlaybackRefreshRef.current = true;
      }
      if (data.investigation) {
        applyInvestigation(data.investigation);
      } else {
        setInvestigation((prev) => prev ? ({
          ...prev,
          pendingBattleActions: data.autoSubmitted ? {} : (data.pendingBattleActions || { ...(prev.pendingBattleActions || {}), [character.name]: nextAction }),
          participantStates: data.autoSubmitted ? (data.participantStates || prev.participantStates) : (data.participantStates || prev.participantStates),
          battleTurn: data.battleTurn || prev.battleTurn,
          lastBattleRound: Array.isArray(data.lastBattleRound) ? data.lastBattleRound : prev.lastBattleRound,
        }) : prev);
      }
      if (data.currentNodeId) setCurrentNodeId(data.currentNodeId);
      setActionPicker("");
      if (data.autoSubmitted) {
        setMyBattleAction("");
        setEditingSavedAction(true);
      }
    } catch (err) {
      console.error("saveMyBattleAction error", err);
      alert("행동 저장 중 오류가 발생했습니다.");
      loadInvestigation();
    } finally {
      setBattleActionSubmitting(false);
    }
  };

  const chooseBattleAction = (actionName) => {
    if (battleInputLocked || battleActionSubmitting || !actionName) return;
    skipAutoActionSyncRef.current = true;
    setMyBattleAction(actionName);
    saveMyBattleAction(actionName);
  };

  const submitBattleTurn = async () => {
    if (!canControl) return blocked();
    const res = await apiFetch("/submitBattleTurn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ investigationId }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "턴 처리에 실패했습니다.");
      return;
    }
    if (data.investigation) applyInvestigation(data.investigation);
    else loadInvestigation();
  };

  const endInvestigationNow = async () => {
    if (!(isAdmin || canControl)) return blocked();
    const res = await apiFetch("/endInvestigationOnly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: investigationId, endedBy: isAdmin ? "운영자" : character?.name || "리더" }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "조사 종료에 실패했습니다.");
      return;
    }
    setShowResult(true);
    window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { force: true } }));
    loadInvestigation();
  };

  useEffect(() => {
    if (!investigation || !character?.name) return;
    const pending = investigation.pendingBattleActions?.[character.name];
    if (pending) {
      if (skipAutoActionSyncRef.current) return;
      setMyBattleAction(pending);
      return;
    }
    skipAutoActionSyncRef.current = false;
    setMyBattleAction("");
    setActionPicker("");
  }, [investigation?.battleTurn, investigation?.pendingBattleActions, character?.name]);
  useEffect(() => {
    if (!investigation || !character?.name) return;
    const turn = Number(investigation?.battleTurn || 0);
    if (prevBattleTurnRef.current && turn !== prevBattleTurnRef.current) {
      skipAutoActionSyncRef.current = false;
      setMyBattleAction("");
      setActionPicker("");
      setEditingSavedAction(true);
      setBattleActionSubmitting(false);
      setStagedBattleLogs([]);
      setLocalPendingActions({});
      setInvestigation((prev) => (prev ? { ...prev, pendingBattleActions: {} } : prev));
    }
    prevBattleTurnRef.current = turn;
  }, [investigation?.battleTurn, character?.name]);

  const investigationButtons = currentNode?.investigations || [];
  const effectiveChoices = (() => {
    if (!currentNode) return [];
    const direct = Array.isArray(currentNode?.choices) ? currentNode.choices.map((choice) => ({ ...choice })) : [];
    const nodes = investigation?.data?.nodes || {};
    Object.entries(nodes).forEach(([nodeId, node]) => {
      if (nodeId === currentNodeId) return;
      const reverseSource = Array.isArray(node?.choices)
        ? node.choices.find((choice) => String(choice?.target || "") === String(currentNodeId))
        : null;
      if (!reverseSource) return;
      if (direct.some((choice) => String(choice?.target || "") === String(nodeId))) return;
      const reverseLabel = oppositeDirectionLabel(reverseSource.text) || node.name || "되돌아가기";
      direct.push({ text: reverseLabel, target: nodeId, generatedReverse: true });
    });
    return direct;
  })();
  const directionalChoices = buildDirectionalChoices(effectiveChoices);
  const endedReadonly = !!isSpectator && !!investigation?.ended;
  const routeHistory = Array.isArray(investigation?.routeHistory) ? investigation.routeHistory : [];
  const endConfirmations = Array.isArray(investigation?.endConfirmations) ? investigation.endConfirmations : [];
  const hasConfirmedExit = character?.name ? endConfirmations.includes(character.name) : false;
  const totalNodeCount = Number(investigation?.totalNodeCount ?? (Object.keys(investigation?.data?.nodes || {}).length || 0));
  const visitedNodeCount = Number(investigation?.visitedNodeCount ?? Array.from(new Set(routeHistory.map((entry) => entry.nodeId))).length);
  const visitProgressPercent = Number(investigation?.visitProgressPercent ?? (totalNodeCount > 0 ? Math.min(100, Math.round((visitedNodeCount / totalNodeCount) * 100)) : 0));
  const totalInvestigationActionCount = Number(investigation?.totalInvestigationActionCount ?? Object.values(investigation?.data?.nodes || {}).reduce((sum, node) => {
    const fromList = Array.isArray(node?.investigations) ? node.investigations.filter(Boolean).length : 0;
    const fromResults = Object.keys(node?.actionResults || {}).length;
    return sum + Math.max(fromList, fromResults);
  }, 0));
  const completedInvestigationActionCount = Number(investigation?.completedInvestigationActionCount ?? Object.keys(investigation?.discoveredFlags || {}).length);
  const totalProgressCount = totalNodeCount + totalInvestigationActionCount;
  const completedProgressCount = visitedNodeCount + completedInvestigationActionCount;
  const overallProgressPercent = Number(investigation?.overallProgressPercent ?? (totalProgressCount > 0 ? Math.min(100, Math.round((completedProgressCount / totalProgressCount) * 100)) : 0));
  const progressDisplayPercent = overallProgressPercent;
  const foundItems = Array.isArray(investigation?.foundItems) ? investigation.foundItems : [];
  const foundNPCs = Array.isArray(investigation?.foundNPCs) ? investigation.foundNPCs : [];
  const rewards = Array.isArray(investigation?.rewards) ? investigation.rewards : [];
  const clues = Array.isArray(investigation?.clues) ? investigation.clues : [];
  const pendingReward = investigation?.pendingReward || null;

  useEffect(() => {
    const rewardKey = pendingReward ? `${pendingReward.type || ""}:${pendingReward.label || pendingReward.value || ""}` : "";
    if (!pendingReward) {
      dailyRewardAutoRef.current = "";
      return;
    }
    if (!isDaily) return;
    const solo = (participants || [])[0];
    if (!solo?.name) return;
    if (dailyRewardAutoRef.current === rewardKey) return;
    dailyRewardAutoRef.current = rewardKey;
    assignReward(solo.name);
  }, [pendingReward, isDaily, participants]);
  const activeNpcScene = investigation?.activeNpcScene || null;
  const npcLineIndex = typeof investigation?.npcLineIndex === "number" ? investigation.npcLineIndex : 0;
  const currentNpcLine = activeNpcScene?.lines?.[npcLineIndex] || null;
  const npcOptions = Array.isArray(currentNpcLine?.options)
    ? currentNpcLine.options
        .map((option, originalIndex) => ({ ...option, originalIndex }))
        .filter((option) => option && String(option.text || "").trim())
    : [];
  const npcHasChoices = npcOptions.length > 0;
  const blockByReward = !!pendingReward && !isDaily;
  const blockByNpc = !!activeNpcScene;
  const explorationLocked = blockByReward || blockByNpc || endedReadonly;
  const participantStates = investigation?.participantStates || {};
  const displayLogs = liveDisplayLogs;
  const displayParticipantStates = playbackState?.participantStates || participantStates;
  const displayCurrentNode = playbackState?.battle
    ? { ...currentNode, battle: { ...(currentNode?.battle || {}), ...playbackState.battle } }
    : currentNode;
  const showBanner = !!investigation?.eventBanner && Number(investigation?.eventBannerUntil || 0) > nowTick;
  const pendingActions = pendingActionsEarly || {};
  const aliveParticipants = participants.filter((p) => !p?.isAdmin && String(p?.id || "") !== "admin" && String(p?.ownerId || "") !== "admin" && p?.name !== "운영자").filter((p) => Number(displayParticipantStates[p.name]?.hp || 0) > 0);
  const spectators = participants.filter((p) => !p?.isAdmin && String(p?.id || "") !== "admin" && String(p?.ownerId || "") !== "admin" && p?.name !== "운영자").filter((p) => Number(displayParticipantStates[p.name]?.hp || 0) <= 0);
  const leaderDown = leaders.some((name) => Number(participantStates[name]?.hp || 0) <= 0);
  const aliveNames = aliveParticipants.map((p) => p.name);
  const battleItemOptions = foundItems.filter((item) => item === "응급 붕대" || item === "소독약");
  const battleTurnRemainingMs = battleActive && battleTurnStartedAt
    ? Math.max(0, (battleTurnStartedAt + BATTLE_TURN_LIMIT_MS) - nowTick)
    : BATTLE_TURN_LIMIT_MS;
  const battleTimeoutReached = battleActive && battleTurnRemainingMs <= 0;
  const battleReadyCount = aliveParticipants.filter((participant) => !!pendingActions?.[participant.name]).length;
  const battlePhaseLabel = getBattlePhaseText({
    battleActive,
    pendingReward,
    readyCount: battleReadyCount,
    aliveCount: aliveParticipants.length,
    endedReadonly,
  });
  const battleSkillOptions = Array.isArray(character?.skills) && character.skills.length > 0
    ? character.skills.map((skill) => {
        const normalized = typeof skill === "string" ? { key: skill, name: skill } : skill;
        const cooldownLeft = getSkillCooldown(selfState, normalized);
        return { ...normalized, cooldownLeft };
      })
    : [];
  useEffect(() => {
    if (!battleActive) {
      setBattleReadyUntil(0);
      return;
    }
    setBattleReadyUntil((prev) => Math.max(prev, Date.now() + 120));
  }, [battleActive, investigation?.battleTurn, currentNodeId]);

  const battleInputLocked = battlePlaybackLocked || (battleActive && nowTick < battleReadyUntil);

  useEffect(() => {
    if (!battleActive) return;
    if (!character?.name) return;
    const pending = investigation?.pendingBattleActions?.[character.name];
    if (!pending) {
      setMyBattleAction("");
      setActionPicker("");
      setEditingSavedAction(true);
    }
  }, [battleActive, investigation?.pendingBattleActions, investigation?.battleTurn, character?.name]);

  useEffect(() => {
    if (previewMode || !battleActive || battlePlaybackLocked || !battleTimeoutReached || !investigationId) return;
    const turnKey = `${investigationId}:${Number(investigation?.battleTurn || 1)}`;
    if (battleTimeoutHandlingRef.current === turnKey) return;

    const aliveMissingParticipants = aliveParticipants.filter((participant) => !livePendingBattleActions?.[participant.name]);
    if (!aliveMissingParticipants.length) return;

    const canAutoResolveAll = !!(isAdmin || canControl);
    const selfMissing = !!(character?.name && aliveMissingParticipants.some((participant) => participant.name === character.name));
    if (!canAutoResolveAll && !selfMissing) return;

    battleTimeoutHandlingRef.current = turnKey;

    const fillAndSubmitBattleTurn = async () => {
      try {
        const targets = canAutoResolveAll
          ? aliveMissingParticipants.map((participant) => participant.name)
          : selfMissing
            ? [character.name]
            : [];

        for (const targetName of targets) {
          const res = await apiFetch("/setBattleAction", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ investigationId, characterName: targetName, actionName: "방어" }),
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.message || "자동 방어 처리 실패");
          if (data.investigation) applyInvestigation(data.investigation);
        }

        if (canAutoResolveAll) {
          const submitRes = await apiFetch("/submitBattleTurn", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ investigationId }),
          });
          const submitData = await submitRes.json();
          if (!submitData.success) throw new Error(submitData.message || "자동 턴 진행 실패");
          if (submitData.investigation) applyInvestigation(submitData.investigation);
          else loadInvestigation();
        } else {
          loadInvestigation();
        }
      } catch (err) {
        console.error("battle timeout auto resolve error", err);
      }
    };

    fillAndSubmitBattleTurn();
  }, [previewMode, battleActive, battlePlaybackLocked, battleTimeoutReached, investigationId, investigation?.battleTurn, livePendingBattleActions, aliveParticipants, isAdmin, canControl, character?.name]);

  useEffect(() => {
    const rounds = Array.isArray(investigation?.lastBattleRound) ? investigation.lastBattleRound : [];
    const canReplay = !!currentNode?.battle || rounds.length > 0;
    if (!canReplay || rounds.length === 0) {
      playbackSourceRef.current = null;
      setStagedBattleLogs([]);
      setPlaybackState(null);
      battlePlaybackLockStartedRef.current = 0;
      setBattlePlaybackLocked(false);
      const queuedState = queuedStateUpdateRef.current;
      queuedStateUpdateRef.current = null;
      if (queuedState) applyInvestigation(queuedState);
      return undefined;
    }
    const key = `${investigation?.battleTurn || 0}:${rounds.map((entry) => `${entry.phase || "normal"}:${entry.text || ""}`).join("|")}`;
    if (autoBattleSubmitRef.current === `replay:${key}`) return undefined;
    autoBattleSubmitRef.current = `replay:${key}`;
    setMyBattleAction("");
    setActionPicker("");
    setEditingSavedAction(true);
    playbackSourceRef.current = null;
    const visibleEntries = rounds.filter((entry) => entry?.text);
    const now = Date.now();
    const baseParticipantStates = JSON.parse(JSON.stringify(playbackSourceRef.current?.participantStates || investigation?.participantStates || {}));
    const battleSource = playbackSourceRef.current?.battle || currentNode?.battle || null;
    const baseBattle = battleSource ? JSON.parse(JSON.stringify(battleSource)) : null;
    let cursor = now;
    const scheduledEntries = visibleEntries.map((entry, index) => {
      const timings = getBattlePlaybackTimings(entry, index);
      const appearedAt = cursor + Number(timings.beforeLog || 0);
      const snapshotAt = entry?.snapshot ? appearedAt + Number(timings.beforeSnapshot || 0) : 0;
      cursor = appearedAt + Number(timings.totalAfterLog || 0);
      return { ...entry, appearedAt, snapshotAt };
    });
    setPlaybackState({ active: true, participantStates: baseParticipantStates, battle: baseBattle });
    setStagedBattleLogs(scheduledEntries);
    const snapshotTimers = scheduledEntries
      .filter((entry) => entry?.snapshot && Number(entry?.snapshotAt || 0) > 0)
      .map((entry) => setTimeout(() => {
        setPlaybackState({
          active: true,
          participantStates: JSON.parse(JSON.stringify(entry.snapshot.participantStates || baseParticipantStates)),
          battle: {
            ...(JSON.parse(JSON.stringify(baseBattle || {})) || {}),
            hp: Number(entry.snapshot.battleHp ?? baseBattle?.hp ?? 0),
            maxHp: Number(entry.snapshot.battleMaxHp ?? baseBattle?.maxHp ?? baseBattle?.hp ?? 0),
          },
        });
      }, Math.max(0, Number(entry.snapshotAt || 0) - now)));
    requestAnimationFrame(() => {
      if (logScrollRef.current && stickLogsToBottom) {
        logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
      }
    });
    battlePlaybackLockStartedRef.current = now;
    setBattlePlaybackLocked(true);
    const playbackDuration = Math.max(980, cursor - now + 240);
    const unlockTimer = setTimeout(() => {
      const queuedState = queuedStateUpdateRef.current;
      queuedStateUpdateRef.current = null;
      setLogs((Array.isArray(investigation?.sharedLogs) ? investigation.sharedLogs : []).slice(-160));
      setPlaybackState(null);
      setBattlePlaybackLocked(false);
      battlePlaybackLockStartedRef.current = 0;
      setTimeout(() => setStagedBattleLogs([]), 90);
      if (queuedState) applyInvestigation(queuedState);
    }, playbackDuration);
    return () => {
      snapshotTimers.forEach((timer) => clearTimeout(timer));
      clearTimeout(unlockTimer);
    };
  }, [battleActive, investigation?.battleTurn, investigation?.lastBattleRound, investigation?.sharedLogs, investigation?.participantStates, currentNode?.battle]);

  useEffect(() => {
    if (!battlePlaybackLocked) return undefined;
    skipAutoActionSyncRef.current = false;
    setMyBattleAction("");
    setActionPicker("");
    const hardTimeoutMs = Math.max(
      2600,
      ...stagedBattleLogs.map((entry) => Math.max(0, Number(entry?.appearedAt || 0) - Number(battlePlaybackLockStartedRef.current || 0), Number(entry?.snapshotAt || 0) - Number(battlePlaybackLockStartedRef.current || 0)) + 1200),
    );
    const timer = setInterval(() => {
      if (Date.now() - Number(battlePlaybackLockStartedRef.current || 0) > hardTimeoutMs) {
        battlePlaybackLockStartedRef.current = 0;
        setStagedBattleLogs([]);
        setPlaybackState(null);
        setBattlePlaybackLocked(false);
        const queuedState = queuedStateUpdateRef.current;
        queuedStateUpdateRef.current = null;
        if (queuedState) {
          const queuedRoundKey = getBattleRoundKey(queuedState);
          if (queuedRoundKey && queuedRoundKey === handledBattleRoundKeyRef.current) loadInvestigation();
          else applyInvestigation(queuedState);
        }
      }
    }, 160);
    return () => clearInterval(timer);
  }, [battlePlaybackLocked, stagedBattleLogs]);

  useEffect(() => {
    if (!battlePlaybackLocked) return undefined;
    if (stagedBattleLogs.length > 0) return undefined;
    const timer = setTimeout(() => {
      battlePlaybackLockStartedRef.current = 0;
      setBattlePlaybackLocked(false);
      const queuedState = queuedStateUpdateRef.current;
      queuedStateUpdateRef.current = null;
      if (queuedState) {
        const queuedRoundKey = getBattleRoundKey(queuedState);
        if (queuedRoundKey && queuedRoundKey === handledBattleRoundKeyRef.current) loadInvestigation();
        else applyInvestigation(queuedState);
      } else if (postPlaybackRefreshRef.current) {
        postPlaybackRefreshRef.current = false;
        loadInvestigation();
      }
    }, 320);
    return () => clearTimeout(timer);
  }, [battlePlaybackLocked, stagedBattleLogs.length, previewMode]);

  useEffect(() => {
    if (battleActive) return;
    if (Object.keys(localPendingActions || {}).length === 0) return;
    setLocalPendingActions({});
  }, [battleActive, localPendingActions]);

  useEffect(() => {
    if (endedReadonly) {
      setShowResult(false);
    }
  }, [endedReadonly]);

  useEffect(() => {
    if (endedReadonly) {
      endedResultOpenedRef.current = false;
      setShowResult(false);
      return;
    }
    if (!investigation?.ended) {
      endedResultOpenedRef.current = false;
      return;
    }
    if (battlePlaybackLocked || stagedBattleLogs.length > 0) {
      setShowResult(false);
      return;
    }
    if (!endedResultOpenedRef.current) {
      endedResultOpenedRef.current = true;
      setShowResult(true);
    }
  }, [investigation?.ended, endedReadonly, battlePlaybackLocked, stagedBattleLogs.length]);

  if (!investigation || !currentNodeId || !currentNode) {
    return (
      <DesignPageFrame design={design} pageKey={pageKey} handlers={{}} theme={theme} minHeight="100vh" contentStyle={{ padding: 0 }}>
        <div style={{ minHeight: "100vh", color: "white", padding: "20px" }}>불러오는 중...</div>
      </DesignPageFrame>
    );
  }

  const onChatScroll = (e) => {
    const target = e.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 24;
    setStickToBottom(nearBottom);
    if (nearBottom) setShowNewChatCue(false);
  };

  const onLogScroll = (e) => {
    const target = e.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 24;
    setStickLogsToBottom(nearBottom);
    if (nearBottom) setShowNewLogCue(false);
  };


  const assignReward = async (receiverName) => {
    if (!isDaily && !isAdmin && !isLeader) {
      blocked();
      return;
    }
    const res = await apiFetch("/assignInvestigationReward", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ investigationId, receiverName, actorName: character?.name || "", isAdmin: !!isAdmin }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "보상 배분에 실패했습니다.");
      return;
    }
    window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { force: true } }));
    loadInvestigation();
  };

  const dismissEndNotice = async () => {
    await apiFetch("/dismissEndNotice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ investigationId }),
    });
    loadInvestigation();
  };

  const confirmExit = async () => {
    if (hasConfirmedExit) {
      goBack();
      return;
    }
    if (!character?.name) {
      goBack();
      return;
    }
    const res = await apiFetch("/confirmInvestigationExit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ investigationId, characterName: character.name }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "확인 처리에 실패했어.");
      return;
    }
    goBack();
  };

  const advanceNpc = async () => {
    const res = await apiFetch("/advanceNpcScene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ investigationId }),
    });
    const data = await res.json();
    if (!data.success) {
      const message = String(data.message || "");
      if (message.includes("진행 중인 NPC 대화가 없습니다") || message.includes("선택지를 골라야 합니다")) {
        loadInvestigation();
        return;
      }
      alert(data.message || "다음 대사로 진행할 수 없습니다.");
      return;
    }
    loadInvestigation();
  };

  const chooseNpcOption = async (optionIndex) => {
    const res = await apiFetch("/chooseNpcOption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ investigationId, optionIndex }),
    });
    const data = await res.json();
    if (!data.success) {
      if (String(data.message || "").includes("진행 중인 NPC 대화가 없습니다")) {
        loadInvestigation();
        return;
      }
      alert(data.message || "선택지를 처리할 수 없습니다.");
      return;
    }
    loadInvestigation();
  };

  const reassignLeader = async (leaderName) => {
    const res = await apiFetch("/reassignInvestigationLeader", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ investigationId, leaderName }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "리더 재지정에 실패했습니다.");
      return;
    }
    loadInvestigation();
  };



          return (
    <DesignPageFrame design={design} pageKey={pageKey} handlers={{}} theme={theme} minHeight="100vh" contentStyle={{ padding: 0 }}>
      <>
        {showItems && (
          <OverlayPanel title="조사 아이템" onClose={() => setShowItems(false)}>
            <div style={overlaySectionTitleStyle}>이 조사에서 획득한 아이템</div>
            {foundItems.length > 0 ? (
              <div style={overlayListStyle}>{foundItems.map((item, idx) => <div key={`${item}-${idx}`} style={overlayBadgeStyle}>{item}</div>)}</div>
            ) : <div style={overlayEmptyStyle}>아직 획득한 조사 아이템이 없습니다.</div>}
            <div style={overlaySectionTitleStyle}>발견 NPC</div>
            {foundNPCs.length > 0 ? (
              <div style={overlayListStyle}>{foundNPCs.map((npc, idx) => <div key={`${npc}-${idx}`} style={overlayBadgeStyle}>{npc}</div>)}</div>
            ) : <div style={overlayEmptyStyle}>아직 발견한 NPC가 없습니다.</div>}
          </OverlayPanel>
        )}

        {showInventory && (
          <OverlayPanel title="인벤토리" onClose={() => setShowInventory(false)}>
            <div style={overlaySectionTitleStyle}>현재 소지 중인 아이템</div>
            {inventoryItems.length > 0 ? (
              <div style={overlayListStyle}>{inventoryItems.map((item, idx) => <div key={`${item}-${idx}`} style={overlayBadgeStyle}>{item}</div>)}</div>
            ) : <div style={overlayEmptyStyle}>현재 소지 중인 아이템이 없습니다.</div>}
          </OverlayPanel>
        )}

        {showMap && (
          <OverlayPanel title="지도" onClose={() => setShowMap(false)}>
            <InvestigationMapCanvas investigation={investigation} participants={participants} leaders={leaders} />
            <div style={{ marginTop: 14 }}>
              <div style={overlaySectionTitleStyle}>방문 순서</div>
              {getUniqueRouteSteps(routeHistory).length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {getUniqueRouteSteps(routeHistory).map((entry, index) => (
                    <div key={`${entry.nodeId}-${index}`} style={overlayRouteCardStyle}>
                      <div style={{ fontWeight: 800 }}>{index + 1}. {entry.name}</div>
                      <div style={{ marginTop: 4, color: "#9fb0c7", fontSize: 13 }}>{formatRouteTime(entry.time)}</div>
                    </div>
                  ))}
                </div>
              ) : <div style={overlayEmptyStyle}>아직 방문 기록이 없습니다.</div>}
            </div>
          </OverlayPanel>
        )}

        {actionPicker === "item" && (
          <OverlayPanel title="전투 아이템" onClose={() => setActionPicker("")}>
            {battleItemOptions.length > 0 ? (
              <div style={{ display: "grid", gap: "10px" }}>
                {battleItemOptions.map((item, idx) => (
                  <button key={`${item}-${idx}`} type="button" className="ghost-button" onClick={() => { chooseBattleAction(`아이템::${item}`); }}>
                    {item}
                  </button>
                ))}
              </div>
            ) : <div style={overlayEmptyStyle}>사용 가능한 전투 아이템이 없습니다.</div>}
          </OverlayPanel>
        )}

        {actionPicker === "skill" && (
          <OverlayPanel title="전투 스킬" onClose={() => setActionPicker("")}>
            {battleSkillOptions.length > 0 ? (
              <div style={{ display: "grid", gap: "10px" }}>
                {battleSkillOptions.map((skill, idx) => {
                  const disabled = Number(skill.cooldownLeft || 0) > 0;
                  return (
                    <button
                      key={`${skill.key || skill.name}-${idx}`}
                      type="button"
                      className="ghost-button"
                      onClick={() => { if (disabled) return; chooseBattleAction(`스킬::${skill.key || skill.name}`); }}
                      disabled={disabled}
                      style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                    >
                      <div style={{ fontWeight: 800 }}>{skill.name || skill.key}</div>
                      <div style={{ color: "#9fb0c7", marginTop: 6 }}>{skill.desc || ""}</div>
                      {disabled ? <div style={{ color: "#fca5a5", marginTop: 6, fontSize: 12 }}>재사용까지 {skill.cooldownLeft}턴</div> : null}
                    </button>
                  );
                })}
              </div>
            ) : <div style={overlayEmptyStyle}>사용 가능한 스킬이 없습니다.</div>}
          </OverlayPanel>
        )}

        {showInfo && (
          <OverlayPanel title="조사 인원" onClose={() => setShowInfo(false)}>
            {participants.length > 0 ? (
              <div style={{ display: "grid", gap: "10px" }}>
                {participants.map((participant) => {
                  const state = participantStates[participant.name] || {};
                  const maxHp = Number(state.maxHp || participant.stats?.hp || 0);
                  const hp = Number(state.hp || participant.stats?.hp || 0);
                  const hpPercent = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
                  const dead = maxHp > 0 && hp <= 0;
                  return (
                    <div key={participant.name} style={{ ...participantStateRowStyle, background: dead ? "rgba(127,29,29,0.18)" : participantStateRowStyle.background, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                        <div style={smallPortraitStyle}>
                          {participant.image ? <img src={participant.image} alt={participant.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                        </div>
                        <div>
                          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                            <div style={{ fontWeight: 800 }}>{participant.name}</div>
                            {leaders.includes(participant.name) && <div style={leaderBadgeStyle}>리더</div>}
                            {isParticipantOnline(participant) ? <div style={onlineBadgeStyle}>온라인</div> : <div style={{ ...onlineBadgeStyle, background: "rgba(148,163,184,0.18)", color: "#94a3b8" }}>오프라인</div>}
                            {dead && <div style={dangerBadgeStyle}>관전</div>}

                          </div>
                          <div style={{ marginTop: "6px", color: "#9fb0c7", fontSize: "13px" }}>
                            HP {hp}/{maxHp} / ATK {state.atk || participant.stats?.atk || 0} / DEF {state.def || participant.stats?.def || 0} / DEX {state.agi || participant.stats?.agi || 0}
                          </div>
                          <div style={miniBarTrackStyle}><div style={{ ...miniBarFillStyle, width: `${hpPercent}%` }} /></div>
                          {state.status ? <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>{state.status}</div> : null}
                        </div>
                      </div>
                      {isAdmin ? (
                        <button type="button" className="ghost-button" onClick={() => reassignLeader(participant.name)}>
                          리더 지정
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
                  <div style={overlaySectionTitleStyle}>관전중</div>
                  {spectators.length > 0 ? (
                    <div style={{ display: "grid", gap: "8px" }}>
                      {spectators.map((spectator) => (
                        <div key={spectator.name} style={{ ...participantStateRowStyle, background: "rgba(127,29,29,0.14)" }}>
                          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                            <div style={smallPortraitStyle}>
                              {spectator.image ? <img src={spectator.image} alt={spectator.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                            </div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                              <div style={{ fontWeight: 800 }}>{spectator.name}</div>
                              {isParticipantOnline(spectator) ? <div style={onlineBadgeStyle}>온라인</div> : <div style={{ ...onlineBadgeStyle, background: "rgba(148,163,184,0.18)", color: "#94a3b8" }}>오프라인</div>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <div style={overlayEmptyStyle}>현재 관전 중인 캐릭터가 없습니다.</div>}
                </div>
              </div>
            ) : <div style={overlayEmptyStyle}>아직 참여 인원이 없습니다.</div>}
          </OverlayPanel>
        )}

        {showBanner && (
          <div style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: 1400, pointerEvents: "none" }}>
            <div style={{
              padding: "18px 28px",
              borderRadius: "999px",
              fontSize: "42px",
              fontWeight: 900,
              letterSpacing: "0.02em",
              color: "white",
              background: investigation.eventBannerType === "danger"
                ? "rgba(127,29,29,0.88)"
                : investigation.eventBannerType === "success"
                  ? "rgba(20,83,45,0.88)"
                  : "rgba(8,15,30,0.82)",
              boxShadow: "0 18px 40px rgba(0,0,0,0.28)",
            }}>
              {investigation.eventBanner}
            </div>
          </div>
        )}

        {showClues && (
          <OverlayPanel title={`단서 (${clues.length})`} onClose={() => setShowClues(false)}>
            {clues.length > 0 ? (
              <div style={{ display: "grid", gap: "12px" }}>
                {clues.map((clue) => (
                  <div key={clue.id} style={overlayRouteCardStyle}>
                    <div style={{ fontWeight: 800 }}>{clue.title}</div>
                    {clue.image ? <img src={clue.image} alt={clue.title} style={{ width: "100%", borderRadius: 16, marginTop: 8, maxHeight: 200, objectFit: "cover" }} /> : null}
                    {clue.text ? <div style={{ marginTop: 8, color: "#cbd5e1", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{clue.text}</div> : null}
                  </div>
                ))}
              </div>
            ) : <div style={overlayEmptyStyle}>아직 얻은 단서가 없습니다.</div>}
          </OverlayPanel>
        )}

        {activeNpcScene && currentNpcLine ? (
          <div style={{ position: "fixed", inset: 0, zIndex: 1170, display: "grid", placeItems: "start center", pointerEvents: "none", paddingTop: 24 }}>
            <div
              onClick={() => {
                if (!npcHasChoices) {
                  advanceNpc();
                }
              }}
              style={{
                width: "min(980px, calc(100vw - 48px))",
                borderRadius: 24,
                background: "rgba(8,15,30,0.9)",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 24px 56px rgba(0,0,0,0.34)",
                padding: 20,
                pointerEvents: "auto",
                cursor: npcHasChoices ? "default" : "pointer",
                display: "grid",
                gridTemplateColumns: (activeNpcScene.npcProfileImage || activeNpcScene.profileImage) ? "180px 1fr" : "1fr",
                gap: 18,
                alignItems: "stretch",
              }}
            >
              {(activeNpcScene.npcProfileImage || activeNpcScene.profileImage) ? (
                <div style={{ borderRadius: 20, overflow: "hidden", background: "rgba(255,255,255,0.06)", height: 220, width: 180, minWidth: 180, maxWidth: 180, justifySelf: "start", alignSelf: "start", flexShrink: 0 }}>
                  <img src={activeNpcScene.npcProfileImage || activeNpcScene.profileImage} alt={activeNpcScene.name || "NPC"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              ) : null}

              <div style={{ display: "grid", minHeight: 0, maxHeight: "min(72vh, 640px)", gridTemplateRows: "auto auto minmax(0, 1fr) auto" }}>
                <div className="section-eyebrow">NPC</div>
                <div>
                  <h3 style={{ marginTop: 10 }}>{activeNpcScene.name || "NPC"}</h3>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <div style={{ ...topChipStyle, padding: "4px 10px" }}>대사 {npcLineIndex + 1}/{Array.isArray(activeNpcScene.lines) ? activeNpcScene.lines.length : 1}</div>
                    {npcHasChoices ? (
                      <div style={{ ...topChipStyle, padding: "4px 10px" }}>선택지 {npcOptions.length}개</div>
                    ) : (
                      <div style={{ ...topChipStyle, padding: "4px 10px" }}>클릭으로 다음 진행</div>
                    )}
                  </div>
                </div>

                <div style={{ color: "#dbe7f5", whiteSpace: "pre-wrap", lineHeight: 1.9, marginTop: 12, minHeight: 0, overflowY: "auto", paddingRight: 6 }}>
                  {currentNpcLine.text || ""}
                </div>

                {npcHasChoices ? (
                  <div style={{ display: "grid", gap: 10, marginTop: 16, justifyItems: "end" }}>
                    {currentNpcLine.options.map((option, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="home-primary-button"
                        onClick={() => chooseNpcOption(idx)}
                        style={{ minWidth: 220, justifySelf: "end" }}
                      >
                        {option.text || `선택 ${idx + 1}`}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 16 }}>
                    <div style={{ fontSize: 22, color: "#bfdbfe", transform: `translateY(${Math.sin(nowTick / 180) * 5}px)` }}>▾</div>
                    <button type="button" className="home-primary-button" onClick={advanceNpc}>다음</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {pendingReward && !isDaily ? (
          <div style={{ position: "fixed", inset: 0, zIndex: 1180, display: "grid", placeItems: "center", pointerEvents: "none" }}>
            <div style={{ width: "min(920px, calc(100vw - 48px))", borderRadius: 28, background: "rgba(8,15,30,0.9)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 24px 56px rgba(0,0,0,0.34)", padding: 24, pointerEvents: "auto" }}>
              <div className="section-eyebrow">REWARD ASSIGN</div>
              <h3 style={{ marginTop: 10, marginBottom: 8 }}>누구에게 줄까?</h3>
              <div style={{ color: "#fde68a", fontWeight: 800 }}>{formatPendingRewardLabel(pendingReward)} 획득 대기</div>
              <div style={{ marginTop: 8, color: "#9fb0c7", lineHeight: 1.7 }}>
                조사 참여 캐릭터 중 한 명을 골라 보상을 배분하세요. 배분이 끝나야 다음 진행으로 넘어갈 수 있습니다.
                {!isDaily && !isAdmin && !isLeader ? " 현재는 리더만 배분할 수 있어." : ""}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14, marginTop: 18 }}>
                {participants.map((participant) => {
                  const state = participantStates[participant.name] || {};
                  const dead = Number(state.hp || 0) <= 0;
                  return (
                    <button
                      key={participant.name}
                      type="button"
                      onClick={() => assignReward(participant.name)}
                      disabled={!isDaily && !isAdmin && !isLeader}
                      className="ghost-button"
                      style={{
                        minHeight: 150,
                        borderRadius: 24,
                        background: dead ? "rgba(127,29,29,0.16)" : "rgba(255,255,255,0.04)",
                        border: dead ? "1px solid rgba(248,113,113,0.18)" : "1px solid rgba(255,255,255,0.08)",
                        display: "grid",
                        placeItems: "center",
                        textAlign: "center",
                        opacity: !isDaily && !isAdmin && !isLeader ? 0.55 : 1,
                        cursor: !isDaily && !isAdmin && !isLeader ? "not-allowed" : "pointer",
                      }}
                    >
                      <div>
                        <div style={{ width: 72, height: 72, margin: "0 auto", borderRadius: "999px", overflow: "hidden", background: "rgba(255,255,255,0.08)", boxShadow: "0 10px 24px rgba(0,0,0,0.22)" }}>
                          {(participant.profileImage || participant.investigationImage || participant.image) ? (
                            <img src={participant.profileImage || participant.investigationImage || participant.image} alt={participant.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : null}
                        </div>
                        <div style={{ marginTop: 10, fontWeight: 900, color: "#e2e8f0" }}>{participant.name}</div>
                        <div style={{ marginTop: 6, fontSize: 12, color: dead ? "#fecaca" : "#9fb0c7" }}>{dead ? "HP 0 / 관전 중" : "배분 가능"}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {showResult && investigation.ended && !endedReadonly && (
          <OverlayPanel title="조사 결과" onClose={() => setShowResult(false)}>
            <div style={resultCardStyle}>
              <div style={{ fontSize: "28px", fontWeight: 900, marginBottom: "8px", color: investigation.endedReason === "전멸" ? "#fecaca" : "#bbf7d0" }}>
                {investigation.endedReason === "전멸" ? "FAILED" : "COMPLETE"}
              </div>
              <div style={{ color: "#dbe7f5", whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
                {investigation.resultSummary || investigation.endedReason || "조사가 종료되었습니다."}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                <div style={topChipStyle}>방문 {visitedNodeCount}/{totalNodeCount || "-"}</div>
                <div style={topChipStyle}>조사 {completedInvestigationActionCount}/{totalInvestigationActionCount || "-"}</div>
                <div style={topChipStyle}>진행률 {overallProgressPercent}%</div>
                <div style={topChipStyle}>아이템 {foundItems.length}개</div>
                <div style={topChipStyle}>단서 {clues.length}개</div>
                <div style={topChipStyle}>보상 {rewards.length}개</div>
              </div>
              <div style={{ marginTop: "12px", color: "#9fb0c7", lineHeight: 1.7 }}>
                완료 기준: 모든 구역 방문 및 조사<br />
                확인한 인원: {endConfirmations.join(", ") || "없음"}<br />
                전투 중 HP 0이었던 인원은 종료 시 HP 10으로 복구됩니다. 확인 버튼을 누르면 조사에서 나갑니다.
              </div>
            </div>
            {(foundItems.length > 0 || clues.length > 0 || rewards.length > 0) ? (
              <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                {foundItems.length > 0 ? (
                  <div style={overlayRouteCardStyle}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>획득 아이템</div>
                    <div style={overlayListStyle}>{foundItems.map((item, idx) => <div key={`${item}-${idx}`} style={overlayBadgeStyle}>{item}</div>)}</div>
                  </div>
                ) : null}
                {rewards.length > 0 ? (
                  <div style={overlayRouteCardStyle}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>기록된 보상</div>
                    <div style={overlayListStyle}>{rewards.map((reward, idx) => <div key={`${reward}-${idx}`} style={overlayBadgeStyle}>{reward}</div>)}</div>
                  </div>
                ) : null}
                {clues.length > 0 ? (
                  <div style={overlayRouteCardStyle}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>획득 단서</div>
                    <div style={overlayListStyle}>{clues.map((clue, idx) => <div key={`${clue.id || clue.title || idx}`} style={overlayBadgeStyle}>{clue.title || `단서 ${idx + 1}`}</div>)}</div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}>
              <button type="button" className="home-primary-button" style={{ flex: 1, minWidth: 160, opacity: hasConfirmedExit ? 0.72 : 1 }} onClick={confirmExit}>
                {hasConfirmedExit ? "뒤로가기" : "확인"}
              </button>
              <button type="button" className="ghost-button" onClick={leaveInvestigationView} style={{ flex: 1, minWidth: 160, color: "#f8fbff", fontWeight: 900, background: "rgba(59,130,246,0.34)", border: "1px solid rgba(191,219,254,0.26)", boxShadow: "0 12px 22px rgba(2,6,23,0.18)", backdropFilter: "blur(14px)" }}>뒤로가기</button>
            </div>
          </OverlayPanel>
        )}

        <div style={{ color: "white", padding: "8px 12px 12px", minHeight: "calc(100vh - 148px)", height: "calc(100vh - 148px)", overflow: "hidden", position: "relative" }}>
          <div style={{ position: "absolute", left: 14, top: 14, zIndex: 1050, display: "grid", gap: 8 }}>
            <div>
              <div className="section-eyebrow">{isDaily ? "DAILY INVESTIGATION" : "GROUP INVESTIGATION"}</div>
              <h2 style={{ marginTop: "8px", marginBottom: 0, color: "white" }}>{investigation.title}</h2>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="ghost-button" onClick={() => setShowInfo(true)} style={{ color: "#f8fbff", fontWeight: 900, background: "rgba(59,130,246,0.34)", border: "1px solid rgba(191,219,254,0.26)", boxShadow: "0 12px 22px rgba(2,6,23,0.18)", backdropFilter: "blur(14px)" }}>참여 인원</button>
              {isAdmin ? <button type="button" className="ghost-button" onClick={() => setShowInfo(true)} style={{ color: "#f8fbff", fontWeight: 900, background: "rgba(59,130,246,0.34)", border: "1px solid rgba(191,219,254,0.26)", boxShadow: "0 12px 22px rgba(2,6,23,0.18)", backdropFilter: "blur(14px)" }}>리더 지정</button> : null}
            </div>
          </div>
          <div style={{ position: "absolute", right: 14, top: 14, zIndex: 1050, display: "flex", gap: 8 }}>
            {(isAdmin || canControl) && !endedReadonly ? <button type="button" className="ghost-button" onClick={endInvestigationNow} style={{ background: "rgba(127,29,29,0.7)", color: "white", border: "none", boxShadow: "0 16px 32px rgba(127,29,29,0.2)", backdropFilter: "blur(14px)" }}>조사 종료</button> : null}
            <button type="button" className="ghost-button" onClick={leaveInvestigationView} style={{ color: "#f8fbff", fontWeight: 900, background: "rgba(59,130,246,0.34)", border: "1px solid rgba(191,219,254,0.26)", boxShadow: "0 12px 22px rgba(2,6,23,0.18)", backdropFilter: "blur(14px)" }}>뒤로가기</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "18px", alignItems: "start", minHeight: "100%" }}>
            <div style={{ display: "grid", gap: "18px", minHeight: "100%" }}>
              <div style={{ ...mainPanelStyle, position: "absolute", inset: 0, overflow: "hidden", paddingTop: 0, paddingLeft: isDaily ? 14 : CHAT_PANEL_WIDTH + 12, paddingRight: RIGHT_PANEL_WIDTH + 14, paddingBottom: battleActive ? 224 : 172 }}>
                <SceneVisualPanel currentNode={currentNode} battleActive={battleActive} leaders={leaders} participants={participants} activeNpcScene={activeNpcScene} pendingReward={pendingReward} investigationBackgroundImage={investigation?.data?.backgroundImage || investigation?.mapBackgroundImage || ""} nowTick={nowTick} isDaily={investigation?.type === "daily"} />
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "start", marginTop: "16px" }}>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", position: "absolute", left: "50%", top: 16, transform: "translateX(-50%)", justifyContent: "center", maxWidth: isDaily ? "calc(100% - 260px)" : `calc(100% - ${CENTER_TOP_CHIP_RESERVED_WIDTH})`, zIndex: 1050 }}>
                    <div style={{ ...topChipStyle, padding: "6px 12px", fontSize: 12 }}>리더: {leaders.length > 0 ? leaders.join(", ") : (isLeader ? character?.name || "없음" : "없음")}</div>
                    <div style={{ ...topChipStyle, padding: "6px 12px", fontSize: 12 }}>현재 위치: {currentNode?.name || "-"}</div>
                    <div style={{ ...topChipStyle, padding: "6px 12px", fontSize: 12 }}>진행률: {progressDisplayPercent}%</div>
                    {battleActive ? <div style={{ ...topChipStyle, padding: "6px 12px", fontSize: 12 }}>전투 턴 {investigation.battleTurn || 1}</div> : null}
                    {battleActive ? (
                      <div style={{ ...topChipStyle, padding: "6px 12px", fontSize: 12, color: battleTimeoutReached ? "#fecaca" : "#fef3c7" }}>
                        {battleTimeoutReached ? "시간 초과 · 자동 방어 진행 중" : `남은 시간 ${formatCountdown(battleTurnRemainingMs)}`}
                      </div>
                    ) : null}
                    {battleActive ? <div style={{ ...topChipStyle, padding: "6px 12px", fontSize: 12 }}>{battlePhaseLabel} · {battleReadyCount}/{aliveParticipants.length || 0}</div> : null}
                  </div>
                  {leaderDown ? (
                    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                      <div style={{ ...topChipStyle, background: "rgba(127,29,29,0.18)", color: "#fecaca", width: "fit-content" }}>
                        리더 재지정 필요
                      </div>
                      {isAdmin ? (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {aliveParticipants.length > 0 ? aliveParticipants.map((participant) => (
                            <button
                              key={`leader-reset-${participant.name}`}
                              type="button"
                              className="ghost-button"
                              onClick={() => reassignLeader(participant.name)}
                            >
                              {participant.name} 지정
                            </button>
                          )) : <div style={{ color: "#fecaca", fontSize: 12 }}>지정 가능한 생존 인원이 없습니다.</div>}
                        </div>
                      ) : (
                        <div style={{ color: "#fecaca", fontSize: 12 }}>운영자가 새 리더를 지정해야 합니다.</div>
                      )}
                    </div>
                  ) : null}
                </div>

                {!battleActive ? (
                  <div style={{ position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", width: isDaily ? "min(960px, calc(100% - 44px))" : "min(760px, calc(100% - 668px))", maxWidth: "calc(100% - 28px)", padding: "14px 18px", borderRadius: 28, background: "linear-gradient(180deg, rgba(4,10,22,0.44), rgba(4,10,22,0.72))", border: "none", boxShadow: "0 18px 40px rgba(2,6,23,0.16)", backdropFilter: "blur(16px)", zIndex: 1045 }}>
                    <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                      {directionalChoices.up ? <button type="button" onClick={() => moveTo(directionalChoices.up.target)} disabled={explorationLocked} style={{ ...moveButtonStyle, opacity: explorationLocked ? 0.55 : 1 }}>{directionalChoices.up.text}</button> : null}
                      {directionalChoices.left ? <button type="button" onClick={() => moveTo(directionalChoices.left.target)} disabled={explorationLocked} style={{ ...moveButtonStyle, opacity: explorationLocked ? 0.55 : 1 }}>{directionalChoices.left.text}</button> : null}
                      {directionalChoices.right ? <button type="button" onClick={() => moveTo(directionalChoices.right.target)} disabled={explorationLocked} style={{ ...moveButtonStyle, opacity: explorationLocked ? 0.55 : 1 }}>{directionalChoices.right.text}</button> : null}
                      {directionalChoices.down ? <button type="button" onClick={() => moveTo(directionalChoices.down.target)} disabled={explorationLocked} style={{ ...moveButtonStyle, opacity: explorationLocked ? 0.55 : 1 }}>{directionalChoices.down.text}</button> : null}
                      {directionalChoices.misc.map((choice) => (
                        <button key={`${choice.text}-${choice.target}`} type="button" onClick={() => moveTo(choice.target)} disabled={explorationLocked} style={{ ...moveButtonStyle, opacity: explorationLocked ? 0.55 : 1 }}>{choice.text}</button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center", marginTop: 12 }}>
                      {investigationButtons.length > 0 ? (
                        investigationButtons.map((label) => (
                          <button key={label} type="button" onClick={() => runInvestigationButton(label)} disabled={explorationLocked} style={{ ...actionButtonStyle, opacity: explorationLocked ? 0.55 : 1 }}>{label}</button>
                        ))
                      ) : <div style={{ color: "#cbd5e1", fontSize: 13 }}>이 위치에서 가능한 조사가 없어.</div>}
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ position: "absolute", left: "50%", bottom: 154, transform: "translateX(-50%)", width: isDaily ? "min(940px, calc(100% - 44px))" : "min(760px, calc(100% - 668px))", maxWidth: "calc(100% - 28px)", padding: "0 18px", borderRadius: 0, background: "transparent", border: "none", boxShadow: "none", backdropFilter: "none", zIndex: 1045 }}>
                      <BattleHero node={displayCurrentNode} investigation={investigation} rounds={stagedBattleLogs} compact nowTick={nowTick} battlePlaybackLocked={battlePlaybackLocked} />
                      <div style={{ marginTop: 12 }}>
                        <BattlePartyStrip participants={participants} participantStates={displayParticipantStates} pendingActions={pendingActions} rounds={stagedBattleLogs} nowTick={nowTick} compact battlePlaybackLocked={battlePlaybackLocked} />
                      </div>
                    </div>
                    <div style={{ position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", width: isDaily ? "min(960px, calc(100% - 44px))" : "min(760px, calc(100% - 668px))", maxWidth: "calc(100% - 28px)", padding: "14px 18px", borderRadius: 28, background: "linear-gradient(180deg, rgba(4,10,22,0.44), rgba(4,10,22,0.72))", border: "none", boxShadow: "0 18px 40px rgba(2,6,23,0.16)", backdropFilter: "blur(16px)", zIndex: 1045 }}>
                      {selfState && Number(selfState.hp || 0) > 0 ? (
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
                          <button type="button" className={`ghost-button ${myBattleAction.startsWith("공격") ? "is-tab-active" : ""}`} onClick={() => chooseBattleAction("공격")} disabled={battleInputLocked}>공격</button>
                          <button type="button" className={`ghost-button ${myBattleAction.startsWith("방어") ? "is-tab-active" : ""}`} onClick={() => chooseBattleAction("방어")} disabled={battleInputLocked}>방어</button>
                          <button type="button" className={`ghost-button ${myBattleAction.startsWith("아이템") ? "is-tab-active" : ""}`} onClick={() => { if (battleInputLocked) return; setActionPicker("item"); }} disabled={battleInputLocked} style={{ color: "#f8fbff", fontWeight: 900, background: "rgba(59,130,246,0.34)", border: "1px solid rgba(191,219,254,0.26)", boxShadow: "0 12px 22px rgba(2,6,23,0.18)", backdropFilter: "blur(14px)" }}>아이템</button>
                          <button type="button" className={`ghost-button ${myBattleAction.startsWith("스킬") ? "is-tab-active" : ""}`} onClick={() => { if (battleInputLocked) return; if (!battleSkillOptions.length) { alert("보유한 스킬이 없어."); return; } setActionPicker("skill"); }} disabled={battleInputLocked || battleSkillOptions.length === 0}>스킬</button>
                          {canControl ? <button type="button" onClick={fleeFromBattle} style={runButtonStyle} disabled={battleInputLocked}>파티 도주</button> : null}
                        </div>
                      ) : (
                        <div style={{ ...dangerMessageStyle, textAlign: "center" }}>현재 관전 상태라 전투 행동을 선택할 수 없습니다.</div>
                      )}
                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                        {battleActive ? <div style={readyBadgeStyle}>미선택 인원은 5분 후 자동으로 방어 처리됩니다.</div> : null}
                        {endedReadonly ? <div style={readyBadgeStyle}>종료된 조사 기록 열람 중</div> : null}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div style={{ ...sidePanelStyle, position: "absolute", right: 14, top: 152, width: RIGHT_PANEL_WIDTH, height: "calc(100% - 418px)", zIndex: 1042, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", overflow: "hidden", background: "linear-gradient(180deg, rgba(18,15,20,0.44), rgba(12,10,16,0.76))", border: "1px solid rgba(245,158,11,0.08)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px" }}>
                  <div>
                    <div className="section-eyebrow">LOG</div>
                    <h3 style={{ marginTop: "10px", marginBottom: 0 }}>로그</h3>
                  </div>
                </div>

                <div style={{ position: "relative", minHeight: 0 }}>
                  <div ref={logScrollRef} onScroll={onLogScroll} style={{ ...logBoxStyle, paddingBottom: 8 }}>
                  {displayLogs.map((log, index) => {
                    const tone = getLogTone(log.text);
                    return (
                      <div
                        key={log.id || index}
                        style={{
                          ...logItemStyle,
                          border: tone === "danger"
                            ? "1px solid rgba(248,113,113,0.18)"
                            : tone === "success"
                              ? "1px solid rgba(74,222,128,0.18)"
                              : tone === "info"
                                ? "1px solid rgba(96,165,250,0.18)"
                                : logItemStyle.border,
                          background: tone === "danger"
                            ? "rgba(127,29,29,0.12)"
                            : tone === "success"
                              ? "rgba(20,83,45,0.12)"
                              : tone === "info"
                                ? "rgba(30,64,175,0.12)"
                                : logItemStyle.background,
                        }}
                      >
                        <div style={{ color: tone === "danger" ? "#fecaca" : tone === "success" ? "#bbf7d0" : tone === "info" ? "#bfdbfe" : "#dce7f5", whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{log.text}</div>
                        {log.time ? <div style={logTimeStyle}>{formatTime(log.time)}</div> : null}
                      </div>
                    );
                  })}
                  </div>
                  {showNewLogCue ? (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        if (logScrollRef.current) logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
                        setStickLogsToBottom(true);
                        setShowNewLogCue(false);
                      }}
                      style={scrollCueButtonStyle}
                    >
                      ↓ 새로운 로그가 있습니다.
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div style={{ display: "contents" }}>
              {!isDaily && (
                  <div style={{ ...sidePanelStyle, position: "absolute", left: 14, top: LEFT_SIDE_PANEL_TOP, width: CHAT_PANEL_WIDTH, height: LEFT_CHAT_PANEL_HEIGHT, zIndex: 1042, display: "flex", flexDirection: "column", overflow: "hidden", background: "linear-gradient(180deg, rgba(4,10,22,0.34), rgba(8,18,32,0.7))", border: "1px solid rgba(125,211,252,0.08)" }}>
                  <div className="section-eyebrow">CHAT</div>
                  <h3 style={{ marginTop: "10px", marginBottom: "14px" }}>채팅</h3>

                  {!canSpeak && <div style={{ marginBottom: "12px", ...dangerMessageStyle }}>HP가 0인 상태라 관전만 가능합니다. 채팅은 사용할 수 없습니다.</div>}

                  <div style={{ position: "relative", minHeight: 0, flex: 1 }}>
                    <div ref={chatScrollRef} onScroll={onChatScroll} style={chatBoxStyle}>
                    {chat.length > 0 ? (
                      chat.map((msg, idx) => (
                        <div key={`${msg.name}-${msg.text}-${idx}`} style={msg.isAdminNotice ? noticeMessageStyle : chatMessageStyle}>
                          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                            {msg.isAdminNotice ? (
                              <div style={{ width: 36, height: 36, borderRadius: 999, background: "rgba(255,255,255,0.14)", display: "grid", placeItems: "center", fontWeight: 900, flexShrink: 0 }}>운</div>
                            ) : (
                              <div style={{ width: 36, height: 36, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.08)", flexShrink: 0 }}>
                                {msg.image ? <img src={msg.image} alt={msg.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 900 }}>{String(msg.name || "?").slice(0,1)}</div>}
                              </div>
                            )}
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontWeight: 800, marginBottom: "4px" }}>{msg.isAdminNotice ? "[운영 공지]" : `${msg.name}`}</div>
                              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{msg.text}</div>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : <div style={{ color: "#94a3b8" }}>아직 채팅이 없습니다.</div>}
                    </div>
                    {showNewChatCue ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
                          setStickToBottom(true);
                          setShowNewChatCue(false);
                        }}
                        style={scrollCueButtonStyle}
                      >
                        ↓ 새로운 채팅이 있습니다.
                      </button>
                    ) : null}
                  </div>

                  <div style={{ display: "flex", gap: "6px", marginTop: "12px", alignItems: "stretch" }}>
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={canSpeak ? (isAdmin ? "운영 공지 또는 채팅 입력" : "채팅 입력") : (isAdmin ? "운영 공지를 입력할 수 있습니다." : "관전 상태에서는 채팅 불가")}
                      style={chatInputStyle}
                      disabled={!canSpeak && !isAdmin}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (isAdmin) sendAdminNotice();
                          else if (canSpeak) sendChat();
                        }
                      }}
                    />
                    <button type="button" className="home-primary-button" title="전송" aria-label="전송" onClick={isAdmin ? sendAdminNotice : sendChat} disabled={isAdmin ? !input.trim() : !canSpeak} style={chatSendButtonStyle}>➤</button>
                  </div>
                </div>
              )}

              {isDaily && (
                  <div style={{ position: "absolute", left: 14, top: LEFT_SIDE_PANEL_TOP, width: CHAT_PANEL_WIDTH, height: "calc(100% - 348px)", zIndex: 1041, borderRadius: 28, background: "transparent", border: "1px solid rgba(255,255,255,0.03)", pointerEvents: "none" }} />
              )}

              <div style={{ position: "absolute", right: 14, top: "calc(100% - 248px)", zIndex: 1050, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, width: 278 }}>
                <button type="button" className="ghost-button" onClick={() => setShowMap(true)} style={{ color: "#f8fbff", fontWeight: 900, background: "rgba(59,130,246,0.34)", border: "1px solid rgba(191,219,254,0.26)", boxShadow: "0 12px 22px rgba(2,6,23,0.18)", backdropFilter: "blur(14px)" }}>지도</button>
                <button type="button" className="ghost-button" onClick={() => setShowItems(true)} style={{ color: "#f8fbff", fontWeight: 900, background: "rgba(59,130,246,0.34)", border: "1px solid rgba(191,219,254,0.26)", boxShadow: "0 12px 22px rgba(2,6,23,0.18)", backdropFilter: "blur(14px)" }}>아이템</button>
                <button type="button" className="ghost-button" onClick={() => setShowInventory(true)} style={{ color: "#f8fbff", fontWeight: 900, background: "rgba(59,130,246,0.34)", border: "1px solid rgba(191,219,254,0.26)", boxShadow: "0 12px 22px rgba(2,6,23,0.18)", backdropFilter: "blur(14px)" }}>인벤토리</button>
                <button type="button" className="ghost-button" onClick={() => setShowClues(true)} style={{ color: "#f8fbff", fontWeight: 900, background: "rgba(59,130,246,0.34)", border: "1px solid rgba(191,219,254,0.26)", boxShadow: "0 12px 22px rgba(2,6,23,0.18)", backdropFilter: "blur(14px)" }}>단서</button>
              </div>
            </div>
          </div>
        </div>
      </>
    </DesignPageFrame>
  );
}





function normalizeDirectionLabel(label) {
  const value = String(label || "").toLowerCase();
  if (/상|위|up|north|북|↑/.test(value)) return "up";
  if (/하|아래|down|south|남|↓/.test(value)) return "down";
  if (/좌|왼쪽|left|west|서|←/.test(value)) return "left";
  if (/우|오른쪽|right|east|동|→/.test(value)) return "right";
  return "";
}


function oppositeDirectionLabel(label) {
  const key = normalizeDirectionLabel(label);
  if (key === "up") return "하";
  if (key === "down") return "상";
  if (key === "left") return "우";
  if (key === "right") return "좌";
  return "";
}

function buildDirectionalChoices(choices) {
  const map = { up: null, down: null, left: null, right: null, misc: [] };
  (Array.isArray(choices) ? choices : []).forEach((choice) => {
    const key = normalizeDirectionLabel(choice?.text);
    if (key && !map[key]) map[key] = choice;
    else map.misc.push(choice);
  });
  return map;
}

function formatBattleActionLabel(action) {
  const raw = String(action || "");
  if (!raw) return "";
  const [type, payload] = raw.split("::");
  if (!payload) return type;
  return `${type} · ${payload}`;
}


function getSceneBubble({ battleActive, activeNpcScene, pendingReward }) {
  if (pendingReward) return "★";
  if (battleActive) return "!";
  if (activeNpcScene) return "?";
  return "";
}

function getLogTone(text) {
  const value = String(text || "");
  if (/\[적군 행동\]|E-Beast|전투 시작|필살기|전멸|패배/.test(value)) return "danger";
  if (/\[아군 행동\]|획득|승리|회복|치명타|단서|NPC 조우|제압/.test(value)) return "success";
  if (/도주|이동|조사 시작|조사 종료/.test(value)) return "info";
  return "normal";
}



function formatPendingRewardLabel(reward) {
  if (!reward) return "";
  const type = String(reward.type || "");
  const label = String(reward.label || reward.value || "");
  if (type === "stat" || type === "statPoints") return `${label || "스탯 포인트"} 보상`;
  if (type === "item") return `${label} 아이템`;
  return label || "보상";
}

function getUniqueRouteSteps(routeHistory) {
  const seen = new Set();
  const result = [];
  (Array.isArray(routeHistory) ? routeHistory : []).forEach((entry) => {
    if (!entry?.nodeId || seen.has(entry.nodeId)) return;
    seen.add(entry.nodeId);
    result.push(entry);
  });
  return result;
}

function InvestigationMapCanvas({ investigation, participants = [], leaders = [] }) {
  const nodes = investigation?.data?.nodes || {};
  const entries = Object.entries(nodes);
  if (!entries.length) return <div style={{ color: "#9fb0c7" }}>표시할 지도가 없어.</div>;

  const uniqueSteps = getUniqueRouteSteps(investigation.routeHistory);
  const visitOrder = Object.fromEntries(uniqueSteps.map((entry, index) => [entry.nodeId, index + 1]));
  const visited = new Set(uniqueSteps.map((entry) => entry.nodeId));
  const currentId = investigation.currentNodeId;
  const width = 1200;
  const height = 760;
  const centerX = width / 2;
  const centerY = height / 2;

  const positions = {};
  const normalize = (value, min, max) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
  };

  const convertPoint = (node, index) => {
    const rawX = Number(node?.mapX);
    const rawY = Number(node?.mapY);
    if (Number.isFinite(rawX) && Number.isFinite(rawY)) {
      const px = rawX >= 0 && rawX <= 100 ? 110 + ((width - 220) * rawX) / 100 : rawX;
      const py = rawY >= 0 && rawY <= 100 ? 90 + ((height - 180) * rawY) / 100 : rawY;
      if (Number.isFinite(px) && Number.isFinite(py)) return { x: Math.max(90, Math.min(width - 90, px)), y: Math.max(90, Math.min(height - 90, py)) };
    }
    const angle = (-Math.PI / 2) + (index / Math.max(entries.length, 1)) * Math.PI * 2;
    return { x: centerX + Math.cos(angle) * Math.min(width, height) * 0.28, y: centerY + Math.sin(angle) * Math.min(width, height) * 0.24 };
  };

  entries.forEach(([nodeId, node], index) => {
    positions[nodeId] = convertPoint(node, index);
  });

  const edges = entries.flatMap(([nodeId, node]) =>
    (Array.isArray(node.choices) ? node.choices : [])
      .map((choice) => [nodeId, choice?.target])
      .filter(([, targetId]) => !!positions[targetId])
  );

  for (let iteration = 0; iteration < 220; iteration += 1) {
    for (let i = 0; i < entries.length; i += 1) {
      const [aId] = entries[i];
      for (let j = i + 1; j < entries.length; j += 1) {
        const [bId] = entries[j];
        const a = positions[aId];
        const b = positions[bId];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const minDistance = 200;
        if (distance < minDistance) {
          const force = (minDistance - distance) * 0.18;
          const ux = dx / distance;
          const uy = dy / distance;
          a.x -= ux * force;
          a.y -= uy * force;
          b.x += ux * force;
          b.y += uy * force;
        }
      }
    }
    edges.forEach(([fromId, toId]) => {
      const from = positions[fromId];
      const to = positions[toId];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const targetLength = 210;
      const diff = (distance - targetLength) * 0.018;
      const ux = dx / distance;
      const uy = dy / distance;
      from.x += ux * diff;
      from.y += uy * diff;
      to.x -= ux * diff;
      to.y -= uy * diff;
    });
    entries.forEach(([nodeId]) => {
      const point = positions[nodeId];
      point.x = Math.max(90, Math.min(width - 90, point.x));
      point.y = Math.max(90, Math.min(height - 90, point.y));
    });
  }

  const leader = (participants || []).find((participant) => (leaders || []).includes(participant.name)) || (investigation?.type === "daily" ? participants?.[0] : null);
  const currentPos = positions[currentId];
  const leaderImage = leader?.investigationImage || leader?.image;
  const visibleNodeIds = new Set([...visited, currentId].filter(Boolean));
  const visibleEntries = entries.filter(([nodeId]) => visibleNodeIds.has(nodeId));
  const visibleEdges = edges.filter(([fromId, toId]) => visibleNodeIds.has(fromId) && visibleNodeIds.has(toId));

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", borderRadius: 24, background: investigation.mapBackgroundImage ? `linear-gradient(rgba(2,6,23,0.36), rgba(2,6,23,0.62)), url(${investigation.mapBackgroundImage}) center/cover no-repeat` : "radial-gradient(circle at 50% 40%, rgba(30,41,59,0.88), rgba(2,6,23,0.98))" }}>
        {visibleEdges.map(([fromId, toId], idx) => {
          const from = positions[fromId];
          const to = positions[toId];
          return <line key={`${fromId}-${toId}-${idx}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={visited.has(fromId) && visited.has(toId) ? "rgba(96,165,250,0.92)" : "rgba(148,163,184,0.26)"} strokeWidth="6" strokeLinecap="round" />;
        })}
        {visibleEntries.map(([nodeId, node]) => {
          const p = positions[nodeId];
          const isCurrent = nodeId === currentId;
          const isVisited = visited.has(nodeId);
          return (
            <g key={nodeId}>
              <circle cx={p.x} cy={p.y} r={isCurrent ? 30 : 26} fill={isCurrent ? "rgba(37,99,235,0.98)" : isVisited ? "rgba(56,189,248,0.86)" : "rgba(71,85,105,0.88)"} stroke="rgba(255,255,255,0.22)" strokeWidth="3" />
              {visitOrder[nodeId] ? <text x={p.x} y={p.y + 5} textAnchor="middle" fill="white" fontSize="13" fontWeight="900">{visitOrder[nodeId]}</text> : null}
              <text x={p.x} y={p.y + 54} textAnchor="middle" fill="#dbeafe" fontSize="16" fontWeight="800">{node.name}</text>
            </g>
          );
        })}
        {leaderImage && currentPos ? <image href={leaderImage} x={currentPos.x - 28} y={currentPos.y - 84} width="56" height="56" preserveAspectRatio="xMidYMid contain" /> : null}
      </svg>
      <div style={{ color: "#9fb0c7", fontSize: 13 }}>지나간 장소 및 현재 위치만 표시됩니다.</div>
    </div>
  );
}

function getBattlePhaseText({ battleActive, pendingReward, readyCount, aliveCount, endedReadonly }) {
  if (endedReadonly) return "기록 열람 중";
  if (pendingReward) return "보상 배분 중";
  if (!battleActive) return "탐색 중";
  if (aliveCount > 0 && readyCount >= aliveCount) return "자동 실행 대기";
  return "행동 선택 중";
}

function getBattleRoundTone(text) {
  const value = String(text || "");
  if (/피해|패배|필살기|전멸|행동불능/.test(value)) return "danger";
  if (/회복|치명타|승리|제압|획득/.test(value)) return "success";
  if (/방어|회피|도주|집중/.test(value)) return "info";
  return "normal";
}

const currentMonsterPlaceholder = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='360' height='360' viewBox='0 0 360 360'><defs><linearGradient id='g' x1='0' x2='1' y1='0' y2='1'><stop stop-color='%23dbeafe'/><stop offset='1' stop-color='%2393c5fd'/></linearGradient></defs><rect rx='40' width='360' height='360' fill='url(%23g)'/><circle cx='180' cy='122' r='68' fill='%23eff6ff'/><path d='M92 258c18-56 54-84 88-84s70 28 88 84' fill='%23bfdbfe'/><circle cx='154' cy='118' r='10' fill='%231e3a8a'/><circle cx='206' cy='118' r='10' fill='%231e3a8a'/><path d='M145 154c21 18 49 18 70 0' stroke='%231e3a8a' stroke-width='10' fill='none' stroke-linecap='round'/><path d='M118 70l30 18M242 70l-30 18' stroke='%2360a5fa' stroke-width='14' stroke-linecap='round'/></svg>";

function getRecentBattleEntry(name, rounds, state = {}, nowTick = Date.now()) {
  const safeName = String(name || "");
  const recent = Array.isArray(rounds)
    ? rounds.filter((entry) => {
        const age = nowTick - Number(entry?.appearedAt || 0);
        return age >= 0 && age < 900;
      })
    : [];

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const entry = recent[index];
    const actor = String(entry?.actor || "");
    const effect = String(entry?.effect || "");
    const text = String(entry?.text || "");
    const isActor = actor === safeName;

    if (!isActor) continue;
    if (effect === "damage") return { effect: "attack", entry };
    if (["attack", "drain"].includes(effect)) return { effect: "attack", entry };
    if (["guard", "shield"].includes(effect)) return { effect: "guard", entry };
    if (["skill", "debuff"].includes(effect)) return { effect: "skill", entry };
    if (effect === "item" && /회복/.test(text)) return { effect: "heal", entry };
    if (effect === "item") return { effect: "item", entry };
    if (effect === "heal") return { effect: "heal", entry };
    if (effect === "evade") return { effect: "evade", entry };
  }

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const entry = recent[index];
    const actor = String(entry?.actor || "");
    const target = String(entry?.target || "");
    const effect = String(entry?.effect || "");
    const text = String(entry?.text || "");
    const isActor = actor === safeName;
    const isTarget = target === safeName;

    if (["damage", "hit", "defeat"].includes(effect) && isTarget) return { effect: "damage", entry };
    if (["attack", "drain"].includes(effect) && isTarget) return { effect: "damage", entry };
    if (["skill", "debuff"].includes(effect) && isTarget) return { effect: "damage", entry };
    if (effect === "item" && /회복/.test(text) && (isActor || isTarget)) return { effect: "heal", entry };
    if (effect === "heal" && (isActor || isTarget)) return { effect: "heal", entry };
    if (effect === "evade" && (isActor || isTarget)) return { effect: "evade", entry };
  }
  if (state?.defending) return { effect: "guard", entry: null, persistent: true };
  return { effect: "", entry: null, persistent: false };
}

function getRecentBattleEffect(name, rounds, state = {}, nowTick = Date.now()) {
  return getRecentBattleEntry(name, rounds, state, nowTick)?.effect || "";
}

function getBattleEffectLabel(effect = "") {
  return {
    damage: "피격!",
    attack: "공격!",
    guard: "방어",
    skill: "스킬",
    heal: "회복",
    item: "아이템",
    evade: "회피",
  }[effect] || "";
}

function getBattleEffectLabelColor(effect = "") {
  return {
    damage: "#fecaca",
    attack: "#fde68a",
    guard: "#93c5fd",
    shield: "#93c5fd",
    skill: "#fde047",
    buff: "#86efac",
    debuff: "#fca5a5",
    drain: "#f9a8d4",
    heal: "#86efac",
    item: "#67e8f9",
    evade: "#c4b5fd",
  }[effect] || "#e2e8f0";
}

function isBattlePhaseHeader(entry) {
  return !!entry?.isPhaseHeader || /^\[(아군 행동|적군 행동)\]$/.test(String(entry?.text || ""));
}

function getBattlePlaybackTimings(entry, index = 0) {
  const effect = String(entry?.effect || "");
  const text = String(entry?.text || "");
  if (isBattlePhaseHeader(entry)) {
    return {
      isPhaseHeader: true,
      beforeLog: index === 0 ? 80 : 180,
      beforeSnapshot: 0,
      totalAfterLog: 280,
    };
  }
  if (effect === "damage") {
    return { isPhaseHeader: false, beforeLog: 70, beforeSnapshot: 280, totalAfterLog: 560 };
  }
  if (effect === "attack") {
    return { isPhaseHeader: false, beforeLog: 60, beforeSnapshot: 240, totalAfterLog: 500 };
  }
  if (["skill", "debuff", "drain"].includes(effect)) {
    return { isPhaseHeader: false, beforeLog: 80, beforeSnapshot: 320, totalAfterLog: 640 };
  }
  if (["guard", "shield", "buff"].includes(effect)) {
    return { isPhaseHeader: false, beforeLog: 60, beforeSnapshot: 220, totalAfterLog: 440 };
  }
  if (effect === "heal") {
    return { isPhaseHeader: false, beforeLog: 70, beforeSnapshot: 260, totalAfterLog: 520 };
  }
  if (effect === "item") {
    return { isPhaseHeader: false, beforeLog: 70, beforeSnapshot: /회복/.test(text) ? 260 : 280, totalAfterLog: /회복/.test(text) ? 520 : 560 };
  }
  if (effect === "evade") {
    return { isPhaseHeader: false, beforeLog: 55, beforeSnapshot: 180, totalAfterLog: 380 };
  }
  if (effect === "defeat") {
    return { isPhaseHeader: false, beforeLog: 80, beforeSnapshot: 320, totalAfterLog: 600 };
  }
  return { isPhaseHeader: false, beforeLog: 60, beforeSnapshot: 240, totalAfterLog: 500 };
}

function getBattleVisualState({ name, rounds, state = {}, nowTick = Date.now(), side = "ally" }) {
  const recent = getRecentBattleEntry(name, rounds, state, nowTick);
  const effect = recent?.effect || "";
  const age = recent?.entry ? Math.max(0, nowTick - Number(recent.entry?.appearedAt || nowTick)) : 0;
  const duration = ({ damage: 760, attack: 620, skill: 820, heal: 700, item: 720, guard: 560, evade: 520 })[effect] || 620;
  const progress = recent?.entry ? Math.max(0, Math.min(1, age / duration)) : 1;
  const pulse = recent?.entry ? Math.sin(progress * Math.PI) : 0;
  const persistentGuard = effect === "guard" && !recent?.entry && !!state?.defending;
  const direction = side === "enemy" ? -1 : 1;
  let translateX = 0;
  let translateY = 0;
  let scale = 1;
  let glow = "drop-shadow(0 10px 18px rgba(0,0,0,0.26))";
  let frameBoxShadow = "";
  let overlayStyle = null;
  let fxOuterStyle = null;
  let fxInnerStyle = null;

  if (effect === "damage") {
    const decay = 1 - progress;
    translateX = Math.sin(age / 28) * 14 * decay;
    translateY = Math.sin(age / 21) * 3.2 * decay;
    scale = 1 - 0.04 * pulse;
    glow = "drop-shadow(0 0 16px rgba(248,113,113,0.78)) drop-shadow(0 10px 18px rgba(0,0,0,0.28))";
    frameBoxShadow = `0 0 0 2px rgba(248,113,113,${(0.34 + decay * 0.38).toFixed(3)}), 0 0 28px rgba(239,68,68,${(0.3 + decay * 0.32).toFixed(3)})`;
    overlayStyle = {
      background: "radial-gradient(circle at 50% 50%, rgba(254,202,202,0.92), rgba(248,113,113,0.44) 44%, rgba(239,68,68,0.12) 72%, transparent 78%)",
      boxShadow: "inset 0 0 28px rgba(127,29,29,0.28)",
      opacity: 0.22 + decay * 0.52,
      mixBlendMode: "screen",
    };
    fxOuterStyle = {
      position: "absolute",
      left: "50%",
      top: "50%",
      width: `${74 + decay * 28}px`,
      height: `${74 + decay * 28}px`,
      transform: `translate(-50%, -50%) scale(${(1 + pulse * 0.18).toFixed(3)})`,
      borderRadius: "50%",
      background: "radial-gradient(circle, rgba(254,226,226,0.85), rgba(248,113,113,0.24) 56%, transparent 72%)",
      opacity: 0.22 + decay * 0.42,
      mixBlendMode: "screen",
      pointerEvents: "none",
      zIndex: 3,
    };
    fxInnerStyle = {
      position: "absolute",
      left: "50%",
      top: "50%",
      width: `${48 + decay * 18}px`,
      height: 10,
      transform: `translate(-50%, -50%) rotate(${(age / 9).toFixed(1)}deg)`,
      borderRadius: 999,
      background: "linear-gradient(90deg, transparent, rgba(254,226,226,0.96), transparent)",
      opacity: 0.28 + decay * 0.42,
      filter: "blur(1px)",
      pointerEvents: "none",
      zIndex: 4,
    };
  } else if (effect === "attack") {
    const thrust = Math.sin(progress * Math.PI);
    const snap = Math.sin(progress * Math.PI * 2) * (1 - progress) * 0.45;
    translateX = direction * ((13 * thrust) + (4 * snap));
    translateY = -3 * thrust;
    scale = 1 + 0.045 * thrust;
    glow = "drop-shadow(0 0 8px rgba(251,191,36,0.26)) drop-shadow(0 10px 18px rgba(0,0,0,0.26))";
    frameBoxShadow = `0 0 14px rgba(251,191,36,${(0.1 + thrust * 0.14).toFixed(3)})`;
    fxOuterStyle = {
      position: "absolute",
      top: "50%",
      [direction > 0 ? "left" : "right"]: "2%",
      width: "46%",
      height: 10,
      transform: `translateY(-50%) rotate(${direction > 0 ? -10 : 10}deg) scaleX(${(0.38 + thrust * 0.44).toFixed(3)})`,
      transformOrigin: direction > 0 ? "left center" : "right center",
      borderRadius: 999,
      background: direction > 0 ? "linear-gradient(90deg, rgba(254,240,138,0), rgba(251,191,36,0.72), rgba(255,255,255,0.82))" : "linear-gradient(270deg, rgba(254,240,138,0), rgba(251,191,36,0.72), rgba(255,255,255,0.82))",
      opacity: 0.14 + thrust * 0.34,
      filter: "blur(1.1px)",
      pointerEvents: "none",
      zIndex: 3,
    };
  } else if (effect === "guard") {
    const brace = persistentGuard ? (0.55 + (Math.sin(nowTick / 170) + 1) * 0.12) : pulse;
    translateX = persistentGuard ? Math.sin(nowTick / 120) * 2.8 : Math.sin(progress * Math.PI * 2) * 2.2;
    translateY = persistentGuard ? -2.2 * Math.sin(nowTick / 190) : -3.4 * pulse;
    scale = 1 + (persistentGuard ? 0.024 : 0.034) * brace;
    glow = "drop-shadow(0 0 12px rgba(96,165,250,0.68)) drop-shadow(0 10px 18px rgba(0,0,0,0.26))";
    frameBoxShadow = persistentGuard
      ? "0 0 0 2px rgba(96,165,250,0.72), 0 0 26px rgba(59,130,246,0.32)"
      : `0 0 0 2px rgba(96,165,250,${(0.3 + pulse * 0.34).toFixed(3)}), 0 0 22px rgba(59,130,246,${(0.18 + pulse * 0.22).toFixed(3)})`;
    overlayStyle = {
      background: "radial-gradient(circle at 50% 50%, rgba(147,197,253,0.22), rgba(59,130,246,0.08) 62%, transparent 74%)",
      opacity: persistentGuard ? 0.72 : 0.38 + pulse * 0.22,
    };
    fxOuterStyle = {
      position: "absolute",
      inset: 8,
      borderRadius: 999,
      border: `2px solid ${persistentGuard ? "rgba(147,197,253,0.92)" : `rgba(147,197,253,${(0.38 + pulse * 0.28).toFixed(3)})`}`,
      boxShadow: persistentGuard ? "0 0 22px rgba(59,130,246,0.28)" : `0 0 18px rgba(59,130,246,${(0.14 + pulse * 0.18).toFixed(3)})`,
      pointerEvents: "none",
      zIndex: 3,
    };
  } else if (effect === "skill") {
    const cast = Math.sin(progress * Math.PI);
    const snap = Math.sin(progress * Math.PI * 2) * (1 - progress) * 0.82;
    translateX = direction * ((22 * cast) + (8 * snap));
    translateY = -9 * cast;
    scale = 1 + 0.08 * cast;
    glow = "drop-shadow(0 0 18px rgba(250,204,21,0.92)) drop-shadow(0 10px 18px rgba(0,0,0,0.26))";
    frameBoxShadow = `0 0 0 2px rgba(250,204,21,${(0.34 + cast * 0.34).toFixed(3)}), 0 0 30px rgba(234,179,8,${(0.28 + cast * 0.32).toFixed(3)})`;
    overlayStyle = {
      background: "radial-gradient(circle at 50% 50%, rgba(254,240,138,0.54), rgba(250,204,21,0.26) 56%, transparent 72%)",
      opacity: 0.34 + cast * 0.28,
      mixBlendMode: "screen",
    };
    fxOuterStyle = {
      position: "absolute",
      top: "50%",
      [direction > 0 ? "left" : "right"]: "-14%",
      width: "84%",
      height: 26,
      transform: `translateY(-50%) rotate(${direction > 0 ? -14 : 14}deg) scaleX(${(0.46 + cast * 0.82).toFixed(3)})`,
      transformOrigin: direction > 0 ? "left center" : "right center",
      borderRadius: 999,
      background: direction > 0 ? "linear-gradient(90deg, rgba(254,240,138,0), rgba(250,204,21,0.98), rgba(255,255,255,1))" : "linear-gradient(270deg, rgba(254,240,138,0), rgba(250,204,21,0.98), rgba(255,255,255,1))",
      opacity: 0.26 + cast * 0.7,
      filter: "blur(2.4px)",
      pointerEvents: "none",
      zIndex: 3,
    };
    fxInnerStyle = {
      position: "absolute",
      left: "50%",
      top: "50%",
      width: `${58 + cast * 28}px`,
      height: `${58 + cast * 28}px`,
      transform: "translate(-50%, -50%)",
      borderRadius: "50%",
      border: `2px solid rgba(254,240,138,${(0.44 + cast * 0.36).toFixed(3)})`,
      boxShadow: `0 0 22px rgba(250,204,21,${(0.22 + cast * 0.32).toFixed(3)})`,
      pointerEvents: "none",
      zIndex: 4,
    };
  } else if (effect === "evade") {
    const dodge = Math.sin(progress * Math.PI);
    translateX = direction * (-22 * dodge);
    translateY = -7 * dodge;
    scale = 1 - 0.03 * dodge;
    glow = "drop-shadow(0 0 12px rgba(196,181,253,0.66)) drop-shadow(0 10px 18px rgba(0,0,0,0.26))";
    frameBoxShadow = `0 0 0 2px rgba(196,181,253,${(0.2 + dodge * 0.22).toFixed(3)}), 0 0 20px rgba(139,92,246,${(0.14 + dodge * 0.2).toFixed(3)})`;
    overlayStyle = {
      background: "radial-gradient(circle at 50% 50%, rgba(221,214,254,0.24), rgba(139,92,246,0.08) 58%, transparent 72%)",
      opacity: 0.16 + dodge * 0.2,
      mixBlendMode: "screen",
    };
    fxOuterStyle = {
      position: "absolute",
      top: "50%",
      [direction > 0 ? "right" : "left"]: "-6%",
      width: "46%",
      height: 8,
      transform: `translateY(-50%) rotate(${direction > 0 ? 16 : -16}deg) scaleX(${(0.28 + dodge * 0.56).toFixed(3)})`,
      transformOrigin: direction > 0 ? "right center" : "left center",
      borderRadius: 999,
      background: direction > 0 ? "linear-gradient(270deg, rgba(221,214,254,0), rgba(196,181,253,0.76), rgba(255,255,255,0.88))" : "linear-gradient(90deg, rgba(221,214,254,0), rgba(196,181,253,0.76), rgba(255,255,255,0.88))",
      opacity: 0.14 + dodge * 0.34,
      filter: "blur(1px)",
      pointerEvents: "none",
      zIndex: 3,
    };
  } else if (effect === "heal") {
    glow = "drop-shadow(0 0 14px rgba(74,222,128,0.78)) drop-shadow(0 10px 18px rgba(0,0,0,0.26))";
    frameBoxShadow = `0 0 0 2px rgba(74,222,128,${(0.22 + pulse * 0.34).toFixed(3)}), 0 0 20px rgba(34,197,94,${(0.18 + pulse * 0.24).toFixed(3)})`;
    overlayStyle = {
      background: "radial-gradient(circle at 50% 50%, rgba(187,247,208,0.34), rgba(34,197,94,0.12) 58%, transparent 74%)",
      opacity: 0.2 + pulse * 0.24,
      mixBlendMode: "screen",
    };
    fxOuterStyle = {
      position: "absolute",
      inset: 8,
      borderRadius: 999,
      border: `2px solid rgba(134,239,172,${(0.3 + pulse * 0.3).toFixed(3)})`,
      boxShadow: `0 0 18px rgba(34,197,94,${(0.16 + pulse * 0.22).toFixed(3)})`,
      pointerEvents: "none",
      zIndex: 3,
    };
  } else if (effect === "item") {
    translateY = -4 * pulse;
    scale = 1 + 0.04 * pulse;
    glow = "drop-shadow(0 0 12px rgba(103,232,249,0.72)) drop-shadow(0 10px 18px rgba(0,0,0,0.26))";
    frameBoxShadow = `0 0 0 2px rgba(103,232,249,${(0.18 + pulse * 0.28).toFixed(3)}), 0 0 18px rgba(34,211,238,${(0.16 + pulse * 0.22).toFixed(3)})`;
    overlayStyle = {
      background: "radial-gradient(circle at 50% 50%, rgba(207,250,254,0.3), rgba(34,211,238,0.12) 58%, transparent 72%)",
      opacity: 0.16 + pulse * 0.2,
      mixBlendMode: "screen",
    };
  }

  return {
    effect,
    badge: getBattleEffectLabel(effect),
    badgeColor: getBattleEffectLabelColor(effect),
    wrapperStyle: {
      transform: `translate(${translateX.toFixed(2)}px, ${translateY.toFixed(2)}px) scale(${scale.toFixed(3)})`,
      transition: persistentGuard ? "box-shadow 0.2s ease, opacity 0.2s ease" : "transform 0.12s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s ease, opacity 0.16s ease",
      boxShadow: frameBoxShadow || "none",
    },
    imageStyle: {
      filter: glow,
      transition: "filter 0.18s ease",
    },
    overlayStyle,
    fxOuterStyle,
    fxInnerStyle,
  };
}

function SceneVisualPanel({ currentNode, battleActive, leaders, participants, activeNpcScene, pendingReward, investigationBackgroundImage, nowTick, isDaily = false }) {
  const leader = (participants || []).find((participant) => (leaders || []).includes(participant.name)) || (isDaily ? participants?.[0] : null);
  const npcVisual = activeNpcScene || currentNode?.npcScene || null;
  const bubble = getSceneBubble({ battleActive, activeNpcScene, pendingReward });
  const wobble = pendingReward ? Math.abs(Math.sin(nowTick / 220)) * -10 : battleActive ? Math.sin(nowTick / 220) * 8 : 0;

  return (
    <div style={{ position: "absolute", inset: 0, minHeight: 0, borderRadius: 30, overflow: "hidden", border: "none", background: currentNode?.image ? `url(${currentNode.image}) center/cover no-repeat` : investigationBackgroundImage ? `linear-gradient(rgba(2,6,23,0.18), rgba(2,6,23,0.42)), url(${investigationBackgroundImage}) center/cover no-repeat` : "radial-gradient(circle at 50% 30%, rgba(30,64,175,0.3), rgba(2,6,23,0.96))" }}>
      <div style={{ position: "absolute", inset: 0, background: battleActive ? "rgba(48,10,18,0.42)" : "rgba(2,6,23,0.26)" }} />
      {!activeNpcScene && (npcVisual?.sdImage || npcVisual?.image || npcVisual?.profileImage || npcVisual?.npcProfileImage || npcVisual?.portrait) ? <img src={npcVisual.sdImage || npcVisual.image || npcVisual.profileImage || npcVisual.npcProfileImage || npcVisual.portrait} alt={npcVisual.name || "NPC"} style={{ position: "absolute", left: "calc(50% + 52px)", bottom: 192, width: 144, height: 178, objectFit: "contain", pointerEvents: "none", opacity: 0.82, filter: "drop-shadow(0 18px 36px rgba(0,0,0,0.32))" }} /> : null}
      {leader && !battleActive ? (
        <div style={{ position: "absolute", left: "50%", bottom: 188, transform: `translateX(-50%) translateY(${wobble}px)`, transition: "transform 0.18s ease", textAlign: "center" }}>
          {bubble ? <div style={{ position: "absolute", left: "50%", top: -16, transform: "translateX(-50%)", minWidth: 36, height: 36, padding: "0 12px", borderRadius: 999, background: battleActive ? "rgba(127,29,29,0.88)" : pendingReward ? "rgba(120,53,15,0.88)" : "rgba(30,64,175,0.88)", color: "white", display: "grid", placeItems: "center", fontWeight: 900, boxShadow: "0 10px 22px rgba(0,0,0,0.28)" }}>{bubble}</div> : null}
          {(leader.investigationImage || leader.image) ? <img src={leader.investigationImage || leader.image} alt={leader.name} style={{ width: 156, height: 156, objectFit: "contain", filter: "drop-shadow(0 24px 48px rgba(0,0,0,0.35))" }} /> : null}
          <div style={{ marginTop: 8, textAlign: "center", color: "white", fontWeight: 900 }}>{leader.name}</div>
        </div>
      ) : null}
      {battleActive ? <div style={{ position: "absolute", left: 18, bottom: 18, padding: "8px 12px", borderRadius: 999, background: "rgba(127,29,29,0.8)", color: "#fecaca", fontWeight: 900 }}>E-BEAST 조우</div> : null}
    </div>
  );
}

function BattleHero({ node, investigation, rounds = [], compact = false, nowTick = Date.now(), battlePlaybackLocked = false }) {
  const battle = node?.battle;
  if (!battle) return null;
  const hp = Number(battle.hp || 0);
  const maxHp = Number(battle.maxHp || battle.hp || 1);
  const hpPercent = Math.max(0, Math.min(100, (hp / Math.max(maxHp, 1)) * 100));
  const effect = getRecentBattleEffect(battle.name, rounds, {}, nowTick);
  const visual = getBattleVisualState({ name: battle.name, rounds, nowTick, side: "enemy" });
  const imageSrc = battle.image || investigation?.data?.backgroundImage || investigation?.mapBackgroundImage || currentMonsterPlaceholder;
  const displayTurn = battlePlaybackLocked ? Math.max(1, Number(investigation?.battleTurn || 1) - 1) : (investigation?.battleTurn || 1);

  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 10, textAlign: "center", padding: compact ? "8px 12px" : "12px 16px" }}>
      {imageSrc ? (
        <div style={{ position: "relative", width: compact ? 140 : 200, height: compact ? 140 : 200, display: "grid", placeItems: "center", borderRadius: 28, ...visual.wrapperStyle }}>
          {visual.overlayStyle ? <div style={{ position: "absolute", inset: 8, borderRadius: 999, pointerEvents: "none", ...visual.overlayStyle }} /> : null}
          {visual.fxOuterStyle ? <div style={visual.fxOuterStyle} /> : null}
          {visual.fxInnerStyle ? <div style={visual.fxInnerStyle} /> : null}
          <img src={imageSrc} alt={battle.name} style={{ width: "100%", height: "100%", objectFit: "contain", position: "relative", zIndex: 2, ...visual.imageStyle }} />
        </div>
      ) : null}
      <div style={{ fontSize: 13, color: "#fda4af", letterSpacing: "0.16em", fontWeight: 800 }}>TURN {displayTurn}</div>
      <div style={{ fontSize: compact ? 24 : 30, fontWeight: 900, lineHeight: 1.1 }}>{battle.name}</div>
      <div style={{ width: "min(520px, 100%)" }}>
        <div style={bossHpTrackStyle}><div style={{ ...bossHpFillStyle, width: `${hpPercent}%` }} /></div>
        <div style={{ marginTop: 8, color: "#fce7f3", fontWeight: 700 }}>HP {hp}/{maxHp}</div>
      </div>
      {effect ? <div style={{ color: visual.badgeColor, fontWeight: 900, fontSize: 12, textShadow: "0 0 12px rgba(255,255,255,0.18)" }}>{visual.badge}</div> : null}
    </div>
  );
}

function BattleMonsterStats({ node }) {
  const battle = node?.battle;
  if (!battle) return null;
  return (
    <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
      <div style={topChipStyle}>HP {battle.hp}/{battle.maxHp || battle.hp}</div>
      <div style={topChipStyle}>ATK {battle.atk || 0}</div>
      <div style={topChipStyle}>DEF {battle.def || 0}</div>
      <div style={topChipStyle}>DEX {battle.agi || 0}</div>
      <div style={topChipStyle}>전체 {Math.round(Number(battle.aoe_chance || 0) * 100)}%</div>
      <div style={topChipStyle}>필살기 {Math.round(Number(battle.finisher_chance || 0) * 100)}%</div>
    </div>
  );
}

function BattlePartyStrip({ participants, participantStates, pendingActions, rounds, nowTick, compact = false, battlePlaybackLocked = false }) {
  if (!participants?.length) return null;
  return (
    <div style={{ marginTop: "14px", display: "flex", gap: compact ? "18px" : "24px", overflowX: "auto", paddingBottom: 6, justifyContent: "center" }}>
      {participants.map((participant) => {
        const state = participantStates?.[participant.name] || {};
        const maxHp = Number(state.maxHp || participant.stats?.hp || 0);
        const hp = Number(state.hp || participant.stats?.hp || 0);
        const hpPercent = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
        const dead = maxHp > 0 && hp <= 0;
        const effect = getRecentBattleEffect(participant.name, rounds, state, nowTick);
        const visual = getBattleVisualState({ name: participant.name, rounds, state, nowTick, side: "ally" });
        return (
          <div key={participant.name} style={{ minWidth: compact ? 116 : 132, maxWidth: compact ? 116 : 132, textAlign: "center", filter: dead ? "grayscale(1)" : "none", opacity: dead ? 0.66 : 1, ...visual.wrapperStyle }}>
            <div style={{ width: compact ? 96 : 112, height: compact ? 96 : 112, margin: "0 auto 8px", display: "grid", placeItems: "center", position: "relative", borderRadius: 24, overflow: "visible" }}>
              {visual.overlayStyle ? <div style={{ position: "absolute", inset: 4, borderRadius: 999, pointerEvents: "none", ...visual.overlayStyle }} /> : null}
              {visual.fxOuterStyle ? <div style={visual.fxOuterStyle} /> : null}
              {visual.fxInnerStyle ? <div style={visual.fxInnerStyle} /> : null}
              {participant.investigationImage || participant.image ? <img src={participant.investigationImage || participant.image} alt={participant.name} style={{ width: "100%", height: "100%", objectFit: "contain", position: "relative", zIndex: 2, ...visual.imageStyle }} /> : null}
            </div>
            <div style={{ fontWeight: 900, fontSize: compact ? "13px" : "14px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{participant.name}</div>
            <div style={{ marginTop: "6px", height: "8px", borderRadius: "999px", background: "rgba(255,255,255,0.08)", overflow: "hidden" }}><div style={{ width: `${hpPercent}%`, height: "100%", background: "linear-gradient(90deg, #93c5fd, #38bdf8)" }} /></div>
            <div style={{ marginTop: "6px", fontSize: "11px", color: "#e2e8f0" }}>HP {hp}/{maxHp}</div>
            {dead ? <div style={{ marginTop: "6px", fontSize: "11px", color: "#fecaca", fontWeight: 800 }}>관전</div> : null}
            {!dead ? <div style={{ marginTop: 4, fontSize: 11, color: pendingActions?.[participant.name] ? "#bae6fd" : battlePlaybackLocked ? "#fef08a" : "#cbd5e1", fontWeight: 900 }}>{pendingActions?.[participant.name] ? "선택 완료" : battlePlaybackLocked ? "행동 진행 중" : "대기 중"}</div> : null}
            {effect ? <div style={{ marginTop: 4, fontSize: 11, color: visual.badgeColor, fontWeight: 900, textShadow: "0 0 10px rgba(255,255,255,0.16)" }}>{visual.badge}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
const mainPanelStyle = { background: "transparent", padding: 0, borderRadius: "32px", border: "none", boxShadow: "none" };
const sidePanelStyle = { background: "linear-gradient(180deg, rgba(4,10,22,0.42), rgba(4,10,22,0.72))", padding: "16px", borderRadius: "28px", border: "none", boxShadow: "0 22px 44px rgba(2,6,23,0.16)", backdropFilter: "blur(18px)", overflow: "hidden" };
const panelLabelStyle = { color: "#8dcaf5", fontSize: "12px", letterSpacing: "0.16em", fontWeight: 800, marginBottom: "10px" };
const topChipStyle = { padding: "8px 12px", borderRadius: "999px", background: "rgba(255,255,255,0.06)", color: "#e2e8f0", fontSize: "13px", fontWeight: 700 };
const leaderBadgeStyle = { padding: "6px 10px", borderRadius: "999px", background: "rgba(125,211,252,0.14)", color: "#dbeafe", fontSize: "12px", fontWeight: 700 };
const onlineBadgeStyle = { padding: "6px 10px", borderRadius: "999px", background: "rgba(74,222,128,0.14)", color: "#bbf7d0", fontSize: "12px", fontWeight: 700 };
const dangerBadgeStyle = { padding: "6px 10px", borderRadius: "999px", background: "rgba(239,68,68,0.14)", color: "#fecaca", fontSize: "12px", fontWeight: 700 };
const readyBadgeStyle = { padding: "6px 10px", borderRadius: "999px", background: "rgba(56,189,248,0.16)", color: "#bae6fd", fontSize: "12px", fontWeight: 700 };
const dangerMessageStyle = { padding: "10px 12px", borderRadius: "18px", background: "rgba(239,68,68,0.12)", border: "none", color: "#fecaca", backdropFilter: "blur(12px)" };
const moveButtonStyle = { padding: "13px 18px", borderRadius: "999px", border: "1px solid rgba(191,219,254,0.16)", background: "linear-gradient(135deg, rgba(191,219,254,0.26), rgba(96,165,250,0.24))", color: "#f8fbff", fontWeight: 800, cursor: "pointer", boxShadow: "0 12px 22px rgba(2,6,23,0.18)" };
const actionButtonStyle = { padding: "12px 18px", borderRadius: "999px", border: "1px solid rgba(191,219,254,0.18)", background: "linear-gradient(135deg, #ffffff, #bfdbfe)", color: "#071422", fontWeight: 900, cursor: "pointer", boxShadow: "0 10px 20px rgba(2,6,23,0.14)" };
const scrollCueButtonStyle = {
  position: "absolute",
  right: 14,
  bottom: 14,
  minWidth: 42,
  minHeight: 42,
  padding: "0 14px",
  borderRadius: "999px",
  background: "rgba(8,15,30,0.88)",
  border: "1px solid rgba(191,219,254,0.22)",
  color: "#dbeafe",
  boxShadow: "0 16px 24px rgba(2,6,23,0.28)",
  zIndex: 5,
};

const battleButtonStyle = { padding: "13px 20px", borderRadius: "16px", border: "none", background: "#fecaca", color: "#7f1d1d", fontWeight: 800, cursor: "pointer", minWidth: "120px" };
const runButtonStyle = { padding: "13px 20px", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.1)", color: "white", fontWeight: 800, cursor: "pointer", minWidth: "120px" };
const myActionPanelStyle = { padding: "14px", borderRadius: "22px", background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))", border: "none", backdropFilter: "blur(12px)" };
const battleSelectStyle = { minWidth: "180px", padding: "10px 12px", borderRadius: "12px", background: "#0f172a", color: "white", border: "1px solid rgba(255,255,255,0.08)" };
const roundLogCardStyle = { padding: "10px 12px", borderRadius: "18px", background: "rgba(255,255,255,0.05)", border: "none", color: "#f8fafc", backdropFilter: "blur(12px)" };
const bossHpTrackStyle = { height: "18px", borderRadius: "999px", overflow: "hidden", background: "rgba(255,255,255,0.08)" };
const bossHpFillStyle = { height: "100%", background: "linear-gradient(90deg, #fb7185, #ef4444)" };
const bossStatCardStyle = { padding: "10px 14px", borderRadius: "999px", background: "rgba(255,255,255,0.07)", border: "none", textAlign: "center", color: "#fde2e2", fontWeight: 700, backdropFilter: "blur(12px)" };
const battleParticipantCardStyle = { padding: "12px", borderRadius: "22px", background: "rgba(255,255,255,0.05)", border: "none", backdropFilter: "blur(12px)" };
const battlePortraitStyle = { width: "48px", height: "48px", borderRadius: "14px", overflow: "hidden", background: "rgba(255,255,255,0.05)", flexShrink: 0 };
const participantStateRowStyle = { padding: "12px", borderRadius: "18px", background: "rgba(255,255,255,0.05)", border: "none", backdropFilter: "blur(12px)" };
const smallPortraitStyle = { width: "52px", height: "52px", borderRadius: "14px", overflow: "hidden", background: "rgba(255,255,255,0.05)", flexShrink: 0 };
const miniBarTrackStyle = { marginTop: "8px", width: "220px", maxWidth: "100%", height: "8px", borderRadius: "999px", overflow: "hidden", background: "rgba(255,255,255,0.08)" };
const miniBarFillStyle = { height: "100%", background: "linear-gradient(90deg, #93c5fd, #38bdf8)" };
const logBoxStyle = { display: "flex", flexDirection: "column", gap: "10px", height: "100%", minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingRight: "4px" };
const logItemStyle = { padding: "12px 14px", borderRadius: "18px", background: "rgba(255,255,255,0.05)", border: "none", backdropFilter: "blur(10px)" };
const logTimeStyle = { marginTop: "8px", color: "#8ea7c4", fontSize: "12px" };
const chatBoxStyle = { minHeight: 0, height: "100%", overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "4px" };
const chatMessageStyle = { padding: "12px 14px", borderRadius: "18px", background: "rgba(255,255,255,0.05)", border: "none", backdropFilter: "blur(10px)" };
const noticeMessageStyle = { padding: "12px 14px", borderRadius: "18px", background: "linear-gradient(135deg, rgba(14,116,144,0.48), rgba(30,64,175,0.38))", border: "1px solid rgba(186,230,253,0.34)", color: "#eff6ff", backdropFilter: "blur(10px)", boxShadow: "0 12px 22px rgba(14,116,144,0.18)" };
const chatInputStyle = { flex: 1, minWidth: 0, padding: "12px 14px", borderRadius: "18px", border: "none", background: "rgba(255,255,255,0.08)", color: "white", backdropFilter: "blur(10px)" };
const chatSendButtonStyle = { width: 48, minWidth: 48, padding: 0, display: "grid", placeItems: "center", fontSize: 18, fontWeight: 900, lineHeight: 1, borderRadius: 18 };
const overlaySectionTitleStyle = { marginTop: "14px", marginBottom: "8px", color: "#7dd3fc", fontSize: "12px", fontWeight: 800, letterSpacing: "0.08em" };
const overlayCardStyle = { padding: "12px", borderRadius: "14px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#e2e8f0" };
const overlayListStyle = { display: "flex", flexWrap: "wrap", gap: "8px" };
const overlayBadgeStyle = { padding: "8px 10px", borderRadius: "999px", background: "rgba(125,211,252,0.12)", border: "1px solid rgba(125,211,252,0.22)", color: "#dbeafe", fontSize: "12px" };
const overlayRewardStyle = { width: "100%", padding: "10px 12px", borderRadius: "12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#f8fafc" };
const overlayRouteCardStyle = { padding: "10px 12px", borderRadius: "12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" };
const overlaySubTextStyle = { marginTop: "4px", color: "#94a3b8", fontSize: "12px" };
const overlayEmptyStyle = { color: "#94a3b8", lineHeight: 1.7 };
const resultCardStyle = { padding: "18px", borderRadius: "18px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", textAlign: "center" };

export default InvestigationPage;
