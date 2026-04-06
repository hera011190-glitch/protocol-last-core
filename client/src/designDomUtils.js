const appliedCache = new WeakMap();

function toCssValue(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function buildSelectorFromNode(node, root) {
  if (!node || !root) return "";
  let current = node.nodeType === 3 ? node.parentElement : node;
  if (!current || current === root) return ":scope";
  const parts = [];
  while (current && current !== root) {
    if (!(current instanceof Element)) break;
    let part = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) break;
    const sameTagSiblings = Array.from(parent.children).filter((el) => el.tagName === current.tagName);
    const index = Math.max(0, sameTagSiblings.indexOf(current)) + 1;
    part += `:nth-of-type(${index})`;
    parts.unshift(part);
    current = parent;
  }
  return parts.join(" > ");
}

export function getNodeLabel(node) {
  const target = node?.nodeType === 3 ? node.parentElement : node;
  if (!target) return "선택 요소";
  const text = String(target.textContent || "").replace(/\s+/g, " ").trim();
  const tag = String(target.tagName || "요소").toLowerCase();
  if (text) return `${tag} · ${text.slice(0, 28)}`;
  return `${tag} 요소`;
}

export function getRectWithinRoot(node, root) {
  if (!node || !root) return null;
  const target = node.nodeType === 3 ? node.parentElement : node;
  if (!target) return null;
  const nodeRect = target.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  return {
    left: nodeRect.left - rootRect.left + root.scrollLeft,
    top: nodeRect.top - rootRect.top + root.scrollTop,
    width: nodeRect.width,
    height: nodeRect.height,
  };
}

export function clearDomOverrides(root) {
  const applied = appliedCache.get(root) || [];
  applied.forEach(({ node, original }) => {
    if (!node || !original) return;
    Object.entries(original).forEach(([key, value]) => {
      try {
        node.style[key] = value;
      } catch {}
    });
  });
  appliedCache.set(root, []);
}

export function applyDomOverrides(root, overrides) {
  if (!root) return;
  clearDomOverrides(root);
  const records = [];
  Object.entries(overrides || {}).forEach(([selector, stylePatch]) => {
    if (!selector || !stylePatch || typeof stylePatch !== "object") return;
    let nodes = [];
    try {
      if (selector === ":scope") {
        nodes = [root];
      } else {
        nodes = Array.from(root.querySelectorAll(selector));
      }
    } catch {
      nodes = [];
    }
    nodes.forEach((node) => {
      const original = {};
      Object.entries(stylePatch).forEach(([key, value]) => {
        try {
          original[key] = node.style[key] || "";
          node.style[key] = toCssValue(value);
        } catch {}
      });
      records.push({ node, original });
    });
  });
  appliedCache.set(root, records);
}
