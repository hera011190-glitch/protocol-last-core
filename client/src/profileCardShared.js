import React from "react";

export const PROFILE_CARD_ASPECT = "0.33 / 1";
const PROFILE_CARD_CLIP = "polygon(14% 0, 100% 0, 86% 100%, 0 100%)";

export function normalizeProfileCardFrame(frame) {
  return {
    x: Number(frame?.x ?? 50),
    y: Number(frame?.y ?? 28),
    scale: Number(frame?.scale ?? 1.12),
  };
}

export function getProfileCardImageStyle(frame) {
  const safe = normalizeProfileCardFrame(frame);
  const offsetX = (safe.x - 50) * 0.52;
  const offsetY = (safe.y - 28) * 0.52;
  return {
    position: "absolute",
    left: "50%",
    top: "40.5%",
    width: "84%",
    height: "72%",
    objectFit: "contain",
    transform: `translate(calc(-50% + ${offsetX}%), calc(-50% + ${offsetY}%)) scale(${safe.scale})`,
    transformOrigin: "center center",
    pointerEvents: "none",
    userSelect: "none",
  };
}

function shapeStyle(extra = {}) {
  return {
    clipPath: PROFILE_CARD_CLIP,
    WebkitClipPath: PROFILE_CARD_CLIP,
    overflow: "hidden",
    ...extra,
  };
}

export function ProfileCard({ character = {}, onClick, theme, width = "100%", oneLine, image, rank, name, frame, isOnline = false, rankFontSize = 9, nameFontSize = 13, oneLineFontSize = 7.8 }) {
  const displayName = name ?? character?.name ?? "캐릭터 이름";
  const displayRank = rank ?? character?.rank ?? "대원";
  const displayOneLine = oneLine ?? character?.oneLine ?? character?.profile ?? "프로필 열기";
  const imageSrc = image ?? character?.mainImage ?? character?.cardImage ?? character?.profileImage ?? character?.image ?? "";
  const cardFrame = frame ?? character?.mainImageFrame;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...shapeStyle({
          position: "relative",
          width,
          aspectRatio: PROFILE_CARD_ASPECT,
          background: "transparent",
          border: "none",
          boxShadow: theme?.shadow || "0 18px 38px rgba(73,132,170,0.16)",
          padding: 0,
          cursor: onClick ? "pointer" : "default",
          textAlign: "left",
          appearance: "none",
          isolation: "isolate",
          display: "block",
          pointerEvents: "auto",
          position: "relative",
          zIndex: 1,
        }),
      }}
    >
      <div
        style={shapeStyle({
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(255,255,255,0.28), rgba(233,246,255,0.22) 48%, rgba(255,255,255,0.26) 100%)",
          border: `1px solid ${theme?.line || "rgba(98,176,220,0.18)"}`,
          backdropFilter: "blur(10px)",
        })}
      />
      <div
        style={shapeStyle({
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 16%, rgba(255,255,255,0.3), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.12), rgba(191,219,254,0.12) 42%, rgba(255,255,255,0.18) 100%)",
        })}
      />
      <div style={shapeStyle({ position: "absolute", inset: 0 })}>
        {imageSrc ? (
          <img src={imageSrc} alt={`${displayName}-full`} draggable={false} loading="eager" decoding="async" fetchPriority="high" style={{ ...getProfileCardImageStyle(cardFrame), zIndex: 1 }} />
        ) : null}
      </div>
      <div
        style={shapeStyle({
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "linear-gradient(180deg, rgba(255,255,255,0) 44%, rgba(239,248,255,0.52) 72%, rgba(220,242,255,0.96) 100%)",
        })}
      />
      <div style={{ position: "absolute", top: 12, right: 14, width: 12, height: 12, borderRadius: "999px", background: isOnline ? "#22c55e" : "#cbd5e1", boxShadow: isOnline ? "0 0 14px rgba(34,197,94,0.62)" : "none", zIndex: 5 }} />
      <div style={{ position: "absolute", left: 18, right: 14, bottom: 10, zIndex: 4, display: "grid", gap: 5, pointerEvents: "none" }}>
        <div style={{ display: "inline-flex", width: "fit-content", padding: "4px 8px", borderRadius: 8, border: "1px solid rgba(125,211,252,0.22)", background: "rgba(255,255,255,0.76)", fontSize: rankFontSize, fontWeight: 800, color: "#31506c" }}>{displayRank}</div>
        <div style={{ fontSize: nameFontSize, fontWeight: 900, color: "#16324a", lineHeight: 1.08 }}>{displayName}</div>
        <div style={{ fontSize: oneLineFontSize, lineHeight: 1.3, color: "#476885", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{displayOneLine}</div>
      </div>
    </button>
  );
}
