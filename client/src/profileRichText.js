import React from "react";

const DEFAULT_FONT = '"Pretendard", "Noto Sans KR", sans-serif';

function sanitizeFont(font) {
  const value = String(font || "").trim();
  return value || DEFAULT_FONT;
}

function parseTagHeader(source, index) {
  if (source.startsWith("[b]", index)) return { type: "open", tag: "b", value: "", next: index + 3 };
  if (source.startsWith("[/b]", index)) return { type: "close", tag: "b", next: index + 4 };
  if (source.startsWith("[i]", index)) return { type: "open", tag: "i", value: "", next: index + 3 };
  if (source.startsWith("[/i]", index)) return { type: "close", tag: "i", next: index + 4 };
  if (source.startsWith("[/size]", index)) return { type: "close", tag: "size", next: index + 7 };
  if (source.startsWith("[/font]", index)) return { type: "close", tag: "font", next: index + 7 };
  if (source.startsWith("[center]", index)) return { type: "open", tag: "center", value: "", next: index + 8 };
  if (source.startsWith("[/center]", index)) return { type: "close", tag: "center", next: index + 9 };
  const sizeMatch = source.slice(index).match(/^\[size=(\d+)\]/);
  if (sizeMatch) return { type: "open", tag: "size", value: Number(sizeMatch[1] || 18), next: index + sizeMatch[0].length };
  const fontMatch = source.slice(index).match(/^\[font=([^\]]+)\]/);
  if (fontMatch) return { type: "open", tag: "font", value: sanitizeFont(fontMatch[1]), next: index + fontMatch[0].length };
  return null;
}

function parseNodes(source, index = 0, stopTag = "") {
  const nodes = [];
  let buffer = "";
  let cursor = index;

  const flush = () => {
    if (!buffer) return;
    nodes.push({ type: "text", text: buffer });
    buffer = "";
  };

  while (cursor < source.length) {
    const token = source[cursor] === "[" ? parseTagHeader(source, cursor) : null;
    if (!token) {
      buffer += source[cursor];
      cursor += 1;
      continue;
    }

    if (token.type === "close") {
      if (stopTag && token.tag === stopTag) {
        flush();
        return { nodes, next: token.next };
      }
      buffer += source.slice(cursor, token.next);
      cursor = token.next;
      continue;
    }

    flush();
    const inner = parseNodes(source, token.next, token.tag);
    nodes.push({ type: token.tag, value: token.value, children: inner.nodes });
    cursor = inner.next;
  }

  flush();
  return { nodes, next: cursor };
}

function renderNode(node, key) {
  if (!node) return null;
  if (node.type === "text") return <React.Fragment key={key}>{node.text}</React.Fragment>;

  const children = (node.children || []).map((child, index) => renderNode(child, `${key}-${index}`));

  if (node.type === "b") return <strong key={key} style={{ fontWeight: 900 }}>{children}</strong>;
  if (node.type === "i") return <em key={key} style={{ fontStyle: "italic" }}>{children}</em>;
  if (node.type === "size") return <span key={key} style={{ fontSize: Number(node.value || 18), lineHeight: 1.8, display: "inline-block" }}>{children}</span>;
  if (node.type === "font") return <span key={key} style={{ fontFamily: sanitizeFont(node.value) }}>{children}</span>;
  if (node.type === "center") return <span key={key} style={{ display: "block", width: "100%", textAlign: "center" }}>{children}</span>;
  return <React.Fragment key={key}>{children}</React.Fragment>;
}

export function renderProfileRichText(text) {
  const source = String(text || "");
  const parsed = parseNodes(source);
  return (parsed.nodes || []).map((node, index) => renderNode(node, `profile-rich-${index}`));
}

export function renderProfileRichParagraph(text) {
  const lines = String(text || "").split("\n");
  return lines.map((line, index) => (
    <React.Fragment key={`profile-line-${index}`}>
      {renderProfileRichText(line)}
      {index < lines.length - 1 ? <br /> : null}
    </React.Fragment>
  ));
}
