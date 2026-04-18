import { useEffect, useMemo, useState } from "react";
import DesignPageFrame from "./DesignPageFrame";
import socket, { ensureSocketConnected } from "./socket";
import { apiFetch } from "./api";
import { getMaxHpFromStat } from "./hpUtils";

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

function InvestigationLobby({
  investigationId,
  initialInvestigation = null,
  character,
  isAdmin,
  goBack,
  startGame,
  reenterGame,
  design,
  theme,
}) {
  const [investigation, setInvestigation] = useState(() => initialInvestigation || null);
  const [users, setUsers] = useState([]);
  const [selectedLeaders, setSelectedLeaders] = useState([]);

  const loadInvestigation = async () => {
    try {
      const res = await apiFetch(`/investigationLobby/${investigationId}?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      setInvestigation((prev) => ({ ...(prev || {}), ...(data || {}) }));
      if (Array.isArray(data?.leaders) && data.leaders.length > 0) setSelectedLeaders(data.leaders);
      return data;
    } catch (err) {
      console.error("loadInvestigation error", err);
      return null;
    }
  };

  useEffect(() => {
    if (initialInvestigation?.id === investigationId) {
      setInvestigation((prev) => prev || initialInvestigation);
      if (Array.isArray(initialInvestigation?.leaders) && initialInvestigation.leaders.length > 0) setSelectedLeaders(initialInvestigation.leaders);
    }
    loadInvestigation();
  }, [investigationId, initialInvestigation]);

  useEffect(() => {
    let cancelled = false;

    const poll = async (force = false) => {
      if (!force && document.visibilityState === "hidden") return;
      try {
        const res = await apiFetch(`/investigationLobby/${investigationId}?t=${Date.now()}`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        setInvestigation(data);
        if (Array.isArray(data?.leaders) && data.leaders.length > 0) setSelectedLeaders(data.leaders);
        if (data?.started && !data?.ended) {
          reenterGame();
        }
      } catch {
        // ignore poll errors
      }
    };

    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        poll(true);
      }
    };

    poll(true);
    const timer = setInterval(() => poll(false), 4000);
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
    };
  }, [investigationId, reenterGame]);

  useEffect(() => {
    const handleUsers = (userList) => {
      const rows = Array.isArray(userList) ? userList : [];
      setUsers(rows);
    };

    const handleStarted = ({ id }) => {
      if (id !== investigationId) return;
      setInvestigation((prev) => (prev ? { ...prev, started: true } : prev));
      reenterGame();
    };

    const handleParticipantsUpdated = (allInvestigations) => {
      const found = (allInvestigations || []).find((v) => v.id === investigationId);
      if (found) {
        setInvestigation((prev) => ({ ...(prev || {}), ...found, participants: found.participants || prev?.participants || [], participantStates: prev?.participantStates || {} }));
        setSelectedLeaders((prev) => (Array.isArray(found.leaders) && (found.leaders.length > 0 || prev.length === 0) ? found.leaders : prev));
      }
    };

    const handleStateUpdated = (payload) => {
      if (payload.investigationId !== investigationId) return;
      setInvestigation((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          currentNodeId: payload.currentNodeId,
          sharedLog: payload.sharedLog,
          sharedLogs: payload.sharedLogs || prev.sharedLogs || [],
          leaders: payload.leaders || prev.leaders || [],
          participants: payload.participants || prev.participants || [],
          spectators: payload.spectators || prev.spectators || [],
          started: payload.started ?? prev.started ?? false,
          participantStates: payload.participantStates || prev.participantStates || {},
        };
      });
      setSelectedLeaders((prev) => (Array.isArray(payload.leaders) && (payload.leaders.length > 0 || prev.length === 0) ? payload.leaders : prev));
    };

    socket.on("users", handleUsers);
    socket.on("onlineAccounts", handleUsers);
    socket.on("investigationStarted", handleStarted);
    socket.on("participantsUpdated", handleParticipantsUpdated);
    socket.on("investigationStateUpdated", handleStateUpdated);

    socket.emit("register", character || { id: `admin-${Date.now()}`, ownerId: "admin", name: "운영자" });
    ensureSocketConnected().emit("joinRoom", investigationId);

    return () => {
      socket.emit("leaveRoom");
      socket.off("users", handleUsers);
      socket.off("onlineAccounts", handleUsers);
      socket.off("investigationStarted", handleStarted);
      socket.off("participantsUpdated", handleParticipantsUpdated);
      socket.off("investigationStateUpdated", handleStateUpdated);
    };
  }, [character, investigationId, reenterGame]);

  const fallbackParticipants = useMemo(() => buildFallbackParticipants(investigation), [investigation]);
  const actualParticipants = useMemo(() => {
    const rows = Array.isArray(investigation?.participants) ? investigation.participants.filter((participant) => participant?.name) : [];
    return rows;
  }, [investigation?.participants]);
  const participantStates = investigation?.participantStates || {};
  const hasPrestartParticipantState = !investigation?.started && Object.keys(participantStates).length > 0;
  const spectatorList = Array.isArray(investigation?.spectators) ? investigation.spectators : [];
  const spectators = spectatorList;

  const participants = useMemo(() => {
    const shouldUseFallback = !!investigation?.started || actualParticipants.length === 0 || hasPrestartParticipantState;
    const raw = shouldUseFallback ? fallbackParticipants : actualParticipants;
    return [...raw].sort((a, b) => {
      const aLeader = selectedLeaders.includes(a.name);
      const bLeader = selectedLeaders.includes(b.name);
      if (aLeader && !bLeader) return -1;
      if (!aLeader && bLeader) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [actualParticipants, fallbackParticipants, hasPrestartParticipantState, investigation?.started, selectedLeaders]);

  const participantNames = participants.map((p) => p.name);
  const isParticipating = character ? (participantNames.includes(character.name) || (!!participantStates?.[character.name] && !investigation?.ended)) : false;

  useEffect(() => {
    if (!investigation?.started) return;
    if (isParticipating) {
      reenterGame();
    }
  }, [investigation?.started, isParticipating, reenterGame]);

  const toggleLeader = async (name) => {
    if (!isAdmin) return;

    const nextLeaders = selectedLeaders.includes(name)
      ? selectedLeaders.filter((v) => v !== name)
      : [...selectedLeaders, name];

    setSelectedLeaders(nextLeaders);

    const res = await apiFetch("/setInvestigationLeaders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: investigationId,
        leaders: nextLeaders,
      }),
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!data.success) {
      alert(data.message || "리더 저장에 실패했습니다.");
      return;
    }

    setInvestigation(data.item || investigation);
    setSelectedLeaders(Array.isArray(data?.item?.leaders) ? data.item.leaders : nextLeaders);
  };

  const saveLeaders = async () => {
    if (!isAdmin) return;
    await loadInvestigation();
    alert("리더 저장됨");
  };

  const startInvestigation = async () => {
    if (!isAdmin) return;
    if (selectedLeaders.length > 0) {
      const leaderRes = await apiFetch("/setInvestigationLeaders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: investigationId, leaders: selectedLeaders }),
      });
      let leaderData = {};
      try { leaderData = await leaderRes.json(); } catch { leaderData = {}; }
      if (!leaderData.success) {
        alert(leaderData.message || "리더 저장에 실패했습니다.");
        return;
      }
    }

    let data = {};
    let requestOk = false;
    try {
      const res = await apiFetch("/startInvestigation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: investigationId }),
      });
      requestOk = !!res.ok;
      try {
        data = await res.json();
      } catch {
        data = {};
      }
    } catch {
      data = {};
    }

    if (!data.success) {
      try {
        const latestRes = await apiFetch(`/investigations/${investigationId}?t=${Date.now()}`, { cache: "no-store" });
        const latest = await latestRes.json();
        if (latest?.started) {
          setInvestigation(latest);
          startGame();
          return;
        }
      } catch {
        // ignore fallback errors
      }
      if (requestOk && data.started) {
        setInvestigation((prev) => (prev ? { ...prev, started: true, leaders: data.leaders || prev.leaders } : prev));
        startGame();
        return;
      }
      setTimeout(async () => {
        try {
          const latest = await loadInvestigation();
          if (latest?.started) {
            setInvestigation(latest);
            startGame();
            return;
          }
          alert(data.message || "조사 시작에 실패했습니다.");
        } catch {
          alert(data.message || "조사 시작에 실패했습니다.");
        }
      }, 450);
      return;
    }
    setInvestigation((prev) => (prev ? { ...prev, started: true, leaders: data.leaders || prev.leaders } : prev));
    startGame();
  };

  const enterOrStartInvestigation = () => {
    if (investigation?.started) {
      reenterGame();
      return;
    }
    startInvestigation();
  };

  const participate = async () => {
    if (!character) return;
    const res = await apiFetch("/participateInvestigation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: investigationId, character }),
    });
    const data = await res.json();
    if (!data.success) return alert(data.message || "조사 참여에 실패했습니다.");
    if (data.investigation) {
      setInvestigation(data.investigation);
      if (Array.isArray(data.investigation?.leaders)) setSelectedLeaders(data.investigation.leaders);
    }
    loadInvestigation();
  };

  const leave = async () => {
    if (!character) return;
    const res = await apiFetch("/leaveInvestigation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: investigationId, characterName: character.name }),
    });
    const data = await res.json();
    if (!data.success) return alert("조사 나가기에 실패했습니다.");
    if (data.item) {
      setInvestigation(data.item);
      if (Array.isArray(data.item?.leaders)) setSelectedLeaders(data.item.leaders);
    }
    loadInvestigation();
  };

  const isParticipantOnline = (participant) => {
    const keySet = new Set();
    users.forEach((user) => {
      [user?.accountKey, user?.ownerId, user?.id, user?.name, user?.characterId].forEach((value) => {
        if (value !== undefined && value !== null && String(value).trim()) keySet.add(String(value));
      });
    });
    return keySet.has(String(participant?.ownerId)) || keySet.has(String(participant?.id)) || keySet.has(String(participant?.name));
  };

  if (!investigation) {
    return (
      <DesignPageFrame design={design} pageKey="investigations" handlers={{}} theme={theme} minHeight="100vh" contentStyle={{ padding: 0 }}>
        <div style={{ minHeight: "100vh", color: "white", padding: "20px" }}>불러오는 중...</div>
      </DesignPageFrame>
    );
  }

  const leaderNames = selectedLeaders.length > 0 ? selectedLeaders.join(", ") : "리더 없음";
  const canStartLobby = investigation?.type === "daily" ? participants.length > 0 : (participants.length > 0 && selectedLeaders.length > 0);

  return (
    <DesignPageFrame design={design} pageKey="investigations" handlers={{}} theme={theme} minHeight="100vh" contentStyle={{ padding: 0 }}>
      <div style={{ color: "white", padding: "26px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "22px", alignItems: "start" }}>
          <div style={{ display: "grid", gap: "22px" }}>
            <div style={panelStyle}>
              <div className="section-eyebrow">LOBBY</div>
              <h2 style={{ marginTop: "10px", marginBottom: "8px" }}>{investigation.title}</h2>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "16px" }}>
                <div style={smallChipStyle}>{investigation.type === "daily" ? "일일조사" : "단체조사"}</div>
                <div style={smallChipStyle}>{investigation.started ? "진행 중" : "대기 중"}</div>
                <div style={leaderChipStyle}>리더: {leaderNames}</div>
                <div style={smallChipStyle}>참여 {participants.length}명</div>
              </div>
              {isAdmin ? (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                  <div style={{ ...leaderChipStyle, background: "rgba(255,255,255,0.08)", color: "#f8fafc" }}>운영자</div>
                  {!investigation.started ? <button type="button" onClick={saveLeaders} className="ghost-button">리더 저장</button> : null}
                  {!investigation.started ? <button type="button" onClick={() => document.getElementById("lobby-participants")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="ghost-button">리더 지정</button> : null}
                  {((!investigation.started && canStartLobby) || investigation.started) ? <button type="button" onClick={enterOrStartInvestigation} className="home-primary-button">조사로 들어가기</button> : null}
                </div>
              ) : null}
            </div>

            <div style={panelStyle}>
              <div id="lobby-participants" style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <div className="section-eyebrow">PARTICIPANTS</div>
                  <h3 style={{ marginTop: "10px", marginBottom: 0 }}>참여 인원</h3>
                </div>

                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {!investigation.started && !isParticipating && character && (
                    <button type="button" onClick={participate} className="home-primary-button">참여하기</button>
                  )}
                  {!investigation.started && isParticipating && character && (
                    <button type="button" onClick={leave} className="ghost-button">팀 나가기</button>
                  )}
                  {isAdmin && !investigation.started && (
                    <button type="button" onClick={saveLeaders} className="ghost-button">리더 저장</button>
                  )}
                  {((investigation.started && (isAdmin || isParticipating)) || (isAdmin && !investigation.started && canStartLobby)) ? (
                    <button type="button" onClick={enterOrStartInvestigation} className="home-primary-button">조사로 들어가기</button>
                  ) : null}
                  <button type="button" onClick={goBack} className="ghost-button">조사 나가기</button>
                </div>
              </div>

              {participants.length === 0 ? (
                <div style={{ color: "#94a3b8" }}>아직 참여한 인원이 없습니다.</div>
              ) : (
                <div style={{ display: "grid", gap: "12px" }}>
                  {participants.map((p) => {
                    const isLeaderSelected = selectedLeaders.includes(p.name);
                    const isOnline = isParticipantOnline(p);
                    const state = participantStates[p.name] || {};
                    const currentHp = Number(state.hp ?? state.currentHp ?? getMaxHpFromStat(p.stats?.hp));
                    const maxHp = Number(state.maxHp ?? getMaxHpFromStat(p.stats?.hp));
                    const hpPercent = maxHp > 0 ? Math.max(0, Math.min(100, (currentHp / maxHp) * 100)) : 0;
                    const dead = maxHp > 0 && currentHp <= 0;

                    return (
                      <div key={p.name} style={participantRowStyle}>
                        <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                          <div style={avatarWrapStyle}>
                            {p.image ? <img src={p.image} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ display: "grid", placeItems: "center", width: "100%", height: "100%", color: "#7e94ae" }}>NO</div>}
                          </div>

                          <div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                              <div style={{ fontWeight: 800, fontSize: "18px" }}>{p.name}</div>
                              {isLeaderSelected && <div style={leaderChipStyle}>리더</div>}
                              {isOnline ? <div style={onlineChipStyle}>온라인</div> : <div style={offlineChipStyle}>오프라인</div>}
                              {dead && <div style={deadChipStyle}>전투 불가</div>}
                            </div>
                            <div style={{ marginTop: "8px", width: "260px", maxWidth: "100%" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#9fb0c7", marginBottom: "6px" }}>
                                <span>Lv. {Number(p.level || 1)}</span>
                                <span>HP {currentHp}/{maxHp || "-"}</span>
                              </div>
                              <div style={{ height: "10px", borderRadius: "999px", background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
                                <div style={{ width: `${hpPercent}%`, height: "100%", background: dead ? "linear-gradient(90deg, #fca5a5, #ef4444)" : "linear-gradient(90deg, #93c5fd, #22d3ee)" }} />
                              </div>
                              <div style={{ marginTop: "6px", color: "#9fb0c7", fontSize: "13px" }}>
                                ATK {state.atk || p.stats?.atk || 0} / DEF {state.def || p.stats?.def || 0} / AGI {state.agi || p.stats?.agi || 0}
                              </div>
                            </div>
                          </div>
                        </div>

                        {isAdmin && !investigation.started ? (
                          <button type="button" onClick={() => toggleLeader(p.name)} className="ghost-button">
                            {isLeaderSelected ? "리더 해제" : "리더 지정"}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gap: "22px" }}>
            <div style={panelStyle}>
              <div className="section-eyebrow">INFO</div>
              <h3 style={{ marginTop: "10px", marginBottom: "14px" }}>조사 정보</h3>
              <div style={{ display: "grid", gap: "10px" }}>
                <div style={infoRowStyle}><span>제목</span><strong>{investigation.title}</strong></div>
                <div style={infoRowStyle}><span>종류</span><strong>{investigation.type === "daily" ? "일일조사" : "단체조사"}</strong></div>
                <div style={infoRowStyle}><span>상태</span><strong>{investigation.started ? "진행 중" : "대기 중"}</strong></div>
                <div style={infoRowStyle}><span>리더</span><strong>{leaderNames}</strong></div>
              </div>
            </div>

            <div style={panelStyle}>
              <div className="section-eyebrow">STATUS</div>
              <h3 style={{ marginTop: "10px", marginBottom: "14px" }}>현재 현황</h3>
              <div style={{ display: "grid", gap: "10px" }}>
                <div style={infoRowStyle}><span>참여 인원</span><strong>{participants.length}명</strong></div>
                <div style={infoRowStyle}><span>관전 인원</span><strong>{spectators.length}명</strong></div>
                <div style={infoRowStyle}><span>리더 수</span><strong>{selectedLeaders.length}명</strong></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DesignPageFrame>
  );
}

const panelStyle = {
  background: "rgba(8, 15, 30, 0.92)",
  padding: "20px",
  borderRadius: "26px",
  border: "1px solid rgba(255,255,255,0.08)",
};

const smallChipStyle = {
  padding: "8px 12px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.06)",
  color: "#e2e8f0",
  fontSize: "13px",
  fontWeight: 700,
};

const leaderChipStyle = {
  padding: "8px 12px",
  borderRadius: "999px",
  background: "rgba(125,211,252,0.14)",
  color: "#dbeafe",
  fontSize: "13px",
  fontWeight: 700,
};

const onlineChipStyle = {
  padding: "6px 10px",
  borderRadius: "999px",
  background: "rgba(74,222,128,0.14)",
  color: "#bbf7d0",
  fontSize: "12px",
  fontWeight: 700,
};

const offlineChipStyle = {
  padding: "6px 10px",
  borderRadius: "999px",
  background: "rgba(148,163,184,0.18)",
  color: "#cbd5e1",
  fontSize: "12px",
  fontWeight: 700,
};

const deadChipStyle = {
  padding: "6px 10px",
  borderRadius: "999px",
  background: "rgba(239,68,68,0.14)",
  color: "#fecaca",
  fontSize: "12px",
  fontWeight: 700,
};

const participantRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
  padding: "14px",
  borderRadius: "18px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.06)",
};

const avatarWrapStyle = {
  width: "62px",
  height: "62px",
  borderRadius: "18px",
  overflow: "hidden",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.06)",
  flexShrink: 0,
};

const infoRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  padding: "12px 14px",
  borderRadius: "14px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.06)",
  color: "#dce7f5",
};

export default InvestigationLobby;
