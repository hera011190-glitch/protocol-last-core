import React, { useRef, useState } from "react";

const hiddenInputStyle = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export default function ImageDropInput({
  label,
  value,
  onChange,
  description = "이미지를 끌어놓거나 클릭해서 선택",
  emptyText = "이미지 없음",
  previewHeight = 160,
  previewFit = "cover",
  compact = false,
  style = {},
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  const openPicker = () => inputRef.current?.click();

  const readFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    setLoading(true);
    reader.onload = () => {
      setLoading(false);
      onChange?.(String(reader.result || ""));
    };
    reader.onerror = () => setLoading(false);
    reader.readAsDataURL(file);
  };

  const handleFiles = (files) => {
    const file = files?.[0];
    if (!file) return;
    readFile(file);
  };

  return (
    <div style={{ display: "grid", gap: 8, ...style }}>
      {label ? <div style={{ fontWeight: 800, color: "#16324a" }}>{label}</div> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={hiddenInputStyle}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div
        role="button"
        tabIndex={0}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer?.files);
        }}
        style={{
          minHeight: previewHeight,
          borderRadius: compact ? 18 : 22,
          border: `1.5px dashed ${dragging ? "rgba(29,157,255,0.55)" : "rgba(98,176,220,0.26)"}`,
          background: dragging
            ? "linear-gradient(135deg, rgba(217,243,255,0.94), rgba(236,248,255,0.96))"
            : "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(240,248,255,0.92))",
          boxShadow: dragging ? "0 16px 34px rgba(73,132,170,0.16)" : "0 12px 28px rgba(73,132,170,0.10)",
          cursor: "pointer",
          overflow: "hidden",
          position: "relative",
          display: "grid",
          placeItems: "center",
          padding: value ? 10 : 18,
          color: "#5f8098",
          textAlign: "center",
          transition: "all 0.16s ease",
        }}
      >
        {value ? (
          <img
            src={value}
            alt={label || "uploaded-image"}
            style={{ width: "100%", height: previewHeight - 20, objectFit: previewFit, borderRadius: compact ? 14 : 18 }}
          />
        ) : (
          <div>
            <div style={{ fontSize: compact ? 13 : 14, fontWeight: 800, color: "#35526a", marginBottom: 6 }}>
              {loading ? "이미지 불러오는 중..." : description}
            </div>
            <div style={{ fontSize: 12 }}>{emptyText}</div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="ghost-button" onClick={openPicker}>파일 선택</button>
        {value ? <button type="button" className="ghost-button" onClick={() => onChange?.("")}>삭제</button> : null}
      </div>
    </div>
  );
}
