import ImageDropInput from "./ImageDropInput";
import React, { useEffect, useMemo, useState } from "react";


async function safeJsonResponse(res) {
  const raw = await res.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(raw && raw.trim().startsWith("<!DOCTYPE") ? "서버가 JSON 대신 HTML을 돌려줬어. 서버 라우트를 확인해줘." : "응답을 읽을 수 없어.");
  }
}

const EMPTY = {
  name: "",
  price: "",
  sellPrice: "",
  description: "",
  image: "",
  useType: "none",
  useValue: "",
  statTarget: "hp",
  skillName: "",
  skillKey: "",
  skillEffect: "damage",
  skillPower: "8",
  cooldownTurns: "0",
  hidden: true,
};

function makeSkillKey(name = "") {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_가-힣-]/g, "") || `skill_${Date.now()}`;
}

function card(extra = {}) {
  return {
    padding: 18,
    borderRadius: 22,
    background: "rgba(255,255,255,0.88)",
    border: "1px solid rgba(98,176,220,0.18)",
    boxShadow: "0 20px 36px rgba(73,132,170,0.12)",
    ...extra,
  };
}

export default function AdminShopManager({ goBack }) {
  const [items, setItems] = useState([]);
  const [shopConfig, setShopConfig] = useState({ blackjackDealerImage: "", ebeasts: [] });
  const [form, setForm] = useState(EMPTY);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [filterMode, setFilterMode] = useState("all");

  const load = async () => {
    try {
      const [itemRes, configRes] = await Promise.all([
        fetch(`http://localhost:3001/shopItems?t=${Date.now()}`),
        fetch(`http://localhost:3001/shopConfig?t=${Date.now()}`),
      ]);
      const data = await safeJsonResponse(itemRes);
      const config = await safeJsonResponse(configRes);
      setItems(Array.isArray(data) ? data : []);
      setShopConfig(config && typeof config === "object" ? config : { blackjackDealerImage: "", ebeasts: [] });
    } catch (error) {
      setItems([]);
      setShopConfig({ blackjackDealerImage: "", ebeasts: [] });
      setMessage(error?.message || "상점 설정을 불러오지 못했어.");
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(""), 1800);
    return () => clearTimeout(timer);
  }, [message]);

  const selected = useMemo(
    () => items.find((item) => String(item.id) === String(selectedId)),
    [items, selectedId]
  );

  const filteredItems = useMemo(() => {
    if (filterMode === "visible") return items.filter((item) => !item.hidden);
    if (filterMode === "hidden") return items.filter((item) => item.hidden);
    return items;
  }, [items, filterMode]);


  useEffect(() => {
    if (!selected) {
      setForm(EMPTY);
      return;
    }
    setForm({
      name: selected.name || "",
      price: selected.price ?? "",
      sellPrice: selected.sellPrice ?? "",
      description: selected.description || "",
      image: selected.image || "",
      useType: selected.useType || "none",
      useValue: selected.useValue ?? "",
      statTarget: selected.statTarget || selected.targetStat || "hp",
      skillName: selected.skillName || "",
      skillKey: selected.skillKey || "",
      skillEffect: selected.skillEffect || "damage",
      skillPower: selected.skillPower ?? selected.useValue ?? "8",
      cooldownTurns: selected.cooldownTurns ?? "0",
      hidden: selected.hidden !== false,
    });
  }, [selected]);

  const save = async () => {
    if (!String(form.name || "").trim()) return setMessage("아이템 이름을 입력해줘.");
    const payload = {
      ...(selected || {}),
      ...form,
      price: Number(form.price || 0),
      sellPrice: Number(form.sellPrice || 0),
      useValue: form.useType === "skill" ? String(form.skillKey || makeSkillKey(form.skillName || form.name) || form.useValue || "").trim() : Number(form.useValue || 0),
      skillEffect: form.useType === "skill" ? form.skillEffect : "damage",
      skillPower: form.useType === "skill" ? Number(form.skillPower || 0) : Number(form.useValue || 0),
      cooldownTurns: form.useType === "skill" ? Number(form.cooldownTurns || 0) : 0,
      hidden: form.hidden !== false,
      image: form.image || "",
    };
    const res = await fetch("http://localhost:3001/shopItems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) return setMessage(data.message || "저장 실패");
    setMessage("저장되었습니다.");
    setSelectedId("");
    setForm(EMPTY);
    load();
  };

  const remove = async (id) => {
    await fetch(`http://localhost:3001/shopItems/${id}`, { method: "DELETE" });
    setMessage("삭제되었습니다.");
    setSelectedId("");
    setForm(EMPTY);
    load();
  };


  const saveShopConfig = async (nextConfig) => {
    const res = await fetch("http://localhost:3001/shopConfig", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextConfig),
    });
    const data = await res.json();
    if (!data.success) return setMessage(data.message || "상점 설정 저장 실패");
    setShopConfig(data.shopConfig || nextConfig);
    setMessage("상점 설정을 저장했어.");
  };

  const toggleHidden = async (item) => {
    const res = await fetch("http://localhost:3001/shopItems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item, hidden: !item.hidden }),
    });
    const data = await res.json();
    if (!data.success) return setMessage(data.message || "상태 변경 실패");
    setMessage(item.hidden ? "상점에 등록했어." : "상점에서 숨겼어.");
    load();
  };

  return (
    <div style={{ padding: 26, color: "#16324a", background: "linear-gradient(180deg, #f7fbff, #eef7ff)", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 18 }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>상점 관리</h2>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className={`ghost-button ${filterMode === "all" ? "is-tab-active" : ""}`} onClick={() => setFilterMode("all")}>전체</button>
          <button type="button" className={`ghost-button ${filterMode === "visible" ? "is-tab-active" : ""}`} onClick={() => setFilterMode("visible")}>표시</button>
          <button type="button" className={`ghost-button ${filterMode === "hidden" ? "is-tab-active" : ""}`} onClick={() => setFilterMode("hidden")}>숨김</button>
          <button type="button" className="ghost-button" onClick={goBack}>뒤로가기</button>
        </div>
      </div>

      {message ? (
        <div style={{ ...card({ marginBottom: 14, padding: "12px 14px", background: "rgba(125,211,252,0.18)" }) }}>
          {message}
        </div>
      ) : null}

      <div style={{ ...card({ marginBottom: 16, display: "grid", gap: 14 }) }}>
        <h3 style={{ marginTop: 0, marginBottom: 0 }}>도박장 화면 설정</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 800, color: "#16324a" }}>블랙잭 딜러 SD</div>
            <ImageDropInput label="블랙잭 딜러 SD" value={shopConfig?.blackjackDealerImage || ""} onChange={(value) => saveShopConfig({ ...shopConfig, blackjackDealerImage: value })} previewHeight={160} previewFit="cover" compact />
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 800, color: "#16324a" }}>E-Beast 이미지</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {(["E-01", "E-02", "E-03", "E-04", "E-05"]).map((key) => {
                const found = (shopConfig?.ebeasts || []).find((item) => String(item?.key || "") === key) || { key, image: "" };
                return (
                  <ImageDropInput
                    key={key}
                    label={`${key} 이미지`}
                    value={found.image || ""}
                    onChange={(value) => saveShopConfig({
                      ...shopConfig,
                      ebeasts: (["E-01", "E-02", "E-03", "E-04", "E-05"]).map((beastKey) => beastKey === key ? { key: beastKey, image: value } : ((shopConfig?.ebeasts || []).find((item) => String(item?.key || "") === beastKey) || { key: beastKey, image: "" })),
                    })}
                    previewHeight={110}
                    previewFit="cover"
                    compact
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 18 }}>
        <div style={{ display: "grid", gap: 12 }}>
          {filteredItems.map((item) => (
            <div key={item.id} style={card()}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "start" }}>
                  {item.image ? <div style={{ width: 64, height: 64, borderRadius: 16, overflow: "hidden", background: "rgba(240,248,255,0.9)", flexShrink: 0 }}><img src={item.image} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div> : null}
                  <div>
                  <div style={{ fontWeight: 900, fontSize: 18 }}>{item.name}</div>
                  <div style={{ color: "#5d7a95", marginTop: 4 }}>
                    가격 {Number(item.price || 0)} / 판매 {Number(item.sellPrice || 0)}
                  </div>
                  <div style={{ color: "#5d7a95", marginTop: 4 }}>
                    {item.hidden ? "숨김" : "표시"} · {itemTypeLabel(item)}
                  </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button type="button" className="ghost-button" onClick={() => setSelectedId(item.id)}>수정</button>
                  <button type="button" className="ghost-button" onClick={() => toggleHidden(item)}>{item.hidden ? "등록" : "숨김"}</button>
                  <button type="button" className="ghost-button" onClick={() => remove(item.id)}>삭제</button>
                </div>
              </div>
            </div>
          ))}
          {filteredItems.length === 0 ? <div style={{ ...card(), color: "#5d7a95" }}>표시할 아이템이 없어.</div> : null}
        </div>

        <div style={card({ display: "grid", gap: 10, alignContent: "start" })}>
          <h3 style={{ marginTop: 0 }}>{selected ? "아이템 수정" : "아이템 추가"}</h3>

          <label>아이템 이름<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>가격<input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} style={inputStyle} /></label>
            <label>판매 가격<input type="number" value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} style={inputStyle} /></label>
          </div>
          <label>설명<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...inputStyle, minHeight: 120 }} /></label>
          <ImageDropInput label="아이템 이미지" value={form.image} onChange={(value) => setForm({ ...form, image: value })} previewHeight={110} previewFit="cover" compact />

          <label>
            사용 타입
            <select value={form.useType} onChange={(e) => setForm({ ...form, useType: e.target.value })} style={inputStyle}>
              <option value="none">사용 불가</option>
              <option value="heal">HP 회복</option>
              <option value="statBoost">스텟 추가</option>
              <option value="statPoint">스탯 포인트</option>
              <option value="corrosionHeal">침식 진행도 감소</option>
              <option value="skill">스킬</option>
            </select>
          </label>

          {form.useType === "heal" ? (
            <label>회복 수치<input type="number" value={form.useValue} onChange={(e) => setForm({ ...form, useValue: e.target.value })} style={inputStyle} /></label>
          ) : null}

          {form.useType === "statBoost" ? (
            <>
              <label>
                추가 스텟
                <select value={form.statTarget} onChange={(e) => setForm({ ...form, statTarget: e.target.value })} style={inputStyle}>
                  <option value="hp">HP</option>
                  <option value="def">DEF</option>
                  <option value="atk">ATK</option>
                  <option value="agi">AGI</option>
                </select>
              </label>
              <label>증가 수치<input type="number" value={form.useValue} onChange={(e) => setForm({ ...form, useValue: e.target.value })} style={inputStyle} /></label>
            </>
          ) : null}

          {form.useType === "statPoint" ? (
            <label>지급 포인트<input type="number" value={form.useValue} onChange={(e) => setForm({ ...form, useValue: e.target.value })} style={inputStyle} /></label>
          ) : null}

          {form.useType === "corrosionHeal" ? (
            <label>감소 수치<input type="number" value={form.useValue} onChange={(e) => setForm({ ...form, useValue: e.target.value })} style={inputStyle} /></label>
          ) : null}

          {form.useType === "skill" ? (
            <>
              <label>스킬 이름<input value={form.skillName} onChange={(e) => setForm({ ...form, skillName: e.target.value })} style={inputStyle} /></label>
              <div style={{ color: "#5d7a95", fontSize: 13, lineHeight: 1.7, marginTop: -4 }}>
                스킬 키는 따로 적지 않아도 돼. 스킬 이름을 기준으로 내부값이 자동 생성돼.
              </div>
              <label>효과 종류<select value={form.skillEffect} onChange={(e) => setForm({ ...form, skillEffect: e.target.value })} style={inputStyle}><option value="damage">공격력</option><option value="heal">치유량</option><option value="buff">버프</option><option value="shield">방어막</option><option value="debuff">디버프</option></select></label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label>효과 값<input type="number" value={form.skillPower} onChange={(e) => setForm({ ...form, skillPower: e.target.value })} style={inputStyle} /></label>
                <label>쿨타임(턴)<input type="number" value={form.cooldownTurns} onChange={(e) => setForm({ ...form, cooldownTurns: e.target.value })} style={inputStyle} /></label>
              </div>
              <div style={{ color: "#5d7a95", fontSize: 13, lineHeight: 1.7, marginTop: -4 }}>
                효과 값은 공격력/치유량/버프 크기처럼 실제 전투에서 쓰이는 수치야. 쿨타임 1턴은 유저 턴 + 적 턴 한 번이 지난 뒤 다시 사용할 수 있어.
              </div>
            </>
          ) : null}

          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="checkbox" checked={form.hidden} onChange={(e) => setForm({ ...form, hidden: e.target.checked })} />
            상점에 보이지 않기
          </label>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            {selected ? <button type="button" className="ghost-button" onClick={() => { setSelectedId(""); setForm(EMPTY); }}>새로 만들기</button> : null}
            <button type="button" className="home-primary-button" onClick={save}>저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function itemTypeLabel(item) {
  const type = item?.useType || "none";
  if (type === "heal") return `HP 회복 ${Number(item.useValue || 0)}`;
  if (type === "statBoost") return `${String(item.statTarget || "hp").toUpperCase()} +${Number(item.useValue || 0)}`;
  if (type === "statPoint") return `스탯 포인트 +${Number(item.useValue || 0)}`;
  if (type === "corrosionHeal") return `침식 진행도 -${Number(item.useValue || 0)}`;
  if (type === "skill") return `스킬 ${item.skillName || item.name || item.useValue || ""} · ${item.skillEffect || "damage"} · 쿨 ${Number(item.cooldownTurns || 0)}턴`;
  return "사용 불가";
}

const inputStyle = {
  width: "100%",
  marginTop: 6,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(98,176,220,0.18)",
  background: "rgba(255,255,255,0.96)",
  color: "#16324a",
  boxSizing: "border-box",
};
