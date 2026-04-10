import { useEffect, useMemo, useState } from "react";
import DesignPageFrame from "./DesignPageFrame";
import { apiJsonCached, buildApiUrl } from "./api";

const INVESTIGATION_LIST_CACHE_KEY = "plc-cache-investigations";

const PRELOADED_INVESTIGATION_IMAGES = new Set();

function preloadInvestigationImages(urls = []) {
  (Array.isArray(urls) ? urls : []).forEach((rawUrl) => {
    const url = String(rawUrl || "").trim();
    if (!url || PRELOADED_INVESTIGATION_IMAGES.has(url)) return;
    PRELOADED_INVESTIGATION_IMAGES.add(url);
    const img = new Image();
    img.decoding = "sync";
    img.loading = "eager";
    img.src = url;
  });
}

function CardImageLayer({ src = "", alt = "", grayscale = false }) {
  const url = String(src || "").trim();
  if (!url) return null;
  return (
    <img
      src={url}
      alt={alt}
      loading="eager"
      decoding="sync"
      fetchPriority="high"
      draggable={false}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        filter: grayscale ? "grayscale(1) saturate(0.12) brightness(0.86)" : "none",
        transform: "translateZ(0)",
        pointerEvents: "none",
        userSelect: "none",
      }}
    />
  );
}

function adminEditButtonStyle(top = 18) {
  return {
    position: "absolute",
    top,
    right: 18,
    zIndex: 3,
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "rgba(255,255,255,0.92)",
    color: "#17324a",
    fontWeight: 900,
    cursor: "pointer",
  };
}


function readCachedInvestigations() {
  try {
    const raw = localStorage.getItem(INVESTIGATION_LIST_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedInvestigations(rows) {
  try {
    localStorage.setItem(INVESTIGATION_LIST_CACHE_KEY, JSON.stringify(Array.isArray(rows) ? rows : []));
  } catch {}
}

function getDailyResumeStorageKeys(investigationId, character) {
  if (!investigationId || !character) return [];
  const ownerKeys = [
    character.id,
    `${character.ownerId || "owner"}:${character.name || ""}`,
    character.name,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return Array.from(new Set(ownerKeys)).map((ownerKey) => `plc-daily-resume-${investigationId}-${ownerKey}`);
}

function hasLocalDailyResume(investigationId, character) {
  const keys = getDailyResumeStorageKeys(investigationId, character);
  if (!keys.length) return false;
  try {
    return keys.some((key) => !!localStorage.getItem(key));
  } catch {
    return false;
  }
}

function card(theme, disabled = false, clickable = false) {
  return {
    padding: 20,
    borderRadius: 28,
    background: disabled ? "rgba(226,232,240,0.72)" : (theme?.panelStrong || "#fff"),
    border: `1px solid ${theme?.line || "rgba(98,176,220,0.18)"}`,
    boxShadow: theme?.shadow || "0 18px 38px rgba(73,132,170,0.16)",
    opacity: disabled ? 0.75 : 1,
    cursor: clickable ? "pointer" : "default",
  };
}

function chip(bg, color) {
  return {
    padding: "6px 10px",
    borderRadius: 999,
    background: bg,
    color,
    fontWeight: 800,
    fontSize: 12,
  };
}

function scheduleOrderValue(item) {
  const open = item?.openAt ? new Date(item.openAt).getTime() : Number.MAX_SAFE_INTEGER;
  return Number.isFinite(open) ? open : Number.MAX_SAFE_INTEGER;
}

function timeText(item) {
  if (!item?.scheduleEnabled || !item?.openAt) return item?.effectiveOpened ? "현재 개방 중" : "비활성화";
  const open = new Date(item.openAt);
  if (Number.isNaN(open.getTime())) return item?.effectiveOpened ? "현재 개방 중" : "비활성화";
  return `${open.toLocaleString("ko-KR", { hour12: false })} 오픈`;
}


function getRepresentativeImage(items = []) {
  const rows = Array.isArray(items) ? items : [];
  return rows.find((item) => String(item?.listImage || "").trim())?.listImage || "";
}

function formatCorrosionRange(items = []) {
  const values = (Array.isArray(items) ? items : [])
    .map((item) => Number(item?.endCorrosion || 0))
    .filter((value) => value > 0);
  if (values.length === 0) return "침식률 종료 +0";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? `침식률 종료 +${min}` : `침식률 종료 +${min}~+${max}`;
}

export default function InvestigationList({ onEnter, onSpectate, onEditInvestigation, activeCharacter, isAdmin = false, design, theme }) {
  const [investigations, setInvestigations] = useState(() => readCachedInvestigations());
  const [view, setView] = useState("entry");
  const [dailyLeft, setDailyLeft] = useState(Number(activeCharacter?.dailyAttemptsLeft ?? 1));
  const [completedOpenId, setCompletedOpenId] = useState("");
  const [completedDetail, setCompletedDetail] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiJsonCached(`/investigations`, { ttlMs: 2500, storageKey: "plc-cache-investigations-json" })
        .then((data) => {
          if (cancelled) return;
          const next = Array.isArray(data) ? data : [];
          setInvestigations(next);
          writeCachedInvestigations(next);
        })
        .catch(() => {
          if (cancelled) return;
          setInvestigations((prev) => (Array.isArray(prev) && prev.length > 0 ? prev : readCachedInvestigations()));
        });
    };
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      load();
    }, 10000);
    setDailyLeft(Number(activeCharacter?.dailyAttemptsLeft ?? 1));
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeCharacter?.id, activeCharacter?.dailyAttemptsLeft]);

  useEffect(() => {
    preloadInvestigationImages((Array.isArray(investigations) ? investigations : []).map((item) => item?.listImage).filter(Boolean));
  }, [investigations]);

  const dailyPool = useMemo(
    () => investigations.filter((item) => item.type === "daily" && !item.hidden && item.opened !== false && item.statusLabel !== "비활성화" && !!(item.effectiveOpened ?? item.opened)),
    [investigations]
  );
  const dailyOwnerKeys = useMemo(() => {
    if (!activeCharacter) return [];
    const keys = [
      String(activeCharacter.id || ""),
      String(`${activeCharacter.ownerId || "owner"}:${activeCharacter.name || ""}`),
    ].filter(Boolean);
    return Array.from(new Set(keys));
  }, [activeCharacter?.id, activeCharacter?.ownerId, activeCharacter?.name]);
  const dailyOwnerKey = dailyOwnerKeys[0] || "";
  const resumableDaily = useMemo(
    () => investigations.find((item) => item.type === "daily" && item.started && !item.ended && (dailyOwnerKeys.includes(String(item.dailyResumeOwnerKey || "")) || (dailyOwnerKeys.includes(String(item.dailyOwnerKey || "")) && Number(item.participantsCount || 0) === 0) || hasLocalDailyResume(item.id, activeCharacter))),
    [investigations, dailyOwnerKeys, activeCharacter]
  );

  const groups = useMemo(() => {
    const rows = investigations.filter((item) => item.type === "group" && !item.hidden && !(item.ended || item.endedAt || item.statusLabel === "종료"));
    return [...rows].sort((a, b) => {
      const aDisabled = !(a.effectiveOpened ?? a.opened);
      const bDisabled = !(b.effectiveOpened ?? b.opened);
      if (aDisabled !== bDisabled) return aDisabled ? 1 : -1;
      const aStarted = !!a.started && !a.ended;
      const bStarted = !!b.started && !b.ended;
      if (aStarted !== bStarted) return aStarted ? -1 : 1;
      return scheduleOrderValue(a) - scheduleOrderValue(b);
    });
  }, [investigations]);

  const completedGroups = useMemo(() => {
    const rows = investigations.filter((item) => item.type === "group" && !item.hidden && (item.ended || item.endedAt || item.statusLabel === "종료"));
    return [...rows].sort((a, b) => Number(new Date(b.endedAt || b.closeAt || 0)) - Number(new Date(a.endedAt || a.closeAt || 0)));
  }, [investigations]);

  const dailyEntryImage = resumableDaily?.listImage || getRepresentativeImage(dailyPool);
  const groupEntryImage = getRepresentativeImage(groups) || getRepresentativeImage(completedGroups);
  const investContent = design?.siteContent?.investigations || {};
  const editableDaily = resumableDaily || dailyPool[0] || null;
  const editableGroup = groups[0] || completedGroups[0] || null;

  const openCompletedDetail = async (item) => {
    try {
      const res = await fetch(buildApiUrl(`/investigationView/${item.id}`));
      const data = await res.json();
      setCompletedDetail(data);
      setCompletedOpenId(item.id);
    } catch {
      setCompletedDetail(item);
      setCompletedOpenId(item.id);
    }
  };

  const startDaily = () => {
    if (dailyPool.length === 0) return alert("활성화된 일일조사가 없습니다.");
    if (dailyLeft <= 0) return alert("남은 일일조사 횟수가 없습니다.");
    const picked = dailyPool[Math.floor(Math.random() * dailyPool.length)];
    onEnter(picked, { mode: "daily" });
  };

  return (
    <DesignPageFrame design={design} pageKey="investigations" handlers={{}} theme={theme} minHeight="100vh">
      <div style={{ color: theme?.textMain || "#13324b" }}>
        <div style={{ marginBottom: 18 }}>
          <div className="section-eyebrow">INVESTIGATION</div>
          <h2 style={{ marginTop: 10, marginBottom: 8 }}>{investContent?.title || "조사"}</h2>
        </div>

        {view === "entry" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                if (resumableDaily) return;
                startDaily();
              }}
              onKeyDown={(event) => {
                if (resumableDaily) return;
                if (event.key === "Enter" || event.key === " ") startDaily();
              }}
              style={{
                ...card(theme, false, !resumableDaily),
                textAlign: "left",
                minHeight: 260,
                position: "relative",
                overflow: "hidden",
                padding: 0,
                background: theme?.panelStrong || "#fff",
              }}
            >
              <CardImageLayer src={dailyEntryImage} alt="일일조사" />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.76) 28%, rgba(255,255,255,0.18) 100%)" }} />
              {isAdmin && editableDaily ? (
                <button type="button" style={adminEditButtonStyle()} onClick={(event) => { event.stopPropagation(); onEditInvestigation?.(editableDaily.id); }}>수정</button>
              ) : null}
              <div style={{ position: "relative", zIndex: 1, padding: 22, display: "grid", gap: 12, minHeight: 260 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="section-eyebrow" style={{ color: "#243b53" }}>DAILY</div>
                  <h3 style={{ marginTop: 0, marginBottom: 0, color: "#17324a" }}>일일조사</h3>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "auto" }}>
                  <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>남은 횟수 {dailyLeft}</div>
                  <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>활성 {dailyPool.length}개</div>
                  <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>{formatCorrosionRange(dailyPool)}</div>
                  {resumableDaily ? <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>진행 중인 일일조사 있음</div> : null}
                  {!activeCharacter ? <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>캐릭터 필요</div> : null}
                </div>
                {resumableDaily ? (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button type="button" className="ghost-button" onClick={(event) => { event.stopPropagation(); onEnter(resumableDaily, { mode: "daily" }); }}>
                      조사로 돌아가기
                    </button>
                    <div style={{ ...chip("rgba(255,255,255,0.88)", theme?.textSoft || "#4f7390"), alignSelf: "center" }}>
                      {resumableDaily.title || "진행 중인 일일조사"}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button type="button" className="home-primary-button" onClick={(event) => { event.stopPropagation(); startDaily(); }}>조사 시작</button>
                  </div>
                )}
              </div>
            </div>

            <button type="button" onClick={() => setView("group")} style={{ ...card(theme, false, true), textAlign: "left", minHeight: 260, position: "relative", overflow: "hidden", padding: 0, background: theme?.panelStrong || "#fff" }}>
              <CardImageLayer src={groupEntryImage} alt="단체조사" />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.76) 28%, rgba(255,255,255,0.18) 100%)" }} />
              {isAdmin && editableGroup ? (
                <span role="button" tabIndex={0} style={adminEditButtonStyle()} onClick={(event) => { event.stopPropagation(); onEditInvestigation?.(editableGroup.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onEditInvestigation?.(editableGroup.id); } }}>수정</span>
              ) : null}
              <div style={{ position: "relative", zIndex: 1, padding: 22, display: "grid", gap: 12, minHeight: 260 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="section-eyebrow" style={{ color: "#243b53" }}>GROUP</div>
                  <h3 style={{ marginTop: 0, marginBottom: 0, color: "#17324a" }}>단체조사</h3>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "auto" }}>
                  <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>활성 {groups.filter((item) => item.effectiveOpened ?? item.opened).length}개</div>
                  <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>비활성 {groups.filter((item) => !(item.effectiveOpened ?? item.opened)).length}개</div>
                  <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>완료 {completedGroups.length}개</div>
                </div>
              </div>
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12 }}>
              <div>
                <div className="section-eyebrow">GROUP LIST</div>
                <h3 style={{ marginTop: 10, marginBottom: 0 }}>단체조사 목록</h3>
              </div>
              <button type="button" className="ghost-button" onClick={() => setView("entry")}>뒤로가기</button>
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              {groups.map((item) => {
                const disabled = !(item.effectiveOpened ?? item.opened);
                const started = !!item.started && !item.ended;
                return (
                  <div key={item.id} style={{ ...card(theme, disabled), position: "relative", overflow: "hidden", minHeight: 188, padding: 0, background: disabled ? "rgba(226,232,240,0.72)" : (theme?.panelStrong || "#fff") }}>
                    <CardImageLayer src={item.listImage} alt={item.title} />
                    {item.listImage ? <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.82) 34%, rgba(255,255,255,0.24) 72%, rgba(255,255,255,0.06) 100%)" }} /> : null}
                    {isAdmin ? <button type="button" style={adminEditButtonStyle(16)} onClick={(event) => { event.stopPropagation(); onEditInvestigation?.(item.id); }}>수정</button> : null}
                    <div style={{ position: "relative", zIndex: 1, padding: 20, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "stretch", minHeight: 188 }}>
                      <div style={{ maxWidth: "70%" }}>
                        <div className="section-eyebrow">{disabled ? "INACTIVE" : "GROUP"}</div>
                        <h3 style={{ marginTop: 10, marginBottom: 8 }}>{item.title}</h3>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                          <div style={chip(started ? "rgba(30,64,175,0.14)" : disabled ? "rgba(100,116,139,0.14)" : "rgba(20,83,45,0.12)", started ? "#1d4ed8" : disabled ? "#475569" : "#166534")}>{started ? "진행 중" : disabled ? "비활성화" : "대기 중"}</div>
                          <div style={chip("rgba(255,255,255,0.78)", theme?.textSoft || "#4f7390")}>참여 {item.participantsCount || 0}명</div>
                          <div style={chip("rgba(255,255,255,0.78)", theme?.textSoft || "#4f7390")}>{timeText(item)}</div>
                          <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>종료 시 침식 +{Number(item.endCorrosion || 0)}</div>
                        </div>
                      </div>
                      <div style={{ display: "grid", gap: 8, alignContent: "start", justifyItems: "end" }}>
                        {disabled ? <div style={chip("rgba(100,116,139,0.16)", "#475569")}>비활성화</div> : started ? <div style={chip("rgba(30,64,175,0.16)", "#1d4ed8")}>진행중</div> : null}
                        <button type="button" className="home-primary-button" onClick={() => onEnter(item, { mode: "group" })} disabled={item.ended || disabled}>{started ? "들어가기" : "참여"}</button>
                        {(started || item.ended) ? <button type="button" className="ghost-button" onClick={() => (onSpectate ? onSpectate(item) : onEnter(item, { mode: "spectate" }))}>관전</button> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              {groups.length === 0 ? <div style={{ color: theme?.textSoft || "#4f7390" }}>등록된 단체조사가 없습니다.</div> : null}

              <div style={{ marginTop: 10 }}>
                <div className="section-eyebrow">COMPLETED</div>
                <h3 style={{ marginTop: 10, marginBottom: 12 }}>완료된 조사</h3>
                <div style={{ display: "grid", gap: 14 }}>
                  {completedGroups.map((item) => (
                    <div key={item.id} style={{ ...card(theme, true), position: "relative", overflow: "hidden", background: "rgba(203,213,225,0.72)", filter: "grayscale(0.15)" }}>
                      <CardImageLayer src={item.listImage} alt={item.title} grayscale />
                      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(244,244,245,0.96) 0%, rgba(244,244,245,0.82) 36%, rgba(244,244,245,0.38) 72%, rgba(244,244,245,0.14) 100%)" }} />
                      {isAdmin ? <button type="button" style={adminEditButtonStyle(16)} onClick={() => onEditInvestigation?.(item.id)}>수정</button> : null}
                      <div style={{ position: "relative", zIndex: 1 }}>
                      <div className="section-eyebrow">COMPLETE</div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                        <div>
                          <h3 style={{ marginTop: 10, marginBottom: 8 }}>{item.title}</h3>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                            <div style={chip("rgba(59,130,246,0.12)", "#1d4ed8")}>완료됨</div>
                            <div style={chip("rgba(148,163,184,0.12)", theme?.textSoft || "#4f7390")}>참여 {item.participantsCount || 0}명</div>
                          </div>
                        </div>
                        <div style={chip("rgba(59,130,246,0.12)", "#1d4ed8")}>로그 열람 가능</div>
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                        <button type="button" className="ghost-button" onClick={() => (onSpectate ? onSpectate(item) : onEnter(item, { mode: "spectate" }))}>조사 로그 보기</button>
                      </div>
                      </div>
                    </div>
                  ))}
                  {completedGroups.length === 0 ? <div style={{ color: theme?.textSoft || "#4f7390" }}>완료된 단체조사가 아직 없습니다.</div> : null}
                </div>
              </div>
            </div>
            {completedOpenId ? (
              <div style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.56)", backdropFilter: "blur(8px)", zIndex: 2500, display: "grid", placeItems: "center", padding: 24 }}>
                <div style={{ width: "min(920px, calc(100vw - 48px))", maxHeight: "calc(100vh - 48px)", overflow: "auto", padding: 22, borderRadius: 24, background: "rgba(255,255,255,0.96)", border: `1px solid ${theme?.line || "rgba(98,176,220,0.18)"}`, boxShadow: theme?.shadow || "0 18px 38px rgba(73,132,170,0.16)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <div className="section-eyebrow">COMPLETED LOG</div>
                      <h3 style={{ marginTop: 10, marginBottom: 0 }}>{completedDetail?.title || "완료 조사"}</h3>
                    </div>
                    <button type="button" className="ghost-button" onClick={() => { setCompletedOpenId(""); setCompletedDetail(null); }}>닫기</button>
                  </div>
                  <div style={{ display: "grid", gap: 12 }}>
                    {(completedDetail?.resultSummary || completedDetail?.endedReason) ? (
                      <div style={{ padding: 16, borderRadius: 18, background: "rgba(239,249,255,0.9)", border: `1px solid ${theme?.line || "rgba(98,176,220,0.18)"}` }}>
                        <div style={{ fontWeight: 900, marginBottom: 8 }}>조사 결과</div>
                        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{completedDetail?.resultSummary || completedDetail?.endedReason}</div>
                      </div>
                    ) : null}
                    <div style={{ padding: 16, borderRadius: 18, background: "rgba(255,255,255,0.96)", border: `1px solid ${theme?.line || "rgba(98,176,220,0.18)"}`, display: "grid", gap: 8 }}>
                      <div style={{ fontWeight: 900 }}>공유 로그</div>
                      {(completedDetail?.sharedLogs || []).length ? (completedDetail.sharedLogs.map((entry, idx) => <div key={entry?.id || idx} style={{ padding: 12, borderRadius: 14, background: "rgba(239,249,255,0.86)", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{entry?.text || ""}</div>)) : <div style={{ color: theme?.textSoft || "#4f7390" }}>기록된 로그가 없습니다.</div>}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </DesignPageFrame>
  );
}
