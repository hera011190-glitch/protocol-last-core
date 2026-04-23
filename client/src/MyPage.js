import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DesignPageFrame from "./DesignPageFrame";
import ImageDropInput from "./ImageDropInput";
import AudioSourceInput from "./AudioSourceInput";
import { buildApiUrl } from "./api";
import ProfileRichEditor from "./ProfileRichEditor";
import { renderProfileRichContent } from "./profileRichText";
import { getCurrentHpDisplay, getHpStatValue, getMaxHpFromStat } from "./hpUtils";
import { normalizeProfileCardFrame, ProfileCard } from "./profileCardShared";

function card(base = {}) {
  return {
    padding: "18px",
    borderRadius: "24px",
    background: "rgba(255,255,255,0.82)",
    border: "1px solid rgba(98,176,220,0.18)",
    ...base,
  };
}

function InfoCell({ label, value }) {
  return (
    <div style={card({ padding: "12px 14px", borderRadius: "16px", background: "rgba(255,255,255,0.62)" })}>
      <div style={{ fontSize: "12px", color: "#6a87a3", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontWeight: 800 }}>{value || "-"}</div>
    </div>
  );
}

function Meter({ label, value, percent, danger = false, fill, track }) {
  const resolvedFill = fill || (danger ? "linear-gradient(90deg, #fda4af, #ef4444)" : "linear-gradient(90deg, #93c5fd, #38bdf8)");
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#5d7a95", marginBottom: "6px" }}>
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div style={{ height: "12px", borderRadius: "999px", background: track || "rgba(255,255,255,0.76)", overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(15,23,42,0.08)" }}>
        <div
          style={{
            width: `${Math.max(0, Math.min(100, percent || 0))}%`,
            height: "100%",
            background: resolvedFill,
            boxShadow: "0 6px 16px rgba(15,23,42,0.12)",
          }}
        />
      </div>
    </div>
  );
}

function findItemMeta(catalog, item) {
  return (Array.isArray(catalog) ? catalog : []).find((value) => value?.name === item || value?.id === item) || {};
}

function buildFallbackItemImage(label) {
  const title = encodeURIComponent(String(label || "ITEM").slice(0, 10));
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="%23dbeafe"/><stop offset="1" stop-color="%23bae6fd"/></linearGradient></defs><rect width="240" height="240" rx="34" fill="url(%23g)"/><circle cx="120" cy="92" r="38" fill="%23ffffff" fill-opacity="0.72"/><path d="M82 150c13-16 29-24 38-24s25 8 38 24" stroke="%230f172a" stroke-opacity="0.18" stroke-width="16" stroke-linecap="round"/><text x="120" y="206" text-anchor="middle" font-family="Pretendard,Noto Sans KR,sans-serif" font-size="26" font-weight="700" fill="%2316324a">${title}</text></svg>`;
}


function withImageVersion(src, version) {
  if (!src) return "";
  const value = String(src || "");
  if (value.startsWith("data:image/")) return value;
  const joiner = value.includes("?") ? "&" : "?";
  return `${value}${joiner}cb=${encodeURIComponent(String(version || Date.now()))}`;
}

function isUsableItem(meta) {
  const useType = String(meta?.useType || "none");
  return useType && useType !== "none" && useType !== "unusable";
}

function ItemUsePanel({ items, catalog, onUse, style = {} }) {
  const entries = useMemo(
    () => (Array.isArray(items) ? items : []).map((item, index) => {
      const meta = findItemMeta(catalog, item);
      return {
        key: `${meta?.id || meta?.name || item}-${index}`,
        item,
        index,
        meta,
        displayName: meta?.name || item,
        image: meta?.image || buildFallbackItemImage(meta?.name || item),
      };
    }),
    [items, catalog]
  );
  const [selectedKey, setSelectedKey] = useState("");

  useEffect(() => {
    if (!entries.length) {
      setSelectedKey("");
      return;
    }
    if (!entries.some((entry) => entry.key === selectedKey)) {
      setSelectedKey("");
    }
  }, [entries, selectedKey]);

  const selected = entries.find((entry) => entry.key === selectedKey) || null;

  return (
    <div style={card({ padding: "20px 20px 18px", background: "linear-gradient(180deg, rgba(232,244,255,0.96), rgba(248,252,255,0.96))", border: "1px solid rgba(56,189,248,0.22)", ...style })}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>보유 아이템</h3>
      </div>
      {entries.length > 0 ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(116px, 1fr))", gap: "12px" }}>
            {entries.map((entry) => {
              const active = entry.key === selected?.key;
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setSelectedKey(entry.key)}
                  style={{
                    border: "none",
                    borderRadius: 0,
                    padding: 0,
                    background: "transparent",
                    boxShadow: "none",
                    cursor: "pointer",
                    display: "grid",
                    gap: 8,
                    textAlign: "center",
                    transform: active ? "translateY(-2px)" : "none",
                  }}
                >
                  <div style={{ width: "100%", aspectRatio: "1 / 1", overflow: "hidden", display: "grid", placeItems: "center", borderRadius: 0 }}>
                    <img src={entry.image} alt={entry.displayName} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12, outline: active ? "2px solid rgba(14,165,233,0.85)" : "none", outlineOffset: active ? 2 : 0 }} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: active ? "#0f5f93" : "#16324a", lineHeight: 1.3, minHeight: 34 }}>{entry.displayName}</div>
                </button>
              );
            })}
          </div>

          {selected && typeof document !== "undefined" ? createPortal(
            <div onClick={() => setSelectedKey("")} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.58)", display: "grid", placeItems: "center", padding: 24, zIndex: 2200 }}>
              <div onClick={(e) => e.stopPropagation()} style={{ width: "min(720px, 100%)", borderRadius: 28, padding: 20, background: "rgba(255,255,255,0.98)", boxShadow: "0 26px 60px rgba(15,23,42,0.24)", display: "grid", gridTemplateColumns: "160px minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
                <div style={{ width: 160, height: 160, borderRadius: 24, overflow: "hidden", background: "linear-gradient(180deg, rgba(191,219,254,0.35), rgba(255,255,255,0.94))" }}>
                  <img src={selected.image} alt={selected.displayName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#5d7a95", marginBottom: 4 }}>아이템 이름</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: "#16324a" }}>{selected.displayName}</div>
                    </div>
                    <button type="button" className="ghost-button" onClick={() => setSelectedKey("")}>닫기</button>
                  </div>
                  <div style={{ padding: "14px 16px", borderRadius: 18, background: "rgba(240,248,255,0.86)", color: "#35566f", lineHeight: 1.75, minHeight: 120 }}>
                    {selected.meta?.description || "등록된 설명이 없습니다."}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ color: isUsableItem(selected.meta) ? "#0f766e" : "#6a87a3", fontWeight: 800 }}>
                      {isUsableItem(selected.meta) ? "사용 가능한 아이템입니다." : "사용할 수 없는 아이템입니다."}
                    </div>
                    {isUsableItem(selected.meta) ? (
                      <button type="button" className="home-primary-button" onClick={() => onUse(selected.item, selected.meta, selected.index)}>사용</button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          ) : null}
        </>
      ) : <div style={{ color: "#5d7a95" }}>보유 아이템이 없습니다.</div>}
    </div>
  );
}

function MailDetail({ mail, onClose, onReceive }) {
  if (!mail || typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.56)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "24px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "720px", maxWidth: "100%", maxHeight: "84vh", overflowY: "auto", ...card({ background: "#fff" }) }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "14px" }}>
          <h3 style={{ margin: 0 }}>{mail.title || `${mail.fromName}의 우편`}{mail.received ? " · 수령완료" : ""}</h3>
          <button type="button" className="ghost-button" onClick={onClose}>닫기</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: "14px", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ width: "84px", height: "84px", borderRadius: "20px", overflow: "hidden", background: "rgba(255,255,255,0.7)" }}>
            {mail.fromImage ? <img src={mail.fromImage} alt={mail.fromName} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#88a0b8" }}>IMG</div>}
          </div>
          <div>
            <div style={{ fontSize: "20px", fontWeight: 900 }}>{mail.fromName}</div>
            <div style={{ color: "#5d7a95", marginTop: "4px" }}>{mail.title || `${mail.fromName}의 우편`}{mail.received ? " · 수령완료" : ""}</div>
          </div>
        </div>
        <div style={card({ background: "rgba(240,248,255,0.88)", marginBottom: "16px" })}>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.85 }}>{mail.body || "편지 내용 없음"}</div>
        </div>
        <div style={card({ background: "rgba(240,248,255,0.88)" })}>
          <div style={{ fontWeight: 800, marginBottom: "8px" }}>첨부 물품</div>
          <div style={{ color: "#5d7a95", lineHeight: 1.75 }}>
            코인: {Number(mail.coins || 0)}
            <br />
            아이템: {Array.isArray(mail.items) && mail.items.length > 0 ? mail.items.join(", ") : "없음"}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: "16px" }}>
          <div style={{ color: mail.received ? "#2563eb" : "#6a87a3", fontWeight: 800 }}>
            {mail.received ? "이미 받은 우편입니다." : "받지 않은 우편입니다."}
          </div>
          {!mail.received ? <button type="button" className="home-primary-button" onClick={() => onReceive(mail)}>우편 받기</button> : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

function QuoteEditor({ quotes, extraQuotes = [], onSave, style = {} }) {
  const mergedQuotes = useMemo(() => Array.from(new Set([...(Array.isArray(quotes) ? quotes : []), ...(Array.isArray(extraQuotes) ? extraQuotes : [])].map((value) => String(value || "").trim()).filter(Boolean))), [quotes, extraQuotes]);
  const [list, setList] = useState(mergedQuotes.length ? mergedQuotes : [""]);
  const quotesKey = useMemo(() => JSON.stringify(mergedQuotes), [mergedQuotes]);
  useEffect(() => {
    setList(mergedQuotes.length ? mergedQuotes : [""]);
  }, [quotesKey]);

  const savedQuotes = list.map((value) => String(value || "").trim()).filter(Boolean);

  return (
    <div style={card(style)}>
      <h3 style={{ marginTop: 0 }}>SD 대사</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {savedQuotes.length > 0 ? savedQuotes.map((quote, idx) => (
          <div key={`${quote}-${idx}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 999, background: "rgba(224,242,254,0.9)", border: "1px solid rgba(56,189,248,0.2)", color: "#16324a", maxWidth: "100%" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{quote}</span>
            <button type="button" className="ghost-button" onClick={() => setList((prev) => {
              const next = prev.filter((_, i) => String(prev[i] || "").trim() !== quote || i !== prev.findIndex((value) => String(value || "").trim() === quote));
              return next.length ? next : [""];
            })}>삭제</button>
          </div>
        )) : <div style={{ color: "#6a87a3" }}>저장된 대사가 없습니다.</div>}
      </div>
      <div style={{ display: "grid", gap: "10px" }}>
        {list.map((quote, idx) => (
          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px" }}>
            <input
              value={quote}
              onChange={(e) => setList((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))}
              placeholder="대사 입력"
              style={inputStyle}
            />
            <button
              type="button"
              className="ghost-button"
              onClick={() => setList((prev) => (prev.filter((_, i) => i !== idx).length ? prev.filter((_, i) => i !== idx) : [""]))}
            >
              삭제
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "12px" }}>
        <button type="button" className="ghost-button" onClick={() => setList((prev) => [...prev, ""])}>추가</button>
        <button type="button" className="home-primary-button" onClick={() => onSave(list.map((v) => String(v || "").trim()).filter(Boolean))}>저장</button>
      </div>
    </div>
  );
}

function FullBodyFrameEditor({ image, frame, onChange, previewCharacter = {}, theme }) {
  const dragRef = useRef(null);
  const safeFrame = normalizeProfileCardFrame(frame);

  const clampFrame = (next) => ({
    x: Math.max(-1200, Math.min(1200, Number(next.x ?? safeFrame.x))),
    y: Math.max(-1200, Math.min(1200, Number(next.y ?? safeFrame.y))),
    scale: Math.max(0.45, Math.min(11.5, Number(next.scale ?? safeFrame.scale))),
  });

  const handlePointerDown = (event) => {
    if (!onChange || !image) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      frameX: safeFrame.x,
      frameY: safeFrame.y,
      scale: safeFrame.scale,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (!dragRef.current || !onChange) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    onChange(clampFrame({
      x: dragRef.current.frameX + dx,
      y: dragRef.current.frameY + dy,
      scale: dragRef.current.scale,
    }));
  };

  const stopDrag = (event) => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 800, color: "#16324a" }}>프로필 카드 미리보기</div>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        style={{ width: 160, maxWidth: "100%", touchAction: "none", cursor: onChange && image ? "grab" : "default", userSelect: "none", margin: "0 auto" }}
      >
        <ProfileCard
          character={{ name: previewCharacter?.name || "미리보기", rank: previewCharacter?.rank || "대원", oneLine: previewCharacter?.oneLine || "카드 미리보기", mainImage: image, mainImageFrame: safeFrame }}
          theme={{ line: "rgba(98,176,220,0.18)", shadow: "0 18px 38px rgba(73,132,170,0.16)" }}
          width="100%"
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label>가로 위치<input type="range" min="-1200" max="1200" step="1" value={safeFrame.x} onChange={(e) => onChange(clampFrame({ ...safeFrame, x: Number(e.target.value) }))} /></label>
        <label>세로 위치<input type="range" min="-1200" max="1200" step="1" value={safeFrame.y} onChange={(e) => onChange(clampFrame({ ...safeFrame, y: Number(e.target.value) }))} /></label>
      </div>
      <label>크기<input type="range" min="0.45" max="11.5" step="0.01" value={safeFrame.scale} onChange={(e) => onChange(clampFrame({ ...safeFrame, scale: Number(e.target.value) }))} /></label>
      <div style={{ color: "#6a87a3", fontSize: 12 }}>운영 화면 카드 미리보기와 동일한 방식으로 드래그와 확대를 적용합니다.</div>
    </div>
  );
}

function StatEditorRow({ label, value, delta, availablePoints, onIncrease, onDecrease, previewMaxHp }) {
  return (
    <div style={card({ padding: "14px 16px", borderRadius: "18px", background: "rgba(255,255,255,0.62)" })}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
        <div style={{ fontWeight: 900 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {delta > 0 ? <button type="button" className="ghost-button" onClick={onDecrease}>-</button> : null}
          <div style={{ minWidth: 54, textAlign: "center", fontWeight: 800 }}>{value}</div>
          <button type="button" className="ghost-button" onClick={onIncrease} disabled={availablePoints <= 0}>+</button>
        </div>
      </div>
      <div style={{ height: "14px", borderRadius: "999px", background: "rgba(230,240,248,0.86)", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, Math.max(12, value * 8))}%`, height: "100%", background: "linear-gradient(90deg, #bfdbfe, #38bdf8)" }} />
      </div>
      {label === "HP" ? <div style={{ fontSize: "12px", color: "#5d7a95", marginTop: "6px" }}>최대 체력 {previewMaxHp}</div> : null}
    </div>
  );
}

function getSkillLabel(skill) {
  if (!skill) return "";
  if (typeof skill === "string") return skill;
  return skill.name || skill.key || String(skill);
}

const PROFILE_FONT_OPTIONS = [
  { label: "기본 폰트", value: `"Pretendard", "Noto Sans KR", sans-serif` },
  { label: "맑은 고딕", value: `"Malgun Gothic", sans-serif` },
  { label: "나눔고딕", value: `"Nanum Gothic", sans-serif` },
  { label: "나눔명조", value: `"Nanum Myeongjo", serif` },
  { label: "바탕", value: `"Batang", serif` },
  { label: "궁서", value: `"Gungsuh", serif` },
];

export default function MyPage({ currentUser = {}, ownerUser = {}, onUpdateUser, design, theme }) {
  const [allMyCharacters, setAllMyCharacters] = useState([]);
  const [allCharacters, setAllCharacters] = useState([]);
  const [mailList, setMailList] = useState([]);
  const [selectedMail, setSelectedMail] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [receiverId, setReceiverId] = useState("");
  const [itemToSend, setItemToSend] = useState("");
  const [coinToSend, setCoinToSend] = useState(0);
  const [letter, setLetter] = useState("");
  const [draftDelta, setDraftDelta] = useState({ hp: 0, def: 0, atk: 0, agi: 0 });
  const [profileEdit, setProfileEdit] = useState({ name: "", age: "", bodyInfo: "", rank: "대원", oneLine: "", profile: "", image: "", mainImage: "", mainImageFrame: { x: 50, y: 26, scale: 1.06 }, investigationImage: "", profileBgm: "", profileBgmVolume: 1 });
  const [brokenProfileImageSrc, setBrokenProfileImageSrc] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const profileTextareaRef = useRef(null);
  const [relationOpen, setRelationOpen] = useState(false);
  const [relationTargetId, setRelationTargetId] = useState("");
  const [relationName, setRelationName] = useState("");
  const [relationDescription, setRelationDescription] = useState("");
  const profileEditDirtyRef = useRef(false);
  const lastProfileSyncRef = useRef("");
  const profileHydratedIdRef = useRef("");

  const setProfileEditDraft = useCallback((updater) => {
    profileEditDirtyRef.current = true;
    setProfileEdit((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  const baseHpStat = getHpStatValue(currentUser?.stats?.hp);
  const effectiveHpStat = baseHpStat + Number(draftDelta.hp || 0);
  const effectiveStats = {
    hp: effectiveHpStat,
    def: Number(currentUser?.stats?.def || 0) + Number(draftDelta.def || 0),
    atk: Number(currentUser?.stats?.atk || 0) + Number(draftDelta.atk || 0),
    agi: Number(currentUser?.stats?.agi || 0) + Number(draftDelta.agi || 0),
  };
  const previewMaxHp = getMaxHpFromStat(effectiveStats.hp);
  const currentHp = getCurrentHpDisplay(effectiveStats.hp, currentUser?.currentHp || currentUser?.stats?.currentHp);
  const expLimit = Math.max(100, Number(currentUser?.level || 1) * 100);
  const exp = Number(currentUser?.exp || 0);
  const corrosion = Math.max(0, Math.min(100, Number(currentUser?.corrosion || 0)));
  const inventory = Array.isArray(currentUser?.items) ? currentUser.items : [];
  const rawProfileImageSrc = currentUser?.image || currentUser?.profileImage || currentUser?.mainImage || currentUser?.investigationImage || "";
  const myProfileImageSrc = rawProfileImageSrc && rawProfileImageSrc !== brokenProfileImageSrc
    ? withImageVersion(rawProfileImageSrc, currentUser?.assetVersion || currentUser?.updatedAt)
    : "";

  useEffect(() => {
    setBrokenProfileImageSrc("");
  }, [currentUser?.id, currentUser?.image, currentUser?.profileImage, currentUser?.mainImage, currentUser?.investigationImage, currentUser?.assetVersion, currentUser?.updatedAt]);

  const safeMyDesign = useMemo(() => ({
    ...(design || {}),
    pages: {
      ...(design?.pages || {}),
      my: {
        ...(design?.pages?.my || {}),
        elements: [],
      },
    },
  }), [design]);
  const unreadCount = useMemo(() => mailList.filter((mail) => !mail.read).length, [mailList]);
  const pendingSpent = Object.values(draftDelta).reduce((sum, value) => sum + Number(value || 0), 0);
  const availableStatPoints = Math.max(0, Number(currentUser?.statPoints || 0) - pendingSpent);
  const receiverOptions = useMemo(() => {
    const merged = [...(Array.isArray(allCharacters) ? allCharacters : []), ...(Array.isArray(allMyCharacters) ? allMyCharacters : [])];
    const seen = new Set();
    return merged
      .filter((character) => String(character?.id || character?.name || "").trim())
      .filter((character) => String(character.id) !== String(currentUser?.id))
      .filter((character) => {
        const key = String(character.id || character.name || "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko"));
  }, [allCharacters, allMyCharacters, currentUser?.id]);

  const loadCharacterDetail = async (characterId) => {
    if (!characterId) return null;
    try {
      const res = await fetch(buildApiUrl(`/character-public/${characterId}`));
      const data = await res.json();
      return data?.character || null;
    } catch {
      return null;
    }
  };

  const loadMine = async () => {
    if (!ownerUser?.id) return;
    try {
      const res = await fetch(buildApiUrl(`/characters-public/${ownerUser.id}`));
      const data = await res.json();
      setAllMyCharacters(Array.isArray(data) ? data : []);
    } catch {
      setAllMyCharacters([]);
    }
  };

  const loadAllCharacters = async () => {
    try {
      const res = await fetch(buildApiUrl(`/characters-public`));
      const data = await res.json();
      setAllCharacters(Array.isArray(data) ? data : []);
    } catch {
      setAllCharacters([]);
    }
  };

  const loadMail = async () => {
    if (!currentUser?.id) return;
    const res = await fetch(buildApiUrl(`/mails/${currentUser.id}?t=${Date.now()}`));
    const data = await res.json();
    setMailList(Array.isArray(data) ? data : []);
    localStorage.setItem(`plc-mail-seen-${currentUser.id}`, "1");
  };

  useEffect(() => {
    loadMine();
  }, [ownerUser?.id]);

  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent("plc-audio-clear", { detail: { scope: "my-profile-preview" } }));
  }, []);

  useEffect(() => {
    fetch(buildApiUrl(`/shopItems`))
      .then((res) => res.json())
      .then((data) => setCatalog(Array.isArray(data) ? data : []))
      .catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    loadMail();
  }, [currentUser?.id]);

  useEffect(() => {
    if (!saveNotice) return undefined;
    const timer = window.setTimeout(() => setSaveNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [saveNotice]);

  useEffect(() => {
    setDraftDelta({ hp: 0, def: 0, atk: 0, agi: 0 });
  }, [currentUser?.id, currentUser?.stats?.hp, currentUser?.stats?.def, currentUser?.stats?.atk, currentUser?.stats?.agi, currentUser?.statPoints]);

  useEffect(() => {
    const currentId = String(currentUser?.id || "");
    if (!currentId) return undefined;
    const needsProfileDetail = currentUser?.profile === undefined || currentUser?.profileBgm === undefined || currentUser?.relations === undefined;
    if (!needsProfileDetail || profileEditDirtyRef.current || profileHydratedIdRef.current === currentId) return undefined;

    let cancelled = false;
    profileHydratedIdRef.current = currentId;
    loadCharacterDetail(currentId).then((detail) => {
      if (cancelled || !detail) return;
      onUpdateUser({ ...currentUser, ...detail });
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [currentUser?.id, currentUser?.profile, currentUser?.profileBgm, currentUser?.relations]);

  useEffect(() => {
    const incomingId = String(currentUser?.id || "");
    const characterChanged = incomingId !== String(lastProfileSyncRef.current || "");
    if (profileEditDirtyRef.current && !characterChanged) return;
    lastProfileSyncRef.current = incomingId;
    profileEditDirtyRef.current = false;
    setProfileEdit({
      name: currentUser?.name || "",
      age: currentUser?.age || "",
      bodyInfo: currentUser?.bodyInfo || "",
      rank: currentUser?.rank || "대원",
      oneLine: currentUser?.oneLine || "",
      profile: currentUser?.profile || "",
      image: currentUser?.image || "",
      mainImage: currentUser?.mainImage || "",
      mainImageFrame: normalizeProfileCardFrame(currentUser?.mainImageFrame),
      investigationImage: currentUser?.investigationImage || "",
      profileBgm: currentUser?.profileBgm || "",
      profileBgmVolume: Math.max(0, Math.min(1, Number(currentUser?.profileBgmVolume ?? 1) || 1)),
    });
  }, [currentUser?.id, currentUser?.name, currentUser?.age, currentUser?.bodyInfo, currentUser?.rank, currentUser?.oneLine, currentUser?.profile, currentUser?.image, currentUser?.mainImage, currentUser?.mainImageFrame, currentUser?.investigationImage, currentUser?.profileBgm, currentUser?.profileBgmVolume]);

  const readEditImage = (file, key) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setProfileEditDraft((prev) => ({ ...prev, [key]: reader.result }));
    reader.readAsDataURL(file);
  };

  const wrapSelectionAsTitle = () => {
    const textarea = profileTextareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const raw = profileEdit.profile || "";
    const selected = raw.slice(start, end).trim();
    const title = selected || "제목";
    const replacement = `<${title}>\n`;
    const next = `${raw.slice(0, start)}${replacement}${raw.slice(end)}`;
    setProfileEditDraft((prev) => ({ ...prev, profile: next }));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + replacement.length;
    });
  };

  const insertProfileTemplate = () => {
    const textarea = profileTextareaRef.current;
    const raw = profileEdit.profile || "";
    const start = textarea?.selectionStart ?? raw.length;
    const block = `${raw && !raw.endsWith("\n") ? "\n\n" : ""}<제목>\n내용`;
    const next = `${raw.slice(0, start)}${block}${raw.slice(start)}`;
    setProfileEditDraft((prev) => ({ ...prev, profile: next }));
    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + block.length;
    });
  };


  const wrapSelectionWithTag = (openTag, closeTag = openTag) => {
    const textarea = profileTextareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const raw = profileEdit.profile || "";
    const selected = raw.slice(start, end) || "텍스트";
    const replacement = `${openTag}${selected}${closeTag}`;
    const next = `${raw.slice(0, start)}${replacement}${raw.slice(end)}`;
    setProfileEditDraft((prev) => ({ ...prev, profile: next }));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = start + openTag.length;
      textarea.selectionEnd = start + openTag.length + selected.length;
    });
  };

  const applyFontToSelection = (fontFamily) => {
    if (!fontFamily) return;
    wrapSelectionWithTag(`[font=${fontFamily}]`, "[/font]");
  };

  const saveProfileEdit = async () => {
    const data = await saveCharacterPatch({
      name: profileEdit.name,
      age: profileEdit.age,
      bodyInfo: profileEdit.bodyInfo,
      rank: profileEdit.rank,
      oneLine: profileEdit.oneLine,
      profile: profileEdit.profile,
      image: profileEdit.image,
      mainImage: profileEdit.mainImage,
      mainImageFrame: normalizeProfileCardFrame(profileEdit.mainImageFrame),
      investigationImage: profileEdit.investigationImage,
      profileBgm: profileEdit.profileBgm,
      profileBgmVolume: Math.max(0, Math.min(1, Number(profileEdit.profileBgmVolume ?? 1) || 1)),
    });
    if (data.success) {
      profileEditDirtyRef.current = false;
      setSaveNotice("프로필 저장 완료");
    }
  };

  const saveCharacterPatch = async (patch) => {
    const res = await fetch(buildApiUrl(`/updateCharacter`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ charId: currentUser.id, ...patch }),
    });
    const data = await res.json();
    if (data.success && data.character) {
      let nextCharacter = data.character;
      try {
        const detailRes = await fetch(buildApiUrl(`/character-public/${currentUser.id}?t=${Date.now()}`), { cache: "no-store" });
        const detailData = await detailRes.json();
        if (detailData?.character) nextCharacter = detailData.character;
      } catch {}
      onUpdateUser(nextCharacter);
      window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { character: nextCharacter } }));
      Promise.allSettled([loadMine(), loadAllCharacters()]).catch(() => {});
      return { ...data, character: nextCharacter };
    }
    await loadMine();
    await loadAllCharacters();
    return data;
  };

  const submitRelationRequest = async () => {
    const target = receiverOptions.find((character) => String(character.id) === String(relationTargetId));
    if (!currentUser?.id || !target?.id) return alert("대상 캐릭터를 선택해주세요.");
    const res = await fetch(buildApiUrl(`/relationRequests`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromCharacterId: currentUser.id,
        fromCharacter: currentUser.name,
        toCharacterId: target.id,
        toCharacter: target.name,
        relationName,
        description: relationDescription,
      }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "관계 신청에 실패했습니다.");
      return;
    }
    setRelationOpen(false);
    setRelationTargetId("");
    setRelationName("");
    setRelationDescription("");
    alert("관계 신청을 보냈습니다.");
  };

  const useItem = async (itemName, meta, itemIndex = -1) => {
    const nextItems = [...inventory];
    const index = itemIndex >= 0 ? itemIndex : nextItems.findIndex((v) => v === itemName || v === meta.id);
    if (index < 0) return;
    const patch = { items: nextItems.filter((_, i) => i !== index) };
    const stats = { ...(currentUser.stats || {}) };
    const skills = Array.isArray(currentUser.skills) ? [...currentUser.skills] : [];
    const useType = meta.useType || "none";
    const useValue = Number(meta.useValue || meta.amount || 0);
    const statTarget = meta.statTarget || meta.targetStat || "atk";
    const maxHp = getMaxHpFromStat(stats.hp);

    if (useType === "heal") {
      patch.currentHp = Math.min(maxHp, Number(currentUser.currentHp || maxHp) + useValue);
    } else if (useType === "corrosionHeal") {
      patch.corrosion = Math.max(0, Number(currentUser.corrosion || 0) - useValue);
    } else if (useType === "statPoint") {
      patch.statPoints = Number(currentUser.statPoints || 0) + useValue;
    } else if (useType === "skill") {
      const nextSkill = meta.skillKey || meta.skillName || meta.useValue;
      if (nextSkill && !skills.some((skill) => getSkillLabel(skill) === String(nextSkill))) {
        skills.push(typeof nextSkill === "string" ? { key: nextSkill, name: meta.skillName || nextSkill } : nextSkill);
      }
      patch.skills = skills;
    } else if (useType === "statBoost") {
      const prevMaxHp = getMaxHpFromStat(stats.hp);
      if (statTarget === "hp") {
        stats.hp = getHpStatValue(stats.hp) + useValue;
        const nextMaxHp = getMaxHpFromStat(stats.hp);
        const currentValue = Number(currentUser.currentHp || prevMaxHp);
        patch.currentHp = Math.min(nextMaxHp, currentValue + Math.max(0, nextMaxHp - prevMaxHp));
      }
      if (statTarget === "def") stats.def = Number(stats.def || 0) + useValue;
      if (statTarget === "atk") stats.atk = Number(stats.atk || 0) + useValue;
      if (statTarget === "agi") stats.agi = Number(stats.agi || 0) + useValue;
      patch.stats = stats;
    } else if (useType === "hp") {
      const prevMaxHp = getMaxHpFromStat(stats.hp);
      stats.hp = getHpStatValue(stats.hp) + useValue;
      const nextMaxHp = getMaxHpFromStat(stats.hp);
      const currentValue = Number(currentUser.currentHp || prevMaxHp);
      patch.currentHp = Math.min(nextMaxHp, currentValue + Math.max(0, nextMaxHp - prevMaxHp));
      patch.stats = stats;
    } else if (useType === "atk" || useType === "def" || useType === "agi") {
      stats[useType] = Number(stats[useType] || 0) + useValue;
      patch.stats = stats;
    } else if (useType === "none" || useType === "unusable") {
      alert("이 아이템은 사용할 수 없습니다.");
      return;
    }

    await saveCharacterPatch(patch);
    alert(`${meta.name || itemName} 사용 완료`);
  };

  const sendMail = async () => {
    if (!receiverOptions.length) await loadAllCharacters();
    if (!receiverId) return alert("받는 사람을 선택해주세요.");
    if (!itemToSend && Number(coinToSend || 0) <= 0 && !letter.trim()) return alert("보낼 내용이 없습니다.");
    const nextItems = [...inventory];
    if (itemToSend) {
      const idx = nextItems.findIndex((v) => v === itemToSend);
      if (idx < 0) return alert("선택한 아이템이 없습니다.");
      nextItems.splice(idx, 1);
    }
    if (Number(coinToSend || 0) > Number(currentUser.coins || 0)) return alert("코인이 부족합니다.");
    const receiver = receiverOptions.find((v) => String(v.id) === String(receiverId)) || {};
    const res = await fetch(buildApiUrl(`/mails/send`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromCharacterId: currentUser.id,
        toCharacterId: receiverId,
        title: `${currentUser.name}의 우편`,
        body: letter,
        coins: Number(coinToSend || 0),
        items: itemToSend ? [itemToSend] : [],
      }),
    });
    const data = await res.json();
    if (!data.success) return alert(data.message || "우편 보내기 실패");
    await saveCharacterPatch({
      items: nextItems,
      coins: Number(currentUser.coins || 0) - Number(coinToSend || 0),
    });
    setReceiverId("");
    setItemToSend("");
    setCoinToSend(0);
    setLetter("");
    alert(`${receiver.name || "상대"}에게 우편을 보냈습니다.`);
  };

  const saveStats = async () => {
    if (pendingSpent <= 0) return;
    const nextStats = {
      ...(currentUser.stats || {}),
      hp: effectiveStats.hp,
      def: effectiveStats.def,
      atk: effectiveStats.atk,
      agi: effectiveStats.agi,
    };
    const currentMaxHp = getMaxHpFromStat(currentUser?.stats?.hp);
    const nextMaxHp = getMaxHpFromStat(nextStats.hp);
    const hpIncrease = Math.max(0, nextMaxHp - currentMaxHp);
    const nextCurrentHp = Math.min(nextMaxHp, Number(currentUser.currentHp || currentMaxHp) + hpIncrease);
    const data = await saveCharacterPatch({
      stats: nextStats,
      statPoints: availableStatPoints,
      currentHp: nextCurrentHp,
    });
    if (data.success) {
      setDraftDelta({ hp: 0, def: 0, atk: 0, agi: 0 });
      setSaveNotice("스탯 저장 완료");
    }
  };

  const openMail = async (mail) => {
    setSelectedMail(mail);
    if (!mail.read) {
      await fetch(buildApiUrl(`/mails/${mail.id}/read`), { method: "POST" });
      await loadMail();
    }
  };

  const receiveMail = async (mail) => {
    const res = await fetch(buildApiUrl(`/mails/${mail.id}/receive`), { method: "POST" });
    const data = await res.json();
    if (!data.success) return alert(data.message || "우편 수령 실패");
    if (data.character) onUpdateUser(data.character);
    setSelectedMail(null);
    await loadMail();
    await loadMine();
    await loadAllCharacters();
  };

  const statRows = [
    { key: "hp", label: "HP", value: effectiveStats.hp },
    { key: "def", label: "DEF", value: effectiveStats.def },
    { key: "atk", label: "ATK", value: effectiveStats.atk },
    { key: "agi", label: "DEX", value: effectiveStats.agi },
  ];

  return (
    <DesignPageFrame design={design} pageKey="my" handlers={{}} theme={theme} minHeight="100vh">
      <div style={{ color: theme?.textMain || "#13324b" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
          <button
            type="button"
            onClick={() => { loadAllCharacters(); setRelationOpen(true); }}
            style={{
              padding: "10px 18px",
              borderRadius: 999,
              border: "1px solid rgba(14,165,233,0.26)",
              background: "linear-gradient(135deg, rgba(56,189,248,0.98), rgba(37,99,235,0.98))",
              color: "#ffffff",
              fontWeight: 900,
              boxShadow: "0 14px 24px rgba(37,99,235,0.18)",
              cursor: "pointer",
            }}
          >
            관계신청
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "18px", marginBottom: "18px" }}>
          <div style={card()}>
            <h2 style={{ marginTop: 0 }}>{currentUser?.name || "캐릭터 없음"}</h2>
            {currentUser ? (
              <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "16px" }}>
                <div>
                  <div style={{ height: "220px", borderRadius: "22px", overflow: "hidden", background: "rgba(255,255,255,0.72)", position: "relative" }}>
                    {myProfileImageSrc ? (
                      <img
                        src={myProfileImageSrc}
                        alt={currentUser.name}
                        onError={() => setBrokenProfileImageSrc(rawProfileImageSrc)}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                          filter: `drop-shadow(0 8px 16px rgba(0,0,0,0.12)) saturate(${1 + corrosion / 120}) hue-rotate(${-corrosion / 4}deg)`,
                        }}
                      />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#88a0b8" }}>프로필 이미지</div>
                    )}
                  </div>
                  <div style={{ marginTop: "12px", fontSize: "22px", fontWeight: 900 }}>Lv. {currentUser.level || 1}</div>
                  <Meter label="HP" value={`${currentHp} / ${previewMaxHp}`} percent={(currentHp / Math.max(previewMaxHp, 1)) * 100} fill="linear-gradient(90deg, #4ade80, #16a34a)" track="rgba(220,252,231,0.92)" />
                  <Meter label="경험치" value={`${exp} / ${expLimit}`} percent={(exp / expLimit) * 100} fill="linear-gradient(90deg, #fbbf24, #f59e0b)" track="rgba(254,249,195,0.94)" />
                  <Meter label="침식률" value={`${corrosion}%`} percent={corrosion} fill="linear-gradient(90deg, #fb7185, #e11d48)" track="rgba(255,228,230,0.94)" danger />
                </div>
                <div style={{ display: "grid", gap: "12px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
                    <InfoCell label="이름" value={currentUser.name} />
                    <InfoCell label="나이" value={currentUser.age || "-"} />
                    <InfoCell label="키 / 몸무게" value={currentUser.bodyInfo || "-"} />
                    <InfoCell label="계급" value={currentUser.rank || "대원"} />
                  </div>
                  <div style={card({ padding: "12px 14px", borderRadius: "16px", background: "rgba(255,255,255,0.62)" })}>
                    <div style={{ fontSize: "12px", color: "#6a87a3" }}>코인</div>
                    <div style={{ fontSize: "22px", fontWeight: 900 }}>{Number(currentUser.coins || 0)} 코인</div>
                  </div>
                  <div style={{ display: "grid", gap: "10px" }}>
                    {statRows.map((row) => (
                      <StatEditorRow
                        key={row.key}
                        label={row.label}
                        value={row.value}
                        delta={draftDelta[row.key]}
                        availablePoints={availableStatPoints}
                        previewMaxHp={previewMaxHp}
                        onIncrease={() => setDraftDelta((prev) => ({ ...prev, [row.key]: Number(prev[row.key] || 0) + 1 }))}
                        onDecrease={() => setDraftDelta((prev) => ({ ...prev, [row.key]: Math.max(0, Number(prev[row.key] || 0) - 1) }))}
                      />
                    ))}
                  </div>
                  <div style={card({ padding: "12px 14px", borderRadius: "16px", background: "rgba(255,255,255,0.62)" })}>
                    스텟 포인트 {availableStatPoints}
                    {pendingSpent > 0 ? <span style={{ color: "#0ea5e9", marginLeft: "8px" }}>(대기 {pendingSpent})</span> : null}
                  </div>
                  {pendingSpent > 0 ? (
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button type="button" className="home-primary-button" onClick={saveStats}>저장</button>
                    </div>
                  ) : null}
                  <div style={card({ background: "rgba(255,255,255,0.62)" })}>
                    <div style={{ fontWeight: 800, marginBottom: "8px" }}>보유 스킬</div>
                    <div style={{ color: "#6a87a3" }}>
                      {Array.isArray(currentUser.skills) && currentUser.skills.length > 0
                        ? currentUser.skills.map(getSkillLabel).join(", ")
                        : "없음"}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ display: "grid", gap: "18px" }}>
            <div style={card({ position: "relative" })}>
              <h3 style={{ marginTop: 0 }}>우편함</h3>
              {unreadCount > 0 ? <div style={{ position: "absolute", top: "14px", right: "14px", width: "12px", height: "12px", borderRadius: "50%", background: "#ef4444" }} /> : null}
              <div style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
                {mailList.map((mail) => (
                  <button
                    key={mail.id}
                    type="button"
                    onClick={() => openMail(mail)}
                    style={{
                      textAlign: "left",
                      ...card({
                        padding: "12px 14px",
                        borderRadius: "16px",
                        background: mail.read ? "rgba(229,239,248,0.62)" : "rgba(255,255,255,0.9)",
                        opacity: mail.read ? 0.72 : 1,
                      }),
                    }}
                  >
                    {!mail.read ? <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "#ef4444", marginRight: "8px" }} /> : null}
                    {mail.title || `${mail.fromName}의 우편`}{mail.received ? " · 수령완료" : ""}
                  </button>
                ))}
                {mailList.length === 0 ? <div style={{ color: "#6a87a3" }}>도착한 우편이 없습니다.</div> : null}
              </div>
            </div>

            <div style={card()}>
              <h3 style={{ marginTop: 0 }}>우편 보내기</h3>
              <div style={{ display: "grid", gap: "10px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                  <select value={receiverId} onChange={(e) => setReceiverId(e.target.value)} onFocus={loadAllCharacters} style={inputStyle}>
                    <option value="">받는 사람 선택</option>
                    {receiverOptions.map((character) => <option key={character.id || character.name} value={character.id}>{character.name}</option>)}
                  </select>
                  <button type="button" className="ghost-button" onClick={loadAllCharacters}>새로고침</button>
                </div>
                <select value={itemToSend} onChange={(e) => setItemToSend(e.target.value)} style={inputStyle}>
                  <option value="">보낼 아이템 선택</option>
                  {inventory.map((item, index) => <option key={`${item}-${index}`} value={item}>{item}</option>)}
                </select>
                <input type="number" min="0" max={Number(currentUser?.coins || 0)} value={coinToSend} onChange={(e) => setCoinToSend(e.target.value)} placeholder="보낼 코인" style={inputStyle} />
                <textarea value={letter} onChange={(e) => setLetter(e.target.value)} placeholder="편지 내용" rows={4} style={{ ...inputStyle, minHeight: 120, resize: "vertical" }} />
                <button type="button" className="home-primary-button" onClick={sendMail}>우편 보내기</button>
              </div>
            </div>
          </div>
        </div>

        <ItemUsePanel items={inventory} catalog={catalog} onUse={useItem} />
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 840px) minmax(240px, 0.72fr)", gap: 12, alignItems: "stretch", marginBottom: "18px" }}>
          <div style={card({ padding: "12px 14px", borderRadius: "18px", maxWidth: 780, width: "100%" })}>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>캐릭터 수정</h3>
            <div style={{ color: "#6a87a3", marginBottom: 10 }}>이미지 3종을 수정할 수 있습니다.</div>
            <div style={{ display: "grid", gridTemplateColumns: ownerUser?.isAdmin ? "250px minmax(0, 1fr)" : "minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
              {ownerUser?.isAdmin ? (
                <div style={card({ padding: "10px 12px", borderRadius: "14px", background: "rgba(255,255,255,0.62)" })}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>기본 정보</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
                    <label>이름<input value={profileEdit.name} onChange={(e) => setProfileEditDraft((prev) => ({ ...prev, name: e.target.value }))} style={inputStyle} /></label>
                    <label>나이<input value={profileEdit.age} onChange={(e) => setProfileEditDraft((prev) => ({ ...prev, age: e.target.value }))} style={inputStyle} /></label>
                    <label>키 / 몸무게<input value={profileEdit.bodyInfo} onChange={(e) => setProfileEditDraft((prev) => ({ ...prev, bodyInfo: e.target.value }))} style={inputStyle} /></label>
                    <label>계급<select value={profileEdit.rank} onChange={(e) => setProfileEditDraft((prev) => ({ ...prev, rank: e.target.value }))} style={inputStyle}><option>분대장</option><option>선임대원</option><option>대원</option></select></label>
                    <label style={{ gridColumn: "1 / -1" }}>한마디<input value={profileEdit.oneLine} onChange={(e) => setProfileEditDraft((prev) => ({ ...prev, oneLine: e.target.value }))} style={inputStyle} /></label>
                  </div>
                </div>
              ) : null}

              <div style={card({ padding: "10px 12px", borderRadius: "14px", background: "rgba(255,255,255,0.62)" })}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>이미지</div>
                <div style={{ display: "grid", gridTemplateColumns: "156px minmax(0, 1fr)", gap: "12px", alignItems: "start" }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    <ImageDropInput key={`profile-${profileEdit.image?.length || 0}-${currentUser?.assetVersion || 0}`} label="프로필 이미지" value={profileEdit.image} onChange={(value) => setProfileEditDraft((prev) => ({ ...prev, image: value }))} previewHeight={112} compact />
                    <ImageDropInput key={`sd-${profileEdit.investigationImage?.length || 0}-${currentUser?.assetVersion || 0}`} label="SD 이미지" value={profileEdit.investigationImage} onChange={(value) => setProfileEditDraft((prev) => ({ ...prev, investigationImage: value }))} previewHeight={112} previewFit="contain" compact />
                    <ImageDropInput key={`main-${profileEdit.mainImage?.length || 0}-${currentUser?.assetVersion || 0}`} label="전신 이미지" value={profileEdit.mainImage} onChange={(value) => setProfileEditDraft((prev) => ({ ...prev, mainImage: value }))} previewHeight={112} previewFit="contain" compact />
                    <AudioSourceInput label="프로필 BGM" value={profileEdit.profileBgm || ""} onChange={(value) => setProfileEditDraft((prev) => ({ ...prev, profileBgm: value }))} volume={profileEdit.profileBgmVolume ?? 1} onVolumeChange={(value) => setProfileEditDraft((prev) => ({ ...prev, profileBgmVolume: value }))} previewScope="my-profile-preview" previewPlacement="profile" compact />
                  </div>
                  <div style={{ display: "grid", gap: 10, justifyItems: "stretch", width: "100%", overflow: "hidden", margin: "0 auto" }}>
                    <FullBodyFrameEditor image={profileEdit.mainImage} frame={profileEdit.mainImageFrame} previewCharacter={{ name: profileEdit.name, rank: profileEdit.rank, oneLine: profileEdit.oneLine }} theme={theme} onChange={(frame) => setProfileEditDraft((prev) => ({ ...prev, mainImageFrame: frame }))} />
                  </div>
                </div>
              </div>

              {ownerUser?.isAdmin ? (
                <div style={card({ padding: "12px", borderRadius: "16px", background: "rgba(255,255,255,0.62)", gridColumn: "1 / -1" })}>
                  <div style={{ fontWeight: 900, marginBottom: 10 }}>프로필 내용</div>
                  <ProfileRichEditor value={profileEdit.profile} onChange={(next) => setProfileEditDraft((prev) => ({ ...prev, profile: next }))} minHeight={320} />
                  <div style={{ marginTop: 10, padding: "14px 16px", borderRadius: 14, background: "rgba(240,248,255,0.9)", border: "1px solid rgba(98,176,220,0.16)", color: "#35566f", lineHeight: 1.9 }}>
                    {renderProfileRichContent(profileEdit.profile || "<p>미리보기</p>")}
                  </div>
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 12 }}>
              <div style={{ minHeight: 20, color: "#2563eb", fontWeight: 800 }}>{saveNotice}</div>
              <button type="button" className="home-primary-button" onClick={saveProfileEdit}>프로필 저장</button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 12, alignSelf: "stretch", gridTemplateRows: "minmax(220px, auto) minmax(0, 1fr)" }}>
            <QuoteEditor
              quotes={Array.isArray(currentUser?.sdQuotes) ? currentUser.sdQuotes : []}
              extraQuotes={[currentUser?.oneLine || ""]}
              style={{ minHeight: 200, height: "100%" }}
              onSave={async (next) => {
                const data = await saveCharacterPatch({ sdQuotes: next });
                if (data.success) setSaveNotice("SD 대사 저장 완료");
              }}
            />
            <div style={card({ padding: "12px 14px", borderRadius: "16px", minHeight: 220, height: "100%" })}>
              <h3 style={{ marginTop: 0 }}>내 캐릭터</h3>
              <div style={{ display: "grid", gap: "8px" }}>
                {allMyCharacters.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    onClick={async () => {
                      const detail = await loadCharacterDetail(character.id);
                      onUpdateUser(detail || character);
                    }}
                    style={{
                      textAlign: "left",
                      ...card({
                        padding: "10px 12px",
                        borderRadius: "14px",
                        background: String(character.id) === String(currentUser?.id) ? "rgba(125,211,252,0.18)" : "rgba(255,255,255,0.7)",
                      }),
                    }}
                  >
                    {character.name} · {character.rank || "대원"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <MailDetail mail={selectedMail} onClose={() => setSelectedMail(null)} onReceive={receiveMail} />
      {relationOpen && typeof document !== "undefined" ? createPortal(
        <div onClick={() => setRelationOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.56)", display: "grid", placeItems: "center", padding: 24, zIndex: 2100 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", borderRadius: 28, background: "rgba(255,255,255,0.98)", padding: 22, boxShadow: "0 26px 60px rgba(15,23,42,0.22)", display: "grid", gap: 12 }}>
            <h3 style={{ margin: 0 }}>관계 신청</h3>
            <select value={relationTargetId} onChange={(e) => setRelationTargetId(e.target.value)} onFocus={loadAllCharacters} style={inputStyle}>
              <option value="">대상 캐릭터 선택</option>
              {receiverOptions.map((character) => <option key={character.id || character.name} value={character.id}>{character.name}</option>)}
            </select>
            <input value={relationName} onChange={(e) => setRelationName(e.target.value)} placeholder="관계 이름" style={inputStyle} />
            <textarea value={relationDescription} onChange={(e) => setRelationDescription(e.target.value)} placeholder="설명" style={{ ...inputStyle, minHeight: 120, resize: "vertical" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="ghost-button" onClick={() => setRelationOpen(false)}>닫기</button>
              <button type="button" className="home-primary-button" onClick={submitRelationRequest}>신청 보내기</button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </DesignPageFrame>
  );
}

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid rgba(98,176,220,0.18)",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.92)",
  color: "#16324a",
};
