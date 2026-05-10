import { useEffect, useMemo, useRef, useState } from "react";
import { buildApiUrl } from "./api";
import { preloadImages } from "./imagePreload";

function resolveImageUrl(src) {
  const value = String(src || "").trim();
  if (!value) return "";
  if (value.startsWith("data:image/")) return value;
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")) return buildApiUrl(value);
  return value;
}

export default function LazyImage({
  src,
  fallbackSrcs = [],
  alt = "",
  style,
  className,
  eager = true,
  highPriority = true,
  onError,
  onLoad,
  placeholder = true,
  ...props
}) {
  const candidates = useMemo(() => [src, ...fallbackSrcs].map(resolveImageUrl).filter(Boolean), [src, fallbackSrcs]);
  const [index, setIndex] = useState(0);
  const currentSrc = candidates[index] || "";
  const [ready, setReady] = useState(false);
  const imgRef = useRef(null);
  const placeholderPosition = style?.position === "absolute" || style?.position === "fixed" ? style.position : "relative";

  useEffect(() => {
    setIndex(0);
    setReady(false);
  }, [candidates.join("|")]);

  useEffect(() => {
    if (!currentSrc) return undefined;
    preloadImages([currentSrc], { highPriority, limit: 1 });
    let cancelled = false;
    const image = new Image();
    image.decoding = highPriority ? "sync" : "async";
    image.loading = eager ? "eager" : "lazy";
    image.onload = () => {
      if (!cancelled) setReady(true);
    };
    image.onerror = () => {
      if (!cancelled) setReady(true);
    };
    image.src = currentSrc;
    if (image.complete || imgRef.current?.complete) setReady(true);
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [currentSrc, highPriority, eager]);

  if (!currentSrc) {
    return placeholder ? <div className={className} style={{ ...style, background: "linear-gradient(135deg, rgba(226,242,255,0.42), rgba(255,255,255,0.22))" }} /> : null;
  }

  return (
    <>
      {placeholder && !ready ? (
        <div
          aria-hidden="true"
          style={{
            ...style,
            position: placeholderPosition,
            display: style?.display || "block",
            background: "linear-gradient(135deg, rgba(224,242,254,0.56), rgba(255,255,255,0.24) 52%, rgba(186,230,253,0.30))",
            filter: style?.filter,
          }}
        />
      ) : null}
      <img
        {...props}
        ref={imgRef}
        className={className}
        src={currentSrc}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding={highPriority ? "sync" : "async"}
        fetchPriority={highPriority ? "high" : "auto"}
        draggable={props.draggable ?? false}
        onLoad={(event) => {
          setReady(true);
          if (typeof onLoad === "function") onLoad(event);
        }}
        onError={(event) => {
          if (index + 1 < candidates.length) {
            setIndex(index + 1);
            setReady(false);
            return;
          }
          setReady(true);
          if (typeof onError === "function") onError(event);
        }}
        style={{
          ...style,
          opacity: ready ? style?.opacity ?? 1 : 0.001,
          transition: style?.transition || "opacity 0.18s ease",
        }}
      />
    </>
  );
}
