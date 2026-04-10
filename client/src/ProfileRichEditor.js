import React, { useEffect, useMemo, useRef } from "react";
import { isHtmlProfile, legacyProfileToHtml, sanitizeProfileHtml } from "./profileRichText";

function buttonStyle(active = false) {
  return {
    padding: "9px 12px",
    borderRadius: 12,
    border: active ? "1px solid rgba(29,157,255,0.32)" : "1px solid rgba(98,176,220,0.18)",
    background: active ? "rgba(219,239,255,0.96)" : "rgba(255,255,255,0.92)",
    color: "#16324a",
    fontWeight: 800,
    cursor: "pointer",
  };
}

function normalizeInput(value) {
  const raw = String(value || "");
  const html = isHtmlProfile(raw) ? raw : legacyProfileToHtml(raw);
  return sanitizeProfileHtml(html);
}

export default function ProfileRichEditor({ value, onChange, minHeight = 280 }) {
  const editorRef = useRef(null);
  const syncingRef = useRef(false);
  const normalizedValue = useMemo(() => normalizeInput(value), [value]);

  useEffect(() => {
    try {
      document.execCommand("styleWithCSS", false, true);
    } catch {}
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || syncingRef.current) return;
    const nextHtml = normalizedValue || "<p><br></p>";
    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml;
    }
  }, [normalizedValue]);

  const emitChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextHtml = sanitizeProfileHtml(editor.innerHTML || "<p><br></p>");
    if (editor.innerHTML !== nextHtml) editor.innerHTML = nextHtml;
    onChange?.(nextHtml);
  };

  const run = (command, valueArg = null) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    try {
      document.execCommand(command, false, valueArg);
    } catch {}
    emitChange();
  };

  const insertHtml = (html) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    try {
      document.execCommand("insertHTML", false, html);
    } catch {
      editor.innerHTML += html;
    }
    emitChange();
  };

  const insertTable = (rows, cols) => {
    const bodyRows = Array.from({ length: rows }).map(() => `<tr>${Array.from({ length: cols }).map(() => '<td style="border:1px solid rgba(148,163,184,0.48); padding:10px 12px; min-width:120px;">내용</td>').join("")}</tr>`).join("");
    insertHtml(`<table style="width:100%; border-collapse:collapse; margin:14px 0;"><tbody>${bodyRows}</tbody></table><p><br></p>`);
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={buttonStyle()} onClick={() => run("formatBlock", "h2")}>제목</button>
        <button type="button" style={buttonStyle()} onClick={() => run("formatBlock", "h3")}>소제목</button>
        <button type="button" style={buttonStyle()} onClick={() => run("formatBlock", "p")}>본문</button>
        <button type="button" style={buttonStyle()} onClick={() => run("bold")}>굵게</button>
        <button type="button" style={buttonStyle()} onClick={() => run("italic")}>기울임</button>
        <button type="button" style={buttonStyle()} onClick={() => run("underline")}>밑줄</button>
        <button type="button" style={buttonStyle()} onClick={() => run("justifyLeft")}>왼쪽</button>
        <button type="button" style={buttonStyle()} onClick={() => run("justifyCenter")}>가운데</button>
        <button type="button" style={buttonStyle()} onClick={() => run("justifyRight")}>오른쪽</button>
        <button type="button" style={buttonStyle()} onClick={() => run("insertUnorderedList")}>목록</button>
        <button type="button" style={buttonStyle()} onClick={() => run("insertOrderedList")}>번호</button>
        <button type="button" style={buttonStyle()} onClick={() => insertHtml('<h3 style="text-align:center; margin:18px 0 10px;">제목</h3><p style="margin:0 0 14px 0; line-height:1.95;">내용</p>')}>제목/내용</button>
        <button type="button" style={buttonStyle()} onClick={() => insertTable(2, 2)}>표 2×2</button>
        <button type="button" style={buttonStyle()} onClick={() => insertTable(3, 3)}>표 3×3</button>
        <label style={{ ...buttonStyle(), display: "inline-flex", alignItems: "center", gap: 8 }}>
          글자색
          <input type="color" onChange={(event) => run("foreColor", event.target.value)} style={{ width: 24, height: 24, border: "none", background: "transparent", padding: 0 }} />
        </label>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
        onBlur={emitChange}
        style={{
          minHeight,
          padding: "18px 20px",
          borderRadius: 18,
          border: "1px solid rgba(98,176,220,0.18)",
          background: "rgba(255,255,255,0.96)",
          color: "#16324a",
          lineHeight: 1.9,
          outline: "none",
          overflow: "auto",
        }}
      />
      <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(240,248,255,0.9)", border: "1px solid rgba(98,176,220,0.16)", color: "#35566f", lineHeight: 1.8 }}>
        실시간 미리보기
      </div>
    </div>
  );
}
