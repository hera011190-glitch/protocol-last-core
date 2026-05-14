import { useEffect, useMemo, useRef, useState } from "react";
import defaultDesign from "./defaultDesign";
import ImageDropInput from "./ImageDropInput";
import { buildApiUrl } from "./api";

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}
function normalizeMapCollections(collections, fallbackPresets = []) {
  const source = Array.isArray(collections) && collections.length > 0
    ? collections
    : [{ id: "default", title: "기본 맵", presets: Array.isArray(fallbackPresets) ? fallbackPresets : [] }];
  const seenCollectionIds = new Set();
  return source.filter((collection, index) => {
    const key = String(collection?.id || `collection-${index}`);
    if (seenCollectionIds.has(key)) return false;
    seenCollectionIds.add(key);
    return true;
  }).map((collection, index) => ({
    id: collection?.id || `collection-${index}`,
    title: collection?.title || `맵 탭 ${index + 1}`,
    presets: Array.isArray(collection?.presets) ? collection.presets : [],
  }));
}

function getAppliedCollectionPresets(mapRoot = {}) {
  const appliedCollections = normalizeMapCollections(
    Array.isArray(mapRoot.appliedCollections) ? mapRoot.appliedCollections : mapRoot.collections,
    Array.isArray(mapRoot.presets) ? mapRoot.presets : []
  );
  const appliedCollectionId = mapRoot.appliedCollectionId || mapRoot.activeCollectionId || appliedCollections[0]?.id || "";
  const found = appliedCollections.find((collection) => String(collection.id) === String(appliedCollectionId)) || appliedCollections[0] || null;
  return {
    appliedCollections,
    appliedCollectionId: found?.id || appliedCollectionId,
    appliedPresets: Array.isArray(found?.presets) ? found.presets : [],
  };
}

function ensureDesign(input) {
  const base = clone(defaultDesign || {});
  const data = input || {};
  if (!base.siteContent) base.siteContent = {};
  if (!base.siteContent.maps) base.siteContent.maps = {};
  if (!Array.isArray(base.siteContent.maps.presets)) base.siteContent.maps.presets = [];

  const baseMaps = base.siteContent.maps || {};
  const inputMaps = data.siteContent?.maps || {};
  const appliedInfo = getAppliedCollectionPresets({ ...baseMaps, ...inputMaps });
  const editorCollections = normalizeMapCollections(
    Array.isArray(inputMaps.editorCollections) ? inputMaps.editorCollections : inputMaps.collections,
    Array.isArray(inputMaps.presets) ? inputMaps.presets : appliedInfo.appliedPresets
  );
  const editorActiveCollectionId = inputMaps.editorActiveCollectionId || inputMaps.activeCollectionId || editorCollections[0]?.id || "";

  const merged = {
    ...base,
    ...data,
    siteContent: {
      ...(base.siteContent || {}),
      ...(data.siteContent || {}),
      maps: {
        ...baseMaps,
        ...inputMaps,
        collections: editorCollections,
        activeCollectionId: editorActiveCollectionId,
        presets: (editorCollections.find((collection) => String(collection.id) === String(editorActiveCollectionId)) || editorCollections[0] || {})?.presets || [],
        editorCollections,
        editorActiveCollectionId,
        appliedCollections: appliedInfo.appliedCollections,
        appliedCollectionId: appliedInfo.appliedCollectionId,
        appliedPresets: appliedInfo.appliedPresets,
      },
    },
  };
  return merged;
}
const inputStyle = {
  width: "100%",
  marginTop: 6,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(98,176,220,0.18)",
  background: "rgba(255,255,255,0.92)",
  color: "#16324a",
  boxSizing: "border-box",
};

function card(extra = {}) {
  return {
    padding: 18,
    borderRadius: 22,
    background: "rgba(255,255,255,0.86)",
    border: "1px solid rgba(98,176,220,0.18)",
    ...extra,
  };
}

function iconButtonStyle(active = false) {
  return {
    padding: "10px 12px",
    borderRadius: 14,
    border: `1px solid ${active ? "rgba(29,157,255,0.45)" : "rgba(98,176,220,0.18)"}`,
    background: active ? "rgba(125,211,252,0.20)" : "rgba(255,255,255,0.84)",
    color: "#16324a",
    fontWeight: 800,
    cursor: "pointer",
  };
}


export default function AdminMapManager({ goBack }) {
  const [design, setDesign] = useState(() => ensureDesign(defaultDesign));
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [dragState, setDragState] = useState(null);
  const previewRef = useRef(null);

  useEffect(() => {
    fetch(buildApiUrl("/designConfig"))
      .then((res) => res.json())
      .then((data) => setDesign(ensureDesign(data)))
      .catch(() => setDesign(ensureDesign(defaultDesign)));
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(""), 1800);
    return () => clearTimeout(timer);
  }, [message]);

  const collections = design?.siteContent?.maps?.collections || [];

  useEffect(() => {
    if (!selectedCollectionId && collections[0]?.id) {
      setSelectedCollectionId(design?.siteContent?.maps?.activeCollectionId || collections[0].id);
    }
  }, [collections, selectedCollectionId, design]);

  const selectedCollection = useMemo(
    () => collections.find((v) => String(v.id) === String(selectedCollectionId)) || collections[0] || null,
    [collections, selectedCollectionId]
  );
  const maps = selectedCollection?.presets || [];
  const selectedMap = useMemo(
    () => maps.find((map) => String(map.id) === String(selectedId)) || maps[0] || null,
    [maps, selectedId]
  );

  useEffect(() => {
    if (!selectedId && maps[0]?.id) setSelectedId(maps[0].id);
  }, [maps, selectedId]);

  const syncEditorDraftMaps = (next, activeId = selectedCollectionId) => {
    if (!next?.siteContent?.maps) return next;
    const draftCollections = normalizeMapCollections(next.siteContent.maps.collections || [], next.siteContent.maps.presets || []);
    next.siteContent.maps.collections = draftCollections;
    next.siteContent.maps.editorCollections = draftCollections;
    next.siteContent.maps.editorActiveCollectionId = activeId || draftCollections[0]?.id || "";
    const foundDraft = draftCollections.find((collection) => String(collection.id) === String(next.siteContent.maps.editorActiveCollectionId)) || draftCollections[0] || null;
    next.siteContent.maps.presets = Array.isArray(foundDraft?.presets) ? foundDraft.presets : [];
    return next;
  };

  const patchCollection = (collectionId, updater) => {
    setDesign((prev) => {
      const next = ensureDesign(prev);
      next.siteContent.maps.collections = next.siteContent.maps.collections.map((collection) =>
        String(collection.id) === String(collectionId) ? updater(collection) : collection
      );
      return syncEditorDraftMaps(next);
    });
  };

  const updateMap = (mapId, patch) =>
    patchCollection(selectedCollectionId, (collection) => ({
      ...collection,
      presets: (collection.presets || []).map((map) =>
        String(map.id) === String(mapId) ? { ...map, ...patch } : map
      ),
    }));

  const updateCollection = (collectionId, patch) =>
    setDesign((prev) => {
      const next = ensureDesign(prev);
      next.siteContent.maps.collections = next.siteContent.maps.collections.map((collection) =>
        String(collection.id) === String(collectionId) ? { ...collection, ...patch } : collection
      );
      return syncEditorDraftMaps(next);
    });

  const addCollection = () => {
    const id = `maps-${Date.now()}`;
    setDesign((prev) => {
      const next = ensureDesign(prev);
      next.siteContent.maps.collections = [...(next.siteContent.maps.collections || []), { id, title: `새 맵 탭 ${next.siteContent.maps.collections.length + 1}`, presets: [] }];
      return syncEditorDraftMaps(next, id);
    });
    setSelectedCollectionId(id);
    setSelectedId("");
  };

  const addMap = () => {
    const id = `sector-${Date.now()}`;
    patchCollection(selectedCollectionId, (collection) => ({
      ...collection,
      presets: [
        ...(collection.presets || []),
        {
          id,
          name: "새 맵",
          buttonTitle: "(새 맵)",
          backgroundImage: "",
          background: "linear-gradient(180deg, rgba(195,235,255,0.78), rgba(224,244,255,0.98))",
          backgroundPositionX: 50,
          backgroundPositionY: 50,
          backgroundScale: 100,
          neighbors: { up: "", down: "", left: "", right: "" },
        },
      ],
    }));
    setSelectedId(id);
  };

  const removeMap = (mapId) => {
    if (!window.confirm("이 맵을 삭제하시겠습니까?")) return;
    patchCollection(selectedCollectionId, (collection) => ({
      ...collection,
      presets: (collection.presets || [])
        .filter((map) => String(map.id) !== String(mapId))
        .map((map) => ({
          ...map,
          neighbors: {
            up: map?.neighbors?.up === mapId ? "" : map?.neighbors?.up || "",
            down: map?.neighbors?.down === mapId ? "" : map?.neighbors?.down || "",
            left: map?.neighbors?.left === mapId ? "" : map?.neighbors?.left || "",
            right: map?.neighbors?.right === mapId ? "" : map?.neighbors?.right || "",
          },
        })),
    }));
    setSelectedId("");
  };

  const buildMapDesignPayload = ({ apply = false } = {}) => {
    const nextDesign = syncEditorDraftMaps(ensureDesign(design), selectedCollectionId);
    const mapRoot = nextDesign.siteContent.maps;
    const draftCollections = normalizeMapCollections(mapRoot.collections || [], mapRoot.presets || []);
    const draftActiveId = selectedCollectionId || draftCollections[0]?.id || "";
    const draftSelected = draftCollections.find((collection) => String(collection.id) === String(draftActiveId)) || draftCollections[0] || null;

    mapRoot.editorCollections = draftCollections;
    mapRoot.editorActiveCollectionId = draftActiveId;

    if (apply) {
      mapRoot.collections = draftCollections;
      mapRoot.activeCollectionId = draftActiveId;
      mapRoot.presets = Array.isArray(draftSelected?.presets) ? draftSelected.presets : [];
      mapRoot.appliedCollections = draftCollections;
      mapRoot.appliedCollectionId = draftActiveId;
      mapRoot.appliedPresets = mapRoot.presets;
    } else {
      const appliedCollections = normalizeMapCollections(mapRoot.appliedCollections || mapRoot.collections || [], mapRoot.appliedPresets || mapRoot.presets || []);
      const appliedCollectionId = mapRoot.appliedCollectionId || mapRoot.activeCollectionId || appliedCollections[0]?.id || "";
      const appliedSelected = appliedCollections.find((collection) => String(collection.id) === String(appliedCollectionId)) || appliedCollections[0] || null;
      mapRoot.collections = appliedCollections;
      mapRoot.activeCollectionId = appliedCollectionId;
      mapRoot.presets = Array.isArray(appliedSelected?.presets) ? appliedSelected.presets : [];
      mapRoot.appliedCollections = appliedCollections;
      mapRoot.appliedCollectionId = appliedCollectionId;
      mapRoot.appliedPresets = mapRoot.presets;
    }
    return nextDesign;
  };

  const save = async () => {
    try {
      const nextDesign = buildMapDesignPayload({ apply: false });
      const res = await fetch(buildApiUrl("/designConfig"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextDesign),
      });
      const data = await res.json();
      if (data?.success) {
        setDesign(ensureDesign(data.designConfig || nextDesign));
        setMessage("맵 편집값이 저장되었습니다. 실제 맵에는 적용되지 않았습니다.");
      } else {
        setMessage("맵 저장 실패");
      }
    } catch {
      setMessage("맵 저장 실패");
    }
  };

  const applyCollection = async () => {
    try {
      const nextDesign = buildMapDesignPayload({ apply: true });
      setDesign(ensureDesign(nextDesign));
      const res = await fetch(buildApiUrl("/designConfig"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextDesign),
      });
      const data = await res.json();
      if (!data?.success) {
        setMessage("적용 실패");
        return;
      }
      setDesign(ensureDesign(data.designConfig || nextDesign));
      window.dispatchEvent(new CustomEvent("plc-design-updated"));
      setMessage("현재 맵 탭을 실제 맵에 적용했습니다.");
    } catch {
      setMessage("적용 실패");
    }
  };

  const clampPercent = (value) => Math.max(0, Math.min(100, Number(value || 0)));
  const clampScale = (value) => Math.max(30, Math.min(260, Number(value || 100)));

  const beginPreviewDrag = (event) => {
    if (!selectedMap || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    setDragState({
      startX: event.clientX,
      startY: event.clientY,
      posX: Number(selectedMap.backgroundPositionX ?? 50),
      posY: Number(selectedMap.backgroundPositionY ?? 50),
      width: rect.width || 1,
      height: rect.height || 1,
    });
  };

  const movePreview = (event) => {
    if (!dragState || !selectedMap) return;
    const dx = ((event.clientX - dragState.startX) / dragState.width) * 100;
    const dy = ((event.clientY - dragState.startY) / dragState.height) * 100;
    updateMap(selectedMap.id, {
      backgroundPositionX: clampPercent(dragState.posX + dx),
      backgroundPositionY: clampPercent(dragState.posY + dy),
    });
  };

  useEffect(() => {
    const handleUp = () => setDragState(null);
    const handleMove = (event) => movePreview(event);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("mousemove", handleMove);
    return () => {
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("mousemove", handleMove);
    };
  });

  const nudgePreview = (dx, dy) => {
    if (!selectedMap) return;
    updateMap(selectedMap.id, {
      backgroundPositionX: clampPercent(Number(selectedMap.backgroundPositionX ?? 50) + dx),
      backgroundPositionY: clampPercent(Number(selectedMap.backgroundPositionY ?? 50) + dy),
    });
  };

  const zoomPreview = (delta) => {
    if (!selectedMap) return;
    updateMap(selectedMap.id, { backgroundScale: clampScale(Number(selectedMap.backgroundScale ?? 100) + delta) });
  };

  const resetPreview = () => {
    if (!selectedMap) return;
    updateMap(selectedMap.id, { backgroundPositionX: 50, backgroundPositionY: 50, backgroundScale: 100 });
  };

  const handleWheelZoom = (event) => {
    if (!selectedMap) return;
    event.preventDefault();
    zoomPreview(event.deltaY > 0 ? -4 : 4);
  };

  return (
    <div style={{ padding: 26, color: "#13324b", background: "linear-gradient(180deg, #f7fbff, #eef7ff)", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 18 }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>맵 관리</h2>
          <div style={{ color: "#5f8098", fontSize: 14 }}>실제 SD 화면처럼 보이는 미리보기에서 배경을 마우스로 바로 움직이고, 휠로 확대/축소할 수 있습니다.</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="ghost-button" onClick={addCollection}>맵 탭 추가</button>
          <button type="button" className="ghost-button" onClick={addMap}>맵 추가</button>
          <button type="button" className="ghost-button" onClick={applyCollection}>적용</button>
          <button type="button" className="home-primary-button" onClick={save}>저장</button>
          <button type="button" className="ghost-button" onClick={goBack}>뒤로가기</button>
        </div>
      </div>

      {message ? <div style={{ ...card({ marginBottom: 18, background: "rgba(125,211,252,0.16)" }) }}>{message}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "240px 320px minmax(0,1fr)", gap: 18 }}>
        <div style={card({ display: "grid", gap: 10, alignContent: "start" })}>
          <h3 style={{ marginTop: 0 }}>맵 탭</h3>
          {collections.map((collection) => (
            <button
              key={collection.id}
              type="button"
              onClick={() => {
                setSelectedCollectionId(collection.id);
                setSelectedId("");
              }}
              style={{
                textAlign: "left",
                padding: 14,
                borderRadius: 16,
                border: `1px solid ${String(selectedCollectionId) === String(collection.id) ? "rgba(29,157,255,0.45)" : "rgba(98,176,220,0.18)"}`,
                background: String(selectedCollectionId) === String(collection.id) ? "rgba(125,211,252,0.18)" : "rgba(255,255,255,0.82)",
              }}
            >
              {collection.title || "맵 탭"}
            </button>
          ))}
          {selectedCollection ? (
            <label>탭 이름<input value={selectedCollection.title || ""} onChange={(e) => updateCollection(selectedCollection.id, { title: e.target.value })} style={inputStyle} /></label>
          ) : null}
        </div>

        <div style={card({ display: "grid", gap: 10, alignContent: "start" })}>
          <h3 style={{ marginTop: 0 }}>맵 목록</h3>
          {maps.map((map) => (
            <button
              key={map.id}
              type="button"
              onClick={() => setSelectedId(map.id)}
              style={{
                textAlign: "left",
                padding: 14,
                borderRadius: 16,
                border: `1px solid ${String(selectedId) === String(map.id) ? "rgba(29,157,255,0.45)" : "rgba(98,176,220,0.18)"}`,
                background: String(selectedId) === String(map.id) ? "rgba(125,211,252,0.18)" : "rgba(255,255,255,0.82)",
              }}
            >
              <div style={{ fontWeight: 800 }}>{map.buttonTitle || map.name || map.id}</div>
              <div style={{ color: "#6a87a3", fontSize: 13 }}>{map.id}</div>
            </button>
          ))}
          {!maps.length ? <div style={{ color: "#6a87a3", fontSize: 13 }}>먼저 맵을 하나 추가해 주세요.</div> : null}
        </div>

        <div style={card({ display: "grid", gap: 18 })}>
          {selectedMap ? (
            <>
              <div>
                <h3 style={{ marginTop: 0, marginBottom: 6 }}>맵 수정</h3>
                <div style={{ color: "#5f8098", fontSize: 14 }}>배경 이미지 편집은 이 미리보기에서 바로 맞추시면 실제 SD 화면과 더 가깝게 보입니다.</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>버튼 제목<input value={selectedMap.buttonTitle || ""} onChange={(e) => updateMap(selectedMap.id, { buttonTitle: e.target.value })} style={inputStyle} /></label>
                <label>구역 이름<input value={selectedMap.name || ""} onChange={(e) => updateMap(selectedMap.id, { name: e.target.value })} style={inputStyle} /></label>
                <ImageDropInput label="배경 이미지" value={selectedMap.backgroundImage || ""} onChange={(value) => updateMap(selectedMap.id, { backgroundImage: value })} previewHeight={180} previewFit="cover" compact style={{ gridColumn: "1 / span 2" }} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "start" }}>
                <div
                  ref={previewRef}
                  onMouseDown={beginPreviewDrag}
                  onWheel={handleWheelZoom}
                  style={{
                    height: 430,
                    borderRadius: 26,
                    overflow: "hidden",
                    border: "1px solid rgba(98,176,220,0.16)",
                    background: selectedMap.backgroundImage
                      ? `url(${selectedMap.backgroundImage}) ${Number(selectedMap.backgroundPositionX ?? 50)}% ${Number(selectedMap.backgroundPositionY ?? 50)}% / ${Number(selectedMap.backgroundScale ?? 100)}% no-repeat`
                      : selectedMap.background || "#dff4ff",
                    cursor: dragState ? "grabbing" : "grab",
                    position: "relative",
                    boxShadow: "0 24px 60px rgba(73,132,170,0.16)",
                    userSelect: "none",
                  }}
                >
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.52), rgba(255,255,255,0.14) 32%, rgba(255,255,255,0.22))" }} />
                  <div style={{ position: "absolute", left: 20, top: 18, padding: "8px 14px", borderRadius: 999, background: "rgba(255,255,255,0.78)", fontWeight: 800, boxShadow: "0 10px 24px rgba(73,132,170,0.12)" }}>
                    {selectedMap.name || "맵"}
                  </div>
                  {[["up", "▲", { top: 16, left: "50%", transform: "translateX(-50%)" }], ["down", "▼", { bottom: 16, left: "50%", transform: "translateX(-50%)" }], ["left", "◀", { left: 16, top: "50%", transform: "translateY(-50%)" }], ["right", "▶", { right: 16, top: "50%", transform: "translateY(-50%)" }]].map(([dir, label, pos]) => (
                    <div key={dir} style={{ position: "absolute", width: 56, height: 56, borderRadius: 18, display: "grid", placeItems: "center", background: selectedMap?.neighbors?.[dir] ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.42)", color: "#16324a", fontWeight: 900, boxShadow: selectedMap?.neighbors?.[dir] ? "0 10px 24px rgba(73,132,170,0.12)" : "none", ...pos }}>{label}</div>
                  ))}
                  {/* SD 예시는 표시하지 않음 */}
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <button type="button" style={iconButtonStyle()} onClick={() => nudgePreview(0, -2)}>위로</button>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" style={iconButtonStyle()} onClick={() => nudgePreview(-2, 0)}>왼쪽</button>
                    <button type="button" style={iconButtonStyle()} onClick={() => nudgePreview(2, 0)}>오른쪽</button>
                  </div>
                  <button type="button" style={iconButtonStyle()} onClick={() => nudgePreview(0, 2)}>아래로</button>
                  <button type="button" style={iconButtonStyle()} onClick={() => zoomPreview(8)}>확대</button>
                  <button type="button" style={iconButtonStyle()} onClick={() => zoomPreview(-8)}>축소</button>
                  <button type="button" style={iconButtonStyle()} onClick={resetPreview}>초기화</button>
                </div>
              </div>

              <div style={{ color: "#5f8098", fontSize: 13, marginTop: -6 }}>미리보기에서 드래그하면 배경 위치가 바로 바뀌며, 마우스 휠로 확대/축소할 수 있습니다.</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <label>위치 X<input type="number" value={Number(selectedMap.backgroundPositionX ?? 50)} onChange={(e) => updateMap(selectedMap.id, { backgroundPositionX: clampPercent(e.target.value) })} style={inputStyle} /></label>
                <label>위치 Y<input type="number" value={Number(selectedMap.backgroundPositionY ?? 50)} onChange={(e) => updateMap(selectedMap.id, { backgroundPositionY: clampPercent(e.target.value) })} style={inputStyle} /></label>
                <label>크기 %<input type="number" value={Number(selectedMap.backgroundScale ?? 100)} onChange={(e) => updateMap(selectedMap.id, { backgroundScale: clampScale(e.target.value) })} style={inputStyle} /></label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
                <label>위<select value={selectedMap?.neighbors?.up || ""} onChange={(e) => updateMap(selectedMap.id, { neighbors: { ...(selectedMap.neighbors || {}), up: e.target.value } })} style={inputStyle}><option value="">없음</option>{maps.filter((m) => m.id !== selectedMap.id).map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}</select></label>
                <label>아래<select value={selectedMap?.neighbors?.down || ""} onChange={(e) => updateMap(selectedMap.id, { neighbors: { ...(selectedMap.neighbors || {}), down: e.target.value } })} style={inputStyle}><option value="">없음</option>{maps.filter((m) => m.id !== selectedMap.id).map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}</select></label>
                <label>왼쪽<select value={selectedMap?.neighbors?.left || ""} onChange={(e) => updateMap(selectedMap.id, { neighbors: { ...(selectedMap.neighbors || {}), left: e.target.value } })} style={inputStyle}><option value="">없음</option>{maps.filter((m) => m.id !== selectedMap.id).map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}</select></label>
                <label>오른쪽<select value={selectedMap?.neighbors?.right || ""} onChange={(e) => updateMap(selectedMap.id, { neighbors: { ...(selectedMap.neighbors || {}), right: e.target.value } })} style={inputStyle}><option value="">없음</option>{maps.filter((m) => m.id !== selectedMap.id).map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}</select></label>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ color: "#6a87a3", fontSize: 13 }}>화살표가 켜진 방향만 실제 SD 페이지에서 이동 가능하게 연결돼.</div>
                <button type="button" className="ghost-button" onClick={() => removeMap(selectedMap.id)}>삭제</button>
              </div>
            </>
          ) : (
            <div style={{ color: "#4f7390" }}>왼쪽에서 맵을 선택해 주세요.</div>
          )}
        </div>
      </div>
    </div>
  );
}
