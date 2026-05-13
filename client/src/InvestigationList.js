import { useEffect, useMemo, useRef, useState } from "react";
import DesignPageFrame from "./DesignPageFrame";
import LazyImage from "./LazyImage";
import { apiFetch, apiJsonCached, buildApiUrl } from "./api";

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

function withImageVersion(src = "", version = 0) {
  const url = String(src || "").trim();
  const stamp = Number(version || 0);
  if (!url || !stamp) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${stamp}`;
}

function normalizeImageFrame(frame) {
  return {
    x: Math.max(0, Math.min(100, Number(frame?.x ?? 50))),
    y: Math.max(0, Math.min(100, Number(frame?.y ?? 50))),
    scale: Math.max(1, Math.min(3, Number(frame?.scale ?? 1))),
  };
}

function getCoverImageStyle(frame = {}, grayscale = false) {
  const safe = normalizeImageFrame(frame);
  const offsetX = (safe.x - 50) * 0.52;
  const offsetY = (safe.y - 50) * 0.52;
  return {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    filter: grayscale ? "grayscale(1) saturate(0.12) brightness(0.86)" : "none",
    transform: `translate(${offsetX}%, ${offsetY}%) scale(${safe.scale})`,
    transformOrigin: "center center",
    pointerEvents: "none",
    userSelect: "none",
  };
}

function CardImageLayer({ src = "", alt = "", grayscale = false, frame = null, version = 0 }) {
  const url = withImageVersion(src, version);
  if (!url) return null;
  return (
    <LazyImage
      src={url}
      alt={alt}
      eager
      fit="cover"
      draggable={false}
      style={getCoverImageStyle(frame || { x: 50, y: 50, scale: 1 }, grayscale)}
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

function mergeInvestigationRowsWithCachedImages(rows, cachedRows) {
  const cachedById = new Map((Array.isArray(cachedRows) ? cachedRows : []).map((item) => [String(item?.id || ""), item]));
  return (Array.isArray(rows) ? rows : []).map((item) => {
    const cached = cachedById.get(String(item?.id || ""));
    if (!cached) return item;
    return {
      ...item,
      listImage: item?.listImage || cached?.listImage || "",
      entryImage: item?.entryImage || cached?.entryImage || item?.listImage || cached?.listImage || "",
      listImageFrame: item?.listImageFrame || cached?.listImageFrame,
      entryImageFrame: item?.entryImageFrame || cached?.entryImageFrame || item?.listImageFrame || cached?.listImageFrame,
      imageUpdatedAt: Number(item?.imageUpdatedAt || cached?.imageUpdatedAt || 0),
    };
  });
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

function getDailyOwnerKeysForCharacter(character) {
  if (!character) return [];
  const keys = [
    character.id,
    `${character.ownerId || "owner"}:${character.name || ""}`,
    character.name,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return Array.from(new Set(keys));
}

function isDailyStartableForCharacter(item, character) {
  if (!item || item.type !== "daily") return false;
  if (item.hidden || item.opened === false || item.statusLabel === "비활성화" || !(item.effectiveOpened ?? item.opened)) return false;
  if (!item.started || item.ended) return true;
  const ownerKeys = getDailyOwnerKeysForCharacter(character);
  const dailyOwnerKey = String(item.dailyOwnerKey || "").trim();
  const dailyResumeOwnerKey = String(item.dailyResumeOwnerKey || "").trim();
  if (dailyOwnerKey && ownerKeys.includes(dailyOwnerKey)) return true;
  if (dailyResumeOwnerKey && ownerKeys.includes(dailyResumeOwnerKey)) return true;
  if (hasLocalDailyResume(item.id, character)) return true;
  return Number(item.participantsCount || 0) === 0 && !dailyOwnerKey && !dailyResumeOwnerKey;
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
    padding: "5px 9px",
    borderRadius: 999,
    background: bg,
    color,
    fontWeight: 800,
    fontSize: 11.5,
    lineHeight: 1.2,
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


function InvestigationEntryPreviewCard({ item, type, theme, imageSrc, frame, version, titleOverride = "" }) {
  const isDaily = type === "daily";
  return (
    <div style={{ ...card(theme, false, false), position: "relative", minHeight: 246, overflow: "hidden", paddingTop: 22, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <div style={{ position: "absolute", inset: 0, background: isDaily ? "linear-gradient(180deg, rgba(94,167,217,0.12), rgba(255,255,255,0.04))" : "linear-gradient(180deg, rgba(101,126,234,0.15), rgba(255,255,255,0.04))" }} />
        <CardImageLayer src={imageSrc || item?.cardImage || getRepresentativeImage([item], "entry")} alt={item?.title || "조사 카드"} frame={frame || item?.cardImageFrame || { x: 50, y: 50, scale: 1 }} version={version || item?.imageUpdatedAt || 0} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.18) 38%, rgba(255,255,255,0) 74%)" }} />
      </div>
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: 12, letterSpacing: 2.6, fontWeight: 900, color: isDaily ? "#1d4ed8" : "#4338ca", textTransform: "uppercase" }}>{isDaily ? "DAILY" : "GROUP"}</div>
        <div style={{ marginTop: 4, fontSize: 20, fontWeight: 900, color: "#0f172a" }}>{isDaily ? "일일조사" : "단체조사"}</div>
        <div style={{ marginTop: 8, fontSize: 14, fontWeight: 900, color: "#13324b" }}>{titleOverride || item?.title || (isDaily ? "일일조사" : "단체조사")}</div>
      </div>
      <div style={{ position: "relative", zIndex: 1, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={chip("rgba(255,255,255,0.86)", "#17324a")}>{isDaily ? `남은 ${Math.max(0, 3 - Number(item?.attempts || 0))}회` : `활성 ${Array.isArray(item?.participants) ? item.participants.length : 0}명`}</span>
        <span style={chip("rgba(255,255,255,0.86)", "#17324a")}>{isDaily ? `침식 진행도 +${Number(item?.corrosionGain || 0)}` : timeText(item)}</span>
      </div>
    </div>
  );
}

function InvestigationInnerPreviewCard({ item, theme, imageSrc, frame, version }) {
  return (
    <div style={{ ...card(theme, !item?.effectiveOpened, false), position: "relative", minHeight: 172, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <CardImageLayer src={imageSrc || item?.cardImage || getRepresentativeImage([item], "list")} alt={item?.title || "조사 카드"} frame={frame || item?.cardImageFrame || { x: 50, y: 50, scale: 1 }} version={version || item?.imageUpdatedAt || 0} grayscale={!item?.effectiveOpened} />
        <div style={{ position: "absolute", inset: 0, background: item?.effectiveOpened ? "linear-gradient(90deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.5) 34%, rgba(255,255,255,0.08) 72%)" : "linear-gradient(90deg, rgba(226,232,240,0.92) 0%, rgba(226,232,240,0.74) 38%, rgba(226,232,240,0.32) 78%)" }} />
      </div>
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: 12, letterSpacing: 2.6, fontWeight: 900, color: item?.effectiveOpened ? "#1d4ed8" : "#64748b", textTransform: "uppercase" }}>{String(item?.titleEn || item?.title || "INVESTIGATION").toUpperCase()}</div>
        <div style={{ marginTop: 3, fontSize: 18, fontWeight: 900, color: item?.effectiveOpened ? "#0f172a" : "#334155" }}>{item?.type === "daily" ? "일일조사" : "단체조사"}</div>
        <div style={{ marginTop: 8, fontSize: 14, fontWeight: 900, color: item?.effectiveOpened ? "#13324b" : "#475569" }}>{item?.title}</div>
      </div>
      <div style={{ position: "relative", zIndex: 1, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={chip("rgba(255,255,255,0.82)", item?.effectiveOpened ? "#17324a" : "#475569")}>{item?.type === "daily" ? `남은 ${Math.max(0, 3 - Number(item?.attempts || 0))}회` : `${item?.effectiveOpened ? "활성" : "비활성"}`}</span>
        <span style={chip("rgba(255,255,255,0.82)", item?.effectiveOpened ? "#17324a" : "#475569")}>{`침식 진행도 +${Number(item?.corrosionGain || 0)}`}</span>
      </div>
    </div>
  );
}

function getRepresentativeImage(items = [], mode = "list") {
  const rows = Array.isArray(items) ? items : [];
  if (mode === "entry") {
    return rows.find((item) => String(item?.entryImage || item?.listImage || "").trim())?.entryImage || rows.find((item) => String(item?.entryImage || item?.listImage || "").trim())?.listImage || "";
  }
  return rows.find((item) => String(item?.listImage || item?.entryImage || "").trim())?.listImage || rows.find((item) => String(item?.listImage || item?.entryImage || "").trim())?.entryImage || "";
}

function formatCorrosionRange(items = []) {
  const values = (Array.isArray(items) ? items : [])
    .map((item) => Number(item?.endCorrosion || 0))
    .filter((value) => value > 0);
  if (values.length === 0) return "종료 시 침식 진행도 +0";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? `종료 시 침식 진행도 +${min}` : `종료 시 침식 진행도 +${min}~+${max}`;
}

export default function InvestigationList({ onEnter, onSpectate, onEditInvestigation, activeCharacter, isAdmin = false, design, theme }) {
  const [investigations, setInvestigations] = useState(() => readCachedInvestigations());
  const [view, setView] = useState("entry");
  const [dailyLeft, setDailyLeft] = useState(Number(activeCharacter?.dailyAttemptsLeft ?? 1));
  const [completedOpenId, setCompletedOpenId] = useState("");
  const [completedDetail, setCompletedDetail] = useState(null);
  const [imageEditor, setImageEditor] = useState(null);
  const imagePreviewDragRef = useRef(null);
  const [imageSaving, setImageSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiJsonCached(`/investigations`, { ttlMs: 2500, storageKey: "plc-cache-investigations-json" })
        .then((data) => {
          if (cancelled) return;
          const next = mergeInvestigationRowsWithCachedImages(Array.isArray(data) ? data : [], readCachedInvestigations());
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
    preloadInvestigationImages((Array.isArray(investigations) ? investigations : []).flatMap((item) => [item?.listImage, item?.entryImage]).filter(Boolean));
  }, [investigations]);

  const dailyPool = useMemo(
    () => investigations.filter((item) => item.type === "daily" && !item.hidden && item.opened !== false && item.statusLabel !== "비활성화" && !!(item.effectiveOpened ?? item.opened)),
    [investigations]
  );
  const startableDailyPool = useMemo(
    () => dailyPool.filter((item) => isDailyStartableForCharacter(item, activeCharacter)),
    [dailyPool, activeCharacter]
  );
  const dailyOwnerKeys = useMemo(() => getDailyOwnerKeysForCharacter(activeCharacter), [activeCharacter?.id, activeCharacter?.ownerId, activeCharacter?.name]);
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

  const dailyEntryImage = resumableDaily?.entryImage || resumableDaily?.listImage || getRepresentativeImage(dailyPool, "entry");
  const groupEntryImage = getRepresentativeImage(groups, "entry") || getRepresentativeImage(completedGroups, "entry");
  const investContent = design?.siteContent?.investigations || {};
  const editableDaily = resumableDaily || startableDailyPool[0] || dailyPool[0] || null;
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
    const candidates = startableDailyPool.length > 0 ? startableDailyPool : dailyPool.filter((item) => !item.started || item.ended);
    if (!candidates.length) return alert("현재 시작할 수 있는 일일조사가 없습니다. 진행 중인 일일조사가 있다면 먼저 조사로 돌아가거나 잠시 후 다시 시도해주세요.");
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    onEnter(picked, { mode: "daily" });
  };

  const openImageEditor = (item, mode = "list") => {
    if (!item?.id) return;
    const type = item.type || (mode === "entry" && view === "group" ? "group" : "daily");
    const previewBadges = mode === "entry"
      ? (type === "group"
          ? [
              `활성 ${groups.filter((row) => row.effectiveOpened ?? row.opened).length}개`,
              `비활성 ${groups.filter((row) => !(row.effectiveOpened ?? row.opened)).length}개`,
              `완료 ${completedGroups.length}개`,
            ]
          : [
              `남은 횟수 ${dailyLeft}`,
              `활성 ${dailyPool.length}개`,
              formatCorrosionRange(dailyPool),
            ])
      : [
          !!item.started && !item.ended ? "진행 중" : ((item.effectiveOpened ?? item.opened) ? "대기 중" : "비활성화"),
          type === "group" ? `참여 ${item.participantsCount || 0}명` : `남은 횟수 ${dailyLeft}`,
          type === "group" ? `종료 시 침식 진행도 +${Number(item.endCorrosion || 0)}` : `침식 진행도 ${Number(item.endCorrosion || 0)}`,
        ];
    setImageEditor({
      id: item.id,
      type,
      title: item.title || "조사",
      mode,
      image: mode === "entry" ? String(item.entryImage || item.listImage || "") : String(item.listImage || item.entryImage || ""),
      frame: normalizeImageFrame(mode === "entry" ? (item.entryImageFrame || item.listImageFrame || { x: 50, y: 50, scale: 1 }) : (item.listImageFrame || item.entryImageFrame || { x: 50, y: 50, scale: 1 })),
      badges: previewBadges.filter(Boolean),
      eyebrow: mode === "entry" ? (type === "group" ? "GROUP" : "DAILY") : (type === "group" ? "GROUP MISSION" : "DAILY MISSION"),
      version: Number(item.imageUpdatedAt || Date.now()),
    });
  };

  const updateEditorFrame = (patch) => {
    setImageEditor((prev) => {
      if (!prev) return prev;
      return { ...prev, frame: normalizeImageFrame({ ...(prev.frame || { x: 50, y: 50, scale: 1 }), ...(patch || {}) }) };
    });
  };

  const startImagePreviewDrag = (event) => {
    if (!imageEditor?.image) return;
    const rect = event.currentTarget.getBoundingClientRect?.();
    const startX = event.clientX;
    const startY = event.clientY;
    const baseFrame = normalizeImageFrame(imageEditor.frame || { scale: 1, x: 50, y: 50 });
    imagePreviewDragRef.current = {
      pointerId: event.pointerId,
      startX,
      startY,
      x: baseFrame.x,
      y: baseFrame.y,
      width: Math.max(1, rect?.width || 1),
      height: Math.max(1, rect?.height || 1),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const handleMove = (moveEvent) => {
      const drag = imagePreviewDragRef.current;
      if (!drag) return;
      const dx = moveEvent.clientX - drag.startX;
      const dy = moveEvent.clientY - drag.startY;
      updateEditorFrame({
        x: drag.x + (dx / drag.width) * 100 / 0.52,
        y: drag.y + (dy / drag.height) * 100 / 0.52,
      });
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      imagePreviewDragRef.current = null;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  };

  const saveImageEditor = async () => {
    if (!imageEditor?.id) return;
    setImageSaving(true);
    try {
      const payload = { investigationId: imageEditor.id };
      if (imageEditor.mode === "entry") {
        payload.entryImage = imageEditor.image || "";
        payload.entryImageFrame = normalizeImageFrame(imageEditor.frame);
      } else {
        payload.listImage = imageEditor.image || "";
        payload.listImageFrame = normalizeImageFrame(imageEditor.frame);
      }
      const res = await apiFetch('/admin/investigationCardImage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data?.success) {
        alert(data?.message || '이미지를 저장하지 못했습니다.');
        return;
      }
      const updated = data.item || {};
      setInvestigations((prev) => {
        const nextRows = Array.isArray(prev) ? prev.map((item) => item?.id === imageEditor.id ? { ...item, ...updated } : item) : prev;
        writeCachedInvestigations(nextRows);
        return nextRows;
      });
      setImageEditor(null);
    } catch {
      alert('이미지를 저장하지 못했습니다.');
    } finally {
      setImageSaving(false);
    }
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
              <CardImageLayer src={dailyEntryImage} alt="일일조사" frame={editableDaily?.entryImageFrame || editableDaily?.listImageFrame} version={editableDaily?.imageUpdatedAt} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.76) 28%, rgba(255,255,255,0.18) 100%)" }} />
              {isAdmin && editableDaily ? (
                <button type="button" style={adminEditButtonStyle()} onClick={(event) => { event.stopPropagation(); openImageEditor(editableDaily, "entry"); }}>수정</button>
              ) : null}
              <div style={{ position: "relative", zIndex: 1, padding: 22, display: "flex", flexDirection: "column", gap: 12, minHeight: 260 }}>
                <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
                  <div className="section-eyebrow">DAILY</div>
                  <span className="feature-label">일일조사</span>
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
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: "auto" }}>
                    <button type="button" className="ghost-button" onClick={(event) => { event.stopPropagation(); onEnter(resumableDaily, { mode: "daily" }); }}>
                      조사로 돌아가기
                    </button>
                    <div style={{ ...chip("rgba(255,255,255,0.88)", theme?.textSoft || "#4f7390"), alignSelf: "center" }}>
                      {resumableDaily.title || "진행 중인 일일조사"}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <button type="button" onClick={() => setView("group")} style={{ ...card(theme, false, true), textAlign: "left", minHeight: 260, position: "relative", overflow: "hidden", padding: 0, background: theme?.panelStrong || "#fff" }}>
              <CardImageLayer src={groupEntryImage} alt="단체조사" frame={editableGroup?.entryImageFrame || editableGroup?.listImageFrame} version={editableGroup?.imageUpdatedAt} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.76) 28%, rgba(255,255,255,0.18) 100%)" }} />
              {isAdmin && editableGroup ? (
                <span role="button" tabIndex={0} style={adminEditButtonStyle()} onClick={(event) => { event.stopPropagation(); openImageEditor(editableGroup, "entry"); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); openImageEditor(editableGroup, "entry"); } }}>수정</span>
              ) : null}
              <div style={{ position: "relative", zIndex: 1, padding: 22, display: "flex", flexDirection: "column", gap: 12, minHeight: 260 }}>
                <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
                  <div className="section-eyebrow">GROUP</div>
                  <span className="feature-label">단체조사</span>
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
                    <CardImageLayer src={item.listImage} alt={item.title} frame={item.listImageFrame} version={item.imageUpdatedAt} />
                    {item.listImage ? <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.82) 34%, rgba(255,255,255,0.24) 72%, rgba(255,255,255,0.06) 100%)" }} /> : null}
                    {isAdmin ? <button type="button" style={adminEditButtonStyle(16)} onClick={(event) => { event.stopPropagation(); openImageEditor(item, "list"); }}>수정</button> : null}
                    <div style={{ position: "relative", zIndex: 1, padding: 20, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "stretch", minHeight: 188 }}>
                      <div style={{ maxWidth: "70%" }}>
                        <div className="section-eyebrow">{disabled ? "비활성" : "단체조사"}</div>
                        <h3 style={{ marginTop: 10, marginBottom: 8 }}>{item.title}</h3>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                          <div style={chip(started ? "rgba(30,64,175,0.14)" : disabled ? "rgba(100,116,139,0.14)" : "rgba(20,83,45,0.12)", started ? "#1d4ed8" : disabled ? "#475569" : "#166534")}>{started ? "진행 중" : disabled ? "비활성화" : "대기 중"}</div>
                          <div style={chip("rgba(255,255,255,0.78)", theme?.textSoft || "#4f7390")}>참여 {item.participantsCount || 0}명</div>
                          <div style={chip("rgba(255,255,255,0.78)", theme?.textSoft || "#4f7390")}>{timeText(item)}</div>
                          <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>종료 시 침식 진행도 +{Number(item.endCorrosion || 0)}</div>
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
                      <CardImageLayer src={item.listImage} alt={item.title} grayscale frame={item.listImageFrame} />
                      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(244,244,245,0.96) 0%, rgba(244,244,245,0.82) 36%, rgba(244,244,245,0.38) 72%, rgba(244,244,245,0.14) 100%)" }} />
                      {isAdmin ? <button type="button" style={adminEditButtonStyle(16)} onClick={() => openImageEditor(item, "list")}>수정</button> : null}
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
      {imageEditor ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.56)", backdropFilter: "blur(8px)", zIndex: 2600, display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ width: "min(1000px, calc(100vw - 48px))", maxHeight: "calc(100vh - 48px)", overflow: "auto", padding: 22, borderRadius: 24, background: "rgba(255,255,255,0.98)", border: `1px solid ${theme?.line || "rgba(98,176,220,0.18)"}`, boxShadow: theme?.shadow || "0 18px 38px rgba(73,132,170,0.16)", display: "grid", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <h3 style={{ marginTop: 0, marginBottom: 0 }}>{imageEditor.title} · {imageEditor.mode === "entry" ? "입구 카드 이미지" : "목록 카드 이미지"}</h3>
              </div>
              <button type="button" className="ghost-button" onClick={() => setImageEditor(null)}>닫기</button>
            </div>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(250px, 290px) minmax(480px, 1fr)", alignItems: "stretch" }}>
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 10, padding: 16, borderRadius: 18, background: "rgba(245,251,255,0.94)", border: `1px solid ${theme?.line || "rgba(98,176,220,0.18)"}` }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: theme?.textMain || "#16364b" }}>{imageEditor.mode === "entry" ? "입구 카드 이미지" : "목록 카드 이미지"}</div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        setImageEditor((prev) => ({ ...prev, image: String(reader.result || "") }));
                      };
                      reader.readAsDataURL(file);
                      event.target.value = "";
                    }}
                  />
                  <div style={{ fontSize: 12, color: theme?.textSoft || "#6b8aa4", lineHeight: 1.55 }}>
                    이미지를 올린 뒤 오른쪽 실제 카드 미리보기에서 바로 드래그해서 위치를 맞춰주세요.
                  </div>
                </div>
                <div style={{ display: "grid", gap: 10, padding: 14, borderRadius: 18, background: "rgba(255,255,255,0.86)", border: "1px solid rgba(148,163,184,0.2)" }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#4f7390", fontWeight: 700 }}>
                    확대
                    <input type="range" min="1" max="3" step="0.01" value={Number(imageEditor.frame?.scale || 1)} onChange={(event) => updateEditorFrame({ scale: Number(event.target.value || 1) })} />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#4f7390", fontWeight: 700 }}>
                    가로 위치
                    <input type="range" min="0" max="100" step="0.1" value={Number(imageEditor.frame?.x ?? 50)} onChange={(event) => updateEditorFrame({ x: Number(event.target.value || 50) })} />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#4f7390", fontWeight: 700 }}>
                    세로 위치
                    <input type="range" min="0" max="100" step="0.1" value={Number(imageEditor.frame?.y ?? 50)} onChange={(event) => updateEditorFrame({ y: Number(event.target.value || 50) })} />
                  </label>
                </div>
              </div>
              <div style={{ display: "grid", gap: 12, padding: 16, borderRadius: 20, background: "rgba(245,251,255,0.94)", border: `1px solid ${theme?.line || "rgba(98,176,220,0.18)"}` }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: theme?.textMain || "#16364b" }}>실제 카드 미리보기</div>
                <div style={{ display: "grid", placeItems: "center", minHeight: imageEditor.mode === "list" ? 240 : 320 }}>
                  <div
                    onPointerDown={startImagePreviewDrag}
                    style={{
                      width: "100%",
                      maxWidth: "100%",
                      cursor: imageEditor.image ? "grab" : "default",
                    }}
                  >
                    {imageEditor.mode === "list" ? (
                      <div
                        style={{
                          ...card(theme, false),
                          position: "relative",
                          overflow: "hidden",
                          minHeight: 188,
                          padding: 0,
                          background: theme?.panelStrong || "#fff",
                          width: "100%",
                        }}
                      >
                        <CardImageLayer src={imageEditor.image} alt={imageEditor.title || "조사 카드"} frame={imageEditor.frame || { scale: 1, x: 50, y: 50 }} version={imageEditor.version || Date.now()} />
                        {imageEditor.image ? <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.82) 34%, rgba(255,255,255,0.24) 72%, rgba(255,255,255,0.06) 100%)" }} /> : null}
                        <div style={{ position: "relative", zIndex: 1, padding: 20, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "stretch", minHeight: 188 }}>
                          <div style={{ maxWidth: "70%" }}>
                            <div className="section-eyebrow">{imageEditor.type === "group" ? "단체조사" : "일일조사"}</div>
                            <h3 style={{ marginTop: 10, marginBottom: 8 }}>{imageEditor.title || (imageEditor.type === "group" ? "단체조사" : "일일조사")}</h3>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                              <div style={chip("rgba(20,83,45,0.12)", "#166534")}>{imageEditor.type === "group" ? "대기 중" : "즉시 시작"}</div>
                              <div style={chip("rgba(255,255,255,0.78)", theme?.textSoft || "#4f7390")}>{imageEditor.type === "group" ? "참여 0명" : "남은 횟수 1회"}</div>
                              <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>종료 시 침식 진행도 +{Number((Array.isArray(imageEditor.badges) ? imageEditor.badges.find((badge) => String(badge).includes("침식 진행도 +") || String(badge).includes("침식 +"))?.replace(/[^0-9.-]/g, "") : 0) || 0)}</div>
                            </div>
                          </div>
                          <div style={{ display: "grid", gap: 8, alignContent: "start", justifyItems: "end" }}>
                            <div style={chip("rgba(20,83,45,0.12)", "#166534")}>{imageEditor.type === "group" ? "대기중" : "일일"}</div>
                            <button type="button" className="home-primary-button" disabled>{imageEditor.type === "group" ? "참여" : "시작"}</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          ...card(theme, false, true),
                          textAlign: "left",
                          minHeight: 260,
                          position: "relative",
                          overflow: "hidden",
                          padding: 0,
                          background: theme?.panelStrong || "#fff",
                          width: "100%",
                        }}
                      >
                        <CardImageLayer src={imageEditor.image} alt={imageEditor.title || (imageEditor.type === "group" ? "단체조사" : "일일조사")} frame={imageEditor.frame || { scale: 1, x: 50, y: 50 }} version={imageEditor.version || Date.now()} />
                        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.76) 28%, rgba(255,255,255,0.18) 100%)" }} />
                        <div style={{ position: "relative", zIndex: 1, padding: 22, display: "flex", flexDirection: "column", gap: 12, minHeight: 260 }}>
                          <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
                            <div className="section-eyebrow">{imageEditor.type === "group" ? "GROUP" : "DAILY"}</div>
                            <span className="feature-label">{imageEditor.type === "group" ? "단체조사" : "일일조사"}</span>
                            <h3 style={{ marginTop: 0, marginBottom: 0, color: "#17324a" }}>{imageEditor.title || (imageEditor.type === "group" ? "단체조사" : "일일조사")}</h3>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "auto" }}>
                            {imageEditor.type === "group" ? (
                              <>
                                <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>활성 0개</div>
                                <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>비활성 0개</div>
                                <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>완료 0개</div>
                              </>
                            ) : (
                              <>
                                <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>남은 횟수 1회</div>
                                <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>활성 1개</div>
                                <div style={chip("rgba(255,255,255,0.86)", "#17324a")}>종료 시 침식 진행도 +{Number((Array.isArray(imageEditor.badges) ? imageEditor.badges.find((badge) => String(badge).includes("침식 진행도 +") || String(badge).includes("침식 +"))?.replace(/[^0-9.-]/g, "") : 0) || 0)}</div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: theme?.textSoft || "#6b8aa4", textAlign: "center" }}>실제 카드와 같은 방향으로 보이도록 맞춰두었고, 이 카드 자체를 바로 드래그해서 위치를 조정할 수 있어요.</div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="ghost-button" onClick={() => setImageEditor(null)}>취소</button>
              <button type="button" className="home-primary-button" onClick={saveImageEditor} disabled={imageSaving}>{imageSaving ? "저장 중..." : "저장"}</button>
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </DesignPageFrame>
  );
}
