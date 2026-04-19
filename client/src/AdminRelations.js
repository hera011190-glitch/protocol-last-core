import React, { useEffect, useMemo, useState } from "react";

export default function AdminRelations({ goBack }) {
  const [requests, setRequests] = useState([]);
  const [relations, setRelations] = useState([]);
  const [message, setMessage] = useState("");

  const loadAll = async () => {
    try {
      const [requestRes, relationRes] = await Promise.all([
        fetch("http://localhost:3001/admin/relationRequests"),
        fetch("http://localhost:3001/admin/relations"),
      ]);
      const requestData = await requestRes.json();
      const relationData = await relationRes.json();
      setRequests(Array.isArray(requestData) ? requestData : []);
      setRelations(Array.isArray(relationData) ? relationData : []);
    } catch (err) {
      console.error(err);
      setRequests([]);
      setRelations([]);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);
  const approvedRelations = useMemo(() => (Array.isArray(relations) ? relations : []), [relations]);

  const act = async (requestId, decision) => {
    try {
      const res = await fetch("http://localhost:3001/admin/relationRequests/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, decision }),
      });
      const data = await res.json();
      if (!data.success) {
        setMessage(data.message || "처리에 실패했습니다.");
        return;
      }
      setMessage(decision === "approved" ? "관계 승인 완료" : "관계 거절 완료");
      loadAll();
    } catch (err) {
      console.error(err);
      setMessage("관계 처리 중 오류가 발생했습니다.");
    }
  };

  const removeRelation = async (item) => {
    const ok = window.confirm(`${item.characterName || item.character} ↔ ${item.otherCharacterName || item.otherCharacter} 관계를 삭제하시겠습니까?`);
    if (!ok) return;
    try {
      const res = await fetch("http://localhost:3001/admin/relations/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: item.characterId, otherCharacterId: item.otherCharacterId }),
      });
      const data = await res.json();
      if (!data.success) {
        setMessage(data.message || "관계 삭제에 실패했습니다.");
        return;
      }
      setMessage("관계를 삭제했습니다.");
      loadAll();
    } catch (err) {
      console.error(err);
      setMessage("관계 삭제 중 오류가 발생했습니다.");
    }
  };

  return (
    <div style={{ padding: "26px", color: "#1e2f3d", display: "grid", gap: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
        <div>
          <div className="section-eyebrow" style={{ color: "#5c6d7e" }}>RELATION ADMIN</div>
          <h2 style={{ marginTop: "10px", marginBottom: "8px", color: "#243746" }}>관계 승인 관리</h2>
          <div style={{ color: "#334b5f" }}>
            관계 신청은 승인 또는 거절할 수 있으며, 이미 등록된 관계는 운영에서만 삭제할 수 있습니다.
          </div>
        </div>
        <button type="button" className="ghost-button" onClick={goBack}>뒤로가기</button>
      </div>

      {message ? (
        <div style={{ padding: "12px 14px", borderRadius: "14px", background: "rgba(125,211,252,0.12)", border: "1px solid rgba(125,211,252,0.2)", color: "#2b4255" }}>
          {message}
        </div>
      ) : null}

      <section style={{ display: "grid", gap: 14 }}>
        <div>
          <div className="section-eyebrow">PENDING</div>
          <h3 style={{ marginTop: 10, marginBottom: 8 }}>대기 중인 관계 신청</h3>
        </div>
        {requests.length > 0 ? requests.map((item) => (
          <div key={item.id} style={cardStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "20px", fontWeight: 900, marginBottom: "8px" }}>
                {item.fromCharacter} → {item.toCharacter}
              </div>
              <div style={{ color: "#334b5f", marginBottom: "8px" }}>
                관계명: {item.relationName || "-"} / 상태: {item.status}
              </div>
              <div style={{ color: "#2b4255", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                {item.description || "설명 없음"}
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button type="button" className="home-primary-button" onClick={() => act(item.id, "approved")}>
                승인
              </button>
              <button type="button" className="ghost-button" onClick={() => act(item.id, "rejected")}>
                거절
              </button>
            </div>
          </div>
        )) : <div style={{ color: "#41586b" }}>현재 대기 중인 관계 신청이 없습니다.</div>}
      </section>

      <section style={{ display: "grid", gap: 14 }}>
        <div>
          <div className="section-eyebrow">ACTIVE RELATIONS</div>
          <h3 style={{ marginTop: 10, marginBottom: 8 }}>등록된 관계</h3>
        </div>
        {approvedRelations.length > 0 ? approvedRelations.map((item, index) => (
          <div key={`${item.characterId}-${item.otherCharacterId}-${index}`} style={cardStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "20px", fontWeight: 900, marginBottom: "8px" }}>
                {item.characterName || item.character} ↔ {item.otherCharacterName || item.otherCharacter}
              </div>
              <div style={{ color: "#334b5f", marginBottom: "8px" }}>
                관계명: {item.relationName || item.title || "-"}
              </div>
              <div style={{ color: "#2b4255", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
                {item.description || "설명 없음"}
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button type="button" className="ghost-button" onClick={() => removeRelation(item)}>
                관계 삭제
              </button>
            </div>
          </div>
        )) : <div style={{ color: "#41586b" }}>현재 등록된 관계가 없습니다.</div>}
      </section>
    </div>
  );
}

const cardStyle = {
  padding: "18px",
  borderRadius: "22px",
  background: "rgba(255,255,255,0.78)",
  border: "1px solid rgba(98,176,220,0.16)",
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "center",
};
