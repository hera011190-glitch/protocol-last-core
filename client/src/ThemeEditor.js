import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import defaultDesign from "./defaultDesign";
import ImageDropInput from "./ImageDropInput";
import HomePage from "./HomePage";
import SDPage from "./SDPage";
import CharacterGallery from "./CharacterGallery";
import InvestigationList from "./InvestigationList";
import MyPage from "./MyPage";
import Login from "./Login";
import ShopPage from "./ShopPage";
import CharacterProfile from "./CharacterProfile";
import InvestigationPage from "./InvestigationPage";
import renderElement from "./renderElement";
import AppShellFrame, { mergeShellOverrideMaps, getSharedShellElementsFromDesign, getSharedShellOverridesFromDesign } from "./AppShellFrame";
import { applyDomOverrides, buildSelectorFromNode, getNodeLabel } from "./designDomUtils";

const DESIGN_CACHE_KEY = "plc-design-cache";

const PAGE_KEYS = ["home", "sd", "characters", "investigations", "shop", "my", "login", "profileTemplate", "profileCharacter", "gambling", "investigationOverlay"];
const ACTION_OPTIONS = ["", "goHome", "openMy", "goCharacters", "goInvestigations", "goShop", "goSD"];
const EFFECT_PRESETS = {
  none: { boxShadow: "", transform: "", filter: "" },
  glow: { boxShadow: "0 0 24px rgba(85,199,255,0.42)", transform: "", filter: "" },
  rise: { boxShadow: "0 18px 40px rgba(73,132,170,0.20)", transform: "translateY(-2px)", filter: "" },
  blur: { boxShadow: "", transform: "", filter: "blur(0.2px)" },
  zoom: { boxShadow: "0 14px 28px rgba(0,0,0,0.16)", transform: "scale(1.02)", filter: "" },
};

const PRESET_LIBRARY = {
  title: () => ({
    id: `el-${Date.now()}`,
    type: "text",
    text: "섹션 제목",
    x: 48,
    y: 36,
    width: 340,
    height: 56,
    zIndex: 3,
    action: "",
    hoverScale: 1,
    style: {
      color: "#13324b",
      background: "transparent",
      borderRadius: 18,
      padding: 0,
      fontSize: 34,
      fontWeight: 900,
      opacity: 1,
      fontFamily: "",
      fontDataUrl: "",
      boxShadow: "",
    },
  }),
  navButton: () => ({
    id: `el-${Date.now()}`,
    type: "button",
    text: "메뉴 버튼",
    x: 48,
    y: 120,
    width: 152,
    height: 52,
    zIndex: 5,
    action: "",
    hoverScale: 1.03,
    style: {
      color: "#0f3652",
      background: "linear-gradient(135deg, rgba(255,255,255,0.92), rgba(217,241,255,0.88))",
      borderRadius: 999,
      padding: 12,
      fontSize: 16,
      fontWeight: 800,
      opacity: 1,
      border: "1px solid rgba(108,183,224,0.36)",
      boxShadow: "0 14px 28px rgba(71,126,166,0.14)",
      fontFamily: "",
      fontDataUrl: "",
    },
  }),
  heroPanel: () => ({
    id: `el-${Date.now()}`,
    type: "panel",
    text: "",
    x: 42,
    y: 96,
    width: 470,
    height: 212,
    zIndex: 2,
    action: "",
    hoverScale: 1,
    style: {
      color: "#13324b",
      background: "linear-gradient(145deg, rgba(255,255,255,0.90), rgba(224,243,255,0.72))",
      borderRadius: 28,
      padding: 20,
      fontSize: 16,
      opacity: 1,
      border: "1px solid rgba(112,188,228,0.30)",
      boxShadow: "0 30px 60px rgba(73,132,170,0.14), inset 0 1px 0 rgba(255,255,255,0.55)",
      backdropFilter: "blur(12px)",
      fontFamily: "",
      fontDataUrl: "",
    },
  }),
  card: () => ({
    id: `el-${Date.now()}`,
    type: "panel",
    text: "",
    x: 48,
    y: 340,
    width: 280,
    height: 180,
    zIndex: 2,
    action: "",
    hoverScale: 1.01,
    style: {
      color: "#13324b",
      background: "linear-gradient(155deg, rgba(255,255,255,0.88), rgba(231,246,255,0.70))",
      borderRadius: 24,
      padding: 16,
      fontSize: 16,
      opacity: 1,
      border: "1px solid rgba(112,188,228,0.24)",
      boxShadow: "0 18px 36px rgba(73,132,170,0.12)",
      backdropFilter: "blur(8px)",
      fontFamily: "",
      fontDataUrl: "",
    },
  }),
  popup: () => ({
    id: `el-${Date.now()}`,
    type: "panel",
    text: "",
    x: 520,
    y: 110,
    width: 260,
    height: 160,
    zIndex: 8,
    action: "",
    hoverScale: 1,
    style: {
      color: "#13324b",
      background: "linear-gradient(145deg, rgba(255,255,255,0.96), rgba(230,246,255,0.86))",
      borderRadius: 24,
      padding: 18,
      fontSize: 16,
      opacity: 1,
      border: "1px solid rgba(112,188,228,0.32)",
      boxShadow: "0 28px 56px rgba(73,132,170,0.18)",
      backdropFilter: "blur(14px)",
      fontFamily: "",
      fontDataUrl: "",
    },
  }),
  imageFrame: () => ({
    id: `el-${Date.now()}`,
    type: "image",
    text: "",
    src: "",
    x: 540,
    y: 320,
    width: 220,
    height: 240,
    zIndex: 4,
    action: "",
    hoverScale: 1,
    style: {
      background: "transparent",
      borderRadius: 0,
      padding: 0,
      fontSize: 16,
      opacity: 1,
      border: "none",
      boxShadow: "none",
      objectFit: "cover",
      fontFamily: "",
      fontDataUrl: "",
    },
  }),
};

const clone = (v) => JSON.parse(JSON.stringify(v));

function ensureDesign(input) {
  const base = clone(defaultDesign || {});
  const data = clone(input || {});
  base.pages = base.pages || {};
  data.pages = data.pages || {};

  PAGE_KEYS.forEach((key) => {
    base.pages[key] = base.pages[key] || { background: {}, elements: [], shellElements: [], domOverrides: {}, shellOverrides: {} };
    data.pages[key] = data.pages[key] || base.pages[key];
    data.pages[key].background = { ...(base.pages[key].background || {}), ...(data.pages[key].background || {}) };
    data.pages[key].elements = Array.isArray(data.pages[key].elements) ? data.pages[key].elements : clone(base.pages[key].elements || []);
    data.pages[key].shellElements = Array.isArray(data.pages[key].shellElements) ? data.pages[key].shellElements : clone(base.pages[key].shellElements || []);
    data.pages[key].domOverrides = typeof data.pages[key].domOverrides === "object" && data.pages[key].domOverrides ? data.pages[key].domOverrides : {};
    data.pages[key].shellOverrides = typeof data.pages[key].shellOverrides === "object" && data.pages[key].shellOverrides ? data.pages[key].shellOverrides : {};
  });

  data.sharedShellElements = clone(getSharedShellElementsFromDesign(data));
  data.sharedShellOverrides = clone(getSharedShellOverridesFromDesign(data));

  PAGE_KEYS.forEach((key) => {
    data.pages[key] = {
      ...(data.pages[key] || {}),
      shellElements: [],
      shellOverrides: {},
    };
  });

  return {
    ...base,
    ...data,
    pages: data.pages,
    sharedShellElements: data.sharedShellElements,
    sharedShellOverrides: data.sharedShellOverrides,
  };
}

const ELEMENT_BUCKET_BY_SCOPE = { page: "elements", shell: "shellElements" };

function getElementBucket(scope = "page") {
  return ELEMENT_BUCKET_BY_SCOPE[scope] || "elements";
}

function normalizeElementTarget(target, fallbackScope = "page") {
  if (!target || target.kind !== "element") return target;
  return { ...target, scope: target.scope || fallbackScope };
}

function makeElementTarget(element, scope = "page") {
  return element ? { kind: "element", id: element.id, scope } : null;
}

function addElement(type = "text") {
  return {
    id: `el-${Date.now()}`,
    type,
    text: type === "text" ? "새 텍스트" : type === "button" ? "새 버튼" : "",
    x: 40,
    y: 40,
    width: 220,
    height: type === "image" ? 180 : 60,
    zIndex: 1,
    action: "",
    hoverScale: 1,
    style: {
      color: "#13324b",
      background: type === "panel" ? "rgba(255,255,255,0.56)" : type === "image" ? "transparent" : "rgba(255,255,255,0.76)",
      borderRadius: type === "image" ? 0 : 18,
      padding: 12,
      fontSize: 16,
      opacity: 1,
      fontFamily: "",
      fontDataUrl: "",
    },
  };
}

function sanitizeFontFamily(name, fallback) {
  const value = String(name || "").trim();
  if (!value) return fallback;
  return value.replace(/[^a-zA-Z0-9가-힣 _-]/g, "").trim() || fallback;
}

function FontFaceStyle({ element }) {
  const fontDataUrl = element?.style?.fontDataUrl;
  if (!fontDataUrl) return null;
  const fontFamily = sanitizeFontFamily(element?.style?.fontFamily, `plc_font_${String(element?.id || "element").replace(/[^a-zA-Z0-9_-]/g, "_")}`);
  return (
    <style>{`
      @font-face {
        font-family: '${fontFamily}';
        src: url('${fontDataUrl}');
      }
    `}</style>
  );
}

function prettyElementTypeLabel(type) {
  return {
    text: "텍스트",
    button: "버튼",
    panel: "패널",
    image: "이미지",
  }[type] || type;
}

function prettyActionLabel(action) {
  return {
    "": "없음",
    goHome: "홈으로 이동",
    openMy: "MY 열기",
    goCharacters: "캐릭터로 이동",
    goInvestigations: "조사로 이동",
    goShop: "상점으로 이동",
    goSD: "맵으로 이동",
  }[action] || action;
}


function getEditorRectWithinRoot(node, root, scale = 1) {
  if (!node || !root) return null;
  const target = node?.nodeType === 3 ? node.parentElement : node;
  if (!target) return null;
  const nodeRect = target.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const safeScale = Number(scale) > 0 ? Number(scale) : 1;
  return {
    left: (nodeRect.left - rootRect.left + root.scrollLeft) / safeScale,
    top: (nodeRect.top - rootRect.top + root.scrollTop) / safeScale,
    width: nodeRect.width / safeScale,
    height: nodeRect.height / safeScale,
  };
}

function prettyPresetLabel(key) {
  return {
    title: "제목",
    navButton: "메뉴 버튼",
    heroPanel: "큰 패널",
    card: "카드",
    popup: "팝업",
    imageFrame: "이미지 틀",
  }[key] || key;
}

function prettyPageLabel(key) {
  return {
    home: "홈",
    sd: "맵",
    characters: "캐릭터",
    investigations: "조사",
    shop: "상점",
    my: "MY",
    login: "로그인",
    profileTemplate: "프로필 양식",
    profileCharacter: "캐릭터 프로필",
    gambling: "도박",
    investigationOverlay: "조사 화면",
  }[key] || key;
}

function buildThemeVars(theme) {
  return {
    "--bg-main": theme.bgMain || "#eef9ff",
    "--panel": theme.panel || "rgba(255,255,255,0.78)",
    "--text-main": theme.textMain || "#13324b",
    "--accent": theme.accent || "#55c7ff",
    "--line": theme.line || "rgba(98, 176, 220, 0.18)",
    "--font-family": theme.fontFamily || '"Pretendard", "Noto Sans KR", sans-serif',
    "--shadow": theme.shadow || "0 24px 60px rgba(73,132,170,0.16)",
    "--radius-xl": theme.radiusXl || "30px",
  };
}
function parseTranslate(transform) {
  const value = String(transform || "");
  const match = value.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
  return { x: match ? Number(match[1] || 0) : 0, y: match ? Number(match[2] || 0) : 0 };
}

function mergeTranslate(transform, x, y) {
  const value = String(transform || "").replace(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*/g, "").trim();
  const prefix = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  return value ? `${prefix} ${value}` : prefix;
}

function isEditorSelectableElement(node, scopeRoot) {
  if (!(node instanceof Element) || !(scopeRoot instanceof Element) || !scopeRoot.contains(node)) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width < 6 || rect.height < 6) return false;
  const style = window.getComputedStyle(node);
  if (style.pointerEvents === "none" || style.visibility === "hidden" || style.display === "none") return false;
  if (node.hasAttribute("data-design-page-root") || node.hasAttribute("data-design-shell-root")) return false;
  if (node.closest("[data-design-editor-ignore='true']")) return false;
  return true;
}

function ElementPreview({ element, scope = "page", isSelected, dragging, interactionLocked = false, setDragging, setResizing, setSelectedTarget }) {
  const style = {
    position: "absolute",
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    zIndex: element.zIndex || 1,
    opacity: Number(element.style?.opacity ?? 1),
    ...element.style,
    fontFamily: sanitizeFontFamily(element.style?.fontFamily, element.style?.fontDataUrl ? `plc_font_${String(element.id || "element").replace(/[^a-zA-Z0-9_-]/g, "_")}` : "inherit"),
    cursor: dragging?.id === element.id ? "grabbing" : "move",
    userSelect: "none",
    outline: isSelected && element.type !== "image" ? "2px solid rgba(29,157,255,0.9)" : "none",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
    overflow: "hidden",
    pointerEvents: interactionLocked && !isSelected ? "none" : "auto",
  };
  const shared = {
    onClick: (e) => {
      e.stopPropagation();
      setSelectedTarget({ kind: "element", id: element.id, scope });
    },
    onMouseDown: (event) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedTarget({ kind: "element", id: element.id, scope });
      setDragging({ kind: "element", id: element.id, scope, clientX: event.clientX, clientY: event.clientY, startX: Number(element.x || 0), startY: Number(element.y || 0) });
    },
    style,
    "data-design-element-id": element.id,
    "data-design-element-scope": scope,
  };
  return (
    <div key={element.id}>
      <FontFaceStyle element={element} />
      {element.type === "image"
        ? <img {...shared} src={element.src || ""} alt={element.id} />
        : element.type === "button"
          ? <button {...shared} type="button">{element.text || "버튼"}</button>
          : <div {...shared}>{element.text || ""}</div>}
      {isSelected ? (
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setResizing({ kind: "element", id: element.id, scope, clientX: event.clientX, clientY: event.clientY, startWidth: Number(element.width || 0), startHeight: Number(element.height || 0) });
          }}
          style={{
            position: "absolute",
            left: Number(element.x || 0) + Number(element.width || 0) - 18,
            top: Number(element.y || 0) + Number(element.height || 0) - 18,
            width: 18,
            height: 18,
            zIndex: (element.zIndex || 1) + 30,
            borderRadius: 999,
            border: "1px solid rgba(29,157,255,0.9)",
            background: "white",
            cursor: "nwse-resize",
          }}
        />
      ) : null}
    </div>
  );
}

function InvestigationOverlayPreview({ design, theme, previewCharacter }) {
  return (
    <div style={{ position: "relative", minHeight: "100vh", color: "white" }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(4,7,16,0.58), rgba(4,7,16,0.72))" }} />
      <div style={{ position: "relative", zIndex: 2, padding: 24, display: "grid", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
          <div>
            <div className="section-eyebrow" style={{ color: "#7dd3fc" }}>INVESTIGATION</div>
            <h2 style={{ marginTop: 10, marginBottom: 0 }}>대저택 조사</h2>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="ghost-button">조사 종료</button>
            <button type="button" className="ghost-button">나가기</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "320px minmax(0, 1fr) 360px", gap: 16, alignItems: "stretch" }}>
          <div style={{ padding: 16, borderRadius: 24, background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)", display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 900 }}>채팅</div>
            {[1, 2, 3].map((item) => (
              <div key={item} style={{ display: "grid", gridTemplateColumns: "34px 1fr", gap: 10, alignItems: "start" }}>
                <div style={{ width: 34, height: 34, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.18)" }}>{previewCharacter?.image ? <img src={previewCharacter.image} alt="chat" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}</div>
                <div style={{ background: "rgba(2,6,23,0.26)", padding: 10, borderRadius: 14 }}><strong>{previewCharacter?.name || "캐릭터"}</strong>: 조사 중 채팅 예시 {item}</div>
              </div>
            ))}
          </div>
          <div style={{ minHeight: 520, borderRadius: 28, background: "rgba(255,255,255,0.06)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", left: 22, right: 22, bottom: 20, display: "grid", gap: 12, justifyItems: "center" }}>
              <div style={{ width: 120, height: 120, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.16)", display: "grid", placeItems: "center" }}>{previewCharacter?.image ? <img src={previewCharacter.image} alt="sd" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "SD"}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {["조사", "이동", "공격", "스킬"].map((label) => <button key={label} type="button" className="home-primary-button">{label}</button>)}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {["지도", "아이템", "인벤토리", "단서"].map((label) => <button key={label} type="button" className="ghost-button">{label}</button>)}
              </div>
            </div>
          </div>
          <div style={{ padding: 16, borderRadius: 24, background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)", display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 900 }}>로그</div>
            {["아군 행동 로그", "적군 행동 로그", "조사 진행 로그"].map((text, index) => <div key={index} style={{ background: "rgba(2,6,23,0.26)", padding: 12, borderRadius: 14 }}>{text}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewShell({ pageKey, design, theme, canvasWidth = 1440, canvasHeight = 900 }) {
  const shellRef = useRef(null);
  const previewOwner = useMemo(() => ({ id: "", name: "운영자", isAdmin: true }), []);
  const previewChat = useMemo(() => ([
    { id: "chat-1", name: "테스트 러너", message: "왼쪽 복도 쪽을 먼저 확인하겠습니다.", image: "", time: "" },
    { id: "chat-2", name: "지원 러너", message: "응급 붕대는 제가 들고 있겠습니다.", image: "", time: "" },
    { id: "chat-3", name: "테스트 러너", message: "전투 로그 연출도 여기서 바로 볼 수 있습니다.", image: "", time: "" },
  ]), []);

  const previewCharacter = useMemo(() => ({
    id: "preview-character",
    ownerId: "",
    name: "테스트 러너",
    age: "20",
    bodyInfo: "170cm / 55kg",
    rank: "대원",
    oneLine: "미리보기용 한마디입니다.",
    profile: `<프로필>
이 화면은 실제 페이지 컴포넌트를 그대로 미리보기에 올린 상태입니다.
<size=22>크기 태그</size>와 [b]굵은 글씨[/b]도 함께 확인하실 수 있습니다.`,
    image: "",
    mainImage: "",
    investigationImage: "",
    level: 4,
    exp: 180,
    corrosion: 24,
    coins: 320,
    items: ["붕대", "열쇠", "지도 조각"],
    skills: ["격발", "응급처치", "보호막"],
    relations: [
      { title: "후관명", target: "상대 캐릭터", description: "관계 설명이 여기에 표시됩니다." },
      { title: "추가 후관", target: "다른 상대", description: "관계 카드 스타일도 바로 클릭해서 조절할 수 있습니다." },
    ],
    stats: { hp: 5, atk: 3, def: 2, agi: 4 },
  }), []);
  const previewInvestigation = useMemo(() => ({
    id: "preview-investigation",
    type: "group",
    started: true,
    ended: false,
    currentNodeId: "boss",
    leaders: [previewCharacter.name],
    participants: [
      {
        id: previewCharacter.id,
        ownerId: previewCharacter.ownerId,
        name: previewCharacter.name,
        image: previewCharacter.image,
        investigationImage: previewCharacter.investigationImage || previewCharacter.image,
        stats: previewCharacter.stats,
      },
      {
        id: "preview-ally",
        ownerId: "preview-owner-2",
        name: "지원 러너",
        image: previewCharacter.image,
        investigationImage: previewCharacter.investigationImage || previewCharacter.image,
        stats: { hp: 4, atk: 2, def: 3, agi: 3 },
      },
    ],
    participantStates: {
      [previewCharacter.name]: { hp: 34, maxHp: 50, def: 2, agi: 4, skillCooldowns: { 보호막: 1 } },
      "지원 러너": { hp: 28, maxHp: 40, def: 3, agi: 3, skillCooldowns: {} },
    },
    data: {
      start: "entrance",
      backgroundImage: "",
      nodes: {
        entrance: { id: "entrance", name: "입구", choices: [{ text: "우", target: "boss" }] },
        boss: {
          id: "boss",
          name: "중앙 홀",
          image: "",
          choices: [{ text: "좌", target: "entrance" }],
          investigations: ["문양 조사", "잔해 조사"],
          battle: {
            name: "E-Beast",
            hp: 82,
            maxHp: 120,
            atk: 18,
            def: 10,
            agi: 7,
            aoe_chance: 0.25,
            finisher_chance: 0.08,
            image: "",
          },
        },
      },
    },
    routeHistory: [
      { nodeId: "entrance", nodeName: "입구", time: Date.now() - 300000 },
      { nodeId: "boss", nodeName: "중앙 홀", time: Date.now() - 120000 },
    ],
    sharedLogs: [
      { id: "log-1", text: "조사가 시작되었다.", time: "" },
      { id: "log-2", text: "아군 행동 로그는 적군 행동 로그와 분리되어 표시됩니다.", time: "" },
      { id: "log-3", text: "현재 전투 연출 미리보기 화면이다.", time: "" },
    ],
    foundItems: ["응급 붕대", "지도 조각"],
    foundNPCs: ["관리인"],
    rewards: ["스탯 포인트"],
    clues: [{ name: "푸른 문양", description: "벽면에 새겨진 흔적." }],
    points: 4,
    battleTurn: 3,
    pendingBattleActions: { [previewCharacter.name]: "공격", "지원 러너": "스킬::응급처치" },
    lastBattleRound: [
      { phase: "allies", text: "[아군 행동]", isPhaseHeader: true },
      { phase: "allies", text: `${previewCharacter.name}의 공격! E-Beast에게 8 데미지.`, actor: previewCharacter.name, target: "E-Beast", effect: "attack", snapshot: { participantStates: { [previewCharacter.name]: { hp: 34, maxHp: 50, def: 2, agi: 4, skillCooldowns: { 보호막: 1 } }, "지원 러너": { hp: 28, maxHp: 40, def: 3, agi: 3, skillCooldowns: {} } }, battleHp: 74, battleMaxHp: 120 } },
      { phase: "allies", text: `지원 러너의 응급처치! ${previewCharacter.name}가 6 회복.`, actor: "지원 러너", target: previewCharacter.name, effect: "heal", snapshot: { participantStates: { [previewCharacter.name]: { hp: 40, maxHp: 50, def: 2, agi: 4, skillCooldowns: { 보호막: 1 } }, "지원 러너": { hp: 28, maxHp: 40, def: 3, agi: 3, skillCooldowns: {} } }, battleHp: 74, battleMaxHp: 120 } },
      { phase: "enemy", text: "[적군 행동]", isPhaseHeader: true },
      { phase: "enemy", text: `E-Beast의 반격! ${previewCharacter.name}이(가) 10 데미지.`, actor: "E-Beast", target: previewCharacter.name, effect: "damage", snapshot: { participantStates: { [previewCharacter.name]: { hp: 30, maxHp: 50, def: 2, agi: 4, skillCooldowns: { 보호막: 1 } }, "지원 러너": { hp: 28, maxHp: 40, def: 3, agi: 3, skillCooldowns: {} } }, battleHp: 74, battleMaxHp: 120 } },
    ],
    previewChat,
    previewInventory: ["응급 붕대", "지도 조각", "열쇠"],
  }), [previewCharacter, previewChat]);

  const previewPage = design?.pages?.[pageKey] || {};
  const previewShellElements = useMemo(() => getSharedShellElementsFromDesign(design), [design]);
  const previewShellOverrides = useMemo(
    () => mergeShellOverrideMaps(getSharedShellOverridesFromDesign(design), previewPage?.shellOverrides || {}),
    [design, previewPage?.shellOverrides]
  );

  useLayoutEffect(() => {
    applyDomOverrides(shellRef.current, previewShellOverrides);
  }, [previewShellOverrides]);

  const themeVars = buildThemeVars(theme || {});
  const navText = design?.siteContent?.topNav || {};

  const previewDesign = useMemo(() => {
    const next = ensureDesign(design);
    next.pages[pageKey] = { ...(next.pages?.[pageKey] || {}), elements: [], shellElements: [] };
    return next;
  }, [design, pageKey]);
  const navItems = [
    ["home", navText.home || "홈"],
    ["sd", navText.sd || "맵"],
    ["characters", navText.characters || "캐릭터"],
    ["investigations", navText.investigations || "조사"],
    ["shop", navText.shop || "상점"],
  ];

  const noop = () => {};

  const renderPage = () => {
    if (pageKey === "home") return <HomePage user={previewOwner} activeCharacter={previewCharacter} openMy={noop} goCharacters={noop} goInvestigations={noop} goShop={noop} goSD={noop} theme={theme} design={previewDesign} />;
    if (pageKey === "sd") return <SDPage activeCharacter={{}} design={previewDesign} theme={theme} />;
    if (pageKey === "characters") return <CharacterGallery user={previewOwner} activeCharacter={previewCharacter} design={previewDesign} theme={theme} />;
    if (pageKey === "investigations") return <InvestigationList onEnter={noop} onSpectate={noop} activeCharacter={previewCharacter} design={previewDesign} theme={theme} />;
    if (pageKey === "shop") return <ShopPage activeCharacter={previewCharacter} onApplyCharacter={noop} design={previewDesign} theme={theme} initialTab="shop" pageKeyOverride="shop" />;
    if (pageKey === "my") return <MyPage currentUser={{ ...previewCharacter, id: "" }} ownerUser={previewOwner} onUpdateUser={noop} design={previewDesign} theme={theme} />;
    if (pageKey === "login") return <Login setUser={noop} design={previewDesign} theme={theme} />;
    if (pageKey === "profileTemplate" || pageKey === "profileCharacter") return <CharacterProfile character={previewCharacter} goBack={noop} theme={theme} viewerCharacter={{ id: "viewer" }} design={previewDesign} pageKey={pageKey} />;
    if (pageKey === "gambling") return <ShopPage activeCharacter={previewCharacter} onApplyCharacter={noop} design={previewDesign} theme={theme} initialTab="gamble" pageKeyOverride="gambling" />;
    if (pageKey === "investigationOverlay") return <InvestigationPage investigationId="preview-investigation" character={previewCharacter} isAdmin={false} isSpectator={false} goBack={noop} design={previewDesign} theme={theme} pageKey="investigationOverlay" previewData={previewInvestigation} previewChat={previewChat} previewInventory={previewInvestigation.previewInventory} />;
    return null;
  };

  const previewUser = pageKey === "login" ? null : previewOwner;
  const shellActivePage = pageKey === "login" ? "my" : pageKey;
  const resolvedShellPageKey = pageKey === "investigationOverlay" ? "investigationOverlay" : pageKey;

  return (
    <div style={{ ...themeVars, width: canvasWidth, minHeight: canvasHeight, background: "var(--bg-main)", overflow: "visible" }}>
      <AppShellFrame
        user={previewUser}
        activePage={shellActivePage}
        shellPageKey={resolvedShellPageKey}
        onNavigate={noop}
        onLogout={noop}
        onLogin={noop}
        designConfig={previewDesign}
        myUnread={0}
        shellRef={shellRef}
      >
        {renderPage()}
      </AppShellFrame>
    </div>
  );
}

function inputField(label, value, onChange, extra = {}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>{label}</div>
      <input value={value} onChange={onChange} style={inputStyle} {...extra} />
    </div>
  );
}

function selectField(label, value, onChange, options = []) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>{label}</div>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function rangeField(label, value, onChange, min, max, step = 1) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, fontWeight: 800, color: "#476885" }}>
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function hasMeaningfulHitBox(node, scopeRoot) {
  if (!(node instanceof Element) || !(scopeRoot instanceof Element)) return false;
  if (!isEditorSelectableElement(node, scopeRoot)) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width < 18 || rect.height < 18) return false;
  const style = window.getComputedStyle(node);
  if (style.display === "inline") return false;
  const rootRect = scopeRoot.getBoundingClientRect();
  const area = Math.max(1, rect.width * rect.height);
  const rootArea = Math.max(1, rootRect.width * rootRect.height);
  if (area >= rootArea * 0.8 && node !== scopeRoot) return false;
  return true;
}

function hasVisualSurface(node) {
  if (!(node instanceof Element)) return false;
  const style = window.getComputedStyle(node);
  const backgroundColor = String(style.backgroundColor || "").replace(/\s+/g, "").toLowerCase();
  const backgroundImage = String(style.backgroundImage || "").toLowerCase();
  const boxShadow = String(style.boxShadow || "").toLowerCase();
  const borderTop = parseFloat(style.borderTopWidth || "0") || 0;
  const borderRight = parseFloat(style.borderRightWidth || "0") || 0;
  const borderBottom = parseFloat(style.borderBottomWidth || "0") || 0;
  const borderLeft = parseFloat(style.borderLeftWidth || "0") || 0;
  const hasBackground = backgroundImage !== "none" || (backgroundColor && backgroundColor !== "transparent" && backgroundColor !== "rgba(0,0,0,0)" && backgroundColor !== "rgb(0,0,0,0)");
  const hasBorder = borderTop > 0 || borderRight > 0 || borderBottom > 0 || borderLeft > 0;
  const hasRadius = (parseFloat(style.borderTopLeftRadius || "0") || 0) > 0 || (parseFloat(style.borderTopRightRadius || "0") || 0) > 0 || (parseFloat(style.borderBottomRightRadius || "0") || 0) > 0 || (parseFloat(style.borderBottomLeftRadius || "0") || 0) > 0;
  const tag = String(node.tagName || "").toLowerCase();
  const semanticBox = ["button", "img", "figure", "section", "article", "aside", "nav", "header", "footer", "main", "li", "ul", "ol", "table", "td", "th"].includes(tag);
  return hasBackground || hasBorder || hasRadius || boxShadow !== "none" || semanticBox;
}

function isStrongSelectableBox(node, scopeRoot) {
  if (!hasMeaningfulHitBox(node, scopeRoot)) return false;
  const rect = node.getBoundingClientRect();
  const rootRect = scopeRoot.getBoundingClientRect();
  const area = Math.max(1, rect.width * rect.height);
  const rootArea = Math.max(1, rootRect.width * rootRect.height);
  if (area >= rootArea * 0.72 && node !== scopeRoot) return false;
  if (node?.hasAttribute?.("data-design-element-id")) return true;
  return hasVisualSurface(node);
}

function pickNearestSelectable(node, scopeRoot, preferred = false) {
  let current = node?.nodeType === 3 ? node.parentElement : node;
  while (current && current !== scopeRoot) {
    if (current?.hasAttribute?.("data-design-element-id")) return current;
    if (preferred ? isStrongSelectableBox(current, scopeRoot) : hasMeaningfulHitBox(current, scopeRoot)) {
      return current;
    }
    current = current.parentElement;
  }
  return preferred && isStrongSelectableBox(scopeRoot, scopeRoot) ? scopeRoot : hasMeaningfulHitBox(scopeRoot, scopeRoot) ? scopeRoot : null;
}

function resolveSelectableTarget(target, scopeRoot, point = null) {
  const initialNode = target?.nodeType === 3 ? target.parentElement : target;
  if (!(scopeRoot instanceof Element)) return null;

  const x = Number(point?.x);
  const y = Number(point?.y);
  if (Number.isFinite(x) && Number.isFinite(y) && typeof document !== "undefined" && document.elementsFromPoint) {
    const hits = document.elementsFromPoint(x, y)
      .filter((node) => node instanceof Element)
      .filter((node) => scopeRoot.contains(node))
      .filter((node) => !node.closest("[data-design-editor-ignore='true']"));

    for (const hit of hits) {
      const picked = pickNearestSelectable(hit, scopeRoot, true);
      if (picked) return picked;
    }
    for (const hit of hits) {
      const picked = pickNearestSelectable(hit, scopeRoot, false);
      if (picked) return picked;
    }
  }

  const strongFallback = pickNearestSelectable(initialNode, scopeRoot, true);
  if (strongFallback) return strongFallback;
  return pickNearestSelectable(initialNode, scopeRoot, false) || scopeRoot;
}

function rectEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return ["left", "top", "width", "height"].every((key) => Math.abs(Number(a[key] || 0) - Number(b[key] || 0)) < 0.5);
}

export default function ThemeEditor({ goBack }) {
  const [design, setDesign] = useState(() => {
    try {
      const cached = localStorage.getItem(DESIGN_CACHE_KEY);
      return ensureDesign(cached ? JSON.parse(cached) : defaultDesign);
    } catch {
      return ensureDesign(defaultDesign);
    }
  });
  const [pageKey, setPageKey] = useState("home");
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [message, setMessage] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [previewScale, setPreviewScale] = useState(0.74);
  const previewViewportRef = useRef(null);
  const previewRootRef = useRef(null);
  const saveMessageTimerRef = useRef(null);
  const imagePickerRef = useRef(null);
  const pendingImageElementIdRef = useRef("");
  const [selectionRect, setSelectionRect] = useState(null);
  const [pageOverlayRect, setPageOverlayRect] = useState(null);
  const [previewContentHeight, setPreviewContentHeight] = useState(900);
  const [previewCanvasWidth, setPreviewCanvasWidth] = useState(() => (typeof window !== "undefined" ? Math.max(1280, window.innerWidth) : 1440));
  const [previewCanvasHeight, setPreviewCanvasHeight] = useState(() => (typeof window !== "undefined" ? Math.max(900, window.innerHeight) : 900));

  useEffect(() => {
    fetch("http://localhost:3001/designConfig", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const next = ensureDesign(data);
        setDesign(next);
        setIsDirty(false);
        try {
          localStorage.setItem(DESIGN_CACHE_KEY, JSON.stringify(next));
        } catch {}
      })
      .catch(() => setDesign((prev) => ensureDesign(prev || defaultDesign)));
  }, []);

  useEffect(() => {
    const refreshCanvasSize = () => {
      if (typeof window === "undefined") return;
      setPreviewCanvasWidth(Math.max(1280, window.innerWidth));
      setPreviewCanvasHeight(Math.max(900, window.innerHeight));
    };
    refreshCanvasSize();
    window.addEventListener("resize", refreshCanvasSize);
    return () => window.removeEventListener("resize", refreshCanvasSize);
  }, []);

  const page = design.pages?.[pageKey] || { background: {}, elements: [], shellElements: [], domOverrides: {}, shellOverrides: {} };
  const pageElements = Array.isArray(page.elements) ? page.elements : [];
  const shellElements = useMemo(() => getSharedShellElementsFromDesign(design), [design]);
  const shellOverrides = useMemo(() => getSharedShellOverridesFromDesign(design), [design]);
    const selected = useMemo(() => {
    if (!selectedTarget) {
      const firstElement = shellElements[0] ? { kind: "element", scope: "shell", element: shellElements[0] } : pageElements[0] ? { kind: "element", scope: "page", element: pageElements[0] } : null;
      return firstElement;
    }
    if (selectedTarget.kind === "element") {
      const scope = selectedTarget.scope || "page";
      const bucket = getElementBucket(scope);
      const source = scope === "shell" ? { shellElements } : page;
      const element = (source[bucket] || []).find((el) => el.id === selectedTarget.id);
      return element ? { kind: "element", scope, element } : null;
    }
    if (selectedTarget.kind === "dom") {
      const styleSource = selectedTarget.scope === "shell" ? shellOverrides : (page.domOverrides || {});
      return {
        kind: "dom",
        scope: selectedTarget.scope,
        selector: selectedTarget.selector,
        label: selectedTarget.label,
        style: styleSource[selectedTarget.selector] || {},
      };
    }
    return null;
  }, [selectedTarget, page, pageElements, shellElements]);

  const updatePage = (updater) => setDesign((prev) => {
    const next = ensureDesign(prev);
    next.pages[pageKey] = updater(next.pages[pageKey]);
    setIsDirty(true);
    return next;
  });

  const updateDesign = (updater) => setDesign((prev) => {
    const next = ensureDesign(prev);
    const updated = updater(next) || next;
    setIsDirty(true);
    return ensureDesign(updated);
  });

  const updateSelectedElement = (updater) => {
    if (!selected || selected.kind !== "element") return;
    const bucket = getElementBucket(selected.scope);
    if (selected.scope === "shell") {
      updateDesign((next) => ({
        ...next,
        sharedShellElements: (next.sharedShellElements || []).map((el) => (el.id === selected.element.id ? updater(el) : el)),
      }));
      return;
    }
    updatePage((pageData) => ({
      ...pageData,
      [bucket]: (pageData[bucket] || []).map((el) => (el.id === selected.element.id ? updater(el) : el)),
    }));
  };

  const updateSelectedElementStyle = (patch) => updateSelectedElement((el) => ({
    ...el,
    style: { ...(el.style || {}), ...patch },
  }));

  const updateSelectedDomStyle = (patch) => {
    if (!selected || selected.kind !== "dom") return;
    if (selected.scope === "shell") {
      updateDesign((next) => ({
        ...next,
        sharedShellOverrides: {
          ...(next.sharedShellOverrides || {}),
          [selected.selector]: {
            ...((next.sharedShellOverrides || {})[selected.selector] || {}),
            ...patch,
          },
        },
      }));
      return;
    }
    const bucket = "domOverrides";
    updatePage((pageData) => ({
      ...pageData,
      [bucket]: {
        ...(pageData[bucket] || {}),
        [selected.selector]: {
          ...((pageData[bucket] || {})[selected.selector] || {}),
          ...patch,
        },
      },
    }));
  };

  useEffect(() => {
    if (!selectedTarget) {
      if (shellElements[0]?.id) {
        setSelectedTarget({ kind: "element", id: shellElements[0].id, scope: "shell" });
        return;
      }
      if (pageElements[0]?.id) {
        setSelectedTarget({ kind: "element", id: pageElements[0].id, scope: "page" });
      }
    }
  }, [pageElements, shellElements, selectedTarget]);

  useEffect(() => {
    if (!dragging && !resizing) return undefined;
    const handleMove = (event) => {
      const scale = Math.max(0.01, Number(previewScale || 1));
      setDesign((prev) => {
        const next = ensureDesign(prev);
        const pageData = next.pages[pageKey] || { background: {}, elements: [], shellElements: [], domOverrides: {}, shellOverrides: {} };
        const deltaX = (event.clientX - (dragging?.clientX || resizing?.clientX || 0)) / scale;
        const deltaY = (event.clientY - (dragging?.clientY || resizing?.clientY || 0)) / scale;
        const activeElementInteraction = dragging?.kind === "element" ? dragging : resizing?.kind === "element" ? resizing : null;
        if (activeElementInteraction) {
          const scope = activeElementInteraction.scope || "page";
          if (scope === "shell") {
            next.sharedShellElements = (next.sharedShellElements || []).map((el) => {
              if (dragging?.kind === "element" && el.id === dragging.id) {
                return {
                  ...el,
                  x: Math.round((dragging.startX + deltaX) * 10) / 10,
                  y: Math.round((dragging.startY + deltaY) * 10) / 10,
                };
              }
              if (resizing?.kind === "element" && el.id === resizing.id) {
                return {
                  ...el,
                  width: Math.max(40, Math.round((resizing.startWidth + deltaX) * 10) / 10),
                  height: Math.max(40, Math.round((resizing.startHeight + deltaY) * 10) / 10),
                };
              }
              return el;
            });
          } else {
            const bucket = getElementBucket(scope);
            pageData[bucket] = (pageData[bucket] || []).map((el) => {
              if (dragging?.kind === "element" && el.id === dragging.id) {
                return {
                  ...el,
                  x: Math.round((dragging.startX + deltaX) * 10) / 10,
                  y: Math.round((dragging.startY + deltaY) * 10) / 10,
                };
              }
              if (resizing?.kind === "element" && el.id === resizing.id) {
                return {
                  ...el,
                  width: Math.max(40, Math.round((resizing.startWidth + deltaX) * 10) / 10),
                  height: Math.max(40, Math.round((resizing.startHeight + deltaY) * 10) / 10),
                };
              }
              return el;
            });
          }
        }
        const activeDom = dragging?.kind === "dom" ? dragging : resizing?.kind === "dom" ? resizing : null;
        if (activeDom) {
          if (activeDom.scope === "shell") {
            const currentStyle = { ...((next.sharedShellOverrides || {})[activeDom.selector] || {}) };
            if (dragging?.kind === "dom") {
              currentStyle.transform = mergeTranslate(currentStyle.transform || activeDom.startTransform || "", activeDom.startTranslateX + deltaX, activeDom.startTranslateY + deltaY);
            }
            if (resizing?.kind === "dom") {
              currentStyle.width = `${Math.max(24, activeDom.startWidth + deltaX)}px`;
              currentStyle.height = `${Math.max(24, activeDom.startHeight + deltaY)}px`;
            }
            next.sharedShellOverrides = {
              ...(next.sharedShellOverrides || {}),
              [activeDom.selector]: currentStyle,
            };
          } else {
            const currentStyle = { ...((pageData.domOverrides || {})[activeDom.selector] || {}) };
            if (dragging?.kind === "dom") {
              currentStyle.transform = mergeTranslate(currentStyle.transform || activeDom.startTransform || "", activeDom.startTranslateX + deltaX, activeDom.startTranslateY + deltaY);
            }
            if (resizing?.kind === "dom") {
              currentStyle.width = `${Math.max(24, activeDom.startWidth + deltaX)}px`;
              currentStyle.height = `${Math.max(24, activeDom.startHeight + deltaY)}px`;
            }
            pageData.domOverrides = {
              ...(pageData.domOverrides || {}),
              [activeDom.selector]: currentStyle,
            };
          }
        }
        next.pages[pageKey] = pageData;
        return next;
      });
    };
    const handleUp = () => {
      setDragging(null);
      setResizing(null);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, resizing, pageKey, previewScale]);

  const save = async () => {
    const payload = ensureDesign(design);
    const res = await fetch("http://localhost:3001/designConfig", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return alert("저장 실패");
    try {
      localStorage.setItem(DESIGN_CACHE_KEY, JSON.stringify(payload));
    } catch {}
    window.dispatchEvent(new CustomEvent("plc-design-updated", { detail: { design: payload } }));
    setMessage("저장되었습니다.");
    setIsDirty(false);
    clearTimeout(saveMessageTimerRef.current);
    saveMessageTimerRef.current = setTimeout(() => setMessage(""), 1400);
  };


  useEffect(() => () => clearTimeout(saveMessageTimerRef.current), []);

  const refreshSelectionRect = () => {
    const viewport = previewViewportRef.current;
    const root = previewRootRef.current;
    if (!viewport || !root) {
      setSelectionRect((prev) => (prev === null ? prev : null));
      setPageOverlayRect((prev) => (prev === null ? prev : null));
      return;
    }
    const pageRoot = root.querySelector(`[data-design-page-root="${pageKey}"]`) || root.querySelector("[data-design-page-root]");
    const nextContentHeight = Math.max(previewCanvasHeight, Number(root.scrollHeight || 0), Number(pageRoot?.scrollHeight || 0), Number(root.getBoundingClientRect().height || 0));
    setPreviewContentHeight((prev) => (Math.abs(Number(prev || 0) - nextContentHeight) < 0.5 ? prev : nextContentHeight));
    const nextPageOverlayRect = pageRoot ? getEditorRectWithinRoot(pageRoot, root, previewScale) : null;
    setPageOverlayRect((prev) => (rectEquals(prev, nextPageOverlayRect) ? prev : nextPageOverlayRect));
    if (!selected) {
      setSelectionRect((prev) => (prev === null ? prev : null));
      return;
    }
    let targetNode = null;
    if (selected.kind === "element") {
      targetNode = root.querySelector(`[data-design-element-id="${selected.element.id}"]`);
    } else if (selected.kind === "dom") {
      const scopeRoot = selected.scope === "shell"
        ? root.querySelector(`[data-design-shell-root="${pageKey}"]`) || root.querySelector("[data-design-shell-root]")
        : pageRoot;
      if (scopeRoot) {
        try {
          targetNode = selected.selector === ":scope" ? scopeRoot : scopeRoot.querySelector(selected.selector);
        } catch {
          targetNode = null;
        }
      }
    }
    if (!targetNode) {
      setSelectionRect((prev) => (prev === null ? prev : null));
      return;
    }
    const nextSelectionRect = getEditorRectWithinRoot(targetNode, root, previewScale);
    setSelectionRect((prev) => (rectEquals(prev, nextSelectionRect) ? prev : nextSelectionRect));
  };

  useLayoutEffect(() => {
    refreshSelectionRect();
  }, [selected, design, pageKey, previewScale, previewCanvasWidth, previewCanvasHeight]);

  useEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport) return undefined;
    const refresh = () => refreshSelectionRect();
    viewport.addEventListener("scroll", refresh);
    window.addEventListener("resize", refresh);
    const timer = setInterval(refresh, 800);
    return () => {
      viewport.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
      clearInterval(timer);
    };
  }, [selected, pageKey]);

  const handlePreviewClickCapture = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragging || resizing) return;
    const root = previewRootRef.current;
    if (!root) return;
    let target = event.target;
    if (target?.nodeType === 3) target = target.parentElement;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-design-editor-ignore='true']")) return;

    const pageRoot = root.querySelector(`[data-design-page-root="${pageKey}"]`) || root.querySelector("[data-design-page-root]");
    const shellRoot = root.querySelector(`[data-design-shell-root="${pageKey}"]`) || root.querySelector("[data-design-shell-root]");
    const hitCandidates = document.elementsFromPoint(event.clientX, event.clientY).filter((node) => node instanceof Element && root.contains(node) && !node.closest("[data-design-editor-ignore='true']"));
    const deepTarget = hitCandidates.find((node) => node.hasAttribute?.("data-design-element-id")) || hitCandidates.find((node) => pageRoot && pageRoot.contains(node)) || hitCandidates.find((node) => shellRoot && shellRoot.contains(node)) || target;

    const customTarget = deepTarget.closest("[data-design-element-id]");
    if (customTarget && root.contains(customTarget)) {
      const id = customTarget.getAttribute("data-design-element-id");
      const scope = customTarget.getAttribute("data-design-element-scope") || "page";
      if (id) setSelectedTarget({ kind: "element", id, scope });
      return;
    }

    const insidePage = pageRoot && pageRoot.contains(deepTarget);
    const scope = insidePage ? "page" : shellRoot && shellRoot.contains(deepTarget) ? "shell" : "";
    const scopeRoot = insidePage ? pageRoot : shellRoot;
    if (!scope || !scopeRoot) return;

    const resolvedTarget = resolveSelectableTarget(deepTarget, scopeRoot, { x: event.clientX, y: event.clientY }) || deepTarget;
    const selector = buildSelectorFromNode(resolvedTarget, scopeRoot);
    setSelectedTarget({ kind: "dom", scope, selector, label: getNodeLabel(resolvedTarget) });
  };

  const uploadSelectedFont = (file) => {
    if (!selected || selected.kind !== "element") return;
    const reader = new FileReader();
    reader.onload = () => {
      const family = sanitizeFontFamily(file.name.replace(/\.[^.]+$/, ""), `plc_font_${String(selected.element.id || "element").replace(/[^a-zA-Z0-9_-]/g, "_")}`);
      updateSelectedElement((el) => ({
        ...el,
        style: {
          ...(el.style || {}),
          fontFamily: family,
          fontDataUrl: String(reader.result || ""),
        },
      }));
    };
    reader.readAsDataURL(file);
  };

  const deleteSelected = () => {
    if (!selected) return;
    if (selected.kind === "element") {
      if (selected.scope === "shell") {
        updateDesign((next) => ({
          ...next,
          sharedShellElements: (next.sharedShellElements || []).filter((el) => el.id !== selected.element.id),
        }));
      } else {
        const bucket = getElementBucket(selected.scope);
        updatePage((pg) => ({ ...pg, [bucket]: (pg[bucket] || []).filter((el) => el.id !== selected.element.id) }));
      }
      setSelectedTarget(null);
      return;
    }
    if (selected.kind === "dom") {
      if (selected.scope === "shell") {
        updateDesign((next) => {
          const nextBucket = { ...(next.sharedShellOverrides || {}) };
          delete nextBucket[selected.selector];
          return { ...next, sharedShellOverrides: nextBucket };
        });
      } else {
        updatePage((pg) => {
          const nextBucket = { ...(pg.domOverrides || {}) };
          delete nextBucket[selected.selector];
          return { ...pg, domOverrides: nextBucket };
        });
      }
      setSelectedTarget(null);
    }
  };

  const addPreset = (presetKey, scope = "page") => {
    const factory = PRESET_LIBRARY[presetKey];
    if (!factory) return;
    const nextEl = factory();
    const bucket = getElementBucket(scope);
    if (scope === "shell") {
      updateDesign((next) => ({ ...next, sharedShellElements: [...(next.sharedShellElements || []), nextEl] }));
    } else {
      updatePage((pg) => ({ ...pg, [bucket]: [...(pg[bucket] || []), nextEl] }));
    }
    setSelectedTarget({ kind: "element", id: nextEl.id, scope });
    if (nextEl.type === "image") {
      pendingImageElementIdRef.current = nextEl.id;
      setTimeout(() => imagePickerRef.current?.click(), 0);
    }
  };

  const setBackgroundImage = (value) => {
    updatePage((pg) => ({ ...pg, background: { ...(pg.background || {}), image: String(value || "") } }));
  };

  const setSelectedImage = (value) => {
    if (!selected || selected.kind !== "element" || selected.element.type !== "image") return;
    updateSelectedElement((el) => ({ ...el, src: String(value || "") }));
  };

  const handleImageElementFile = (file) => {
    if (!file || !pendingImageElementIdRef.current) return;
    const reader = new FileReader();
    const nextId = pendingImageElementIdRef.current;
    reader.onload = () => {
      updateDesign((next) => {
        next.pages[pageKey] = {
          ...(next.pages?.[pageKey] || {}),
          elements: ((next.pages?.[pageKey]?.elements) || []).map((el) => (el.id === nextId ? { ...el, src: String(reader.result || "") } : el)),
        };
        next.sharedShellElements = (next.sharedShellElements || []).map((el) => (el.id === nextId ? { ...el, src: String(reader.result || "") } : el));
        return next;
      });
      const imageScope = (shellElements || []).some((el) => el.id === nextId) ? "shell" : "page";
      setSelectedTarget({ kind: "element", id: nextId, scope: imageScope });
      pendingImageElementIdRef.current = "";
      if (imagePickerRef.current) imagePickerRef.current.value = "";
    };
    reader.readAsDataURL(file);
  };

  const editedDomEntries = Object.keys(page.domOverrides || {});
  const editedShellEntries = Object.keys(shellOverrides || {});

  return (
    <div style={{ padding: 26, color: "#13324b", display: "grid", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div className="section-eyebrow">디자인 관리</div>
          <h2 style={{ marginTop: 10, marginBottom: 0 }}>실제 화면 기반 편집</h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="home-primary-button" onClick={save}>저장</button>
          <button type="button" className="ghost-button" onClick={goBack}>뒤로가기</button>
        </div>
      </div>
      {message ? <div style={{ padding: 12, borderRadius: 14, background: "rgba(125,211,252,0.12)" }}>{message}</div> : null}
      <input ref={imagePickerRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && handleImageElementFile(e.target.files[0])} />

      <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr) 390px", gap: 18, alignItems: "start" }}>
        <section style={panelStyle}>
          <div className="section-eyebrow">화면 선택</div>
          <select value={pageKey} onChange={(e) => { setPageKey(e.target.value); setSelectedTarget(null); }} style={inputStyle}>
            {PAGE_KEYS.map((key) => <option key={key} value={key}>{prettyPageLabel(key)}</option>)}
          </select>

          <div className="section-eyebrow" style={{ marginTop: 10 }}>배경 설정</div>
          <ImageDropInput label="배경 이미지" value={page.background?.image || ""} onChange={setBackgroundImage} previewHeight={180} previewFit="cover" compact />
          {inputField("배경 오버레이 / 그라데이션", page.background?.overlay || "", (e) => updatePage((pg) => ({ ...pg, background: { ...(pg.background || {}), overlay: e.target.value } })))}
          {inputField("기본 배경색", page.background?.color || "", (e) => updatePage((pg) => ({ ...pg, background: { ...(pg.background || {}), color: e.target.value } })))}

          <div className="section-eyebrow" style={{ marginTop: 10 }}>기본 요소 추가</div>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#476885", marginBottom: 6 }}>페이지 내부</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {["text", "button", "panel", "image"].map((type) => <button key={`page-${type}`} type="button" className="ghost-button" onClick={() => {
                  const item = addElement(type);
                  updatePage((pg) => ({ ...pg, elements: [...(pg.elements || []), item] }));
                  setSelectedTarget({ kind: "element", id: item.id, scope: "page" });
                  if (type === "image") {
                    pendingImageElementIdRef.current = item.id;
                    setTimeout(() => imagePickerRef.current?.click(), 0);
                  }
                }}>{prettyElementTypeLabel(type)}</button>)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#476885", marginBottom: 6 }}>상단 / 공통</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {["text", "button", "panel", "image"].map((type) => <button key={`shell-${type}`} type="button" className="ghost-button" onClick={() => {
                  const item = addElement(type);
                  updateDesign((next) => ({ ...next, sharedShellElements: [...(next.sharedShellElements || []), item] }));
                  setSelectedTarget({ kind: "element", id: item.id, scope: "shell" });
                  if (type === "image") {
                    pendingImageElementIdRef.current = item.id;
                    setTimeout(() => imagePickerRef.current?.click(), 0);
                  }
                }}>{prettyElementTypeLabel(type)}</button>)}
              </div>
            </div>
          </div>

          <div className="section-eyebrow" style={{ marginTop: 10 }}>빠른 프리셋</div>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#476885", marginBottom: 6 }}>페이지 내부</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {Object.keys(PRESET_LIBRARY).map((key) => <button key={`page-${key}`} type="button" className="ghost-button" onClick={() => addPreset(key, "page")}>{prettyPresetLabel(key)}</button>)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#476885", marginBottom: 6 }}>상단 / 공통</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {Object.keys(PRESET_LIBRARY).map((key) => <button key={`shell-${key}`} type="button" className="ghost-button" onClick={() => addPreset(key, "shell")}>{prettyPresetLabel(key)}</button>)}
              </div>
            </div>
          </div>

          <div className="section-eyebrow" style={{ marginTop: 10 }}>미리보기 크기</div>
          <label style={{ ...toggleLabel, display: "grid", gap: 8 }}>
            <span>{Math.round(previewScale * 100)}%</span>
            <input type="range" min="0.55" max="1" step="0.05" value={previewScale} onChange={(e) => setPreviewScale(Number(e.target.value || 0.74))} />
          </label>

          <div className="section-eyebrow" style={{ marginTop: 10 }}>직접 배치 요소</div>
          <div style={{ display: "grid", gap: 8, maxHeight: 250, overflow: "auto" }}>
            {shellElements.length ? <div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>상단 / 공통</div> : null}
            {shellElements.map((el) => <button key={`shell-${el.id}`} type="button" className={selected?.kind === "element" && selected.scope === "shell" && selected.element.id === el.id ? "home-primary-button" : "ghost-button"} onClick={() => setSelectedTarget({ kind: "element", id: el.id, scope: "shell" })}>{prettyElementTypeLabel(el.type)} · {el.id}</button>)}
            {pageElements.length ? <div style={{ fontSize: 12, fontWeight: 800, color: "#476885", marginTop: shellElements.length ? 4 : 0 }}>페이지 내부</div> : null}
            {pageElements.map((el) => <button key={`page-${el.id}`} type="button" className={selected?.kind === "element" && selected.scope === "page" && selected.element.id === el.id ? "home-primary-button" : "ghost-button"} onClick={() => setSelectedTarget({ kind: "element", id: el.id, scope: "page" })}>{prettyElementTypeLabel(el.type)} · {el.id}</button>)}
            {!shellElements.length && !pageElements.length ? <div style={{ color: "#6a87a3", fontSize: 13 }}>추가한 요소가 아직 없습니다.</div> : null}
          </div>

          <div className="section-eyebrow" style={{ marginTop: 10 }}>실제 화면에서 편집 중인 요소</div>
          <div style={{ display: "grid", gap: 8, maxHeight: 240, overflow: "auto" }}>
            {editedShellEntries.map((selector) => <button key={`shell-${selector}`} type="button" className={selected?.kind === "dom" && selected.scope === "shell" && selected.selector === selector ? "home-primary-button" : "ghost-button"} onClick={() => setSelectedTarget({ kind: "dom", scope: "shell", selector, label: `상단/공통 · ${selector}` })}>상단/공통 · {selector}</button>)}
            {editedDomEntries.map((selector) => <button key={`dom-${selector}`} type="button" className={selected?.kind === "dom" && selected.scope === "page" && selected.selector === selector ? "home-primary-button" : "ghost-button"} onClick={() => setSelectedTarget({ kind: "dom", scope: "page", selector, label: `페이지 · ${selector}` })}>페이지 · {selector}</button>)}
            {!editedShellEntries.length && !editedDomEntries.length ? <div style={{ color: "#6a87a3", fontSize: 13 }}>가운데 실제 화면을 눌러서 선택해 주세요.</div> : null}
          </div>
        </section>

        <section style={panelStyle}>
          <div className="section-eyebrow">전체 미리보기</div>
          <div style={{ color: "#62839a", fontSize: 13, marginTop: -4 }}>실제 페이지 컴포넌트를 그대로 렌더하고 있습니다. 드래그 중에는 선택한 요소만 움직이며, 미리보기 내부 클릭은 실제 기능을 실행하지 않습니다.</div>
          <div ref={previewViewportRef} style={{ overflow: "auto", borderRadius: 26, border: "1px solid rgba(98,176,220,0.18)", background: "linear-gradient(180deg, rgba(255,255,255,0.88), rgba(236,248,255,0.88))", padding: 18, maxHeight: 860, position: "relative" }}>
            <div style={{ width: previewCanvasWidth, transform: `scale(${previewScale})`, transformOrigin: "top left", height: previewContentHeight * previewScale, position: "relative" }}>
              <div ref={previewRootRef} onPointerDownCapture={handlePreviewClickCapture} onClickCapture={(event) => { event.preventDefault(); event.stopPropagation(); }} onDoubleClickCapture={(event) => { event.preventDefault(); event.stopPropagation(); }} onSubmitCapture={(event) => { event.preventDefault(); event.stopPropagation(); }} style={{ width: previewCanvasWidth, minHeight: previewCanvasHeight, position: "relative", cursor: dragging || resizing ? "grabbing" : "crosshair" }}>
                <PreviewShell pageKey={pageKey} design={design} theme={design.theme || {}} canvasWidth={previewCanvasWidth} canvasHeight={previewCanvasHeight} />
                <div style={{ position: "absolute", inset: 0, zIndex: 4999, pointerEvents: "none" }}>{shellElements.map((el) => (
                  <ElementPreview
                    key={`shell-preview-${el.id}`}
                    element={el}
                    scope="shell"
                    isSelected={selected?.kind === "element" && selected.scope === "shell" && selected.element.id === el.id}
                    dragging={dragging}
                    interactionLocked={!!dragging || !!resizing}
                    setDragging={setDragging}
                    setResizing={setResizing}
                    setSelectedTarget={setSelectedTarget}
                  />
                ))}</div>
                {pageOverlayRect ? <div style={{ position: "absolute", left: pageOverlayRect.left, top: pageOverlayRect.top, width: pageOverlayRect.width, height: pageOverlayRect.height, zIndex: 5000, pointerEvents: "none" }}>{pageElements.map((el) => (
                  <ElementPreview
                    key={`page-preview-${el.id}`}
                    element={el}
                    scope="page"
                    isSelected={selected?.kind === "element" && selected.scope === "page" && selected.element.id === el.id}
                    dragging={dragging}
                    interactionLocked={!!dragging || !!resizing}
                    setDragging={setDragging}
                    setResizing={setResizing}
                    setSelectedTarget={setSelectedTarget}
                  />
                ))}</div> : null}
              </div>
              {selectionRect ? (
                <div
                  data-design-editor-ignore="true"
                  style={{ position: "absolute", left: selectionRect.left, top: selectionRect.top, width: selectionRect.width, height: selectionRect.height, border: "2px solid rgba(29,157,255,0.95)", boxShadow: "0 0 0 9999px rgba(29,157,255,0.04)", borderRadius: 8, pointerEvents: "none", zIndex: 9999 }}
                >
                  <div
                    data-design-editor-ignore="true"
                    onMouseDown={(event) => {
                      if (!selected) return;
                      event.stopPropagation();
                      if (selected.kind === "element") {
                        setDragging({ kind: "element", id: selected.element.id, scope: selected.scope, clientX: event.clientX, clientY: event.clientY, startX: Number(selected.element.x || 0), startY: Number(selected.element.y || 0) });
                      } else if (selected.kind === "dom") {
                        const parsed = parseTranslate(selected.style?.transform || "");
                        setDragging({ kind: "dom", scope: selected.scope, selector: selected.selector, clientX: event.clientX, clientY: event.clientY, startTranslateX: parsed.x, startTranslateY: parsed.y, startTransform: selected.style?.transform || "" });
                      }
                    }}
                    style={{ position: "absolute", left: -8, top: -8, minWidth: 52, height: 22, padding: "0 10px", borderRadius: 999, background: "rgba(29,157,255,0.98)", border: "2px solid white", color: "white", fontSize: 11, fontWeight: 900, display: "grid", placeItems: "center", cursor: "move", pointerEvents: "auto" }}
                  >
                    이동
                  </div>
                  <div
                    data-design-editor-ignore="true"
                    onMouseDown={(event) => {
                      event.stopPropagation();
                      if (!selected) return;
                      if (selected.kind === "element") {
                        setResizing({ kind: "element", id: selected.element.id, scope: selected.scope, clientX: event.clientX, clientY: event.clientY, startWidth: Number(selected.element.width || selectionRect.width), startHeight: Number(selected.element.height || selectionRect.height) });
                      } else if (selected.kind === "dom") {
                        setResizing({ kind: "dom", scope: selected.scope, selector: selected.selector, clientX: event.clientX, clientY: event.clientY, startWidth: Number(parseFloat(selected.style?.width || "") || selectionRect.width), startHeight: Number(parseFloat(selected.style?.height || "") || selectionRect.height) });
                      }
                    }}
                    style={{ position: "absolute", right: -7, bottom: -7, width: 16, height: 16, borderRadius: 999, background: "rgba(29,157,255,0.98)", border: "2px solid white", cursor: "nwse-resize", pointerEvents: "auto" }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section style={panelStyle}>
          <div className="section-eyebrow">선택 요소 편집</div>
          {!selected ? <div style={{ color: "#6a87a3" }}>가운데 미리보기에서 요소를 클릭해 주세요.</div> : null}

          {selected?.kind === "element" ? (
            <>
              <div style={{ padding: 12, borderRadius: 16, background: "rgba(125,211,252,0.10)", color: "#28506d", lineHeight: 1.6 }}>
                <div style={{ fontWeight: 900, marginBottom: 4 }}>{selected.scope === "shell" ? "상단 / 공통 요소" : "페이지 내부 요소"}</div>
                <div style={{ fontSize: 12, color: "#62839a" }}>X/Y 값은 음수도 가능하며, 상단/공통으로 옮기면 미리보기 바깥 영역까지 배치할 수 있습니다.</div>
              </div>
              {selectField("배치 영역", selected.scope, (value) => {
                const nextScope = value || "page";
                if (nextScope === selected.scope) return;
                const fromBucket = getElementBucket(selected.scope);
                const toBucket = getElementBucket(nextScope);
                const movingElement = clone(selected.element);
                if (selected.scope === "shell" || nextScope === "shell") {
                  updateDesign((next) => {
                    const currentPageData = next.pages?.[pageKey] || { background: {}, elements: [], shellElements: [], domOverrides: {}, shellOverrides: {} };
                    const nextPageElements = [...(currentPageData.elements || [])];
                    let nextSharedShellElements = [...(next.sharedShellElements || shellElements || [])];
                    if (selected.scope === "shell") {
                      nextSharedShellElements = nextSharedShellElements.filter((el) => el.id !== movingElement.id);
                    } else {
                      currentPageData.elements = nextPageElements.filter((el) => el.id !== movingElement.id);
                    }
                    if (nextScope === "shell") nextSharedShellElements = [...nextSharedShellElements, movingElement];
                    else currentPageData.elements = [...(currentPageData.elements || []), movingElement];
                    next.sharedShellElements = nextSharedShellElements;
                    next.pages[pageKey] = currentPageData;
                    return next;
                  });
                } else {
                  updatePage((pg) => ({
                    ...pg,
                    [fromBucket]: (pg[fromBucket] || []).filter((el) => el.id !== movingElement.id),
                    [toBucket]: [...(pg[toBucket] || []), movingElement],
                  }));
                }
                setSelectedTarget({ kind: "element", id: movingElement.id, scope: nextScope });
              }, [{ value: "page", label: "페이지 내부" }, { value: "shell", label: "상단 / 공통" }])}
              {inputField("텍스트 / 버튼 문구", selected.element.text || "", (e) => updateSelectedElement((el) => ({ ...el, text: e.target.value })))}
              {selected.element.type === "image" ? <ImageDropInput label="요소 이미지" value={selected.element.src || ""} onChange={setSelectedImage} previewHeight={180} previewFit="contain" compact /> : null}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {inputField("가로 위치 (X)", String(selected.element.x || 0), (e) => updateSelectedElement((el) => ({ ...el, x: Number(e.target.value || 0) })), { type: "number" })}
                {inputField("세로 위치 (Y)", String(selected.element.y || 0), (e) => updateSelectedElement((el) => ({ ...el, y: Number(e.target.value || 0) })), { type: "number" })}
                {inputField("가로 크기", String(selected.element.width || 0), (e) => updateSelectedElement((el) => ({ ...el, width: Number(e.target.value || 0) })), { type: "number" })}
                {inputField("세로 크기", String(selected.element.height || 0), (e) => updateSelectedElement((el) => ({ ...el, height: Number(e.target.value || 0) })), { type: "number" })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {selectField("레이어 순서", String(selected.element.zIndex || 1), (value) => updateSelectedElement((el) => ({ ...el, zIndex: Number(value || 1) })), Array.from({ length: 15 }, (_, idx) => ({ value: String(idx + 1), label: `${idx + 1}단` })))}
                {rangeField("투명도", Number(selected.element.style?.opacity ?? 1), (value) => updateSelectedElementStyle({ opacity: Number(value || 1) }), 0, 1, 0.05)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button type="button" className="ghost-button" onClick={() => updateSelectedElement((el) => ({ ...el, zIndex: Math.max(1, Number(el.zIndex || 1) + 1) }))}>레이어 올리기</button>
                <button type="button" className="ghost-button" onClick={() => updateSelectedElement((el) => ({ ...el, zIndex: Math.max(1, Number(el.zIndex || 1) - 1) }))}>레이어 내리기</button>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>클릭 액션</div>
                <select value={selected.element.action || ""} onChange={(e) => updateSelectedElement((el) => ({ ...el, action: e.target.value }))} style={inputStyle}>
                  <option value="">클릭 액션 없음</option>
                  {ACTION_OPTIONS.filter(Boolean).map((key) => <option key={key} value={key}>{prettyActionLabel(key)}</option>)}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {rangeField("호버 확대 비율", Number(selected.element.hoverScale || 1), (value) => updateSelectedElement((el) => ({ ...el, hoverScale: Number(value || 1) })), 1, 1.4, 0.01)}
                {selectField("글자 크기", String(selected.element.style?.fontSize || ""), (value) => updateSelectedElementStyle({ fontSize: Number(value || 0) || "" }), ["", 12, 14, 16, 18, 20, 24, 28, 32, 40].map((value) => ({ value: String(value), label: value ? `${value}px` : "기본값" })))}
                {selectField("글자 굵기", String(selected.element.style?.fontWeight || ""), (value) => updateSelectedElementStyle({ fontWeight: value }), [{ value: "", label: "기본값" }, { value: "400", label: "보통" }, { value: "700", label: "굵게" }, { value: "900", label: "매우 굵게" }])}
                {selectField("모서리", String(selected.element.style?.borderRadius || ""), (value) => updateSelectedElementStyle({ borderRadius: value }), ["", "0px", "8px", "14px", "18px", "24px", "32px", "999px"].map((value) => ({ value, label: value || "기본값" })))}
              </div>
              {selected.element.type !== "image" ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>폰트 파일 업로드</div>
                  <input type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={(e) => e.target.files?.[0] && uploadSelectedFont(e.target.files[0])} />
                  {selected.element.style?.fontDataUrl ? <button type="button" className="ghost-button" onClick={() => updateSelectedElementStyle({ fontDataUrl: "" })}>업로드 폰트 제거</button> : null}
                </div>
              ) : null}
              {inputField("폰트 이름", selected.element.style?.fontFamily || "", (e) => updateSelectedElementStyle({ fontFamily: e.target.value }))}
              {inputField("배경 / 그라데이션", selected.element.style?.background || "", (e) => updateSelectedElementStyle({ background: e.target.value }))}
              {inputField("글자색", selected.element.style?.color || "", (e) => updateSelectedElementStyle({ color: e.target.value }))}
              {selectField("발광 / 그림자", String(selected.element.style?.boxShadow || ""), (value) => updateSelectedElementStyle({ boxShadow: value }), [
                { value: "", label: "없음" },
                { value: "0 12px 24px rgba(0,0,0,0.12)", label: "기본 그림자" },
                { value: "0 0 24px rgba(85,199,255,0.42)", label: "발광" },
                { value: "0 18px 40px rgba(73,132,170,0.20)", label: "떠오름" },
              ])}
              {selectField("필터", String(selected.element.style?.filter || ""), (value) => updateSelectedElementStyle({ filter: value }), [{ value: "", label: "없음" }, { value: "blur(0.2px)", label: "살짝 흐림" }, { value: "saturate(1.1)", label: "색 선명" }])}
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>효과 프리셋</div>
                <select value={selected.element.effectPreset || "none"} onChange={(e) => updateSelectedElement((el) => ({ ...el, effectPreset: e.target.value, style: { ...(el.style || {}), ...EFFECT_PRESETS[e.target.value] } }))} style={inputStyle}>
                  {Object.keys(EFFECT_PRESETS).map((key) => <option key={key} value={key}>{{ none: "없음", glow: "발광", rise: "떠오름", blur: "흐림", zoom: "확대" }[key] || key}</option>)}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button type="button" className="ghost-button" onClick={() => { const copied = { ...clone(selected.element), id: `el-${Date.now()}` }; const bucket = getElementBucket(selected.scope); updatePage((pg) => ({ ...pg, [bucket]: [...(pg[bucket] || []), copied] })); setSelectedTarget({ kind: "element", id: copied.id, scope: selected.scope }); }}>복제</button>
                <button type="button" className="ghost-button" onClick={deleteSelected}>삭제</button>
              </div>
            </>
          ) : null}

          {selected?.kind === "dom" ? (
            <>
              <div style={{ padding: 12, borderRadius: 16, background: "rgba(125,211,252,0.10)", color: "#28506d", lineHeight: 1.6 }}>
                <div style={{ fontWeight: 900, marginBottom: 4 }}>{selected.scope === "shell" ? "상단 / 공통 요소" : "페이지 내부 요소"}</div>
                <div>{selected.label || "선택 요소"}</div>
                <div style={{ fontSize: 12, color: "#62839a", marginTop: 4, wordBreak: "break-all" }}>{selected.selector}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {inputField("가로 크기", String(selected.style?.width || ""), (e) => updateSelectedDomStyle({ width: e.target.value }), { placeholder: "예: 320px, 100%, fit-content" })}
                {inputField("세로 크기", String(selected.style?.height || ""), (e) => updateSelectedDomStyle({ height: e.target.value }), { placeholder: "예: 220px, fit-content" })}
                {inputField("안쪽 여백", String(selected.style?.padding || ""), (e) => updateSelectedDomStyle({ padding: e.target.value }), { placeholder: "예: 12px" })}
                {inputField("위아래 위치", String(selected.style?.marginTop || ""), (e) => updateSelectedDomStyle({ marginTop: e.target.value }), { placeholder: "예: -12px, 24px" })}
                {inputField("좌우 위치", String(selected.style?.marginLeft || ""), (e) => updateSelectedDomStyle({ marginLeft: e.target.value }), { placeholder: "예: -20px, 36px" })}
                {inputField("미세 이동 / 확대", String(selected.style?.transform || ""), (e) => updateSelectedDomStyle({ transform: e.target.value }), { placeholder: "예: translateX(8px) scale(1.02)" })}
              </div>
              {inputField("배경 / 그라데이션", selected.style?.background || "", (e) => updateSelectedDomStyle({ background: e.target.value }))}
              {inputField("글자색", selected.style?.color || "", (e) => updateSelectedDomStyle({ color: e.target.value }))}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {selectField("글자 크기", String(selected.style?.fontSize || ""), (value) => updateSelectedDomStyle({ fontSize: value }), [{ value: "", label: "기본값" }, { value: "12px", label: "12px" }, { value: "14px", label: "14px" }, { value: "16px", label: "16px" }, { value: "18px", label: "18px" }, { value: "24px", label: "24px" }, { value: "32px", label: "32px" }])}
                {selectField("글자 굵기", String(selected.style?.fontWeight || ""), (value) => updateSelectedDomStyle({ fontWeight: value }), [{ value: "", label: "기본값" }, { value: "400", label: "보통" }, { value: "700", label: "굵게" }, { value: "900", label: "매우 굵게" }])}
                {selectField("모서리", String(selected.style?.borderRadius || ""), (value) => updateSelectedDomStyle({ borderRadius: value }), [{ value: "", label: "기본값" }, { value: "0px", label: "없음" }, { value: "8px", label: "8px" }, { value: "14px", label: "14px" }, { value: "18px", label: "18px" }, { value: "24px", label: "24px" }, { value: "999px", label: "완전 둥글게" }])}
                {selectField("테두리", String(selected.style?.border || ""), (value) => updateSelectedDomStyle({ border: value }), [{ value: "", label: "기본값" }, { value: "none", label: "없음" }, { value: "1px solid rgba(98,176,220,0.18)", label: "얇은 테두리" }, { value: "2px solid rgba(29,157,255,0.34)", label: "강조 테두리" }])}
                {selectField("그림자", String(selected.style?.boxShadow || ""), (value) => updateSelectedDomStyle({ boxShadow: value }), [{ value: "", label: "없음" }, { value: "0 12px 24px rgba(0,0,0,0.12)", label: "기본 그림자" }, { value: "0 18px 40px rgba(73,132,170,0.16)", label: "부드러운 그림자" }, { value: "0 0 24px rgba(85,199,255,0.42)", label: "발광" }])}
                {rangeField("투명도", Number(selected.style?.opacity || 1), (value) => updateSelectedDomStyle({ opacity: value }), 0, 1, 0.05)}
              </div>
              {selectField("필터", String(selected.style?.filter || ""), (value) => updateSelectedDomStyle({ filter: value }), [{ value: "", label: "없음" }, { value: "blur(0.2px)", label: "살짝 흐림" }, { value: "brightness(1.05)", label: "조금 밝게" }, { value: "saturate(1.1)", label: "색 선명" }])}
              {selectField("표시 방식", String(selected.style?.display || ""), (value) => updateSelectedDomStyle({ display: value }), [{ value: "", label: "기본값" }, { value: "block", label: "블록" }, { value: "flex", label: "가로 정렬" }, { value: "grid", label: "격자 정렬" }, { value: "none", label: "숨김" }])}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button type="button" className="ghost-button" onClick={() => updateSelectedDomStyle({})}>유지</button>
                <button type="button" className="ghost-button" onClick={deleteSelected}>이 요소 편집 제거</button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

const panelStyle = { padding: 18, borderRadius: 24, background: "rgba(255,255,255,0.78)", border: "1px solid rgba(98,176,220,0.18)", boxShadow: "0 18px 38px rgba(73,132,170,0.10)", display: "grid", gap: 10 };
const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(98,176,220,0.18)", background: "rgba(255,255,255,0.92)", color: "#16324a", boxSizing: "border-box" };
const toggleLabel = { display: "flex", alignItems: "center", gap: 8, color: "#486d8a", fontSize: 14 };
