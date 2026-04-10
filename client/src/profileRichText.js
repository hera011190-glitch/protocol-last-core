import React from "react";

const DEFAULT_FONT = '"Pretendard", "Noto Sans KR", sans-serif';
const HTML_TAG_PATTERN = /<\/?(div|p|span|br|strong|b|em|i|u|ul|ol|li|h1|h2|h3|h4|table|thead|tbody|tr|td|th|hr)(\s|>|\/)/i;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeFont(font) {
  const value = String(font || "").trim();
  return value || DEFAULT_FONT;
}

export function isHtmlProfile(value) {
  return HTML_TAG_PATTERN.test(String(value || ""));
}

function applyInlineMarkup(source) {
  let html = String(source || "");
  const replacements = [
    [/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>"],
    [/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>"],
    [/\[center\]([\s\S]*?)\[\/center\]/gi, '<div style="text-align:center;">$1</div>'],
    [/\[size=(\d+)\]([\s\S]*?)\[\/size\]/gi, (_, size, text) => `<span style="font-size:${Number(size || 18)}px;">${text}</span>`],
    [/\[font=([^\]]+)\]([\s\S]*?)\[\/font\]/gi, (_, font, text) => `<span style="font-family:${escapeHtml(sanitizeFont(font))};">${text}</span>`],
  ];
  for (let i = 0; i < 8; i += 1) {
    let changed = false;
    replacements.forEach(([pattern, replacement]) => {
      const next = html.replace(pattern, replacement);
      if (next !== html) changed = true;
      html = next;
    });
    if (!changed) break;
  }
  return html;
}

export function legacyProfileToHtml(value) {
  const source = String(value || "");
  if (!source.trim()) return "<p><br></p>";
  if (isHtmlProfile(source)) return source;

  const lines = source.replace(/\r/g, "").split("\n");
  const chunks = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const html = paragraph.map((line) => applyInlineMarkup(escapeHtml(line))).join("<br>");
    chunks.push(`<p style="margin:0 0 14px 0; line-height:1.95;">${html || "<br>"}</p>`);
    paragraph = [];
  };

  lines.forEach((line) => {
    const trimmed = String(line || "").trim();
    const titleMatch = trimmed.match(/^<(.+)>$/);
    if (titleMatch) {
      flushParagraph();
      chunks.push(`<h3 style="margin:18px 0 10px; text-align:center; font-weight:900; color:#16324a;">${escapeHtml(titleMatch[1])}</h3>`);
      return;
    }
    if (!trimmed) {
      flushParagraph();
      return;
    }
    paragraph.push(line);
  });
  flushParagraph();

  return chunks.join("") || `<p style="margin:0; line-height:1.95;">${applyInlineMarkup(escapeHtml(source)).replace(/\n/g, "<br>")}</p>`;
}

export function sanitizeProfileHtml(source) {
  const html = String(source || "");
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") return html;

  const parser = new window.DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return html;

  const allowedTags = new Set(["div", "p", "span", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "td", "th", "hr"]);
  const allowedStyles = new Set(["text-align", "color", "font-family", "font-size", "font-weight", "font-style", "text-decoration", "background-color", "border", "border-collapse", "width", "padding", "margin"]);
  const unwrap = (node) => {
    const parent = node.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
  };

  const cleanNode = (node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === 8) {
        child.parentNode?.removeChild(child);
        return;
      }
      if (child.nodeType !== 1) return;
      const tag = String(child.tagName || "").toLowerCase();
      if (!allowedTags.has(tag)) {
        unwrap(child);
        return;
      }
      Array.from(child.attributes).forEach((attr) => {
        const name = String(attr.name || "").toLowerCase();
        if (name === "style") {
          const nextStyle = String(attr.value || "")
            .split(";")
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
              const [prop, ...rest] = part.split(":");
              const key = String(prop || "").trim().toLowerCase();
              const value = rest.join(":").trim();
              if (!allowedStyles.has(key) || !value) return "";
              return `${key}:${value}`;
            })
            .filter(Boolean)
            .join("; ");
          if (nextStyle) child.setAttribute("style", nextStyle);
          else child.removeAttribute("style");
          return;
        }
        if (["colspan", "rowspan"].includes(name) && ["td", "th"].includes(tag)) return;
        child.removeAttribute(attr.name);
      });
      cleanNode(child);
    });
  };

  cleanNode(root);
  return root.innerHTML;
}

export function renderProfileRichContent(value) {
  const normalized = sanitizeProfileHtml(isHtmlProfile(value) ? String(value || "") : legacyProfileToHtml(value));
  return <div dangerouslySetInnerHTML={{ __html: normalized || "<p><br></p>" }} />;
}

export function renderProfileRichText(value) {
  return renderProfileRichContent(value);
}

export function renderProfileRichParagraph(value) {
  return renderProfileRichContent(value);
}
