import React, { useEffect, useMemo, useRef, useState } from "react";
import { ProfileCard, normalizeProfileCardFrame } from "./profileCardShared";
import { renderProfileRichParagraph } from "./profileRichText";
import ImageDropInput from "./ImageDropInput";
import AudioSourceInput from "./AudioSourceInput";

function MenuCard({ title, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: "left",
        padding: "22px",
        borderRadius: "24px",
        border: "1px solid rgba(98,176,220,0.18)",
        background: "rgba(255,255,255,0.92)",
        color: "#16324a",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        boxShadow: "0 20px 36px rgba(73,132,170,0.12)",
      }}
    >
      <div className="section-eyebrow">ADMIN</div>
      <div style={{ fontSize: "24px", fontWeight: 900, marginTop: "10px" }}>{title}</div>
    </button>
  );
}

const PROFILE_FONT_OPTIONS = [
  { label: "기본 폰트", value: `"Pretendard", "Noto Sans KR", sans-serif` },
  { label: "맑은 고딕", value: `"Malgun Gothic", sans-serif` },
  { label: "나눔고딕", value: `"Nanum Gothic", sans-serif` },
  { label: "나눔명조", value: `"Nanum Myeongjo", serif` },
  { label: "바탕", value: `"Batang", serif` },
  { label: "궁서", value: `"Gungsuh", serif` },
];

const inputStyle = {
  width: "100%",
  marginTop: 6,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(98,176,220,0.18)",
  background: "rgba(255,255,255,0.98)",
  color: "#16324a",
  boxSizing: "border-box",
};

const panelStyle = {
  padding: 18,
  borderRadius: 24,
  background: "rgba(255,255,255,0.92)",
  border: "1px solid rgba(98,176,220,0.18)",
  boxShadow: "0 20px 36px rgba(73,132,170,0.12)",
  display: "grid",
  gap: 10,
};

function PreviewCharacterCard({ name, rank, image, oneLine, frame, onFrameChange }) {
  const dragRef = useRef(null);
  const safeFrame = normalizeProfileCardFrame(frame);

  const clampFrame = (next) => ({
    x: Math.max(-1200, Math.min(1200, Number(next.x ?? safeFrame.x))),
    y: Math.max(-1200, Math.min(1200, Number(next.y ?? safeFrame.y))),
    scale: Math.max(0.45, Math.min(11.5, Number(next.scale ?? safeFrame.scale))),
  });

  const handlePointerDown = (e) => {
    if (!onFrameChange || !image) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      frameX: safeFrame.x,
      frameY: safeFrame.y,
      scale: safeFrame.scale,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current || !onFrameChange) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    onFrameChange(clampFrame({
      x: dragRef.current.frameX + dx,
      y: dragRef.current.frameY + dy,
      scale: dragRef.current.scale,
    }));
  };

  const stopDrag = (e) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      style={{ width: 160, maxWidth: "100%", touchAction: "none", cursor: onFrameChange && image ? "grab" : "default", userSelect: "none" }}
    >
      <ProfileCard
        character={{ name, rank, oneLine, mainImage: image, mainImageFrame: safeFrame }}
        theme={{ line: "rgba(98,176,220,0.18)", shadow: "0 18px 38px rgba(73,132,170,0.16)" }}
        width="100%"
      />
    </div>
  );
}

function frameFromSource(source) {
  return {
    x: Number(source?.mainImageFrame?.x ?? source?.frameX ?? 50),
    y: Number(source?.mainImageFrame?.y ?? source?.frameY ?? 28),
    scale: Number(source?.mainImageFrame?.scale ?? source?.frameScale ?? 1.12),
  };
}

export default function AdminPage({
  goBack,
  goInvestigations,
  goInvestigationBuilder,
  goDesignEditor,
  goShopManager,
  goRelations,
  goMapManager,
}) {
  const [users, setUsers] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [selectedCharacterDetail, setSelectedCharacterDetail] = useState(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    charName: "",
    charProfile: "",
    charImage: "",
    charMainImage: "",
    charInvestigationImage: "",
    charAge: "",
    charBodyInfo: "",
    charRank: "대원",
    charOneLine: "",
    charProfileBgm: "",
    frameX: 50,
    frameY: 28,
    frameScale: 1.12,
  });
  const createProfileTextareaRef = useRef(null);
  const editProfileTextareaRef = useRef(null);
  const [siteBgm, setSiteBgm] = useState("");
  const [siteBgmVolume, setSiteBgmVolume] = useState(1);
  const [edit, setEdit] = useState({
    name: "",
    profile: "",
    image: "",
    mainImage: "",
    investigationImage: "",
    coins: "",
    exp: "",
    level: "",
    statPoints: "",
    corrosion: "",
    atk: "",
    hp: "",
    def: "",
    agi: "",
    age: "",
    bodyInfo: "",
    rank: "대원",
    oneLine: "",
    profileBgm: "",
    profileBgmVolume: 1,
    dailyAttemptsLeft: "1",
    gambleCountLeft: "3",
    frameX: 50,
    frameY: 28,
    frameScale: 1.12,
  });


  const wrapTextareaSelection = (textarea, value, setter, openTag, closeTag = openTag) => {
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const raw = value || "";
    const selected = raw.slice(start, end) || "텍스트";
    const replacement = `${openTag}${selected}${closeTag}`;
    setter(`${raw.slice(0, start)}${replacement}${raw.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = start + openTag.length;
      textarea.selectionEnd = start + openTag.length + selected.length;
    });
  };

  const applyTextareaFontSelection = (textarea, value, setter, fontFamily) => {
    if (!fontFamily) return;
    wrapTextareaSelection(textarea, value, setter, `[font=${fontFamily}]`, "[/font]");
  };

  const loadSiteBgm = async () => {
    try {
      const res = await fetch(`http://localhost:3001/designConfig?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      setSiteBgm(String(data?.siteContent?.bgm?.site || data?.siteContent?.bgm?.home || ""));
      setSiteBgmVolume(Math.max(0, Math.min(1, Number(data?.siteContent?.bgm?.siteVolume ?? data?.siteContent?.bgm?.volume ?? 1) || 1)));
    } catch {
      setSiteBgm("");
    }
  };

  useEffect(() => () => {
    ["admin-site-preview", "admin-create-profile-preview", "admin-edit-profile-preview"].forEach((scope) => {
      window.dispatchEvent(new CustomEvent("plc-audio-clear", { detail: { scope } }));
    });
  }, []);

  const saveSiteBgm = async () => {
    try {
      const currentRes = await fetch(`http://localhost:3001/designConfig?t=${Date.now()}`, { cache: "no-store" });
      const current = await currentRes.json();
      const next = {
        ...(current || {}),
        siteContent: {
          ...((current && current.siteContent) || {}),
          bgm: {
            ...(((current && current.siteContent) || {}).bgm || {}),
            site: siteBgm || "",
            siteVolume: Math.max(0, Math.min(1, Number(siteBgmVolume) || 1)),
          },
        },
      };
      const saveRes = await fetch("http://localhost:3001/designConfig", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const saved = await saveRes.json();
      if (!saved?.success) {
        setMessage(saved?.message || "홈페이지 BGM 저장 실패");
        return;
      }
      try {
        localStorage.setItem("plc-design-cache", JSON.stringify(saved.designConfig));
      } catch {}
      window.dispatchEvent(new CustomEvent("plc-design-updated", { detail: { design: saved.designConfig } }));
      setMessage("홈페이지 BGM 저장 완료");
    } catch {
      setMessage("홈페이지 BGM 저장 실패");
    }
  };

  const loadAll = async () => {
    const userRes = await fetch("http://localhost:3001/admin/users");
    const userData = await userRes.json();
    setUsers(Array.isArray(userData) ? userData : []);
    const charRes = await fetch(`http://localhost:3001/characters-lite?t=${Date.now()}`, { cache: "no-store" });
    const charData = await charRes.json();
    setCharacters(Array.isArray(charData) ? charData : []);
  };

  const loadCharacterDetail = async (characterId) => {
    if (!characterId) return null;
    try {
      const res = await fetch(`http://localhost:3001/character/${characterId}?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      return data?.character || null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    loadAll().catch(() => {});
    loadSiteBgm().catch(() => {});
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(""), 1800);
    return () => clearTimeout(timer);
  }, [message]);

  const ownerCharacters = useMemo(
    () => characters.filter((c) => c.ownerId === selectedUserId),
    [characters, selectedUserId]
  );
  const selectedCharacterLite = ownerCharacters.find((c) => String(c.id) === String(selectedCharacterId));
  const selectedCharacter = selectedCharacterDetail && String(selectedCharacterDetail.id) === String(selectedCharacterId) ? selectedCharacterDetail : null;

  useEffect(() => {
    let cancelled = false;
    if (!selectedCharacterId) {
      setSelectedCharacterDetail(null);
      return undefined;
    }
    loadCharacterDetail(selectedCharacterId).then((detail) => {
      if (cancelled) return;
      setSelectedCharacterDetail(detail);
    }).catch(() => {
      if (cancelled) return;
      setSelectedCharacterDetail(null);
    });
    return () => { cancelled = true; };
  }, [selectedCharacterId]);

  useEffect(() => {
    if (!selectedCharacter) return;
    const frame = normalizeProfileCardFrame(frameFromSource(selectedCharacter));
    setEdit({
      name: selectedCharacter.name || "",
      profile: selectedCharacter.profile || "",
      image: selectedCharacter.image || "",
      mainImage: selectedCharacter.mainImage || "",
      investigationImage: selectedCharacter.investigationImage || "",
      coins: String(selectedCharacter.coins ?? 0),
      exp: String(selectedCharacter.exp ?? 0),
      level: String(selectedCharacter.level ?? 1),
      statPoints: String(selectedCharacter.statPoints ?? 0),
      corrosion: String(selectedCharacter.corrosion ?? 0),
      atk: String(selectedCharacter.stats?.atk ?? 0),
      hp: String(selectedCharacter.stats?.hp ?? 0),
      def: String(selectedCharacter.stats?.def ?? 0),
      agi: String(selectedCharacter.stats?.agi ?? 0),
      age: selectedCharacter.age || "",
      bodyInfo: selectedCharacter.bodyInfo || "",
      rank: selectedCharacter.rank || "대원",
      oneLine: selectedCharacter.oneLine || "",
      profileBgm: selectedCharacter.profileBgm || "",
      profileBgmVolume: Math.max(0, Math.min(1, Number(selectedCharacter.profileBgmVolume ?? 1) || 1)),
      dailyAttemptsLeft: String(selectedCharacter.dailyAttemptsLeft ?? 1),
      gambleCountLeft: String(selectedCharacter.gambleCountLeft ?? 3),
      frameX: frame.x,
      frameY: frame.y,
      frameScale: frame.scale,
    });
  }, [selectedCharacterId, selectedCharacter]);

  const readAsDataUrl = (file, key) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setForm((prev) => ({ ...prev, [key]: reader.result }));
    reader.readAsDataURL(file);
  };

  const createCharacterForUser = async () => {
    if (!selectedUserId) return setMessage("먼저 계정을 선택해주세요.");
    if (!form.charName.trim()) return setMessage("캐릭터 이름을 입력해주세요.");
    const res = await fetch("http://localhost:3001/createCharacter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerId: selectedUserId,
        name: form.charName.trim(),
        image: form.charImage,
        mainImage: form.charMainImage,
        investigationImage: form.charInvestigationImage,
        profile: form.charProfile,
        age: form.charAge,
        bodyInfo: form.charBodyInfo,
        rank: form.charRank,
        oneLine: form.charOneLine,
        profileBgm: form.charProfileBgm,
        profileBgmVolume: Math.max(0, Math.min(1, Number(form.charProfileBgmVolume ?? 1) || 1)),
        mainImageFrame: { x: Number(form.frameX || 50), y: Number(form.frameY || 28), scale: Number(form.frameScale || 1.12) },
      }),
    });
    const data = await res.json();
    if (!data.success) return setMessage(data.message || "캐릭터 생성 실패");
    setMessage("캐릭터 생성 완료.");
    if (data.character) window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { character: data.character } }));
    setForm({ charName: "", charProfile: "", charImage: "", charMainImage: "", charInvestigationImage: "", charAge: "", charBodyInfo: "", charRank: "대원", charOneLine: "", charProfileBgm: "", frameX: 50, frameY: 28, frameScale: 1.18 });
    loadAll();
  };

  const saveSelectedCharacter = async () => {
    if (!selectedCharacter) return setMessage("캐릭터를 선택해주세요.");
    const res = await fetch("http://localhost:3001/updateCharacter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        charId: selectedCharacter.id,
        name: edit.name,
        image: edit.image,
        mainImage: edit.mainImage,
        investigationImage: edit.investigationImage,
        profile: edit.profile,
        level: Number(edit.level || 1),
        statPoints: Number(edit.statPoints || 0),
        corrosion: Number(edit.corrosion || 0),
        coins: Number(edit.coins || 0),
        exp: Number(edit.exp || 0),
        stats: { atk: Number(edit.atk || 0), hp: Number(edit.hp || 0), def: Number(edit.def || 0), agi: Number(edit.agi || 0) },
        age: edit.age,
        bodyInfo: edit.bodyInfo,
        rank: edit.rank,
        oneLine: edit.oneLine,
        profileBgm: edit.profileBgm,
        profileBgmVolume: Math.max(0, Math.min(1, Number(edit.profileBgmVolume ?? 1) || 1)),
        dailyAttemptsLeft: Number(edit.dailyAttemptsLeft || 1),
        gambleCountLeft: Number(edit.gambleCountLeft || 3),
        mainImageFrame: { x: Number(edit.frameX || 50), y: Number(edit.frameY || 28), scale: Number(edit.frameScale || 1.12) },
      }),
    });
    const data = await res.json();
    if (!data.success) return setMessage(data.message || "캐릭터 수정 실패");
    setMessage("캐릭터 저장 완료");
    window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { character: data.character } }));
    loadAll();
  };

  const deleteSelectedCharacter = async () => {
    if (!selectedCharacter) return setMessage("캐릭터를 선택해주세요.");
    const ok = window.confirm(`${selectedCharacter.name} 캐릭터를 삭제하겠습니까?`);
    if (!ok) return;
    const res = await fetch(`http://localhost:3001/admin/characters/${selectedCharacter.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.success) return setMessage(data.message || "캐릭터 삭제 실패");
    setSelectedCharacterId("");
    setMessage("캐릭터 삭제 완료");
    await loadAll();
  };

  const createFrame = { x: Number(form.frameX || 50), y: Number(form.frameY || 28), scale: Number(form.frameScale || 1.12) };
  const editFrame = { x: Number(edit.frameX || 50), y: Number(edit.frameY || 28), scale: Number(edit.frameScale || 1.12) };

  return (
    <div style={{ padding: 26, color: "#16324a", background: "linear-gradient(180deg, #f7fbff, #eef7ff)", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 18 }}>
        <div>
          <div className="section-eyebrow">ADMIN CONTROL</div>
          <h2 style={{ marginTop: 10, marginBottom: 0 }}>운영 페이지</h2>
        </div>
        <button type="button" className="ghost-button" onClick={goBack}>뒤로가기</button>
      </div>

      <div style={{ ...panelStyle, marginBottom: 18 }}>
        <div className="section-eyebrow">SITE BGM</div>
        <AudioSourceInput label="홈페이지 / 공용 BGM" value={siteBgm || ""} onChange={setSiteBgm} volume={siteBgmVolume} onVolumeChange={setSiteBgmVolume} previewScope="admin-site-preview" previewPlacement="global" helperText="프로필과 조사에 별도 BGM이 없으면 해당 음악이 재생됩니다." />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="home-primary-button" onClick={saveSiteBgm}>홈페이지 BGM 저장</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 18, marginBottom: 22 }}>
        <MenuCard title="조사 관리" onClick={goInvestigations} />
        <MenuCard title="조사 제작기" onClick={goInvestigationBuilder} />
        <MenuCard title="상점 관리" onClick={goShopManager} />
        <MenuCard title="관계 승인" onClick={goRelations} />
        <MenuCard title="디자인 관리" onClick={goDesignEditor} />
        <MenuCard title="맵 관리" onClick={goMapManager} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div style={panelStyle}>
          <div className="section-eyebrow">CHARACTER CREATE</div>
          <label>계정 선택<select value={selectedUserId} onChange={(e) => { setSelectedUserId(e.target.value); setSelectedCharacterId(""); }} style={inputStyle}><option value="">선택</option>{users.map((user) => <option key={user.id} value={user.id}>{user.id}</option>)}</select></label>
          <label>캐릭터 이름<input value={form.charName} onChange={(e) => setForm({ ...form, charName: e.target.value })} style={inputStyle} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>나이<input value={form.charAge} onChange={(e) => setForm({ ...form, charAge: e.target.value })} style={inputStyle} /></label>
            <label>계급<select value={form.charRank} onChange={(e) => setForm({ ...form, charRank: e.target.value })} style={inputStyle}><option>분대장</option><option>선임대원</option><option>대원</option></select></label>
          </div>
          <label>키 / 몸무게<input value={form.charBodyInfo} onChange={(e) => setForm({ ...form, charBodyInfo: e.target.value })} style={inputStyle} /></label>
          <label>한마디<input value={form.charOneLine} onChange={(e) => setForm({ ...form, charOneLine: e.target.value })} style={inputStyle} /></label>
          <ImageDropInput label="프로필 이미지" value={form.charImage} onChange={(value) => setForm((prev) => ({ ...prev, charImage: value }))} previewHeight={150} compact />
          <ImageDropInput label="전신 이미지" value={form.charMainImage} onChange={(value) => setForm((prev) => ({ ...prev, charMainImage: value }))} previewHeight={180} previewFit="contain" compact />
          <ImageDropInput label="SD 이미지" value={form.charInvestigationImage} onChange={(value) => setForm((prev) => ({ ...prev, charInvestigationImage: value }))} previewHeight={160} previewFit="contain" compact />
          <AudioSourceInput label="프로필 BGM" value={form.charProfileBgm || ""} onChange={(value) => setForm((prev) => ({ ...prev, charProfileBgm: value }))} volume={form.charProfileBgmVolume ?? 1} onVolumeChange={(value) => setForm((prev) => ({ ...prev, charProfileBgmVolume: value }))} previewScope="admin-create-profile-preview" previewPlacement="profile" helperText="캐릭터 프로필 화면 재생 음악" />
          <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 800, color: "#16324a" }}>프로필</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(createProfileTextareaRef.current, form.charProfile, (next) => setForm({ ...form, charProfile: next }), "[b]", "[/b]")}>선택 굵게</button>
                <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(createProfileTextareaRef.current, form.charProfile, (next) => setForm({ ...form, charProfile: next }), "[i]", "[/i]")}>선택 기울기</button>
                <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(createProfileTextareaRef.current, form.charProfile, (next) => setForm({ ...form, charProfile: next }), "[size=24]", "[/size]")}>선택 크게</button>
                <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(createProfileTextareaRef.current, form.charProfile, (next) => setForm({ ...form, charProfile: next }), "[center]", "[/center]")}>가운데 정렬</button>
                <select defaultValue="" onChange={(e) => { applyTextareaFontSelection(createProfileTextareaRef.current, form.charProfile, (next) => setForm({ ...form, charProfile: next }), e.target.value); e.target.value = ""; }} style={{ ...inputStyle, width: 170, padding: "10px 12px" }}>
                  <option value="">선택 글씨체</option>
                  {PROFILE_FONT_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
                </select>
              </div>
            </div>
            <textarea ref={createProfileTextareaRef} value={form.charProfile} onChange={(e) => setForm({ ...form, charProfile: e.target.value })} style={{ ...inputStyle, minHeight: 120 }} />
            <div style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(240,248,255,0.92)", border: "1px solid rgba(98,176,220,0.16)", lineHeight: 1.85 }}>
              {renderProfileRichParagraph(form.charProfile || "미리보기")}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
            <div style={{ fontWeight: 800 }}>카드 전신 이미지 표시 위치</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <label>좌우<input type="range" min="-1200" max="1200" step="1" value={form.frameX} onChange={(e) => setForm({ ...form, frameX: Number(e.target.value) })} style={{ width: "100%" }} /><div style={{ fontSize: 12, color: "#5d7a95" }}>{Number(form.frameX).toFixed(0)}</div></label>
              <label>상하<input type="range" min="-1200" max="1200" step="1" value={form.frameY} onChange={(e) => setForm({ ...form, frameY: Number(e.target.value) })} style={{ width: "100%" }} /><div style={{ fontSize: 12, color: "#5d7a95" }}>{Number(form.frameY).toFixed(0)}</div></label>
              <label>확대<input type="range" min="0.4" max="11.5" step="0.01" value={form.frameScale} onChange={(e) => setForm({ ...form, frameScale: Number(e.target.value) })} style={{ width: "100%" }} /><div style={{ fontSize: 12, color: "#5d7a95" }}>{Number(form.frameScale).toFixed(2)}</div></label>
            </div>
            <PreviewCharacterCard name={form.charName} rank={form.charRank} image={form.charMainImage || ""} oneLine={form.charOneLine} frame={createFrame} onFrameChange={(next) => setForm((prev) => ({ ...prev, frameX: next.x, frameY: next.y, frameScale: next.scale }))} />
          </div>

          <button type="button" className="home-primary-button" onClick={createCharacterForUser}>캐릭터 생성</button>
        </div>

        <div style={panelStyle}>
          <div className="section-eyebrow">CHARACTER EDIT</div>
          <label>캐릭터 선택<select value={selectedCharacterId} onChange={(e) => setSelectedCharacterId(e.target.value)} style={inputStyle}><option value="">선택</option>{ownerCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>

          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ padding: 14, borderRadius: 18, background: "rgba(244,250,255,0.9)", display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>기본 프로필 수정</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                <label>이름<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} style={inputStyle} /></label>
                <label>계급<select value={edit.rank} onChange={(e) => setEdit({ ...edit, rank: e.target.value })} style={inputStyle}><option>분대장</option><option>선임대원</option><option>대원</option></select></label>
                <label>나이<input value={edit.age} onChange={(e) => setEdit({ ...edit, age: e.target.value })} style={inputStyle} /></label>
                <label>키 / 몸무게<input value={edit.bodyInfo} onChange={(e) => setEdit({ ...edit, bodyInfo: e.target.value })} style={inputStyle} /></label>
                <label style={{ gridColumn: "1 / -1" }}>한마디<input value={edit.oneLine} onChange={(e) => setEdit({ ...edit, oneLine: e.target.value })} style={inputStyle} /></label>
                <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, color: "#16324a" }}>프로필</span>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(editProfileTextareaRef.current, edit.profile, (next) => setEdit({ ...edit, profile: next }), "[b]", "[/b]")}>선택 굵게</button>
                      <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(editProfileTextareaRef.current, edit.profile, (next) => setEdit({ ...edit, profile: next }), "[i]", "[/i]")}>선택 기울기</button>
                      <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(editProfileTextareaRef.current, edit.profile, (next) => setEdit({ ...edit, profile: next }), "[size=24]", "[/size]")}>선택 크게</button>
                      <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(editProfileTextareaRef.current, edit.profile, (next) => setEdit({ ...edit, profile: next }), "[center]", "[/center]")}>가운데 정렬</button>
                      <select defaultValue="" onChange={(e) => { applyTextareaFontSelection(editProfileTextareaRef.current, edit.profile, (next) => setEdit({ ...edit, profile: next }), e.target.value); e.target.value = ""; }} style={{ ...inputStyle, width: 170, padding: "10px 12px" }}>
                        <option value="">선택 글씨체</option>
                        {PROFILE_FONT_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <textarea ref={editProfileTextareaRef} value={edit.profile} onChange={(e) => setEdit({ ...edit, profile: e.target.value })} style={{ ...inputStyle, minHeight: 120 }} />
                  <div style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(240,248,255,0.92)", border: "1px solid rgba(98,176,220,0.16)", lineHeight: 1.85 }}>
                    {renderProfileRichParagraph(edit.profile || "미리보기")}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ padding: 14, borderRadius: 18, background: "rgba(244,250,255,0.9)", display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>이미지 수정</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <ImageDropInput label="프로필 이미지" value={edit.image} onChange={(value) => setEdit((prev) => ({ ...prev, image: value }))} previewHeight={140} compact />
                <ImageDropInput label="SD 이미지" value={edit.investigationImage} onChange={(value) => setEdit((prev) => ({ ...prev, investigationImage: value }))} previewHeight={140} previewFit="contain" compact />
                <div style={{ gridColumn: "1 / -1", display: "grid", gap: 12 }}>
                  <ImageDropInput label="전신 이미지" value={edit.mainImage} onChange={(value) => setEdit((prev) => ({ ...prev, mainImage: value }))} previewHeight={180} previewFit="contain" compact />
                  <AudioSourceInput label="프로필 BGM" value={edit.profileBgm || ""} onChange={(value) => setEdit((prev) => ({ ...prev, profileBgm: value }))} volume={edit.profileBgmVolume ?? 1} onVolumeChange={(value) => setEdit((prev) => ({ ...prev, profileBgmVolume: value }))} previewScope="admin-edit-profile-preview" previewPlacement="profile" helperText="캐릭터 프로필 화면 재생 음악" />
                </div>
              </div>
            </div>

            <div style={{ padding: 14, borderRadius: 18, background: "rgba(244,250,255,0.9)", display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>수치 수정</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                <label>레벨<input value={edit.level} onChange={(e) => setEdit({ ...edit, level: e.target.value })} style={inputStyle} /></label>
                <label>코인<input value={edit.coins} onChange={(e) => setEdit({ ...edit, coins: e.target.value })} style={inputStyle} /></label>
                <label>경험치<input value={edit.exp} onChange={(e) => setEdit({ ...edit, exp: e.target.value })} style={inputStyle} /></label>
                <label>침식률<input value={edit.corrosion} onChange={(e) => setEdit({ ...edit, corrosion: e.target.value })} style={inputStyle} /></label>
                <label>스탯 포인트<input value={edit.statPoints} onChange={(e) => setEdit({ ...edit, statPoints: e.target.value })} style={inputStyle} /></label>
                <label>일일조사 횟수<input value={edit.dailyAttemptsLeft} onChange={(e) => setEdit({ ...edit, dailyAttemptsLeft: e.target.value })} style={inputStyle} /></label>
                <label>도박 횟수<input value={edit.gambleCountLeft} onChange={(e) => setEdit({ ...edit, gambleCountLeft: e.target.value })} style={inputStyle} /></label>
                <label>ATK<input value={edit.atk} onChange={(e) => setEdit({ ...edit, atk: e.target.value })} style={inputStyle} /></label>
                <label>HP<input value={edit.hp} onChange={(e) => setEdit({ ...edit, hp: e.target.value })} style={inputStyle} /></label>
                <label>DEF<input value={edit.def} onChange={(e) => setEdit({ ...edit, def: e.target.value })} style={inputStyle} /></label>
                <label>DEX<input value={edit.agi} onChange={(e) => setEdit({ ...edit, agi: e.target.value })} style={inputStyle} /></label>
              </div>
            </div>
          </div>

          {selectedCharacter ? (
            <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
              <div style={{ fontWeight: 800 }}>카드 전신 이미지 표시 위치</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <label>좌우<input type="range" min="-1200" max="1200" step="1" value={edit.frameX} onChange={(e) => setEdit({ ...edit, frameX: Number(e.target.value) })} style={{ width: "100%" }} /><div style={{ fontSize: 12, color: "#5d7a95" }}>{Number(edit.frameX).toFixed(0)}</div></label>
                <label>상하<input type="range" min="-1200" max="1200" step="1" value={edit.frameY} onChange={(e) => setEdit({ ...edit, frameY: Number(e.target.value) })} style={{ width: "100%" }} /><div style={{ fontSize: 12, color: "#5d7a95" }}>{Number(edit.frameY).toFixed(0)}</div></label>
                <label>확대<input type="range" min="0.4" max="11.5" step="0.01" value={edit.frameScale} onChange={(e) => setEdit({ ...edit, frameScale: Number(e.target.value) })} style={{ width: "100%" }} /><div style={{ fontSize: 12, color: "#5d7a95" }}>{Number(edit.frameScale).toFixed(2)}</div></label>
              </div>
              <PreviewCharacterCard name={edit.name || selectedCharacter?.name || selectedCharacterLite?.name} rank={edit.rank || selectedCharacter?.rank || selectedCharacterLite?.rank} image={edit.mainImage || selectedCharacter?.mainImage || selectedCharacterLite?.image || ""} oneLine={edit.oneLine || selectedCharacter?.oneLine || selectedCharacterLite?.oneLine} frame={editFrame} onFrameChange={(next) => setEdit((prev) => ({ ...prev, frameX: next.x, frameY: next.y, frameScale: next.scale }))} />
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="home-primary-button" onClick={saveSelectedCharacter}>저장</button>
            <button type="button" className="ghost-button" onClick={deleteSelectedCharacter} disabled={!selectedCharacter}>캐릭터 삭제</button>
          </div>
        </div>
      </div>
      {message ? <div style={{ position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 9999, padding: "12px 18px", borderRadius: 999, background: "rgba(15,23,42,0.92)", color: "white", boxShadow: "0 12px 30px rgba(0,0,0,0.28)" }}>{message}</div> : null}
    </div>
  );
}
