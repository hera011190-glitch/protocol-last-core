import { useEffect, useState } from "react";
import { apiFetch } from "./api";

function statusTone(item) {
  const disabled = !(item.effectiveOpened ?? item.opened);
  if (item.ended) return { bg: "rgba(148,163,184,0.14)", color: "#475569", label: "종료" };
  if (!!item.started && !item.ended) return { bg: "rgba(30,64,175,0.14)", color: "#1d4ed8", label: "진행중" };
  if (disabled) return { bg: "rgba(100,116,139,0.14)", color: "#475569", label: "비활성화" };
  return { bg: "rgba(20,83,45,0.12)", color: "#166534", label: "대기중" };
}

function formatOpenAt(value) {
  if (!value) return "미설정";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function card(item) {
  return {
    padding: 18,
    borderRadius: 22,
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(98,176,220,0.18)",
    boxShadow: "0 18px 38px rgba(73,132,170,0.10)",
  };
}

export default function AdminInvestigations({ goBack, goBuilder }) {
  const [items, setItems] = useState([]);

  const load = async () => {
    const res = await apiFetch(`/investigations?includeHidden=1&t=${Date.now()}`);
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [];
    rows.sort((a, b) => {
      const aDisabled = !(a.effectiveOpened ?? a.opened);
      const bDisabled = !(b.effectiveOpened ?? b.opened);
      if (aDisabled !== bDisabled) return aDisabled ? 1 : -1;
      const aStarted = !!a.started && !a.ended;
      const bStarted = !!b.started && !b.ended;
      if (aStarted !== bStarted) return aStarted ? -1 : 1;
      const at = a.openAt ? new Date(a.openAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bt = b.openAt ? new Date(b.openAt).getTime() : Number.MAX_SAFE_INTEGER;
      return at - bt;
    });
    setItems(rows);
  };

  useEffect(() => { load().catch(console.error); }, []);

  const patchToggle = async (item, next) => {
    await apiFetch("/toggleInvestigation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, opened: next.opened ?? item.opened, hidden: next.hidden ?? item.hidden }),
    });
    load();
  };

  const saveSchedule = async (item, values) => {
    await apiFetch("/admin/investigationSchedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ investigationId: item.id, scheduleEnabled: !!values.scheduleEnabled, openAt: values.openAt || "", closeAt: values.closeAt || "" }),
    });
    load();
  };

  return (
    <div style={{ padding: 26, color: "#13324b", display: "grid", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div className="section-eyebrow">ADMIN INVESTIGATIONS</div>
          <h2 style={{ margin: "8px 0 0 0" }}>조사 관리</h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="home-primary-button" onClick={goBuilder}>조사 제작기</button>
          <button type="button" className="ghost-button" onClick={goBack}>뒤로가기</button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        {items.map((item) => {
          const tone = statusTone(item);
          return (
          <div key={item.id} style={card(item)}>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr auto", gap: 16, alignItems: "start" }}>
              <div>
                <div className="section-eyebrow">{item.type === "daily" ? "DAILY" : "GROUP"}</div>
                <h3 style={{ marginTop: 10, marginBottom: 8 }}>{item.title}</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  <div style={{ padding: "6px 10px", borderRadius: 999, background: tone.bg, color: tone.color, fontWeight: 800, fontSize: 12 }}>{tone.label}</div>
                  {item.hidden ? <div style={{ padding: "6px 10px", borderRadius: 999, background: "rgba(127,29,29,0.12)", color: "#991b1b", fontWeight: 800, fontSize: 12 }}>숨김</div> : null}
                  {item.scheduleEnabled ? <div style={{ padding: "6px 10px", borderRadius: 999, background: "rgba(148,163,184,0.12)", color: "#475569", fontWeight: 800, fontSize: 12 }}>예약 사용</div> : null}
                </div>
                <div style={{ color: "#5d7a95", lineHeight: 1.75 }}>
                  참여: {item.participantsCount || 0}명<br />
                  리더: {item.leadersCount || 0}명<br />
                  개방 시간: {formatOpenAt(item.openAt)}<br />
                  종료 시간: {formatOpenAt(item.closeAt)}
                </div>
              </div>
              <ScheduleEditor item={item} onSave={saveSchedule} />
              <div style={{ display: "grid", gap: 8 }}>
                <button type="button" className="ghost-button" onClick={() => goBuilder(item.id)}>수정</button>
                <button type="button" className="ghost-button" onClick={() => patchToggle(item, { opened: !item.opened })}>{item.opened ? "비활성화" : "활성화"}</button>
                {item.type === "group" ? (
                  <button type="button" className="ghost-button" onClick={() => patchToggle(item, { hidden: !item.hidden })}>{item.hidden ? "숨김 해제" : "숨김"}</button>
                ) : null}
              </div>
            </div>
          </div>
        )})}
      </div>
    </div>
  );
}

function ScheduleEditor({ item, onSave }) {
  const [scheduleEnabled, setScheduleEnabled] = useState(!!item.scheduleEnabled);
  const [openAt, setOpenAt] = useState(item.openAt || "");
  const [closeAt, setCloseAt] = useState(item.closeAt || "");

  useEffect(() => {
    setScheduleEnabled(!!item.scheduleEnabled);
    setOpenAt(item.openAt || "");
    setCloseAt(item.closeAt || "");
  }, [item.id, item.scheduleEnabled, item.openAt, item.closeAt]);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}><input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} />오픈 시간 사용</label>
      <input type="datetime-local" value={openAt} onChange={(e) => setOpenAt(e.target.value)} />
      <input type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} />
      <button type="button" className="home-primary-button" onClick={() => onSave(item, { scheduleEnabled, openAt, closeAt })}>시간 저장</button>
    </div>
  );
}
