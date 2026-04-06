import { useLayoutEffect, useRef } from "react";
import defaultDesign from "./defaultDesign";
import renderElement from "./renderElement";
import { applyDomOverrides } from "./designDomUtils";

export function mergeShellOverrideMaps(sharedOverrides = {}, pageOverrides = {}) {
  const selectors = Array.from(new Set([...Object.keys(sharedOverrides || {}), ...Object.keys(pageOverrides || {})]));
  return selectors.reduce((acc, selector) => {
    acc[selector] = {
      ...((sharedOverrides || {})[selector] || {}),
      ...((pageOverrides || {})[selector] || {}),
    };
    return acc;
  }, {});
}

function getCombinedShellElements(sharedElements = [], pageShellElements = []) {
  const ordered = [];
  const seen = new Set();
  [...(Array.isArray(sharedElements) ? sharedElements : []), ...(Array.isArray(pageShellElements) ? pageShellElements : [])].forEach((element) => {
    if (!element) return;
    const key = String(element.id || "");
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    ordered.push(element);
  });
  return ordered;
}


export function getSharedShellElementsFromDesign(designConfig = {}) {
  return Array.isArray(designConfig?.sharedShellElements) ? designConfig.sharedShellElements : [];
}

export function getSharedShellOverridesFromDesign(designConfig = {}) {
  return (designConfig?.sharedShellOverrides && typeof designConfig.sharedShellOverrides === "object")
    ? designConfig.sharedShellOverrides
    : {};
}

export default function AppShellFrame({
  user,
  activePage,
  onNavigate,
  onLogout,
  onLogin,
  children,
  shellPageKey,
  designConfig,
  myUnread = 0,
  shellRef: externalShellRef,
}) {
  const internalShellRef = useRef(null);
  const shellRef = externalShellRef || internalShellRef;
  const navText = designConfig?.siteContent?.topNav || {};
  const resolvedShellPageKey = shellPageKey || activePage;
  const pageDesign = designConfig?.pages?.[resolvedShellPageKey] || defaultDesign.pages?.[resolvedShellPageKey] || {};
  const shellElements = getCombinedShellElements(getSharedShellElementsFromDesign(designConfig), pageDesign?.shellElements || []);
  const mergedShellOverrides = mergeShellOverrideMaps(getSharedShellOverridesFromDesign(designConfig), pageDesign?.shellOverrides || {});

  const handleNavigate = (key) => {
    if (typeof onNavigate === "function") onNavigate(key);
  };

  const shellHandlers = {
    goHome: () => handleNavigate("home"),
    openMy: () => handleNavigate("my"),
    goCharacters: () => handleNavigate("characters"),
    goInvestigations: () => handleNavigate("investigations"),
    goShop: () => handleNavigate("shop"),
    goSD: () => handleNavigate("sd"),
    goAdmin: () => user?.isAdmin && handleNavigate("admin"),
    logout: onLogout,
    login: onLogin,
  };

  useLayoutEffect(() => {
    applyDomOverrides(shellRef.current, mergedShellOverrides);
  }, [mergedShellOverrides, children, shellRef]);

  const menuItems = [
    ["home", navText.home || "홈"],
    ["sd", navText.sd || "맵"],
    ["characters", navText.characters || "캐릭터"],
    ["investigations", navText.investigations || "조사"],
    ["shop", navText.shop || "상점"],
  ];

  return (
    <div ref={shellRef} data-design-shell-root={resolvedShellPageKey} className="app-shell" style={{ overflow: "visible" }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 120, pointerEvents: "none" }}>
        {shellElements
          .slice()
          .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
          .map((element) => renderElement(element, shellHandlers, designConfig?.theme || defaultDesign.theme, "shell"))}
      </div>
      <header className="app-topbar" style={{ gridTemplateColumns: "1fr auto" }}>
        <nav className="app-nav" style={{ justifyContent: "flex-start" }}>
          {menuItems.map(([key, label]) => (
            <button key={key} type="button" onClick={() => handleNavigate(key)} className="ghost-button">
              {label}
            </button>
          ))}
        </nav>
        <div className="app-user-tools">
          {user?.isAdmin ? <button type="button" onClick={() => handleNavigate("admin")} className="ghost-button">운영</button> : null}
          {user ? <button type="button" onClick={onLogout} className="ghost-button">로그아웃</button> : <button type="button" onClick={onLogin} className="ghost-button">로그인</button>}
          <button
            type="button"
            onClick={() => handleNavigate("my")}
            className={`profile-button ${activePage === "my" ? "is-active" : ""}`}
            title={navText.my || "MY"}
            style={{ position: "relative" }}
          >
            {navText.my || "MY"}
            {myUnread > 0 ? <span style={{ position: "absolute", top: 4, right: 4, width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} /> : null}
          </button>
        </div>
      </header>
      <main className="app-content" style={{ paddingTop: 16 }}>{children}</main>
    </div>
  );
}
