import { useEffect, useRef } from "react";

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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

function clampVolume(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(0, Math.min(1, num));
}

export default function AudioSourceInput({
  label = "BGM",
  value = "",
  onChange,
  compact = false,
  helperText = "",
  placeholder = "오디오 URL 또는 data URL",
  volume = 1,
  onVolumeChange,
  previewScope = "",
  previewPlacement = "global",
}) {
  const fileRef = useRef(null);
  const nextVolume = clampVolume(volume);

  useEffect(() => {
    if (!previewScope) return undefined;
    if (value) {
      window.dispatchEvent(new CustomEvent("plc-audio-override", { detail: { scope: previewScope, url: String(value || ""), placement: previewPlacement, volume: nextVolume } }));
    } else {
      window.dispatchEvent(new CustomEvent("plc-audio-clear", { detail: { scope: previewScope } }));
    }
    return () => {
      window.dispatchEvent(new CustomEvent("plc-audio-clear", { detail: { scope: previewScope } }));
    };
  }, [previewScope, previewPlacement, value, nextVolume]);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await fileToDataUrl(file);
      onChange?.(result);
    } catch {
      // ignore
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div style={{ display: "grid", gap: compact ? 6 : 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, color: "#16324a" }}>{label}</div>
        {value ? (
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              onChange?.("");
              if (previewScope) {
                window.dispatchEvent(new CustomEvent("plc-audio-clear", { detail: { scope: previewScope } }));
              }
            }}
          >
            지우기
          </button>
        ) : null}
      </div>
      <input
        value={value || ""}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        style={{ ...inputStyle, marginTop: 0, padding: compact ? "10px 12px" : "12px 14px" }}
      />
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label className="ghost-button" style={{ cursor: "pointer" }}>
            파일 업로드
            <input ref={fileRef} type="file" accept="audio/*" onChange={handleFileChange} style={{ display: "none" }} />
          </label>
          <div style={{ color: "#5d7a95", fontSize: 12, lineHeight: 1.6 }}>
            {helperText || "mp3, ogg, wav 같은 오디오 파일을 넣을 수 있어."}
          </div>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 700, color: "#35566f", fontSize: 13 }}>음량</div>
            <div style={{ color: "#5d7a95", fontSize: 12 }}>{Math.round(nextVolume * 100)}%</div>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={nextVolume}
            onChange={(event) => onVolumeChange?.(clampVolume(event.target.value))}
            style={{ width: "100%" }}
          />
        </div>
      </div>
      {value ? (
        <div style={{ color: "#35566f", fontSize: 12, lineHeight: 1.6, wordBreak: "break-all" }}>
          연결됨
        </div>
      ) : null}
    </div>
  );
}
