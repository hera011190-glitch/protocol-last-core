import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildApiUrl } from "./api";

function resolveImageUrl(src) {
  const value = String(src || "").trim();
  if (!value) return "";
  if (value.startsWith("data:image/")) return value;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value.replace("http://localhost:3001", buildApiUrl(""));
  }
  if (value.startsWith("/")) return buildApiUrl(value);
  return value;
}

const loadedCache = new Set();
const failedOnce = new Map();

export default function LazyImage({
  src,
  alt = "",
  className = "",
  style,
  fit = "cover",
  eager = false,
  placeholder = null,
  fallbackSrcs = [],
  onLoad,
  onError,
  retry = 2,
  ...props
}) {
  const wrapperRef = useRef(null);
  const resolvedSrc = useMemo(() => resolveImageUrl(src), [src]);
  const resolvedFallbacks = useMemo(() => {
    const list = Array.isArray(fallbackSrcs) ? fallbackSrcs : [fallbackSrcs];
    const seen = new Set([resolvedSrc]);
    return list
      .map(resolveImageUrl)
      .filter((value) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
  }, [fallbackSrcs, resolvedSrc]);
  const sourceList = useMemo(() => [resolvedSrc, ...resolvedFallbacks].filter(Boolean), [resolvedSrc, resolvedFallbacks]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const activeSrc = sourceList[sourceIndex] || resolvedSrc;
  const [visible, setVisible] = useState(eager || loadedCache.has(resolvedSrc));
  const [loaded, setLoaded] = useState(loadedCache.has(resolvedSrc));
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSourceIndex(0);
    setLoaded(sourceList.some((value) => loadedCache.has(value)));
    setFailed(false);
    setAttempt(0);
    setVisible(eager || sourceList.some((value) => loadedCache.has(value)));
  }, [resolvedSrc, eager, sourceList]);

  useEffect(() => {
    if (!resolvedSrc || visible || eager) return undefined;
    const node = wrapperRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "700px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [resolvedSrc, visible, eager]);

  const srcWithRetry = useMemo(() => {
    if (!activeSrc) return "";
    if (!attempt) return activeSrc;
    const sep = activeSrc.includes("?") ? "&" : "?";
    return `${activeSrc}${sep}retry=${attempt}`;
  }, [activeSrc, attempt]);

  if (!resolvedSrc) return placeholder || null;

  return (
    <span
      ref={wrapperRef}
      className={className}
      style={{
        position: "relative",
        display: "block",
        overflow: "hidden",
        background: loaded ? "transparent" : "rgba(255,255,255,0.08)",
        ...style,
      }}
    >
      {!loaded && (placeholder || (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "rgba(225,242,255,0.62)",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.08em",
          }}
        >
          IMAGE
        </span>
      ))}
      {visible ? (
        <img
          {...props}
          src={srcWithRetry}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={eager ? "high" : "auto"}
          onLoad={(event) => {
            loadedCache.add(activeSrc);
            loadedCache.add(resolvedSrc);
            setLoaded(true);
            setFailed(false);
            if (typeof onLoad === "function") onLoad(event);
          }}
          onError={(event) => {
            const previous = failedOnce.get(activeSrc) || 0;
            failedOnce.set(activeSrc, previous + 1);
            if (attempt < retry) {
              window.setTimeout(() => setAttempt((value) => value + 1), 350 + attempt * 650);
              return;
            }
            if (sourceIndex < sourceList.length - 1) {
              setSourceIndex((value) => value + 1);
              setAttempt(0);
              setLoaded(false);
              return;
            }
            setFailed(true);
            if (typeof onError === "function") onError(event);
          }}
          style={{
            width: "100%",
            height: "100%",
            objectFit: fit,
            opacity: loaded ? 1 : 0,
            transition: "opacity 220ms ease",
            display: failed ? "none" : "block",
          }}
        />
      ) : null}
    </span>
  );
}

export { resolveImageUrl };
