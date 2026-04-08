import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DesignPageFrame from "./DesignPageFrame";
import ImageDropInput from "./ImageDropInput";
import AudioSourceInput from "./AudioSourceInput";
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

function Meter({ label, value, percent, danger = false }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#5d7a95", marginBottom: "6px" }}>
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div style={{ height: "12px", borderRadius: "999px", background: "rgba(255,255,255,0.76)", overflow: "hidden" }}>
        <div
          style={{
            width: `${Math.max(0, Math.min(100, percent || 0))}%`,
            height: "100%",
            background: danger ? "linear-gradient(90deg, #fda4af, #ef4444)" : "linear-gradient(90deg, #93c5fd, #38bdf8)",
          }}
        />
      </div>
    </div>
  );
}

function ItemUsePanel({ items, catalog, onUse, style = {} }) {
  return (
    <div style={card(style)}>
      <h3 style={{ marginTop: 0 }}>보유 아이템</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        {items.length > 0
          ? items.map((item, index) => {
              const meta = catalog.find((v) => v.name === item || v.id === item) || {};
              return (
                <button key={`${item}-${index}`} type="button" className="ghost-button" onClick={() => onUse(item, meta)}>
                  {meta.name || item}
                </button>
              );
            })
          : <div style={{ color: "#6a87a3" }}>보유 아이템이 없습니다.</div>}
      </div>
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

function QuoteEditor({ quotes, onSave, style = {} }) {
  const [list, setList] = useState(Array.isArray(quotes) && quotes.length ? quotes : [""]);
  const quotesKey = useMemo(() => JSON.stringify(Array.isArray(quotes) ? quotes : []), [quotes]);
  useEffect(() => {
    setList(Array.isArray(quotes) && quotes.length ? quotes : [""]);
  }, [quotesKey]);
  return (
    <div style={card(style)}>
      <h3 style={{ marginTop: 0 }}>SD 대사</h3>
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


function FullBodyFrameEditor({ image, frame, onChange, previewCharacter = {} }) {
  const safeFrame = normalizeProfileCardFrame(frame);
  const dragRef = useRef(null);

  const startDrag = (event) => {
    if (!image) return;
    event.preventDefault();
    dragRef.current = { x: event.clientX, y: event.clientY, frame: safeFrame };
    const move = (moveEvent) => {
      if (!dragRef.current) return;
      const dx = moveEvent.clientX - dragRef.current.x;
      const dy = moveEvent.clientY - dragRef.current.y;
      onChange({
        ...dragRef.current.frame,
        x: dragRef.current.frame.x + dx * 0.45,
        y: dragRef.current.frame.y + dy * 0.26,
      });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 800, color: "#16324a" }}>프로필 카드 미리보기</div>
      <div onPointerDown={startDrag} style={{ width: 112, maxWidth: "100%", cursor: image ? "grab" : "default", marginLeft: 56 }}>
        <ProfileCard character={{ name: previewCharacter?.name || "미리보기", rank: previewCharacter?.rank || "대원", oneLine: previewCharacter?.oneLine || "카드 미리보기", mainImage: image, mainImageFrame: safeFrame }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label>가로 위치<input type="range" min="20" max="80" step="1" value={safeFrame.x} onChange={(e) => onChange({ ...safeFrame, x: Number(e.target.value) })} /></label>
        <label>세로 위치<input type="range" min="0" max="60" step="1" value={safeFrame.y} onChange={(e) => onChange({ ...safeFrame, y: Number(e.target.value) })} /></label>
      </div>
      <label>크기<input type="range" min="0.7" max="1.5" step="0.01" value={safeFrame.scale} onChange={(e) => onChange({ ...safeFrame, scale: Number(e.target.value) })} /></label>
      <div style={{ color: "#6a87a3", fontSize: 12 }}>이미지를 드래그해서 위치를 맞추거나 슬라이더로 조정할 수 있습니다.</div>
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

export default function MyPage({ currentUser, ownerUser, onUpdateUser, design, theme }) {
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
  const profileTextareaRef = useRef(null);

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
      const res = await fetch(`http://localhost:3001/character-public/${characterId}`);
      const data = await res.json();
      return data?.character || null;
    } catch {
      return null;
    }
  };

  const loadMine = async () => {
    if (!ownerUser?.id) return;
    try {
      const res = await fetch(`http://localhost:3001/characters-public/${ownerUser.id}`);
      const data = await res.json();
      setAllMyCharacters(Array.isArray(data) ? data : []);
    } catch {
      setAllMyCharacters([]);
    }
  };

  const loadAllCharacters = async () => {
    try {
      const res = await fetch(`http://localhost:3001/characters-public`);
      const data = await res.json();
      setAllCharacters(Array.isArray(data) ? data : []);
    } catch {
      setAllCharacters([]);
    }
  };

  const loadMail = async () => {
    if (!currentUser?.id) return;
    const res = await fetch(`http://localhost:3001/mails/${currentUser.id}?t=${Date.now()}`);
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
    fetch(`http://localhost:3001/shopItems`)
      .then((res) => res.json())
      .then((data) => setCatalog(Array.isArray(data) ? data : []))
      .catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    loadMail();
  }, [currentUser?.id]);

  useEffect(() => {
    setDraftDelta({ hp: 0, def: 0, atk: 0, agi: 0 });
  }, [currentUser?.id, currentUser?.stats?.hp, currentUser?.stats?.def, currentUser?.stats?.atk, currentUser?.stats?.agi, currentUser?.statPoints]);

  useEffect(() => {
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
    reader.onloadend = () => setProfileEdit((prev) => ({ ...prev, [key]: reader.result }));
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
    setProfileEdit((prev) => ({ ...prev, profile: next }));
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
    setProfileEdit((prev) => ({ ...prev, profile: next }));
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
    setProfileEdit((prev) => ({ ...prev, profile: next }));
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
    if (data.success) alert("프로필을 저장했습니다.");
  };

  const saveCharacterPatch = async (patch) => {
    const res = await fetch("http://localhost:3001/updateCharacter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ charId: currentUser.id, ...patch }),
    });
    const data = await res.json();
    if (data.success && data.character) {
      onUpdateUser(data.character);
      window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { character: data.character } }));
    }
    await loadMine();
    await loadAllCharacters();
    return data;
  };

  const useItem = async (itemName, meta) => {
    const nextItems = [...inventory];
    const index = nextItems.findIndex((v) => v === itemName || v === meta.id);
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
      if (statTarget === "hp") stats.hp = getHpStatValue(stats.hp) + useValue;
      if (statTarget === "def") stats.def = Number(stats.def || 0) + useValue;
      if (statTarget === "atk") stats.atk = Number(stats.atk || 0) + useValue;
      if (statTarget === "agi") stats.agi = Number(stats.agi || 0) + useValue;
      patch.stats = stats;
    } else if (useType === "hp") {
      stats.hp = getHpStatValue(stats.hp) + useValue;
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
    const res = await fetch("http://localhost:3001/mails/send", {
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
    const nextMaxHp = getMaxHpFromStat(nextStats.hp);
    const nextCurrentHp = Math.min(nextMaxHp, Number(currentUser.currentHp || nextMaxHp));
    const data = await saveCharacterPatch({
      stats: nextStats,
      statPoints: availableStatPoints,
      currentHp: nextCurrentHp,
    });
    if (data.success) {
      setDraftDelta({ hp: 0, def: 0, atk: 0, agi: 0 });
      alert("스텟이 저장되었습니다.");
    }
  };

  const openMail = async (mail) => {
    setSelectedMail(mail);
    if (!mail.read) {
      await fetch(`http://localhost:3001/mails/${mail.id}/read`, { method: "POST" });
      await loadMail();
    }
  };

  const receiveMail = async (mail) => {
    const res = await fetch(`http://localhost:3001/mails/${mail.id}/receive`, { method: "POST" });
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
    { key: "agi", label: "AGI", value: effectiveStats.agi },
  ];

  return (
    <DesignPageFrame design={design} pageKey="my" handlers={{}} theme={theme} minHeight="100vh">
      <div style={{ color: theme?.textMain || "#13324b" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "18px", marginBottom: "18px" }}>
          <div style={card()}>
            <h2 style={{ marginTop: 0 }}>{currentUser?.name || "캐릭터 없음"}</h2>
            {currentUser ? (
              <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "16px" }}>
                <div>
                  <div style={{ height: "220px", borderRadius: "22px", overflow: "hidden", background: "rgba(255,255,255,0.72)", position: "relative" }}>
                    {currentUser.investigationImage ? (
                      <img
                        src={currentUser.investigationImage}
                        alt={currentUser.name}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                          filter: `drop-shadow(0 8px 16px rgba(0,0,0,0.12)) saturate(${1 + corrosion / 120}) hue-rotate(${-corrosion / 4}deg)`,
                        }}
                      />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#88a0b8" }}>SD 이미지</div>
                    )}
                  </div>
                  <div style={{ marginTop: "12px", fontSize: "22px", fontWeight: 900 }}>Lv. {currentUser.level || 1}</div>
                  <Meter label="HP" value={`${currentHp} / ${previewMaxHp}`} percent={(currentHp / Math.max(previewMaxHp, 1)) * 100} />
                  <Meter label="경험치" value={`${exp} / ${expLimit}`} percent={(exp / expLimit) * 100} />
                  <Meter label="침식률" value={`${corrosion}%`} percent={corrosion} danger />
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
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 620px) minmax(360px, 1fr)", gap: 12, alignItems: "stretch", marginBottom: "18px" }}>
          <div style={card({ padding: "12px 14px", borderRadius: "18px", maxWidth: 660, width: "100%" })}>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>캐릭터 수정</h3>
            <div style={{ color: "#6a87a3", marginBottom: 10 }}>이미지 3종을 수정할 수 있습니다.</div>
            <div style={{ display: "grid", gridTemplateColumns: ownerUser?.isAdmin ? "220px minmax(0, 1fr)" : "minmax(0, 1fr)", gap: 10, alignItems: "start" }}>
              {ownerUser?.isAdmin ? (
                <div style={card({ padding: "10px 12px", borderRadius: "14px", background: "rgba(255,255,255,0.62)" })}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>기본 정보</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
                    <label>이름<input value={profileEdit.name} onChange={(e) => setProfileEdit((prev) => ({ ...prev, name: e.target.value }))} style={inputStyle} /></label>
                    <label>나이<input value={profileEdit.age} onChange={(e) => setProfileEdit((prev) => ({ ...prev, age: e.target.value }))} style={inputStyle} /></label>
                    <label>키 / 몸무게<input value={profileEdit.bodyInfo} onChange={(e) => setProfileEdit((prev) => ({ ...prev, bodyInfo: e.target.value }))} style={inputStyle} /></label>
                    <label>계급<select value={profileEdit.rank} onChange={(e) => setProfileEdit((prev) => ({ ...prev, rank: e.target.value }))} style={inputStyle}><option>분대장</option><option>선임대원</option><option>대원</option></select></label>
                    <label style={{ gridColumn: "1 / -1" }}>한마디<input value={profileEdit.oneLine} onChange={(e) => setProfileEdit((prev) => ({ ...prev, oneLine: e.target.value }))} style={inputStyle} /></label>
                  </div>
                </div>
              ) : null}

              <div style={card({ padding: "10px 12px", borderRadius: "14px", background: "rgba(255,255,255,0.62)" })}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>이미지</div>
                <div style={{ display: "grid", gridTemplateColumns: "92px minmax(160px, 1fr)", gap: "10px", alignItems: "start" }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    <ImageDropInput label="프로필 이미지" value={profileEdit.image} onChange={(value) => setProfileEdit((prev) => ({ ...prev, image: value }))} previewHeight={68} compact />
                    <ImageDropInput label="SD 이미지" value={profileEdit.investigationImage} onChange={(value) => setProfileEdit((prev) => ({ ...prev, investigationImage: value }))} previewHeight={68} previewFit="contain" compact />
                    <ImageDropInput label="전신 이미지" value={profileEdit.mainImage} onChange={(value) => setProfileEdit((prev) => ({ ...prev, mainImage: value }))} previewHeight={68} previewFit="contain" compact />
                    <AudioSourceInput label="프로필 BGM" value={profileEdit.profileBgm || ""} onChange={(value) => setProfileEdit((prev) => ({ ...prev, profileBgm: value }))} volume={profileEdit.profileBgmVolume ?? 1} onVolumeChange={(value) => setProfileEdit((prev) => ({ ...prev, profileBgmVolume: value }))} previewScope="my-profile-preview" previewPlacement="profile" compact helperText="프로필 화면에 들어가면 이 BGM이 자동으로 재생돼." />
                  </div>
                  <div style={{ display: "grid", gap: 10, justifyItems: "start", width: "100%", maxWidth: 180, overflow: "hidden", marginLeft: 52 }}>
                    <FullBodyFrameEditor image={profileEdit.mainImage} frame={profileEdit.mainImageFrame} previewCharacter={{ name: profileEdit.name, rank: profileEdit.rank, oneLine: profileEdit.oneLine }} onChange={(frame) => setProfileEdit((prev) => ({ ...prev, mainImageFrame: frame }))} />
                  </div>
                </div>
              </div>

              {ownerUser?.isAdmin ? (
                <div style={card({ padding: "12px", borderRadius: "16px", background: "rgba(255,255,255,0.62)", gridColumn: "1 / -1" })}>
                  <div style={{ fontWeight: 900, marginBottom: 10 }}>프로필 내용</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    <button type="button" className="ghost-button" onClick={wrapSelectionAsTitle}>제목</button>
                    <button type="button" className="ghost-button" onClick={() => wrapSelectionWithTag("[b]", "[/b]")}>굵게</button>
                    <button type="button" className="ghost-button" onClick={() => wrapSelectionWithTag("[i]", "[/i]")}>기울기</button>
                    <button type="button" className="ghost-button" onClick={() => wrapSelectionWithTag("[size=24]", "[/size]")}>크게</button>
                    <button type="button" className="ghost-button" onClick={() => wrapSelectionWithTag("[center]", "[/center]")}>가운데 정렬</button>
                    <select defaultValue="" onChange={(e) => { applyFontToSelection(e.target.value); e.target.value = ""; }} style={{ ...inputStyle, width: 180, padding: "10px 12px" }}>
                      <option value="">글씨체</option>
                      {PROFILE_FONT_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
                    </select>
                    <button type="button" className="ghost-button" onClick={insertProfileTemplate}>제목/내용 양식 추가</button>
                  </div>
                  <label>프로필 내용<textarea ref={profileTextareaRef} value={profileEdit.profile} onChange={(e) => setProfileEdit((prev) => ({ ...prev, profile: e.target.value }))} style={{ ...inputStyle, minHeight: 220, resize: "vertical" }} /></label>
                  <div style={{ marginTop: 10, padding: "14px 16px", borderRadius: 14, background: "rgba(240,248,255,0.9)", border: "1px solid rgba(98,176,220,0.16)", color: "#35566f", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>
                    {renderProfileRichParagraph(profileEdit.profile || "미리보기")}
                  </div>
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="home-primary-button" onClick={saveProfileEdit}>프로필 저장</button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 12, alignSelf: "stretch", gridTemplateRows: "minmax(240px, auto) minmax(0, 1fr)" }}>
            <QuoteEditor
              quotes={Array.isArray(currentUser?.sdQuotes) ? currentUser.sdQuotes : []}
              style={{ minHeight: 220, height: "100%" }}
              onSave={async (next) => {
                const data = await saveCharacterPatch({ sdQuotes: next });
                if (data.success) alert("SD 대사를 저장했습니다.");
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
