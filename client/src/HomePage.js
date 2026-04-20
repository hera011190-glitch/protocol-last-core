import { useMemo, useState } from "react";
import DesignPageFrame from "./DesignPageFrame";

function mapScheduleItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    date: item?.date || item?.day || "-",
    title: item?.title || "제목 없음",
    desc: item?.desc || item?.time || item?.note || "",
  }));
}

function cardStyle(minHeight) {
  return {
    minHeight,
    padding: "22px",
    borderRadius: "26px",
    background: "rgba(255,255,255,0.78)",
    border: "1px solid rgba(98,176,220,0.18)",
    display: "grid",
    gap: 12,
    alignContent: "start",
  };
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function emptyListItem() {
  return { date: "", title: "", desc: "" };
}

function EditorModal({ type, draft, setDraft, onSave, onClose }) {
  if (!draft) return null;

  const setField = (key, value) => setDraft((prev) => ({ ...(prev || {}), [key]: value }));
  const items = Array.isArray(draft.items) ? draft.items : [];

  const updateItem = (index, key, value) => {
    const nextItems = items.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [key]: value } : item
    ));
    setField("items", nextItems);
  };

  const addItem = () => setField("items", [...items, emptyListItem()]);
  const removeItem = (index) => setField("items", items.filter((_, itemIndex) => itemIndex !== index));
  const itemDateLabel = type === "schedule" ? "날짜 / 요일" : "표시 문구";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,6,23,0.62)",
        display: "grid",
        placeItems: "center",
        zIndex: 1400,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 920,
          maxWidth: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          borderRadius: 28,
          background: "rgba(255,255,255,0.97)",
          padding: 22,
          boxShadow: "0 24px 56px rgba(15,23,42,0.18)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ margin: 0 }}>홈 편집</h3>
          <button type="button" className="ghost-button" onClick={onClose}>닫기</button>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <label style={labelStyle}>
            제목
            <input
              value={draft.title || ""}
              onChange={(e) => setField("title", e.target.value)}
              style={inputStyle}
            />
          </label>

          {type === "text" ? (
            <div style={{ display: "grid", gap: 14 }}>
              <label style={labelStyle}>
                내용
                <textarea
                  value={draft.body || ""}
                  onChange={(e) => setField("body", e.target.value)}
                  style={{ ...inputStyle, minHeight: 220, resize: "vertical" }}
                />
              </label>

              <label style={labelStyle}>
                구글 문서 링크
                <input
                  value={draft.googleDocUrl || draft.docUrl || draft.url || draft.link || ""}
                  onChange={(e) => setField("googleDocUrl", e.target.value)}
                  placeholder="https://docs.google.com/..."
                  style={inputStyle}
                />
              </label>

              <label style={labelStyle}>
                버튼 문구
                <input
                  value={draft.buttonText || ""}
                  onChange={(e) => setField("buttonText", e.target.value)}
                  placeholder="열기"
                  style={inputStyle}
                />
              </label>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {items.map((item, index) => (
                <div
                  key={`editor-item-${index}`}
                  style={{
                    borderRadius: 20,
                    border: "1px solid rgba(98,176,220,0.18)",
                    background: "rgba(240,248,255,0.82)",
                    padding: 16,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 10 }}>
                    <label style={labelStyle}>
                      {itemDateLabel}
                      <input
                        value={item.date || ""}
                        onChange={(e) => updateItem(index, "date", e.target.value)}
                        style={inputStyle}
                      />
                    </label>
                    <label style={labelStyle}>
                      제목
                      <input
                        value={item.title || ""}
                        onChange={(e) => updateItem(index, "title", e.target.value)}
                        style={inputStyle}
                      />
                    </label>
                    <div style={{ display: "grid", alignItems: "end" }}>
                      <button type="button" className="ghost-button" onClick={() => removeItem(index)}>삭제</button>
                    </div>
                  </div>
                  <label style={labelStyle}>
                    내용
                    <textarea
                      value={item.desc || ""}
                      onChange={(e) => updateItem(index, "desc", e.target.value)}
                      style={{ ...inputStyle, minHeight: 100, resize: "vertical" }}
                    />
                  </label>
                </div>
              ))}

              <button type="button" className="ghost-button" onClick={addItem} style={{ justifySelf: "start" }}>
                항목 추가
              </button>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <button type="button" className="home-primary-button" onClick={onSave}>저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NoticeCards({ title, items = [], onEdit, editable }) {
  return (
    <div style={cardStyle(320)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {editable ? <button type="button" className="ghost-button" onClick={onEdit}>수정</button> : null}
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {items.length > 0 ? items.map((item, index) => (
          <div
            key={`${item.title}-${index}`}
            style={{
              padding: "14px 16px",
              borderRadius: 18,
              background: "rgba(255,255,255,0.76)",
              border: "1px solid rgba(98,176,220,0.18)",
            }}
          >
            <div style={{ fontSize: 12, color: "#0b79d0", fontWeight: 800, marginBottom: 6 }}>{item.date || "공지"}</div>
            <div style={{ fontWeight: 800 }}>{item.title}</div>
            {item.desc ? <div style={{ color: "#4f7390", marginTop: 6, whiteSpace: "pre-wrap" }}>{item.desc}</div> : null}
          </div>
        )) : <div style={{ color: "#4f7390" }}>등록된 항목이 없습니다.</div>}
      </div>
    </div>
  );
}

function TextPanel({ title, body, onEdit, editable, minHeight = 220 }) {
  return (
    <div style={cardStyle(minHeight)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {editable ? <button type="button" className="ghost-button" onClick={onEdit}>수정</button> : null}
      </div>
      <div style={{ color: "#4f7390", whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{body}</div>
    </div>
  );
}

function openGoogleDoc(url) {
  const target = String(url || "").trim();
  if (!target) {
    alert("구글 문서 링크가 아직 등록되지 않았습니다.");
    return;
  }
  window.open(target, "_blank", "noopener,noreferrer");
}

function DocButtonsSection({ notice, world, editable, onEditNotice, onEditWorld }) {
  const itemStyle = {
    borderRadius: 18,
    background: "rgba(255,255,255,0.84)",
    border: "1px solid rgba(98,176,220,0.18)",
    padding: 14,
    display: "grid",
    gap: 10,
  };

  const smallButtonStyle = {
    width: "100%",
    border: "none",
    borderRadius: 14,
    padding: "12px 14px",
    background: "linear-gradient(135deg, rgba(127,219,255,0.95), rgba(29,157,255,0.95))",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
    font: "inherit",
  };

  const renderItem = (item, fallbackTitle, onEdit) => (
    <div style={itemStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 900, color: "#16324a" }}>{item?.title || fallbackTitle}</div>
        {editable ? <button type="button" className="ghost-button" onClick={onEdit}>수정</button> : null}
      </div>
      <button
        type="button"
        style={smallButtonStyle}
        onClick={() => openGoogleDoc(item?.googleDocUrl || item?.docUrl || item?.url || item?.link || "")}
      >
        {item?.buttonText || `${item?.title || fallbackTitle} 열기`}
      </button>
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {renderItem(notice, "공지사항", onEditNotice)}
      {renderItem(world, "세계관", onEditWorld)}
    </div>
  );
}

function SchedulePanel({ title, items, onEdit, editable, minHeight }) {
  const mapped = mapScheduleItems(items);
  return (
    <div style={cardStyle(minHeight)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {editable ? <button type="button" className="ghost-button" onClick={onEdit}>수정</button> : null}
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {mapped.length > 0 ? mapped.map((item, index) => (
          <div
            key={`${item.title}-${index}`}
            style={{
              padding: "14px 16px",
              borderRadius: 18,
              background: "rgba(255,255,255,0.72)",
              border: "1px solid rgba(98,176,220,0.18)",
              display: "grid",
              gridTemplateColumns: "120px 1fr",
              gap: 14,
              alignItems: "center",
            }}
          >
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 14,
                background: "rgba(85,199,255,0.12)",
                color: "#0b79d0",
                fontWeight: 800,
                textAlign: "center",
              }}
            >
              {item.date}
            </div>
            <div>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>{item.title}</div>
              {item.desc ? <div style={{ color: "#4f7390", fontSize: 14, whiteSpace: "pre-wrap" }}>{item.desc}</div> : null}
            </div>
          </div>
        )) : <div style={{ color: "#4f7390" }}>등록된 일정이 없습니다.</div>}
      </div>
    </div>
  );
}

function CurrentCharacter({ activeCharacter, openMy, height }) {
  return (
    <div style={cardStyle(height)}>
      <h3 style={{ margin: 0 }}>현재 캐릭터</h3>
      {activeCharacter ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: 16, alignItems: "center" }}>
            <div style={{ width: 92, height: 92, borderRadius: 24, overflow: "hidden", background: "rgba(255,255,255,0.72)" }}>
              {activeCharacter?.image ? (
                <img
                  src={activeCharacter.image}
                  alt={activeCharacter.name}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : null}
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 900 }}>{activeCharacter?.name || "-"}</div>
              <div style={{ color: "#4f7390", marginTop: 4 }}>
                {activeCharacter?.rank || "대원"} · Lv. {activeCharacter?.level || 1}
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ height: 12, borderRadius: 999, background: "rgba(255,255,255,0.66)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, Number(activeCharacter?.corrosion || 0)))}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #fda4af, #ef4444)",
                }}
              />
            </div>
          </div>
        </>
      ) : <div style={{ color: "#4f7390" }}>선택된 캐릭터가 없습니다.</div>}
      <button type="button" className="home-primary-button" onClick={openMy}>MY 열기</button>
    </div>
  );
}

export default function HomePage({ user, activeCharacter, openMy, goCharacters, goInvestigations, goShop, goSD, theme, design }) {
  const handlers = useMemo(
    () => ({
      openMy,
      goCharacters,
      goInvestigations,
      goShop,
      goSD,
      goHome: () => window.scrollTo({ top: 0, behavior: "smooth" }),
    }),
    [openMy, goCharacters, goInvestigations, goShop, goSD]
  );
  const content = design?.siteContent?.home || {};
  const layout = design?.siteLayout?.home || {};
  const editable = !!user?.isAdmin;

  const notice = content.noticeCard || content.leftCard1 || { title: "공지사항", body: "" };
  const world = content.worldCard || content.leftCard2 || { title: "세계관", body: "" };
  const noticeUrl = notice?.googleDocUrl || notice?.docUrl || notice?.url || notice?.link || "";
  const worldUrl = world?.googleDocUrl || world?.docUrl || world?.url || world?.link || "";
  const homeNotice = content.homepageNotice || { title: "홈페이지 공지", items: [] };
  const schedule = content.schedule || { title: "일정표", items: [] };

  const [editorKey, setEditorKey] = useState("");
  const [draft, setDraft] = useState(null);

  const openEditor = (key) => {
    const source = key === "notice" ? notice : key === "world" ? world : key === "homeNotice" ? homeNotice : schedule;
    const normalized = cloneValue(source);
    if (key === "homeNotice" || key === "schedule") {
      normalized.items = mapScheduleItems(normalized.items);
    }
    setEditorKey(key);
    setDraft(normalized);
  };

  const saveEditor = async () => {
    try {
      const nextDesign = cloneValue(design || {});
      nextDesign.siteContent = nextDesign.siteContent || {};
      nextDesign.siteContent.home = nextDesign.siteContent.home || {};

      if (editorKey === "notice") nextDesign.siteContent.home.noticeCard = { ...(notice || {}), ...(draft || {}) };
      if (editorKey === "world") nextDesign.siteContent.home.worldCard = { ...(world || {}), ...(draft || {}) };
      if (editorKey === "homeNotice") {
        nextDesign.siteContent.home.homepageNotice = {
          ...(homeNotice || {}),
          ...(draft || {}),
          items: (draft?.items || []).filter((item) => item.title || item.desc || item.date),
        };
      }
      if (editorKey === "schedule") {
        nextDesign.siteContent.home.schedule = {
          ...(schedule || {}),
          ...(draft || {}),
          items: (draft?.items || []).filter((item) => item.title || item.desc || item.date),
        };
      }

      const res = await fetch("http://localhost:3001/designConfig", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextDesign),
      });
      const data = await res.json();
      if (!data?.success) {
        alert("저장 실패");
        return;
      }
      window.dispatchEvent(new CustomEvent("plc-design-updated"));
      setEditorKey("");
      setDraft(null);
      alert("저장되었습니다.");
    } catch {
      alert("저장 실패");
    }
  };

  const homeNoticeHeight = Number(layout?.homepageNotice?.h) || 320;
  const scheduleHeight = Number(layout?.schedule?.h) || 720;
  const characterHeight = Number(layout?.characterBox?.h) || 720;

  return (
    <DesignPageFrame design={design} pageKey="home" handlers={handlers} theme={theme} minHeight="100vh" contentStyle={{ padding: 0 }}>
      <div style={{ padding: "26px", color: theme?.textMain || "#13324b" }}>
        <div style={{ display: "grid", gridTemplateColumns: "320px minmax(0, 1fr) 320px", gap: "22px", alignItems: "start" }}>
          <div style={{ display: "grid", gap: "22px" }}>
            <DocButtonsSection
              notice={{ ...(notice || {}), googleDocUrl: noticeUrl }}
              world={{ ...(world || {}), googleDocUrl: worldUrl }}
              editable={editable}
              onEditNotice={() => openEditor("notice")}
              onEditWorld={() => openEditor("world")}
            />
            <NoticeCards
              title={homeNotice?.title || "홈페이지 공지"}
              items={homeNotice?.items || []}
              editable={editable}
              onEdit={() => openEditor("homeNotice")}
            />
          </div>

          <SchedulePanel
            title={schedule?.title || "일정표"}
            items={schedule?.items || []}
            minHeight={scheduleHeight}
            editable={editable}
            onEdit={() => openEditor("schedule")}
          />

          <CurrentCharacter activeCharacter={activeCharacter} openMy={openMy} height={characterHeight} />
        </div>
      </div>

      {editorKey ? (
        <EditorModal
          type={editorKey === "notice" || editorKey === "world" ? "text" : editorKey}
          draft={draft}
          setDraft={setDraft}
          onSave={saveEditor}
          onClose={() => {
            setEditorKey("");
            setDraft(null);
          }}
        />
      ) : null}
    </DesignPageFrame>
  );
}

const labelStyle = {
  display: "grid",
  gap: 6,
  color: "#23425a",
  fontWeight: 700,
};

const inputStyle = {
  width: "100%",
  borderRadius: 14,
  border: "1px solid rgba(98,176,220,0.18)",
  background: "rgba(255,255,255,0.98)",
  padding: "12px 14px",
  boxSizing: "border-box",
  color: "#16324a",
  font: "inherit",
};
