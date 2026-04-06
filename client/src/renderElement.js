import React, { useMemo, useState } from "react";

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

function HoverableElement({ element, handlers = {}, theme = {}, elementScope = "page" }) {
  const [hovered, setHovered] = useState(false);

  const actionHandler =
    element.action && typeof handlers[element.action] === "function"
      ? handlers[element.action]
      : undefined;

  const baseStyle = useMemo(() => {
    const hoverScale = Number(element.hoverScale || 1);
    const rawTransform = element.style?.transform || "";
    const hoverTransform = hovered && hoverScale !== 1
      ? `${rawTransform ? `${rawTransform} ` : ""}scale(${hoverScale})`
      : rawTransform;
    const fontFamily = sanitizeFontFamily(
      element.style?.fontFamily,
      element.style?.fontDataUrl
        ? `plc_font_${String(element.id || "element").replace(/[^a-zA-Z0-9_-]/g, "_")}`
        : theme?.fontFamily || "inherit"
    );

    return {
      position: "absolute",
      left: element.x ?? 0,
      top: element.y ?? 0,
      width: element.width ?? "auto",
      height: element.height ?? "auto",
      zIndex: element.zIndex || 1,
      fontFamily,
      transform: hoverTransform || undefined,
      transition: element.style?.transition || "transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease, opacity 0.15s ease",
      transformOrigin: element.style?.transformOrigin || "center center",
      pointerEvents: element.style?.pointerEvents || (actionHandler || element.type === "button" ? "auto" : "none"),
      ...element.style,
    };
  }, [element, theme, hovered]);

  const sharedProps = {
    key: element.id,
    onClick: actionHandler,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    "data-design-element-id": element.id,
    "data-design-element-scope": elementScope,
  };

  let rendered = null;

  if (element.type === "text") {
    rendered = (
      <div
        {...sharedProps}
        style={{
          ...baseStyle,
          whiteSpace: "pre-wrap",
          wordBreak: "keep-all",
          cursor: actionHandler ? "pointer" : "default",
        }}
      >
        {element.text || ""}
      </div>
    );
  } else if (element.type === "image") {
    rendered = (
      <img
        {...sharedProps}
        src={element.src || ""}
        alt={element.id || "image"}
        style={{
          ...baseStyle,
          objectFit: element.style?.objectFit || "cover",
          cursor: actionHandler ? "pointer" : "default",
        }}
      />
    );
  } else if (element.type === "button") {
    rendered = (
      <button
        {...sharedProps}
        type="button"
        style={{
          ...baseStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          whiteSpace: "pre-wrap",
          cursor: "pointer",
        }}
      >
        {element.text || "버튼"}
      </button>
    );
  } else if (element.type === "panel") {
    rendered = (
      <div
        {...sharedProps}
        style={{
          ...baseStyle,
          cursor: actionHandler ? "pointer" : "default",
        }}
      />
    );
  }

  if (!rendered) return null;

  return (
    <>
      <FontFaceStyle element={element} />
      {rendered}
    </>
  );
}

export default function renderElement(element, handlers = {}, theme = {}, elementScope = "page") {
  if (!element) return null;
  return <HoverableElement element={element} handlers={handlers} theme={theme} elementScope={elementScope} />;
}
