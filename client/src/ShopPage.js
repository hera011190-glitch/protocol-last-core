import React, { useEffect, useMemo, useState } from "react";
import DesignPageFrame from "./DesignPageFrame";
import { buildApiUrl } from "./api";

const SHOP_CATALOG_CACHE_KEY = "plc-cache-shop-catalog";
const SHOP_CONFIG_CACHE_KEY = "plc-cache-shop-config";

function readCachedJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeCachedJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function box(theme, extra = {}) {
  return {
    padding: "18px",
    borderRadius: "24px",
    background: theme?.panelStrong || "#fff",
    border: `1px solid ${theme?.line || "rgba(98,176,220,0.18)"}`,
    boxShadow: theme?.shadow || "0 18px 38px rgba(73,132,170,0.16)",
    ...extra,
  };
}

function InventoryModal({ items, catalog, onClose, onSell, onUse }) {
  if (!items) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.56)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "24px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "760px", maxWidth: "100%", ...box({}, { background: "#fff" }) }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
          <h3 style={{ margin: 0 }}>보유 아이템</h3>
          <button type="button" className="ghost-button" onClick={onClose}>닫기</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
          {items.length > 0 ? items.map((item, index) => {
            const meta = catalog.find((v) => v.name === item || v.id === item) || {};
            return (
              <div key={`${item}-${index}`} style={box({}, { padding: "14px", borderRadius: "18px", background: "rgba(240,248,255,0.92)" })}>
                <div style={{ fontWeight: 800 }}>{meta.name || item}</div>
                <div style={{ color: "#5d7a95", fontSize: "14px", marginTop: "6px" }}>{meta.description || ""}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px" }}>
                  <span style={{ color: "#5d7a95" }}>{meta.sellPrice ? `판매가 ${meta.sellPrice}` : "판매가 없음"}</span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button type="button" className="ghost-button" onClick={() => onUse(item, meta)}>사용</button>
                    <button type="button" className="ghost-button" onClick={() => onSell(item, meta)}>판매</button>
                  </div>
                </div>
              </div>
            );
          }) : <div style={{ color: "#5d7a95" }}>아이템이 없습니다.</div>}
        </div>
      </div>
    </div>
  );
}

function Modal({ title, children, onClose, width = 860 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.56)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "24px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width, maxWidth: "100%", background: "#fff", borderRadius: 28, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, gap: 12, alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" className="ghost-button" onClick={onClose}>닫기</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BetModal({ title, maxBet, onClose, onConfirm }) {
  const [bet, setBet] = useState(Math.min(10, Math.max(1, maxBet || 1)));
  return (
    <Modal title={`${title} 배팅`} onClose={onClose} width={420}>
      <div style={{ display: "grid", gap: 12 }}>
        <input type="number" min="1" max={Math.max(1, maxBet || 1)} value={bet} onChange={(e) => setBet(Math.max(1, Math.min(Math.max(1, maxBet || 1), Number(e.target.value || 1))))} style={inputStyle} />
        <button type="button" className="home-primary-button" onClick={() => onConfirm(bet)}>확인</button>
      </div>
    </Modal>
  );
}

function GameResult({ result, onConfirm }) {
  if (!result) return null;
  return (
    <div style={{ marginTop: 16, padding: 18, borderRadius: 20, background: "rgba(239,246,255,0.92)", border: "1px solid rgba(147,197,253,0.35)", textAlign: "center" }}>
      <div style={{ fontWeight: 900, fontSize: 20 }}>{result.text}</div>
      <div style={{ color: "#5d7a95", marginTop: 8 }}>{result.delta >= 0 ? `+${result.delta}` : result.delta} 코인</div>
      <button type="button" className="home-primary-button" onClick={onConfirm} style={{ marginTop: 14 }}>확인</button>
    </div>
  );
}


function PlayingCard({ value }) {
  const card = String(value || "?");
  const suit = card.slice(-1);
  const rank = card.slice(0, -1) || card;
  const isRed = suit === "♥" || suit === "♦";
  return (
    <div style={{ width: 52, height: 78, borderRadius: 14, background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(232,244,255,0.98))", border: "1px solid rgba(255,255,255,0.6)", boxShadow: "0 18px 34px rgba(2,6,23,0.28)", color: isRed ? "#dc2626" : "#0f172a", position: "relative", overflow: "hidden", flexShrink: 0 }}><div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at top, rgba(56,189,248,0.18), transparent 42%)" }} /><div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", padding: "7px 7px 5px" }}><div style={{ display: "grid", gap: 2, lineHeight: 1 }}><div style={{ fontSize: 16, fontWeight: 900 }}>{rank}</div><div style={{ fontSize: 13, fontWeight: 900 }}>{suit}</div></div><div style={{ alignSelf: "center", fontSize: 18, fontWeight: 900, opacity: 0.9 }}>{suit}</div><div style={{ display: "grid", gap: 2, lineHeight: 1, justifyItems: "end", transform: "rotate(180deg)" }}><div style={{ fontSize: 16, fontWeight: 900 }}>{rank}</div><div style={{ fontSize: 13, fontWeight: 900 }}>{suit}</div></div></div></div>
  );
}

function OddEvenGame({ bet, onClose, onResolve }) {
  const [pick, setPick] = useState("even");
  const [rolling, setRolling] = useState(false);
  const [face, setFace] = useState(1);
  const [result, setResult] = useState(null);

  const play = () => {
    if (rolling || result) return;
    setRolling(true);
    let count = 0;
    const timer = setInterval(() => {
      setFace(Math.floor(Math.random() * 6) + 1);
      count += 1;
      if (count > 12) {
        clearInterval(timer);
        const finalFace = Math.floor(Math.random() * 6) + 1;
        setFace(finalFace);
        setRolling(false);
        const win = pick === "even" ? finalFace % 2 === 0 : finalFace % 2 === 1;
        const payload = { delta: win ? bet : -bet, text: win ? `주사위 결과 ${finalFace} · 승리` : `주사위 결과 ${finalFace} · 패배` };
        setResult(payload);
        onResolve(payload.delta, payload.text, false);
      }
    }, 120);
  };

  return (
    <Modal title="홀짝" onClose={onClose}>
      <div style={{ textAlign: "center" }}>
        <div style={{ display:"flex", justifyContent:"center", gap:"10px", marginBottom:"12px" }}>
          <button type="button" className={`ghost-button ${pick === "odd" ? "is-tab-active" : ""}`} onClick={() => setPick("odd")} disabled={rolling || !!result}>홀</button>
          <button type="button" className={`ghost-button ${pick === "even" ? "is-tab-active" : ""}`} onClick={() => setPick("even")} disabled={rolling || !!result}>짝</button>
        </div>
        <div style={{ marginBottom:"10px", fontWeight:800 }}>배팅 {bet} 코인</div>
        <button type="button" onClick={play} disabled={rolling || !!result} style={{ width: 180, height: 180, borderRadius: "26px", border: "1px solid rgba(98,176,220,0.18)", fontSize: "72px", background: rolling ? "linear-gradient(135deg, #dbeafe, #bfdbfe)" : "linear-gradient(135deg, #f8fdff, #e0f2fe)" }}>{face}</button>
        <GameResult result={result} onConfirm={onClose} />
      </div>
    </Modal>
  );
}

const CARD_POOL = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const CARD_SUITS = ["♠", "♥", "♦", "♣"];
function cardRank(card) {
  const raw = String(card || "");
  const maybeRank = raw.slice(0, -1);
  return maybeRank || raw;
}
function cardValue(card) {
  const rank = cardRank(card);
  if (rank === "A") return 11;
  if (["J", "Q", "K"].includes(rank)) return 10;
  return Number(rank || 0);
}
function handScore(cards) {
  let total = cards.reduce((sum, card) => sum + cardValue(card), 0);
  let aces = cards.filter((card) => cardRank(card) === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}
function drawCard() {
  const rank = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
  const suit = CARD_SUITS[Math.floor(Math.random() * CARD_SUITS.length)];
  return `${rank}${suit}`;
}

function BlackJackGame({ bet, onClose, onResolve, dealerImage = "", playerImage = "" }) {
  const [dealerCards, setDealerCards] = useState([drawCard(), drawCard()]);
  const [playerCards, setPlayerCards] = useState([drawCard(), drawCard()]);
  const [result, setResult] = useState(null);
  const [revealDealer, setRevealDealer] = useState(false);

  const playerScore = handScore(playerCards);
  const visibleDealerCards = revealDealer ? dealerCards : [dealerCards[0], "?"];
  const dealerScore = revealDealer ? handScore(dealerCards) : cardValue(dealerCards[0]);

  const finishGame = (payload) => {
    if (result) return;
    setResult(payload);
    setRevealDealer(true);
    onResolve(payload.delta, payload.text, false);
  };

  const hit = () => {
    if (result) return;
    const next = [...playerCards, drawCard()];
    setPlayerCards(next);
    const nextScore = handScore(next);
    if (nextScore > 21) finishGame({ delta: -bet, text: `버스트 ${nextScore} · 패배` });
  };

  const stand = () => {
    if (result) return;
    let nextDealer = [...dealerCards];
    while (handScore(nextDealer) < 17) nextDealer.push(drawCard());
    setDealerCards(nextDealer);
    setRevealDealer(true);
    const dealerFinal = handScore(nextDealer);
    const playerFinal = handScore(playerCards);
    if (dealerFinal > 21 || playerFinal > dealerFinal) finishGame({ delta: bet * 2, text: `승리 ${playerFinal} : ${dealerFinal}` });
    else if (playerFinal === dealerFinal) finishGame({ delta: 0, text: `무승부 ${playerFinal} : ${dealerFinal}` });
    else finishGame({ delta: -bet, text: `패배 ${playerFinal} : ${dealerFinal}` });
  };

  return (
    <Modal title="블랙잭" onClose={onClose} width={880}>
      <div style={{ position: "relative", minHeight: 400, borderRadius: 30, overflow: "hidden", background: "radial-gradient(circle at top, rgba(125,211,252,0.16), transparent 34%), linear-gradient(180deg, #061325, #081a31 26%, #071728)" }}>
        <div style={{ position: "absolute", inset: 14, borderRadius: 34, background: "linear-gradient(180deg, rgba(10,25,51,0.98), rgba(6,52,91,0.98) 42%, rgba(7,29,55,0.98))", border: "1px solid rgba(125,211,252,0.28)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06), 0 26px 48px rgba(0,0,0,0.28)" }} />
        <div style={{ position: "absolute", inset: 26, borderRadius: 26, pointerEvents: "none", background: "radial-gradient(circle at 50% 10%, rgba(255,255,255,0.12), transparent 22%), radial-gradient(circle at 50% 100%, rgba(255,255,255,0.04), transparent 28%), linear-gradient(180deg, rgba(56,189,248,0.05), transparent 26%)" }} />
        <div style={{ position: "relative", zIndex: 2, padding: "20px 22px 18px", display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ padding: "10px 16px", borderRadius: 999, background: "rgba(15,23,42,0.72)", color: "#dbeafe", fontWeight: 900, letterSpacing: "0.08em", boxShadow: "0 0 18px rgba(56,189,248,0.18)" }}>BLACKJACK</div>
            <div style={{ padding: "10px 16px", borderRadius: 999, background: "rgba(15,23,42,0.76)", color: "#fef3c7", fontWeight: 800, boxShadow: "0 0 18px rgba(251,191,36,0.16)" }}>베팅 {bet} 코인</div>
          </div>

          <div style={{ display: "grid", gap: 14, minHeight: 308 }}>
            <section style={{ display: "grid", gridTemplateColumns: "110px minmax(0, 1fr)", gap: 16, alignItems: "center", padding: "16px 18px", borderRadius: 24, background: "linear-gradient(180deg, rgba(15,23,42,0.44), rgba(15,23,42,0.62))", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 12px 28px rgba(2,6,23,0.2)" }}>
              <div style={{ width: 96, height: 96, borderRadius: 28, overflow: "hidden", background: "linear-gradient(180deg, #eff6ff, #93c5fd)", border: "3px solid rgba(255,255,255,0.22)", display: "grid", placeItems: "center", color: "#0f172a", fontWeight: 900, boxShadow: "0 12px 26px rgba(0,0,0,0.24)" }}>{dealerImage ? <img src={dealerImage} alt="딜러 SD" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "딜러"}</div>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 17, color: "#e2e8f0", fontWeight: 800 }}>딜러 카드</div>
                  <div style={{ padding: "6px 12px", borderRadius: 999, background: "rgba(15,23,42,0.62)", color: "#bfdbfe", fontWeight: 800 }}>점수 {dealerScore}</div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", minHeight: 88, alignItems: "center" }}>
                  {visibleDealerCards.map((card, idx) => <PlayingCard key={`dealer-${idx}`} value={card} />)}
                </div>
              </div>
            </section>

            <section style={{ display: "grid", placeItems: "center", gap: 10, padding: "6px 0" }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                <button type="button" className="home-primary-button" onClick={hit} disabled={!!result} style={{ minWidth: 140, boxShadow: "0 0 22px rgba(56,189,248,0.18)" }}>카드 받기</button>
                <button type="button" className="ghost-button" onClick={stand} disabled={!!result} style={{ minWidth: 140, boxShadow: "0 0 18px rgba(255,255,255,0.08)" }}>멈추기</button>
              </div>
              <div style={{ color: "#cbd5e1", fontSize: 13 }}>딜러는 17 이상이 될 때까지 카드를 뽑습니다.</div>
            </section>

            <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 96px", gap: 16, alignItems: "center", padding: "16px 18px", borderRadius: 24, background: "linear-gradient(180deg, rgba(15,23,42,0.5), rgba(15,23,42,0.68))", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 14px 30px rgba(2,6,23,0.22)" }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 17, color: "#f8fafc", fontWeight: 900 }}>플레이어 카드</div>
                  <div style={{ padding: "6px 12px", borderRadius: 999, background: "rgba(15,23,42,0.62)", color: "#a7f3d0", fontWeight: 800 }}>점수 {playerScore}</div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", minHeight: 88, alignItems: "center" }}>
                  {playerCards.map((card, idx) => <PlayingCard key={`player-${idx}`} value={card} />)}
                </div>
              </div>
              <div style={{ display: "grid", placeItems: "center", color: "#e2e8f0", fontWeight: 800, textAlign: "center", gap: 6 }}>
                <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#7dd3fc" }}>PLAYER</div>
                <div style={{ width: 64, height: 64, borderRadius: 999, overflow: "hidden", background: "linear-gradient(135deg, rgba(59,130,246,0.3), rgba(14,165,233,0.18))", boxShadow: "0 0 22px rgba(56,189,248,0.22)" }}>
                  {playerImage ? <img src={playerImage} alt="플레이어" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
      <GameResult result={result} onConfirm={onClose} />
    </Modal>
  );
}

const E_BEASTS = [
  { key: "E-01", color: "#38bdf8" },
  { key: "E-02", color: "#a78bfa" },
  { key: "E-03", color: "#fb7185" },
  { key: "E-04", color: "#f59e0b" },
  { key: "E-05", color: "#34d399" },
];

function EBeastGame({ bet, onClose, onResolve, beastImages = [] }) {
  const [selected, setSelected] = useState("");
  const [positions, setPositions] = useState([0, 0, 0, 0, 0]);
  const [logs, setLogs] = useState(["E-Beats를 선택해주세요."]);
  const [racing, setRacing] = useState(false);
  const [result, setResult] = useState(null);

  const start = () => {
    if (!selected || racing || result) return;
    setRacing(true);
    const speed = E_BEASTS.map(() => 0.62 + Math.random() * 0.9);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setPositions((prev) => {
        const next = prev.map((v, i) => Math.min(100, v + speed[i] + Math.random() * 0.55));
        const eventIndex = Math.floor(Math.random() * E_BEASTS.length);
        if (Math.random() < 0.35) {
          const chosen = E_BEASTS[eventIndex].key;
          const lines = [
            `${chosen} 가 응원을 받아 속도를 올린다!`,
            `${chosen} 의 마음이 흔들렸다!`,
            `${chosen} 가 선두를 추격한다!!`,
            `${chosen} 가 라인 변경을 노린다!`,
          ];
          setLogs((old) => [{ text: lines[Math.floor(Math.random() * lines.length)], beast: chosen }, ...old].slice(0, 5));
        }
        const winnerIndex = next.findIndex((v) => v >= 100 || Date.now() - startedAt > 10000);
        if (winnerIndex >= 0) {
          clearInterval(timer);
          setRacing(false);
          const winner = E_BEASTS.slice().sort((a, b) => next[E_BEASTS.findIndex((v) => v.key === b.key)] - next[E_BEASTS.findIndex((v) => v.key === a.key)])[0].key;
          const win = winner === selected;
          const payload = { delta: win ? bet * 3 : -bet, text: win ? `${winner} 우승 · 3배 획득` : `${winner} 우승 · 예측 실패` };
          setResult(payload);
          onResolve(payload.delta, payload.text, false);
        }
        return next;
      });
    }, 110);
  };

  return (
    <Modal title="E-Beast 맞추기" onClose={onClose} width={1120}>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 10 }}>
          {E_BEASTS.map((beast) => (
            <button key={beast.key} type="button" onClick={() => setSelected(beast.key)} style={{ border: selected === beast.key ? `2px solid ${beast.color}` : "1px solid rgba(98,176,220,0.18)", background: selected === beast.key ? `${beast.color}22` : "#fff", borderRadius: 18, padding: 16, fontWeight: 800 }}>
              {beast.key}
            </button>
          ))}
        </div>
        <div style={{ position: "relative", height: 500, borderRadius: 26, background: "linear-gradient(180deg, #f0f9ff, #e0f2fe)", overflow: "hidden", border: "1px solid rgba(98,176,220,0.18)", backgroundImage: "linear-gradient(90deg, transparent 0%, transparent 86%, rgba(255,255,255,0.94) 86%, rgba(255,255,255,0.94) 87%, transparent 87%)" }}><div style={{ position: "absolute", right: 18, top: 12, fontWeight: 900, color: "#0f4c81", letterSpacing: "0.16em" }}>FINISH</div>
          {E_BEASTS.map((beast, index) => {
            const image = (Array.isArray(beastImages) ? beastImages.find((item) => String(item?.key || "") === beast.key)?.image : "") || "";
            return (
              <div key={beast.key} style={{ position: "absolute", left: `${positions[index]}%`, top: `${16 + index * 16}%`, transform: "translateX(-50%)", width: 88, display: "grid", justifyItems: "center", gap: 6, transition: racing ? "left 0.1s linear" : "left 0.26s ease" }}>
                <div style={{ color: beast.color, fontWeight: 900, textShadow: "0 2px 10px rgba(255,255,255,0.35)" }}>{beast.key}</div>
                <div style={{ width: 70, height: 70, borderRadius: 999, overflow: "hidden", background: selected === beast.key ? `${beast.color}44` : "rgba(255,255,255,0.2)", boxShadow: selected === beast.key ? `0 0 24px ${beast.color}` : "0 8px 18px rgba(2,6,23,0.18)", display: "grid", placeItems: "center" }}>
                  {image ? <img src={image} alt={beast.key} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ fontWeight: 900, color: beast.color }}>{beast.key}</div>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {logs.map((log, idx) => {
            const beast = E_BEASTS.find((item) => item.key === log.beast);
            return <div key={`${log.text}-${idx}`} style={{ color: beast?.color || "#5d7a95", fontWeight: 700 }}>{log.text || log}</div>;
          })}
        </div>
        {!result ? <button type="button" className="home-primary-button" onClick={start} disabled={racing || !selected}>플레이</button> : null}
        <GameResult result={result} onConfirm={onClose} />
      </div>
    </Modal>
  );
}

export default function ShopPage({ activeCharacter, onApplyCharacter, design, theme, initialTab = "shop", pageKeyOverride = "" }) {
  const [catalog, setCatalog] = useState(() => {
    const cached = readCachedJson(SHOP_CATALOG_CACHE_KEY, []);
    return Array.isArray(cached) ? cached : [];
  });
  const [shopConfig, setShopConfig] = useState(() => {
    const cached = readCachedJson(SHOP_CONFIG_CACHE_KEY, { blackjackDealerImage: "", ebeasts: [] });
    return cached && typeof cached === "object" ? cached : { blackjackDealerImage: "", ebeasts: [] };
  });
  const [tab, setTab] = useState(initialTab);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [gameChoice, setGameChoice] = useState("");
  const [session, setSession] = useState(null);
  const inventory = Array.isArray(activeCharacter?.items) ? activeCharacter.items : [];
  const gambleLeft = Number(activeCharacter?.gambleCountLeft ?? 3);
  const activePageKey = pageKeyOverride || (tab === "gamble" ? "gambling" : "shop");

  const loadItems = async () => {
    const res = await fetch(buildApiUrl(`/shopItems?t=${Date.now()}`));
    const data = await res.json();
    const next = Array.isArray(data) ? data : [];
    setCatalog(next);
    writeCachedJson(SHOP_CATALOG_CACHE_KEY, next);
  };
  const loadShopConfig = async () => {
    const res = await fetch(buildApiUrl(`/shopConfig?t=${Date.now()}`));
    const data = await res.json();
    const next = data && typeof data === "object" ? data : { blackjackDealerImage: "", ebeasts: [] };
    setShopConfig(next);
    writeCachedJson(SHOP_CONFIG_CACHE_KEY, next);
  };
  useEffect(() => {
    loadItems().catch(() => {
      setCatalog((prev) => (Array.isArray(prev) && prev.length > 0 ? prev : readCachedJson(SHOP_CATALOG_CACHE_KEY, [])));
    });
    loadShopConfig().catch(() => {
      setShopConfig((prev) => (prev && typeof prev === "object" ? prev : readCachedJson(SHOP_CONFIG_CACHE_KEY, { blackjackDealerImage: "", ebeasts: [] })));
    });
  }, []);

  useEffect(() => {
    setTab(initialTab || "shop");
  }, [initialTab]);

  const saveCharacter = async (patch) => {
    const res = await fetch(buildApiUrl("/updateCharacter"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        charId: activeCharacter?.id,
        characterId: activeCharacter?.id,
        ownerId: activeCharacter?.ownerId,
        characterName: activeCharacter?.name,
        ...patch,
      }),
    });
    const data = await res.json();
    if (data.success && data.character) {
      onApplyCharacter(data.character);
      window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { character: data.character } }));
    }
    return data;
  };

  const buyItem = async (item) => {
    if (!activeCharacter?.id) return alert("구매할 캐릭터를 찾을 수 없습니다.");
    if (Number(activeCharacter?.coins || 0) < Number(item.price || 0)) return alert("코인이 부족합니다.");

    const res = await fetch(buildApiUrl("/shop/buy"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: activeCharacter.id,
        charId: activeCharacter.id,
        ownerId: activeCharacter.ownerId,
        characterName: activeCharacter.name,
        itemId: item.id,
        itemName: item.name,
      }),
    });
    const data = await res.json();
    if (!data.success) return alert(data.message || "구매에 실패했습니다.");
    if (data.character) {
      onApplyCharacter(data.character);
      window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { character: data.character } }));
    }
    alert(`${item.name} 구매 완료`);
  };

  const useItem = async (itemName, meta = {}) => {
    if (!activeCharacter?.id) return alert("사용할 캐릭터를 찾을 수 없습니다.");

    const itemKey = typeof itemName === "object" && itemName !== null
      ? (itemName.id || itemName.name || itemName.itemId || itemName.itemName || "")
      : itemName;

    const res = await fetch(buildApiUrl("/shop/use"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: activeCharacter.id,
        charId: activeCharacter.id,
        ownerId: activeCharacter.ownerId,
        characterName: activeCharacter.name,
        itemId: meta?.id || itemKey,
        itemName: meta?.name || itemKey,
      }),
    });
    const data = await res.json();
    if (!data.success) return alert(data.message || "아이템 사용에 실패했습니다.");
    if (data.character) {
      onApplyCharacter(data.character);
      window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { character: data.character } }));
    }
    setInventoryOpen(false);
    alert(`${meta?.name || itemKey} 사용 완료`);
  };

  const sellItem = async (itemName, meta) => {
    if (!activeCharacter?.id) return alert("판매할 캐릭터를 찾을 수 없습니다.");

    const res = await fetch(buildApiUrl("/shop/sell"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: activeCharacter.id,
        charId: activeCharacter.id,
        ownerId: activeCharacter.ownerId,
        characterName: activeCharacter.name,
        itemId: meta?.id || itemName,
        itemName,
      }),
    });
    const data = await res.json();
    if (!data.success) return alert(data.message || "판매에 실패했습니다.");
    if (data.character) {
      onApplyCharacter(data.character);
      window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { character: data.character } }));
    }
    setInventoryOpen(false);
    alert(`${meta.name || itemName} 판매 완료`);
  };

  const applyGambleResult = async (delta, text, closeImmediately = true) => {
    await saveCharacter({
      coins: Math.max(0, Number(activeCharacter?.coins || 0) + Number(delta || 0)),
      gambleCountLeft: Math.max(0, gambleLeft - 1),
    });
    if (closeImmediately) setSession(null);
  };

  const visibleItems = useMemo(() => catalog.filter((item) => !item.hidden), [catalog]);
  const maxBet = Math.min(50, Number(activeCharacter?.coins || 0));

  return (
    <DesignPageFrame design={design} pageKey={activePageKey} handlers={{}} theme={theme} minHeight="100vh">
      <div style={{ color: theme?.textMain || "#13324b" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>상점</h2>
            <div style={{ color: theme?.textSoft || "#4f7390" }}>현재 코인 {Number(activeCharacter?.coins || 0)}</div>
            <div style={{ color: theme?.textSoft || "#4f7390", marginTop: 4 }}>도박 남은 횟수 {gambleLeft}/3</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className={`ghost-button ${tab === "shop" ? "is-tab-active" : ""}`} onClick={() => setTab("shop")}>상점</button>
            <button type="button" className={`ghost-button ${tab === "gamble" ? "is-tab-active" : ""}`} onClick={() => setTab("gamble")}>도박장</button>
          </div>
        </div>
                {tab === "shop" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
            {visibleItems.map((item) => (
              <div key={item.id} style={box(theme, { display: "grid", gridTemplateColumns: item.image ? "96px minmax(0, 1fr)" : "1fr", gap: 14, alignItems: "start" })}>
                {item.image ? <div style={{ width: 96, height: 96, borderRadius: 20, overflow: "hidden", background: "rgba(255,255,255,0.7)" }}><img src={item.image} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div> : null}
                <div>
                  <div style={{ fontWeight: 900, fontSize: 20 }}>{item.name}</div>
                  <div style={{ color: theme?.textSoft || "#4f7390", lineHeight: 1.75, marginTop: 8 }}>{item.description || ""}</div>
                  <div style={{ marginTop: 12, color: theme?.textSoft || "#4f7390" }}>가격 {item.price || 0}</div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                    <button type="button" className="home-primary-button" onClick={() => buyItem(item)}>구매</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
            <GambleCard title="홀짝" onPlay={() => { setGameChoice("oddEven"); }} disabled={gambleLeft <= 0 || maxBet <= 0} />
            <GambleCard title="블랙잭" onPlay={() => { setGameChoice("blackjack"); }} disabled={gambleLeft <= 0 || maxBet <= 0} />
            <GambleCard title="E-Beast 맞추기" onPlay={() => { setGameChoice("ebeast"); }} disabled={gambleLeft <= 0 || maxBet <= 0} />
          </div>
        )}
      </div>

      {inventoryOpen ? <InventoryModal items={inventory} catalog={catalog} onClose={() => setInventoryOpen(false)} onSell={sellItem} onUse={useItem} /> : null}
      {gameChoice ? <BetModal title={gameLabel(gameChoice)} maxBet={maxBet} onClose={() => setGameChoice("")} onConfirm={(bet) => { setSession({ type: gameChoice, bet }); setGameChoice(""); }} /> : null}
      {session?.type === "oddEven" ? <OddEvenGame bet={session.bet} onClose={() => setSession(null)} onResolve={applyGambleResult} /> : null}
      {session?.type === "blackjack" ? <BlackJackGame bet={session.bet} onClose={() => setSession(null)} onResolve={applyGambleResult} dealerImage={shopConfig?.blackjackDealerImage || ""} playerImage={activeCharacter?.image || activeCharacter?.profileImage || ""} /> : null}
      {session?.type === "ebeast" ? <EBeastGame bet={session.bet} onClose={() => setSession(null)} onResolve={applyGambleResult} beastImages={shopConfig?.ebeasts || []} /> : null}
    </DesignPageFrame>
  );
}

function GambleCard({ title, onPlay, disabled }) {
  return (
    <div style={box({}, { display: "grid", alignContent: "start" })}>
      <div style={{ fontWeight: 900, fontSize: 22, marginBottom: 10 }}>{title}</div>
      <button type="button" className="home-primary-button" onClick={onPlay} disabled={disabled}>플레이</button>
    </div>
  );
}

function gameLabel(type) {
  if (type === "oddEven") return "홀짝";
  if (type === "blackjack") return "블랙잭";
  return "E-Beast 맞추기";
}

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(98,176,220,0.18)",
  boxSizing: "border-box",
};
