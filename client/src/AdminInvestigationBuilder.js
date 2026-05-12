import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, buildApiUrl } from "./api";
import ImageDropInput from "./ImageDropInput";
import AudioSourceInput from "./AudioSourceInput";

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


function normalizeOptionalNpcLineIndex(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? next : undefined;
}

function normalizeImageFrame(frame) {
  return {
    x: Math.max(0, Math.min(100, Number(frame?.x ?? 50))),
    y: Math.max(0, Math.min(100, Number(frame?.y ?? 50))),
    scale: Math.max(1, Math.min(3, Number(frame?.scale ?? 1))),
  };
}

function getCoverFrameStyle(frame = {}) {
  const safe = normalizeImageFrame(frame);
  const offsetX = (safe.x - 50) * 0.52;
  const offsetY = (safe.y - 50) * 0.52;
  return {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: `translate(${offsetX}%, ${offsetY}%) scale(${safe.scale})`,
    transformOrigin: "center center",
    userSelect: "none",
    pointerEvents: "none",
  };
}


async function readJsonResponseSafely(response, fallbackMessage = "응답을 읽지 못했습니다.") {
  const text = await response.text();
  if (!text) {
    return { success: response.ok, message: response.ok ? "" : fallbackMessage };
  }
  try {
    return JSON.parse(text);
  } catch {
    const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return {
      success: false,
      message: plain ? `${fallbackMessage} ${plain.slice(0, 180)}` : fallbackMessage,
    };
  }
}

function InvestigationImageFrameEditor({ image = "", frame = { x: 50, y: 50, scale: 1 }, title = "조사 카드", mode = "list", onFrameChange }) {
  const dragRef = useRef(null);
  const safeFrame = normalizeImageFrame(frame);
  const updateFrame = (patch = {}) => {
    if (!onFrameChange) return;
    onFrameChange(normalizeImageFrame({ ...safeFrame, ...patch }));
  };
  const startDrag = (event) => {
    if (!image) return;
    const rect = event.currentTarget.getBoundingClientRect?.();
    if (!rect) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      frame: safeFrame,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
  };
  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextX = drag.frame.x + ((event.clientX - drag.startX) / drag.width) * 100 / 0.52;
    const nextY = drag.frame.y + ((event.clientY - drag.startY) / drag.height) * 100 / 0.52;
    updateFrame({ x: nextX, y: nextY });
  };
  const endDrag = (event) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const previewMinHeight = mode === "entry" ? 260 : 188;
  const overlayBackground = mode === "entry"
    ? "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.76) 28%, rgba(255,255,255,0.18) 100%)"
    : "linear-gradient(90deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.82) 34%, rgba(255,255,255,0.24) 72%, rgba(255,255,255,0.06) 100%)";

  return (
    <div style={{ display: "grid", gap: 10, padding: 12, borderRadius: 18, background: "rgba(245,251,255,0.9)", border: "1px solid rgba(98,176,220,0.18)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: "#476885" }}>{mode === "entry" ? "첫 화면 카드 위치/크기" : "목록 카드 위치/크기"}</div>
        <button type="button" className="ghost-button" onClick={() => onFrameChange?.({ x: 50, y: 50, scale: 1 })}>초기화</button>
      </div>
      <div
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: "relative",
          minHeight: previewMinHeight,
          overflow: "hidden",
          borderRadius: 18,
          background: "linear-gradient(135deg, rgba(219,234,254,0.8), rgba(15,23,42,0.12))",
          cursor: image ? "grab" : "default",
          touchAction: "none",
          border: "1px solid rgba(15,23,42,0.08)",
        }}
        title={image ? "마우스로 드래그해서 카드 이미지 위치를 조정할 수 있습니다." : "먼저 이미지를 넣어주세요."}
      >
        {image ? <img src={image} alt={title} draggable={false} style={getCoverFrameStyle(safeFrame)} /> : <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#6a87a3", fontSize: 12, fontWeight: 800 }}>이미지를 넣으면 여기서 위치를 조정할 수 있습니다.</div>}
        {image ? <div style={{ position: "absolute", inset: 0, background: overlayBackground, pointerEvents: "none" }} /> : null}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 800, color: "#476885" }}>
          크기
          <input type="range" min="1" max="3" step="0.01" value={safeFrame.scale} onChange={(event) => updateFrame({ scale: Number(event.target.value || 1) })} />
        </label>
        <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 800, color: "#476885" }}>
          가로 위치
          <input type="range" min="0" max="100" step="0.1" value={safeFrame.x} onChange={(event) => updateFrame({ x: Number(event.target.value || 50) })} />
        </label>
        <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 800, color: "#476885" }}>
          세로 위치
          <input type="range" min="0" max="100" step="0.1" value={safeFrame.y} onChange={(event) => updateFrame({ y: Number(event.target.value || 50) })} />
        </label>
      </div>
      <div style={{ fontSize: 12, color: "#6a87a3" }}>이미지는 늘리지 않고 비율을 유지한 채 카드 영역을 채웁니다.</div>
    </div>
  );
}

function emptyAction() {
  return { label: "", log: "", points: 0, item: "", reward: "", clue: "", clueText: "", clueImage: "", statPoints: 0, damage: 0, muteMinutes: 0, onEnterDamage: 0, onEnterMuteMinutes: 0 };
}

function createNode(id = `node-${Date.now()}`) {
  return {
    id,
    name: "",
    log: "",
    image: "",
    mapX: 430,
    mapY: 260,
    choices: [],
    investigations: [],
    actionResults: {},
    battle: null,
    npcScene: null,
    clues: [],
    onEnterDamage: 0,
    onEnterMuteMinutes: 0,
  };
}

function emptyBuilder() {
  return {
    id: `custom-${Date.now()}`,
    title: "",
    type: "group",
    backgroundImage: "",
    listImage: "",
    listImageFrame: { x: 50, y: 50, scale: 1 },
    entryImageFrame: { x: 50, y: 50, scale: 1 },
    imageUpdatedAt: 0,
    bgmUrl: "",
    bgmVolume: 1,
    entryCorrosion: 0,
    endCorrosion: 0,
    start: "start",
    nodes: [createNode("start")],
  };
}

export default function AdminInvestigationBuilder({ goBack, initialInvestigationId = "" }) {
  const [builder, setBuilder] = useState(emptyBuilder());
  const [selectedNodeId, setSelectedNodeId] = useState("start");
  const [draggingNodeId, setDraggingNodeId] = useState(null);
  const previewRef = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const [savedList, setSavedList] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [message, setMessage] = useState("");
  const isEditingInvestigation = !!String(initialInvestigationId || "").trim();
  const initialLoadKeyRef = useRef("");

  const selectedNode = useMemo(() => builder.nodes.find((node) => node.id === selectedNodeId) || builder.nodes[0], [builder, selectedNodeId]);

  const loadSaved = async () => {
    const res = await apiFetch(`/admin/customInvestigations?t=${Date.now()}`);
    setSavedList(await res.json());
  };


  useEffect(() => { loadSaved().catch(console.error); }, []);
  useEffect(() => {
    apiFetch(`/shopItems?t=${Date.now()}`)
      .then((res) => res.json())
      .then((data) => setCatalog(Array.isArray(data) ? data : []))
      .catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    initialLoadKeyRef.current = "";
    if (!initialInvestigationId) {
      const fresh = emptyBuilder();
      setBuilder(fresh);
      setSelectedNodeId(fresh.start);
      setMessage("");
    }
  }, [initialInvestigationId]);

  useEffect(() => {
    const targetId = String(initialInvestigationId || "").trim();
    if (!targetId || initialLoadKeyRef.current === targetId) return undefined;
    const found = savedList.find((item) => String(item.id) === targetId);
    if (found) {
      initialLoadKeyRef.current = targetId;
      loadTemplate(found);
      return undefined;
    }
    let cancelled = false;
    apiFetch(`/investigations/${targetId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || initialLoadKeyRef.current === targetId) return;
        if (data?.id) {
          initialLoadKeyRef.current = targetId;
          loadTemplate(data);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [initialInvestigationId, savedList]);

  const updateNode = (nodeId, updater) => {
    setBuilder((prev) => ({ ...prev, nodes: prev.nodes.map((node) => node.id === nodeId ? updater(node) : node) }));
  };

  const addNode = () => {
    const node = createNode();
    setBuilder((prev) => ({ ...prev, nodes: [...prev.nodes, node] }));
    setSelectedNodeId(node.id);
  };

  const removeNode = (nodeId) => {
    if (builder.nodes.length <= 1) return;
    const nextNodes = builder.nodes.filter((node) => node.id !== nodeId).map((node) => ({ ...node, choices: (node.choices || []).filter((choice) => choice.target !== nodeId) }));
    setBuilder((prev) => ({ ...prev, nodes: nextNodes, start: prev.start === nodeId ? nextNodes[0].id : prev.start }));
    setSelectedNodeId(nextNodes[0].id);
  };

  const serialize = () => {
    const safeId = String(builder.id || `custom-${Date.now()}`).trim();
    const safeTitle = String(builder.title || "새 조사").trim() || "새 조사";
    const nodeIds = (Array.isArray(builder.nodes) ? builder.nodes : []).map((node) => String(node?.id || "").trim()).filter(Boolean);
    const rawStart = String(builder.start || builder.nodes?.[0]?.id || "start").trim() || "start";
    const safeStart = nodeIds.includes(rawStart) ? rawStart : (nodeIds[0] || "start");
    return {
      id: safeId,
      title: safeTitle,
      type: builder.type,
      backgroundImage: builder.backgroundImage,
      listImage: builder.listImage,
      listImageFrame: normalizeImageFrame(builder.listImageFrame),
      entryImageFrame: normalizeImageFrame(builder.entryImageFrame || builder.listImageFrame),
      imageUpdatedAt: Number(builder.imageUpdatedAt || 0),
      bgmUrl: builder.bgmUrl,
      bgmVolume: builder.bgmVolume,
      entryCorrosion: Number(builder.entryCorrosion || 0),
      endCorrosion: Number(builder.endCorrosion || 0),
      data: {
        start: safeStart,
        backgroundImage: builder.backgroundImage,
        listImage: builder.listImage,
        listImageFrame: normalizeImageFrame(builder.listImageFrame),
        entryImageFrame: normalizeImageFrame(builder.entryImageFrame || builder.listImageFrame),
        imageUpdatedAt: Number(builder.imageUpdatedAt || 0),
        bgmUrl: builder.bgmUrl,
        bgmVolume: builder.bgmVolume,
        entryCorrosion: Number(builder.entryCorrosion || 0),
        endCorrosion: Number(builder.endCorrosion || 0),
        nodes: Object.fromEntries(
          builder.nodes.map((node) => [node.id, {
            name: node.name || node.id,
            log: node.log || "",
            image: node.image || "",
            investigations: (node.investigations || []).map((value) => String(value || "").trim()).filter(Boolean),
            choices: (node.choices || []).map((choice) => ({ text: String(choice.text || "").trim(), target: String(choice.target || "").trim() })).filter((choice) => choice.text),
            battle: node.battle ? {
              ...node.battle,
              hp: Number(node.battle.hp || 0),
              maxHp: Number(node.battle.maxHp || node.battle.hp || 0),
              atk: Number(node.battle.atk || 0),
              def: Number(node.battle.def || 0),
              agi: Number(node.battle.agi || 0),
              aoe_chance: Number(node.battle.aoe_chance || 0),
              finisher_chance: Number(node.battle.finisher_chance || 0),
              rewardPoints: Number(node.battle.rewardPoints || 0),
            } : null,
            npcScene: node.npcScene ? {
              ...node.npcScene,
              profileImage: String(node.npcScene.profileImage || ""),
              lines: (node.npcScene.lines || []).map((line) => ({
                text: String(line.text || ""),
                options: (line.options || []).map((option) => ({
                  text: String(option.text || ""),
                  nextIndex: normalizeOptionalNpcLineIndex(option.nextIndex),
                  rewardItem: String(option.rewardItem || ""),
                  rewardStatPoints: Number(option.rewardStatPoints || 0),
                  clue: option.clue || "",
                })),
              })),
            } : null,
            clues: (node.clues || []).map((clue, index) => ({
              id: clue.id || `clue-${node.id}-${index}`,
              title: String(clue.title || ""),
              text: String(clue.text || clue.description || ""),
              description: String(clue.description || clue.text || ""),
              image: String(clue.image || ""),
            })),
            onEnterDamage: Number(node.onEnterDamage || 0),
            onEnterMuteMinutes: Number(node.onEnterMuteMinutes || 0),
            mapX: Number(node.mapX || 0),
            mapY: Number(node.mapY || 0),
            actionResults: Object.fromEntries(
              Object.entries(node.actionResults || {}).map(([key, value]) => [key, {
                ...value,
                log: String(value?.log || ""),
                points: Number(value?.points || 0),
                item: String(value?.item || ""),
                reward: String(value?.reward || ""),
                clue: String(value?.clue || ""),
                clueText: String(value?.clueText || ""),
                clueImage: String(value?.clueImage || ""),
                statPoints: Number(value?.statPoints || 0),
                damage: Number(value?.damage || 0),
                muteMinutes: Number(value?.muteMinutes || 0),
              }])
            ),
          }])
        ),
      },
    };
  };

  const saveTemplate = async () => {
    const serialized = serialize();
    const payload = { id: serialized.id, title: serialized.title, type: builder.type, json: serialized };
    const res = await apiFetch("/admin/customInvestigations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await readJsonResponseSafely(res, "조사 템플릿 저장 응답을 읽지 못했습니다.");
    if (!data.success || !res.ok) return alert(data.message || "저장 실패");
    setMessage("저장됐습니다.");
    loadSaved();
  };

  const publishTemplate = async () => {
    const payload = serialize();
    const res = await apiFetch("/admin/publishInvestigation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await readJsonResponseSafely(res, "조사 저장 응답을 읽지 못했습니다.");
    if (!data.success || !res.ok) return alert(data.message || (isEditingInvestigation ? "조사 저장 실패" : "조사 등록 실패"));
    setBuilder((prev) => ({ ...prev, start: payload.data?.start || prev.start, imageUpdatedAt: payload.imageUpdatedAt || prev.imageUpdatedAt }));
    setSelectedNodeId((prevSelectedNodeId) => builder.nodes.some((node) => node.id === prevSelectedNodeId) ? prevSelectedNodeId : (payload.data?.start || prevSelectedNodeId));
    setMessage(isEditingInvestigation ? "조사 저장 완료" : "조사에 반영됐습니다.");
    loadSaved();
  };

  const loadTemplate = (template) => {
    const json = template?.json || template || {};
    const rawNodes = json?.data?.nodes || template?.data?.nodes || {};
    const nodes = Object.entries(rawNodes).map(([id, node]) => ({
      id,
      name: node.name || id,
      log: node.log || "",
      image: node.image || "",
      mapX: node.mapX ?? 30,
      mapY: node.mapY ?? 30,
      choices: Array.isArray(node.choices) ? node.choices : [],
      investigations: Array.isArray(node.investigations) ? node.investigations : [],
      actionResults: node.actionResults || {},
      battle: node.battle || null,
      npcScene: node.npcScene || null,
      clues: Array.isArray(node.clues) ? node.clues : [],
      onEnterDamage: Number(node.onEnterDamage || 0),
      onEnterMuteMinutes: Number(node.onEnterMuteMinutes || 0),
    }));
    const startNodeId = json?.data?.start || template?.data?.start || nodes[0]?.id || "start";
    const backgroundImage = json?.backgroundImage || json?.data?.backgroundImage || template?.backgroundImage || template?.data?.backgroundImage || "";
    const listImage = json?.listImage || json?.data?.listImage || template?.listImage || template?.data?.listImage || "";
    const listImageFrame = normalizeImageFrame(json?.listImageFrame || json?.data?.listImageFrame || template?.listImageFrame || template?.data?.listImageFrame);
    const entryImageFrame = normalizeImageFrame(json?.entryImageFrame || json?.data?.entryImageFrame || template?.entryImageFrame || template?.data?.entryImageFrame || listImageFrame);
    const imageUpdatedAt = Number(json?.imageUpdatedAt ?? json?.data?.imageUpdatedAt ?? template?.imageUpdatedAt ?? template?.data?.imageUpdatedAt ?? 0);
    const bgmUrl = json?.bgmUrl || json?.data?.bgmUrl || template?.bgmUrl || template?.data?.bgmUrl || "";
    const bgmVolume = Math.max(0, Math.min(1, Number(json?.bgmVolume ?? json?.data?.bgmVolume ?? template?.bgmVolume ?? template?.data?.bgmVolume ?? 1) || 1));
    const entryCorrosion = Number(json?.entryCorrosion ?? json?.data?.entryCorrosion ?? template?.entryCorrosion ?? template?.data?.entryCorrosion ?? 0);
    const endCorrosion = Number(json?.endCorrosion ?? json?.data?.endCorrosion ?? template?.endCorrosion ?? template?.data?.endCorrosion ?? 0);
    setBuilder({ id: template.id, title: template.title || "", type: template.type || "group", backgroundImage, listImage, listImageFrame, entryImageFrame, imageUpdatedAt, bgmUrl, bgmVolume, entryCorrosion, endCorrosion, start: startNodeId, nodes: nodes.length ? nodes : [createNode("start")] });
    setSelectedNodeId(startNodeId);
    setMessage(`${template.title} 불러오기 완료`);
  };

  const deleteTemplate = async (id) => {
    await apiFetch(`/admin/customInvestigations/${id}`, { method: "DELETE" });
    setSavedList((prev) => prev.filter((item) => item.id !== id));
  };

  const setNodeImageFile = async (file, key = "image") => {
    const dataUrl = await toDataUrl(file);
    if (key === "background") {
      setBuilder((prev) => ({ ...prev, backgroundImage: dataUrl }));
      return;
    }
    updateNode(selectedNode.id, (node) => ({ ...node, [key]: dataUrl }));
  };

  const setNpcImageFile = async (file) => {
    const dataUrl = await toDataUrl(file);
    updateNode(selectedNode.id, (node) => ({ ...node, npcScene: { ...(node.npcScene || { name: "", lines: [] }), image: dataUrl } }));
  };

  const setBattleImageFile = async (file) => {
    const dataUrl = await toDataUrl(file);
    updateNode(selectedNode.id, (node) => ({ ...node, battle: { ...(node.battle || { name: "새 E-Beast", hp: 40, maxHp: 40, atk: 8, def: 3, aoe_chance: 0.3 }), image: dataUrl } }));
  };

  const setClueImageFile = async (index, file) => {
    const dataUrl = await toDataUrl(file);
    updateNode(selectedNode.id, (node) => ({ ...node, clues: (node.clues || []).map((clue, i) => i === index ? { ...clue, image: dataUrl } : clue) }));
  };

  const addNpcLine = () => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      npcScene: { ...(node.npcScene || { name: "", image: "", lines: [] }), lines: [...((node.npcScene?.lines) || []), { text: "", options: [] }] },
    }));
  };

  const updateNpcLine = (lineIndex, patch) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      npcScene: {
        ...(node.npcScene || { name: "", image: "", lines: [] }),
        lines: ((node.npcScene?.lines) || []).map((line, idx) => idx === lineIndex ? { ...line, ...patch } : line),
      },
    }));
  };

  const removeNpcLine = (lineIndex) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      npcScene: {
        ...(node.npcScene || { name: "", image: "", lines: [] }),
        lines: ((node.npcScene?.lines) || []).filter((_, idx) => idx !== lineIndex),
      },
    }));
  };

  const addNpcOption = (lineIndex) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      npcScene: {
        ...(node.npcScene || { name: "", image: "", lines: [] }),
        lines: ((node.npcScene?.lines) || []).map((line, idx) =>
          idx === lineIndex ? { ...line, options: [...(line.options || []), { text: "", nextIndex: "", rewardItem: "", rewardStatPoints: 0, clue: "" }] } : line
        ),
      },
    }));
  };

  const updateNpcOption = (lineIndex, optionIndex, patch) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      npcScene: {
        ...(node.npcScene || { name: "", image: "", lines: [] }),
        lines: ((node.npcScene?.lines) || []).map((line, idx) =>
          idx === lineIndex
            ? { ...line, options: (line.options || []).map((option, optIdx) => optIdx === optionIndex ? { ...option, ...patch } : option) }
            : line
        ),
      },
    }));
  };

  const removeNpcOption = (lineIndex, optionIndex) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      npcScene: {
        ...(node.npcScene || { name: "", image: "", lines: [] }),
        lines: ((node.npcScene?.lines) || []).map((line, idx) =>
          idx === lineIndex ? { ...line, options: (line.options || []).filter((_, optIdx) => optIdx !== optionIndex) } : line
        ),
      },
    }));
  };

  const addDirectionChoice = (directionLabel) => {
    updateNode(selectedNode.id, (node) => ({
      ...node,
      choices: [...(node.choices || []), { text: directionLabel, target: "" }],
    }));
  };

  const applyMapPosition = (nodeId, x, y) => {
    updateNode(nodeId, (node) => ({ ...node, mapX: Math.max(50, Math.min(810, Number(x))), mapY: Math.max(50, Math.min(470, Number(y))) }));
  };

  const applyPreviewPointerPosition = (event, nodeId, offset = dragOffsetRef.current) => {
    const rect = previewRef.current?.getBoundingClientRect?.();
    if (!rect) return;
    const x = ((event.clientX - rect.left) / rect.width) * 860 - Number(offset?.x || 0);
    const y = ((event.clientY - rect.top) / rect.height) * 520 - Number(offset?.y || 0);
    applyMapPosition(nodeId, x, y);
  };

  const onNodeMouseDown = (event, node) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedNodeId(node.id);

    if (node.id !== selectedNodeId) {
      return;
    }

    const rect = previewRef.current?.getBoundingClientRect?.();
    if (rect) {
      const pointerX = ((event.clientX - rect.left) / rect.width) * 860;
      const pointerY = ((event.clientY - rect.top) / rect.height) * 520;
      dragOffsetRef.current = {
        x: pointerX - Number(node.mapX || 430),
        y: pointerY - Number(node.mapY || 260),
      };
    } else {
      dragOffsetRef.current = { x: 0, y: 0 };
    }

    setDraggingNodeId(node.id);
  };

  const onMapPreviewMouseMove = (event) => {
    if (!draggingNodeId) return;
    applyPreviewPointerPosition(event, draggingNodeId);
  };

  const endNodeDrag = () => {
    dragOffsetRef.current = { x: 0, y: 0 };
    setDraggingNodeId(null);
  };

  useEffect(() => {
    if (!draggingNodeId) return undefined;
    const handleMove = (event) => applyPreviewPointerPosition(event, draggingNodeId);
    const handleUp = () => endNodeDrag();
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [draggingNodeId]);

  const createBattleEnemy = () => ({ id: `enemy-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: "새 E-Beast", hp: 40, maxHp: 40, atk: 8, def: 3, agi: 6, aoe_chance: 0.3, finisher_chance: 0.05, finisherType: "single", rewardPoints: 10, rewardItem: "", image: "" });

  const getBattleEnemiesForEditor = (battle) => {
    if (!battle) return [];
    if (Array.isArray(battle.enemies) && battle.enemies.length > 0) return battle.enemies;
    return [{ id: "enemy-1", name: battle.name || "새 E-Beast", hp: Number(battle.hp || 40), maxHp: Number(battle.maxHp || battle.hp || 40), atk: Number(battle.atk || 8), def: Number(battle.def || 3), agi: Number(battle.agi || 6), aoe_chance: Number(battle.aoe_chance ?? 0.3), finisher_chance: Number(battle.finisher_chance ?? 0.05), finisherType: battle.finisherType || "single", rewardPoints: Number(battle.rewardPoints || 10), rewardItem: battle.rewardItem || "", image: battle.image || "" }];
  };

  const updateBattleEnemy = (enemyIndex, patch) => {
    updateNode(selectedNode.id, (node) => {
      const enemies = getBattleEnemiesForEditor(node.battle || {}).map((enemy, index) => ({ ...enemy, id: enemy.id || `enemy-${index + 1}` }));
      const nextEnemies = patch === null ? enemies.filter((_, index) => index !== enemyIndex) : enemies.map((enemy, index) => index === enemyIndex ? { ...enemy, ...patch } : enemy);
      const safeEnemies = nextEnemies.length > 0 ? nextEnemies : [createBattleEnemy()];
      return { ...node, battle: { ...(node.battle || {}), name: node.battle?.name || "적군", enemies: safeEnemies } };
    });
  };

  const addBattleEnemy = () => {
    updateNode(selectedNode.id, (node) => {
      const enemies = getBattleEnemiesForEditor(node.battle || {}).map((enemy, index) => ({ ...enemy, id: enemy.id || `enemy-${index + 1}` }));
      return { ...node, battle: { ...(node.battle || { name: "적군" }), enemies: [...enemies, createBattleEnemy()] } };
    });
  };


  if (!selectedNode) return null;

  return (
    <div style={{ padding: 26, color: "#13324b", display: "grid", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div className="section-eyebrow">INVESTIGATION BUILDER</div>
          <h2 style={{ margin: "8px 0 0 0" }}>조사 제작기</h2>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="ghost-button" onClick={() => { setBuilder(emptyBuilder()); setSelectedNodeId("start"); }}>새로 만들기</button>
          <button type="button" className="ghost-button" onClick={saveTemplate}>템플릿 저장</button>
          <button type="button" className="home-primary-button" onClick={publishTemplate}>{isEditingInvestigation ? "저장" : "조사 등록"}</button>
          <button type="button" className="ghost-button" onClick={goBack}>뒤로가기</button>
        </div>
      </div>
      {message ? <div style={{ padding: 12, borderRadius: 14, background: "rgba(125,211,252,0.12)" }}>{message}</div> : null}
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr 420px", gap: 18, alignItems: "start" }}>
        <section style={panelStyle}>
          <div className="section-eyebrow">기본 정보</div>
          <div style={{ display: "grid", gap: 6 }}><div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>조사 제목</div><input value={builder.title} onChange={(e) => setBuilder((prev) => ({ ...prev, title: e.target.value }))} placeholder="조사 제목" style={inputStyle} /></div>
          <div style={{ display: "grid", gap: 6 }}><div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>조사 종류</div><select value={builder.type} onChange={(e) => setBuilder((prev) => ({ ...prev, type: e.target.value }))} style={inputStyle}><option value="group">단체조사</option><option value="daily">일일조사</option></select></div>
          <div style={{ display: "grid", gap: 6 }}><div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>최초 진입 침식 진행도</div><input type="number" min="0" value={builder.entryCorrosion || 0} onChange={(e) => setBuilder((prev) => ({ ...prev, entryCorrosion: Number(e.target.value || 0) }))} placeholder="0" style={inputStyle} /></div>
          <div style={{ display: "grid", gap: 6 }}><div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>조사 종료 시 침식 진행도</div><input type="number" min="0" value={builder.endCorrosion || 0} onChange={(e) => setBuilder((prev) => ({ ...prev, endCorrosion: Number(e.target.value || 0) }))} placeholder="0" style={inputStyle} /></div>
          <div style={{ display: "grid", gap: 6 }}><div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>시작 노드</div><select value={builder.start} onChange={(e) => setBuilder((prev) => ({ ...prev, start: e.target.value }))} style={inputStyle}>{builder.nodes.map((node) => <option key={node.id} value={node.id}>{node.name || node.id}</option>)}</select></div>
          <div style={{ display: "grid", gap: 8 }}>
            <label>조사 카드 이미지</label>
            <ImageDropInput label="조사 카드 이미지" value={builder.listImage || ""} onChange={(value) => setBuilder((prev) => ({ ...prev, listImage: value, imageUpdatedAt: Date.now() }))} previewHeight={150} previewFit="cover" compact />
            <InvestigationImageFrameEditor
              image={builder.listImage || ""}
              title={builder.title || "목록 카드 이미지"}
              mode="list"
              frame={builder.listImageFrame || { x: 50, y: 50, scale: 1 }}
              onFrameChange={(frame) => setBuilder((prev) => ({ ...prev, listImageFrame: frame, imageUpdatedAt: Date.now() }))}
            />
            <InvestigationImageFrameEditor
              image={builder.listImage || ""}
              title={builder.title || "첫 화면 카드 이미지"}
              mode="entry"
              frame={builder.entryImageFrame || builder.listImageFrame || { x: 50, y: 50, scale: 1 }}
              onFrameChange={(frame) => setBuilder((prev) => ({ ...prev, entryImageFrame: frame, imageUpdatedAt: Date.now() }))}
            />
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <label>조사 배경 이미지 업로드</label>
            <ImageDropInput label="조사 배경 이미지" value={builder.backgroundImage || ""} onChange={(value) => setBuilder((prev) => ({ ...prev, backgroundImage: value }))} previewHeight={180} previewFit="cover" compact />
          </div>
          <AudioSourceInput label="조사 BGM" value={builder.bgmUrl || ""} onChange={(value) => setBuilder((prev) => ({ ...prev, bgmUrl: value }))} volume={builder.bgmVolume ?? 1} onVolumeChange={(value) => setBuilder((prev) => ({ ...prev, bgmVolume: value }))} previewScope="builder-investigation-preview" previewPlacement="global" helperText="조사에 들어가면 이 BGM이 자동으로 재생돼." />
          <div className="section-eyebrow" style={{ marginTop: 14 }}>저장된 조사</div>
          <div style={{ display: "grid", gap: 10, maxHeight: 420, overflow: "auto" }}>
            {savedList.map((item) => <div key={item.id} style={savedRowStyle}><div style={{ minWidth: 0 }}><div style={{ fontWeight: 800 }}>{item.title}</div><div style={{ color: "#6a87a3", fontSize: 13 }}>{item.type}</div></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" className="ghost-button" onClick={() => loadTemplate(item)}>불러오기</button><button type="button" className="ghost-button" onClick={() => deleteTemplate(item.id)}>삭제</button></div></div>)}
          </div>
        </section>

        <section style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <div>
              <div className="section-eyebrow">노드 맵</div>
              <h3 style={{ margin: "8px 0 0 0" }}>구역 연결</h3>
            </div>
            <button type="button" className="home-primary-button" onClick={addNode}>노드 추가</button>
          </div>
          <div ref={previewRef} onMouseMove={onMapPreviewMouseMove} onMouseLeave={endNodeDrag} style={{ position: "relative", height: 580, borderRadius: 24, background: "linear-gradient(180deg, rgba(245,252,255,0.96), rgba(232,246,255,0.96))", border: "1px solid rgba(98,176,220,0.18)", overflow: "hidden" }}>
            <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
              {builder.nodes.flatMap((node) => (node.choices || []).map((choice, idx) => {
                const target = builder.nodes.find((v) => v.id === choice.target);
                if (!target) return null;
                return <line key={`${node.id}-${choice.target}-${idx}`} x1={Number(node.mapX || 430)} y1={Number(node.mapY || 260)} x2={Number(target.mapX || 430)} y2={Number(target.mapY || 260)} stroke="rgba(30,167,255,0.45)" strokeWidth="3" />;
              }))}
            </svg>
            {builder.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedNodeId(node.id);
                }}
                onMouseDown={(event) => onNodeMouseDown(event, node)}
                style={{ position: "absolute", left: Number(node.mapX || 430) - 55, top: Number(node.mapY || 260) - 28, width: 110, minHeight: 56, borderRadius: 18, border: node.id === selectedNodeId ? "2px solid #1ea7ff" : "1px solid rgba(98,176,220,0.18)", background: node.id === builder.start ? "linear-gradient(135deg,#7fdbff,#1ea7ff)" : "white", color: node.id === builder.start ? "white" : "#13324b", boxShadow: "0 10px 24px rgba(73,132,170,0.14)", cursor: draggingNodeId === node.id ? "grabbing" : node.id === selectedNodeId ? "grab" : "pointer", userSelect: "none" }}
              >
                <div style={{ fontWeight: 900 }}>{node.name || node.id}</div>
                <div style={{ fontSize: 12 }}>{node.id}</div>
                {node.id === builder.start ? <div style={{ marginTop: 4, fontSize: 10, fontWeight: 800 }}>START</div> : null}
              </button>
            ))}
          </div>
        </section>

        <section style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div><div className="section-eyebrow">선택 노드</div><h3 style={{ margin: "8px 0 0 0" }}>{selectedNode.id}</h3></div>
            <button type="button" className="ghost-button" onClick={() => removeNode(selectedNode.id)}>노드 삭제</button>
          </div>
          <div style={{ color: "#6a87a3", fontSize: 13, lineHeight: 1.7 }}>노드 id는 내부 식별용, 구역 이름은 실제 화면 표시용이야. 진입 로그는 이 구역에 들어왔을 때 바로 보이는 설명 문장이야.</div>
          <div style={{ display: "grid", gap: 6 }}><div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>노드 id (내부 식별용)</div><input value={selectedNode.id} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, id: e.target.value }))} placeholder="노드 id" style={inputStyle} /></div>
          <div style={{ display: "grid", gap: 6 }}><div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>구역 이름 (실제 표시 이름)</div><input value={selectedNode.name} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, name: e.target.value }))} placeholder="구역 이름" style={inputStyle} /></div>
          <div style={{ display: "grid", gap: 6 }}><div style={{ fontSize: 12, fontWeight: 800, color: "#476885" }}>진입 로그 (이 구역에 들어오면 보이는 설명)</div><textarea value={selectedNode.log} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, log: e.target.value }))} placeholder="진입 로그" style={textareaStyle} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={fieldLabelStyle}>맵 X 좌표 (지도에서 좌우 위치)</div>
              <input type="number" value={selectedNode.mapX} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, mapX: Number(e.target.value) }))} placeholder="mapX" style={inputStyle} />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={fieldLabelStyle}>맵 Y 좌표 (지도에서 상하 위치)</div>
              <input type="number" value={selectedNode.mapY} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, mapY: Number(e.target.value) }))} placeholder="mapY" style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <label>노드 이미지 업로드</label>
            <ImageDropInput label="노드 이미지" value={selectedNode.image || ""} onChange={(value) => updateNode(selectedNode.id, (node) => ({ ...node, image: value }))} previewHeight={160} previewFit="cover" compact />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={fieldLabelStyle}>진입 시 피해량</div>
              <input type="number" value={selectedNode.onEnterDamage || 0} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, onEnterDamage: Number(e.target.value || 0) }))} placeholder="진입 시 피해" style={inputStyle} />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={fieldLabelStyle}>진입 시 기절 시간(분)</div>
              <input type="number" value={selectedNode.onEnterMuteMinutes || 0} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, onEnterMuteMinutes: Number(e.target.value || 0) }))} placeholder="기절(분)" style={inputStyle} />
            </div>
          </div>

          <div className="section-eyebrow" style={{ marginTop: 12 }}>이동 연결</div>
          <div style={{ color: "#6a87a3", fontSize: 13 }}>버튼 텍스트는 플레이어가 누르는 이동 버튼 이름이고, 이동 대상은 그 버튼을 눌렀을 때 도착할 구역이야.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="ghost-button" onClick={() => addDirectionChoice("상")}>상 추가</button>
            <button type="button" className="ghost-button" onClick={() => addDirectionChoice("좌")}>좌 추가</button>
            <button type="button" className="ghost-button" onClick={() => addDirectionChoice("우")}>우 추가</button>
            <button type="button" className="ghost-button" onClick={() => addDirectionChoice("하")}>하 추가</button>
            <button type="button" className="ghost-button" onClick={() => updateNode(selectedNode.id, (node) => ({ ...node, choices: [...(node.choices || []), { text: "이동", target: "" }] }))}>일반 연결 추가</button>
          </div>
          {(selectedNode.choices || []).map((choice, idx) => <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginTop: 8, alignItems: "end" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={fieldLabelStyle}>이동 버튼 이름</div>
              <input value={choice.text} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, choices: node.choices.map((v, i) => i === idx ? { ...v, text: e.target.value } : v) }))} placeholder="버튼 텍스트" style={inputStyle} />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={fieldLabelStyle}>도착할 노드</div>
              <select value={choice.target} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, choices: node.choices.map((v, i) => i === idx ? { ...v, target: e.target.value } : v) }))} style={inputStyle}><option value="">이동 대상</option>{builder.nodes.filter((node) => node.id !== selectedNode.id).map((node) => <option key={node.id} value={node.id}>{node.name || node.id}</option>)}</select>
            </div>
            <button type="button" className="ghost-button" onClick={() => updateNode(selectedNode.id, (node) => ({ ...node, choices: node.choices.filter((_, i) => i !== idx) }))}>삭제</button>
          </div>)}

          <div className="section-eyebrow" style={{ marginTop: 12 }}>조사 버튼</div>
          <div style={{ color: "#6a87a3", fontSize: 13 }}>조사 버튼은 이 구역에서 실행할 상호작용이야. 결과 로그는 실행 직후 뜨는 문장이고, 아이템/단서/포인트는 보상으로 지급돼.</div>
          {(selectedNode.investigations || []).map((label, idx) => <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 8, alignItems: "end" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={fieldLabelStyle}>조사 버튼 이름</div>
              <input value={label} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, investigations: node.investigations.map((v, i) => i === idx ? e.target.value : v), actionResults: node.actionResults || {} }))} placeholder="조사 버튼 이름" style={inputStyle} />
            </div>
            <button type="button" className="ghost-button" onClick={() => updateNode(selectedNode.id, (node) => ({ ...node, investigations: node.investigations.filter((_, i) => i !== idx) }))}>삭제</button>
          </div>)}
          <button type="button" className="ghost-button" style={{ marginTop: 8 }} onClick={() => updateNode(selectedNode.id, (node) => ({ ...node, investigations: [...(node.investigations || []), "새 조사"], actionResults: { ...(node.actionResults || {}), "새 조사": emptyAction() } }))}>조사 버튼 추가</button>
          {(selectedNode.investigations || []).map((label, idx) => {
            const result = selectedNode.actionResults?.[label] || emptyAction();
            return (
              <div key={`${label}-${idx}`} style={{ marginTop: 10, padding: 12, borderRadius: 18, background: "rgba(240,248,255,0.92)" }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>{label} 결과</div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={fieldLabelStyle}>결과 로그</div>
                  <textarea value={result.log || ""} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, actionResults: { ...(node.actionResults || {}), [label]: { ...result, log: e.target.value } } }))} placeholder="로그" style={textareaStyle} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={fieldLabelStyle}>획득 포인트</div>
                    <input type="number" value={result.points || 0} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, actionResults: { ...(node.actionResults || {}), [label]: { ...result, points: Number(e.target.value || 0) } } }))} placeholder="포인트" style={inputStyle} />
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={fieldLabelStyle}>보상 아이템</div>
                    <select value={result.item || ""} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, actionResults: { ...(node.actionResults || {}), [label]: { ...result, item: e.target.value } } }))} style={inputStyle}><option value="">보상 아이템 선택</option>{catalog.map((item) => <option key={item.id || item.name} value={item.id || item.name}>{item.name || item.id}</option>)}</select>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={fieldLabelStyle}>획득 단서 제목</div>
                    <input value={result.clue || ""} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, actionResults: { ...(node.actionResults || {}), [label]: { ...result, clue: e.target.value } } }))} placeholder="단서 제목" style={inputStyle} />
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={fieldLabelStyle}>획득 스탯 포인트</div>
                    <input type="number" value={result.statPoints || 0} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, actionResults: { ...(node.actionResults || {}), [label]: { ...result, statPoints: Number(e.target.value || 0) } } }))} placeholder="스탯 포인트" style={inputStyle} />
                  </div>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={fieldLabelStyle}>획득 단서 설명</div>
                  <textarea value={result.clueText || ""} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, actionResults: { ...(node.actionResults || {}), [label]: { ...result, clueText: e.target.value } } }))} placeholder="단서 설명" style={{ ...textareaStyle, minHeight: 80, marginTop: 8 }} />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={fieldLabelStyle}>획득 단서 이미지</div>
                  <ImageDropInput label="단서 이미지" value={result.clueImage || ""} onChange={(value) => updateNode(selectedNode.id, (node) => ({ ...node, actionResults: { ...(node.actionResults || {}), [label]: { ...result, clueImage: value } } }))} previewHeight={120} compact style={{ marginTop: 8 }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={fieldLabelStyle}>행동 실행 시 피해량</div>
                    <input type="number" value={result.damage || 0} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, actionResults: { ...(node.actionResults || {}), [label]: { ...result, damage: Number(e.target.value || 0) } } }))} placeholder="피해" style={inputStyle} />
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={fieldLabelStyle}>행동 실행 시 기절 시간(분)</div>
                    <input type="number" value={result.muteMinutes || 0} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, actionResults: { ...(node.actionResults || {}), [label]: { ...result, muteMinutes: Number(e.target.value || 0) } } }))} placeholder="기절(분)" style={inputStyle} />
                  </div>
                </div>
              </div>
            );
          })}

          <div className="section-eyebrow" style={{ marginTop: 12 }}>단서</div>
          {(selectedNode.clues || []).map((clue, idx) => <div key={idx} style={{ marginTop: 8, padding: 12, borderRadius: 18, background: "rgba(240,248,255,0.92)", display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={fieldLabelStyle}>단서 제목</div>
              <input value={clue.title || ""} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, clues: (node.clues || []).map((v, i) => i === idx ? { ...v, title: e.target.value } : v) }))} placeholder="단서 제목" style={inputStyle} />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={fieldLabelStyle}>단서 설명</div>
              <textarea value={clue.text || clue.description || ""} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, clues: (node.clues || []).map((v, i) => i === idx ? { ...v, text: e.target.value, description: e.target.value } : v) }))} placeholder="단서 설명" style={textareaStyle} />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={fieldLabelStyle}>단서 이미지</div>
              <ImageDropInput label="단서 이미지" value={clue.image || ""} onChange={(value) => updateNode(selectedNode.id, (node) => ({ ...node, clues: (node.clues || []).map((v, i) => i === idx ? { ...v, image: value } : v) }))} previewHeight={120} compact />
            </div>
            <button type="button" className="ghost-button" style={{ marginTop: 8 }} onClick={() => updateNode(selectedNode.id, (node) => ({ ...node, clues: (node.clues || []).filter((_, i) => i !== idx) }))}>단서 삭제</button>
          </div>)}
          <button type="button" className="ghost-button" style={{ marginTop: 8 }} onClick={() => updateNode(selectedNode.id, (node) => ({ ...node, clues: [...(node.clues || []), { title: "새 단서", text: "", image: "" }] }))}>단서 추가</button>

          <div className="section-eyebrow" style={{ marginTop: 12 }}>NPC 대화</div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={fieldLabelStyle}>NPC 이름</div>
            <input value={selectedNode.npcScene?.name || ""} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, npcScene: { ...(node.npcScene || { lines: [] }), name: e.target.value } }))} placeholder="NPC 이름" style={inputStyle} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={fieldLabelStyle}>NPC SD 이미지</div>
            <ImageDropInput label="NPC SD 이미지" value={selectedNode.npcScene?.image || ""} onChange={(value) => updateNode(selectedNode.id, (node) => ({ ...node, npcScene: { ...(node.npcScene || { lines: [] }), image: value } }))} previewHeight={140} previewFit="contain" compact />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={fieldLabelStyle}>NPC 프로필 이미지</div>
            <ImageDropInput label="NPC 프로필 이미지" value={selectedNode.npcScene?.profileImage || ""} onChange={(value) => updateNode(selectedNode.id, (node) => ({ ...node, npcScene: { ...(node.npcScene || { lines: [] }), profileImage: value } }))} previewHeight={140} previewFit="cover" compact />
          </div>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {(selectedNode.npcScene?.lines || []).map((line, lineIndex) => (
              <div key={lineIndex} style={{ padding: 12, borderRadius: 16, background: "rgba(240,248,255,0.92)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div style={{ fontWeight: 800 }}>대사 {lineIndex + 1}</div>
                  <button type="button" className="ghost-button" onClick={() => removeNpcLine(lineIndex)}>대사 삭제</button>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={fieldLabelStyle}>NPC 대사 내용</div>
                  <textarea value={line.text || ""} onChange={(e) => updateNpcLine(lineIndex, { text: e.target.value })} placeholder="NPC 대사" style={{ ...textareaStyle, minHeight: 90, marginTop: 8 }} />
                </div>
                <div style={{ marginTop: 8, fontWeight: 800 }}>선택지</div>
                {(line.options || []).map((option, optionIndex) => (
                  <div key={optionIndex} style={{ padding: 10, borderRadius: 14, background: "rgba(255,255,255,0.88)", marginTop: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={fieldLabelStyle}>선택지 문구</div>
                        <input value={option.text || ""} onChange={(e) => updateNpcOption(lineIndex, optionIndex, { text: e.target.value })} placeholder="선택지 문구" style={inputStyle} />
                      </div>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={fieldLabelStyle}>다음으로 이어질 대사 선택</div>
                        <select value={option.nextIndex ?? ""} onChange={(e) => updateNpcOption(lineIndex, optionIndex, { nextIndex: e.target.value === "" ? "" : Number(e.target.value) })} style={inputStyle}>
                          <option value="">자동으로 다음 대사</option>
                          {(selectedNode.npcScene?.lines || []).map((candidate, candidateIndex) => (
                            <option key={`npc-next-${lineIndex}-${optionIndex}-${candidateIndex}`} value={candidateIndex}>
                              {`대사 ${candidateIndex + 1} · ${String(candidate?.text || "").replace(/\s+/g, " ").slice(0, 24) || "내용 없음"}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={fieldLabelStyle}>선택 시 보상 아이템</div>
                        <select value={option.rewardItem || ""} onChange={(e) => updateNpcOption(lineIndex, optionIndex, { rewardItem: e.target.value })} style={inputStyle}><option value="">보상 아이템 선택</option>{catalog.map((item) => <option key={item.id || item.name} value={item.id || item.name}>{item.name || item.id}</option>)}</select>
                      </div>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={fieldLabelStyle}>선택 시 보상 스탯 포인트</div>
                        <input type="number" value={option.rewardStatPoints || 0} onChange={(e) => updateNpcOption(lineIndex, optionIndex, { rewardStatPoints: Number(e.target.value || 0) })} placeholder="보상 스탯 포인트" style={inputStyle} />
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={fieldLabelStyle}>선택 시 보상 단서 제목</div>
                      <input value={option.clue || ""} onChange={(e) => updateNpcOption(lineIndex, optionIndex, { clue: e.target.value })} placeholder="보상 단서" style={{ ...inputStyle, marginTop: 8 }} />
                    </div>
                    <button type="button" className="ghost-button" style={{ marginTop: 8 }} onClick={() => removeNpcOption(lineIndex, optionIndex)}>선택지 삭제</button>
                  </div>
                ))}
                <button type="button" className="ghost-button" style={{ marginTop: 8 }} onClick={() => addNpcOption(lineIndex)}>선택지 추가</button>
              </div>
            ))}
            <button type="button" className="ghost-button" onClick={addNpcLine}>대사 추가</button>
          </div>

          <div className="section-eyebrow" style={{ marginTop: 12 }}>전투</div>
          <div style={{ color: "#6a87a3", fontSize: 13 }}>한 공간에 적군을 여러 명 넣을 수 있습니다. 적군 턴은 그대로 한 번이고, 등록된 적들이 차례로 행동합니다.</div>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={!!selectedNode.battle} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, battle: e.target.checked ? { name: "적군", enemies: [createBattleEnemy()], rewardItem: "", rewardPoints: 0 } : null }))} />전투 사용</label>
          {selectedNode.battle ? <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={fieldLabelStyle}>전투 이름</div>
              <input value={selectedNode.battle.name || ""} onChange={(e) => updateNode(selectedNode.id, (node) => ({ ...node, battle: { ...node.battle, name: e.target.value } }))} placeholder="예: 오염체 무리" style={inputStyle} />
            </div>
            {getBattleEnemiesForEditor(selectedNode.battle).map((enemy, enemyIndex) => (
              <div key={enemy.id || enemyIndex} style={{ display: "grid", gap: 8, padding: 12, borderRadius: 18, border: "1px solid rgba(148,163,184,0.22)", background: "rgba(15,23,42,0.42)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <strong style={{ color: "#dbeafe" }}>적군 {enemyIndex + 1}</strong>
                  <button type="button" className="ghost-button" onClick={() => updateBattleEnemy(enemyIndex, null)} disabled={getBattleEnemiesForEditor(selectedNode.battle).length <= 1}>삭제</button>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={fieldLabelStyle}>적군 이름</div>
                  <input value={enemy.name || ""} onChange={(e) => updateBattleEnemy(enemyIndex, { name: e.target.value })} placeholder="몬스터 이름" style={inputStyle} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                  <div style={{ display: "grid", gap: 6 }}><div style={fieldLabelStyle}>체력(HP)</div><input type="number" value={enemy.hp || 0} onChange={(e) => updateBattleEnemy(enemyIndex, { hp: Number(e.target.value || 0), maxHp: Number(e.target.value || 0) })} placeholder="HP" style={inputStyle} /></div>
                  <div style={{ display: "grid", gap: 6 }}><div style={fieldLabelStyle}>공격력(ATK)</div><input type="number" value={enemy.atk || 0} onChange={(e) => updateBattleEnemy(enemyIndex, { atk: Number(e.target.value || 0) })} placeholder="ATK" style={inputStyle} /></div>
                  <div style={{ display: "grid", gap: 6 }}><div style={fieldLabelStyle}>방어력(DEF)</div><input type="number" value={enemy.def || 0} onChange={(e) => updateBattleEnemy(enemyIndex, { def: Number(e.target.value || 0) })} placeholder="DEF" style={inputStyle} /></div>
                  <div style={{ display: "grid", gap: 6 }}><div style={fieldLabelStyle}>민첩(DEX)</div><input type="number" value={enemy.agi || 0} onChange={(e) => updateBattleEnemy(enemyIndex, { agi: Number(e.target.value || 0) })} placeholder="DEX" style={inputStyle} /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  <div style={{ display: "grid", gap: 6 }}><div style={fieldLabelStyle}>전체공격 확률</div><input type="number" step="0.05" value={enemy.aoe_chance || 0} onChange={(e) => updateBattleEnemy(enemyIndex, { aoe_chance: Number(e.target.value || 0) })} placeholder="전체공격 확률" style={inputStyle} /></div>
                  <div style={{ display: "grid", gap: 6 }}><div style={fieldLabelStyle}>필살기 확률</div><input type="number" step="0.05" value={enemy.finisher_chance || 0} onChange={(e) => updateBattleEnemy(enemyIndex, { finisher_chance: Number(e.target.value || 0) })} placeholder="필살기 확률" style={inputStyle} /></div>
                  <div style={{ display: "grid", gap: 6 }}><div style={fieldLabelStyle}>필살기 범위</div><select value={enemy.finisherType || "single"} onChange={(e) => updateBattleEnemy(enemyIndex, { finisherType: e.target.value })} style={inputStyle}><option value="single">필살기 단일</option><option value="aoe">필살기 전체</option></select></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={{ display: "grid", gap: 6 }}><div style={fieldLabelStyle}>전투 승리 보상 아이템</div><select value={enemy.rewardItem || ""} onChange={(e) => updateBattleEnemy(enemyIndex, { rewardItem: e.target.value })} style={inputStyle}><option value="">보상 아이템 선택</option>{catalog.map((item) => <option key={item.id || item.name} value={item.id || item.name}>{item.name || item.id}</option>)}</select></div>
                  <div style={{ display: "grid", gap: 6 }}><div style={fieldLabelStyle}>전투 승리 보상 포인트</div><input type="number" value={enemy.rewardPoints || 0} onChange={(e) => updateBattleEnemy(enemyIndex, { rewardPoints: Number(e.target.value || 0) })} placeholder="보상 포인트" style={inputStyle} /></div>
                </div>
                <ImageDropInput label="몬스터 이미지" value={enemy.image || ""} onChange={(value) => updateBattleEnemy(enemyIndex, { image: value })} previewHeight={120} previewFit="contain" compact />
              </div>
            ))}
            <button type="button" className="ghost-button" onClick={addBattleEnemy}>적군 추가</button>
          </div> : null}

        </section>
      </div>
    </div>
  );
}

const panelStyle = { padding: 18, borderRadius: 24, background: "rgba(255,255,255,0.78)", border: "1px solid rgba(98,176,220,0.18)", boxShadow: "0 18px 38px rgba(73,132,170,0.10)", display: "grid", gap: 10 };
const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(98,176,220,0.18)", background: "rgba(255,255,255,0.92)", color: "#16324a", boxSizing: "border-box" };
const textareaStyle = { ...inputStyle, minHeight: 90 };
const savedRowStyle = { padding: 12, borderRadius: 16, background: "rgba(255,255,255,0.78)", border: "1px solid rgba(98,176,220,0.18)", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" };
const fieldLabelStyle = { fontSize: 12, fontWeight: 800, color: "#476885" };
