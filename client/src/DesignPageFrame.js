import { useLayoutEffect, useRef } from "react";
import renderElement from "./renderElement";
import defaultDesign from "./defaultDesign";
import { applyDomOverrides } from "./designDomUtils";

function DesignPageFrame({
  design,
  pageKey,
  handlers = {},
  children,
  minHeight = "100vh",
  innerStyle = {},
  contentStyle = {},
  theme = {},
}) {
  const pageDesign = design?.pages?.[pageKey] || defaultDesign.pages?.[pageKey] || {};
  const background = pageDesign.background || {};
  const pageOverlay = background.overlay || "none";
  const pageElements = Array.isArray(pageDesign.elements) ? pageDesign.elements : [];
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    applyDomOverrides(rootRef.current, pageDesign.domOverrides || {});
  }, [pageDesign.domOverrides, children, pageKey]);

  return (
    <div
      ref={rootRef}
      data-design-page-root={pageKey}
      className={`theme-page theme-page-${pageKey}`}
      style={{
        position: "relative",
        minHeight,
        borderRadius: "var(--radius-xl)",
        overflow: "hidden",
        backgroundColor: background.color || "var(--bg-main)",
        backgroundImage:
          background.image && pageOverlay !== "none"
            ? `${pageOverlay}, url(${background.image})`
            : background.image
            ? `url(${background.image})`
            : pageOverlay !== "none"
            ? pageOverlay
            : "none",
        backgroundSize: background.image
          ? `${background.size || "cover"}, ${background.size || "cover"}`
          : background.size || "cover",
        backgroundPosition: background.image
          ? `${background.position || "center"}, ${background.position || "center"}`
          : background.position || "center",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow)",
        backdropFilter: "blur(8px)",
        ...innerStyle,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 16% 12%, rgba(255,255,255,0.60), transparent 20%), radial-gradient(circle at 82% 16%, rgba(85,199,255,0.14), transparent 24%), radial-gradient(circle at 24% 84%, rgba(152,222,255,0.18), transparent 26%)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {pageElements
        .slice()
        .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
        .map((element) => renderElement(element, handlers, theme, "page"))}

      <div
        style={{
          position: "relative",
          zIndex: 20,
          padding: "24px",
          minHeight,
          ...contentStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default DesignPageFrame;
