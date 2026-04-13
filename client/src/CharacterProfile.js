import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import defaultDesign from "./defaultDesign";
import { applyDomOverrides } from "./designDomUtils";
import { getCurrentHpDisplay, getHpStatValue, getMaxHpFromStat } from "./hpUtils";
import { renderProfileRichContent } from "./profileRichText";

function meter(label, value, percent, gradient) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6, fontSize: 12, color: "#6a87a3", fontWeight: 700 }}>
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div style={{ height: 12, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.72)" }}>
        <div style={{ width: `${Math.max(0, Math.min(100, percent))}%`, height: "100%", background: gradient }} />
      </div>
    </div>
  );
}

function StatCell({ label, value }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 20, background: "rgba(255,255,255,0.72)", boxShadow: "inset 0 0 0 1px rgba(98,176,220,0.08)" }}>
      <div style={{ fontSize: 11, color: "#6a87a3", fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, marginTop: 4, color: "#13324b" }}>{value}</div>
    </div>
  );
}

function RelationCard({ relation }) {
  if (!relation) return null;
  return (
    <div style={{ padding: "16px 18px", borderRadius: 22, background: "rgba(255,255,255,0.64)", minHeight: 134, display: "grid", alignContent: "start", gap: 6 }}>
      <div style={{ fontWeight: 900, color: "#16324a" }}>{relation.title || relation.name || relation.relationName || "후관"}</div>
      <div style={{ color: "#4f7390", fontSize: 14, fontWeight: 700 }}>{relation.target || relation.character || relation.otherCharacter || "상대 캐릭터 미지정"}</div>
      <div style={{ color: "#6a87a3", fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{relation.description || relation.desc || ""}</div>
    </div>
  );
}

function ItemChip({ children }) {
  return <div style={{ padding: "8px 12px", borderRadius: 999, background: "rgba(255,255,255,0.82)", border: "1px solid rgba(98,176,220,0.12)", color: "#21415d", fontWeight: 700, fontSize: 13 }}>{children}</div>;
}

function ScrollPanel({ title, children, minHeight = 280 }) {
  return (
    <div style={{ padding: "18px 20px", borderRadius: 24, background: "rgba(255,255,255,0.72)", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 10, minHeight, height: "100%" }}>
      <div style={{ fontSize: 12, color: "#6a87a3", fontWeight: 800 }}>{title}</div>
      <div style={{ minHeight: 0, overflowY: "auto", paddingRight: 4 }}>{children}</div>
    </div>
  );
}

export default function CharacterProfile({ character, goBack, theme, design, pageKey = "profileCharacter" }) {
  const hpStat = getHpStatValue(character?.stats?.hp);
  const maxHp = getMaxHpFromStat(hpStat);
  const hp = getCurrentHpDisplay(hpStat, character?.currentHp || character?.stats?.currentHp);
  const level = Number(character?.level || 1);
  const exp = Number(character?.exp || 0);
  const expLimit = Math.max(100, level * 100);
  const expPercent = Math.max(0, Math.min(100, ((exp % expLimit) / expLimit) * 100));
  const corrosion = Math.max(0, Math.min(100, Number(character?.corrosion || 0)));
  const hpPercent = Math.max(0, Math.min(100, (hp / Math.max(maxHp, 1)) * 100));
  const relations = Array.isArray(character?.relations) ? character.relations : [];
  const skills = Array.isArray(character?.skills) ? character.skills : [];
  const itemNames = Array.isArray(character?.items) ? character.items : [];
  const oneLine = String(character?.oneLine || "한마디가 없습니다.").trim();
  const stats = character?.stats || {};
  const [audioMuted, setAudioMuted] = useState(() => {
    try {
      return localStorage.getItem("plc-audio-muted") === "1";
    } catch {
      return false;
    }
  });
  const [resolvedProfileAudio, setResolvedProfileAudio] = useState({
    url: String(character?.profileBgm || ""),
    volume: Math.max(0, Math.min(1, Number(character?.profileBgmVolume ?? 1) || 1)),
  });
  const rootRef = useRef(null);
  const pageDesign = design?.pages?.[pageKey] || defaultDesign.pages?.[pageKey] || {};
  const background = pageDesign.background || {};
  const pageOverlay = background.overlay || "none";

  useLayoutEffect(() => {
    applyDomOverrides(rootRef.current, pageDesign.domOverrides || {});
  }, [pageDesign.domOverrides, character, pageKey]);

  useEffect(() => {
    setResolvedProfileAudio({
      url: String(character?.profileBgm || ""),
      volume: Math.max(0, Math.min(1, Number(character?.profileBgmVolume ?? 1) || 1)),
    });
  }, [character?.id, character?.profileBgm, character?.profileBgmVolume]);

  useEffect(() => {
    if (!character?.id || character?.profileBgm) return undefined;
    let cancelled = false;
    fetch(buildApiUrl(`/character/${character.id}?t=${Date.now()}`), { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const nextChar = data?.character;
        const nextUrl = String(nextChar?.profileBgm || "");
        if (!nextUrl) return;
        setResolvedProfileAudio({
          url: nextUrl,
          volume: Math.max(0, Math.min(1, Number(nextChar?.profileBgmVolume ?? 1) || 1)),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [character?.id, character?.profileBgm]);

  const effectiveProfileBgm = useMemo(() => ({
    url: String(resolvedProfileAudio?.url || character?.profileBgm || ""),
    volume: Math.max(0, Math.min(1, Number(resolvedProfileAudio?.volume ?? character?.profileBgmVolume ?? 1) || 1)),
  }), [resolvedProfileAudio, character?.profileBgm, character?.profileBgmVolume]);

  useEffect(() => {
    const profileBgm = String(effectiveProfileBgm?.url || "");
    const profileVolume = Math.max(0, Math.min(1, Number(effectiveProfileBgm?.volume ?? 1) || 1));
    const handleMuted = (event) => setAudioMuted(!!event?.detail?.muted);
    window.addEventListener("plc-audio-muted-changed", handleMuted);
    if (profileBgm) {
      window.dispatchEvent(new CustomEvent("plc-audio-override", { detail: { scope: "profile", url: profileBgm, placement: "profile", volume: profileVolume } }));
      const retryTimer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent("plc-audio-override", { detail: { scope: "profile", url: profileBgm, placement: "profile", volume: profileVolume } }));
      }, 180);
      return () => {
        clearTimeout(retryTimer);
        window.removeEventListener("plc-audio-muted-changed", handleMuted);
        window.dispatchEvent(new CustomEvent("plc-audio-clear", { detail: { scope: "profile" } }));
      };
    }
    return () => {
      window.removeEventListener("plc-audio-muted-changed", handleMuted);
    };
  }, [character?.id, effectiveProfileBgm]);

  return (
    <div
      ref={rootRef}
      data-design-page-root={pageKey}
      className={`theme-page theme-page-${pageKey}`}
      style={{
        position: "relative",
        minHeight: "100vh",
        color: theme?.textMain || "#13324b",
        backgroundColor: background.color || "transparent",
        backgroundImage:
          background.image && pageOverlay !== "none"
            ? `${pageOverlay}, url(${background.image})`
            : background.image
            ? `url(${background.image})`
            : pageOverlay !== "none"
            ? pageOverlay
            : "linear-gradient(180deg, rgba(250,254,255,0.92), rgba(239,249,255,0.95))",
        backgroundSize: background.image ? `${Number(background.scale || 100)}% auto` : undefined,
        backgroundPosition: background.image ? `${Number(background.positionX || 50)}% ${Number(background.positionY || 50)}%` : undefined,
        backgroundRepeat: background.image ? "no-repeat" : undefined,
        padding: "28px 24px 80px",
      }}
    >
      <div style={{ maxWidth: 1240, margin: "0 auto", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 18 }}>
        <div />
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {effectiveProfileBgm.url ? (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("plc-audio-mute-toggle"))}
              title={audioMuted ? "프로필 BGM 켜기" : "프로필 BGM 끄기"}
              style={{ width: 50, height: 50, borderRadius: "50%", border: "none", background: "transparent", color: "rgba(255,255,255,0.74)", cursor: "pointer", display: "grid", placeItems: "center", opacity: 1, boxShadow: "none", padding: 0 }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.18))" }}>
                <path d="M5 9.5H8.4L13.8 5.2V18.8L8.4 14.5H5V9.5Z" fill="currentColor" />
                {!audioMuted ? (
                  <>
                    <path d="M16.2 8.2C17.1 9.1 17.6 10.4 17.6 12C17.6 13.6 17.1 14.9 16.2 15.8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M18.8 5.8C20.4 7.4 21.2 9.5 21.2 12C21.2 14.5 20.4 16.6 18.8 18.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </>
                ) : (
                  <>
                    <path d="M16.1 8.1L20.4 16.1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    <path d="M20.4 8.1L16.1 16.1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </>
                )}
              </svg>
            </button>
          ) : null}
          <button type="button" className="ghost-button" onClick={goBack}>뒤로가기</button>
        </div>
      </div>

      <div style={{ maxWidth: 1240, margin: "0 auto", display: "grid", gap: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 0.92fr) minmax(0, 1.08fr)", gap: 24, alignItems: "stretch" }}>
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <div style={{ width: "100%", maxWidth: 360, margin: "0 auto", display: "grid", gap: 10 }}>
              <div style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 26, overflow: "hidden", background: "rgba(255,255,255,0.82)", boxShadow: theme?.shadow || "0 20px 44px rgba(73,132,170,0.12)" }}>
                {character?.image ? <img src={character.image} alt={`${character.name}-profile`} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#88a0b8" }}>IMG</div>}
              </div>
              <div style={{ width: "100%", maxWidth: 360, margin: "0 auto", display: "flex", justifyContent: "center", paddingTop: 6 }}>
                <div style={{ position: "relative", width: "fit-content", maxWidth: "100%", minWidth: 180, padding: "16px 20px", borderRadius: 24, background: "rgba(255,255,255,0.96)", color: "#274561", fontWeight: 700, lineHeight: 1.7, boxShadow: "0 14px 26px rgba(73,132,170,0.08)", textAlign: "center" }}>
                  <div style={{ position: "absolute", left: "50%", top: -10, width: 20, height: 20, background: "rgba(255,255,255,0.96)", transform: "translateX(-50%) rotate(45deg)", boxShadow: "-2px -2px 8px rgba(73,132,170,0.04)" }} />
                  <div style={{ position: "relative", zIndex: 1, whiteSpace: "pre-wrap", wordBreak: "keep-all", textAlign: "center" }}>{oneLine}</div>
                </div>
              </div>
              <div style={{ display: "grid", gap: 4, textAlign: "left", alignItems: "start" }}>
                <div style={{ display: "inline-flex", justifySelf: "start", padding: "6px 12px", borderRadius: 999, border: "1px solid rgba(148,163,184,0.28)", background: "rgba(255,255,255,0.52)", fontSize: 12, fontWeight: 900, color: "#41617e" }}>{character?.rank || "대원"}</div>
                <h2 style={{ margin: 0, fontSize: 28, lineHeight: 1.08, textAlign: "left" }}>{character?.name}</h2>
                <div style={{ fontSize: 18, fontWeight: 900, color: "#16324a" }}>Lv. {level}</div>
              </div>
            </div>

            <div style={{ width: "100%", maxWidth: 360, margin: "0 auto", display: "grid", gap: 10, alignContent: "start" }}>
              {meter("EXP", `${exp % expLimit} / ${expLimit}`, expPercent, "linear-gradient(90deg, #fcd34d, #f59e0b)")}
              {meter("HP", `${hp} / ${maxHp}`, hpPercent, "linear-gradient(90deg, #86efac, #22c55e)")}
              {meter("침식도", `${corrosion}%`, corrosion, "linear-gradient(90deg, #fda4af, #ef4444)")}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateRows: "auto auto minmax(300px, 1fr)", gap: 16, minHeight: "100%" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
              <StatCell label="HP" value={hpStat} />
              <StatCell label="ATK" value={stats.atk ?? 0} />
              <StatCell label="DEF" value={stats.def ?? 0} />
              <StatCell label="AGI" value={stats.agi ?? 0} />
            </div>

            <div style={{ padding: "18px 20px", borderRadius: 24, background: "rgba(255,255,255,0.72)", display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12, color: "#6a87a3", fontWeight: 800 }}>보유 코인</div>
              <div style={{ fontSize: 32, fontWeight: 900, color: "#13324b" }}>{Number(character?.coins || 0).toLocaleString()}</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, minHeight: 0 }}>
              <ScrollPanel title="보유 스킬" minHeight={320}>
                <div style={{ color: "#4f7390", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
                  {skills.length > 0 ? skills.map((skill) => (typeof skill === "string" ? `• ${skill}` : `• ${skill.name || skill.key}`)).join("\n") : "보유 스킬이 없습니다."}
                </div>
              </ScrollPanel>
              <ScrollPanel title="보유 아이템" minHeight={320}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignContent: "start" }}>
                  {itemNames.length > 0 ? itemNames.map((item, index) => <ItemChip key={`${item}-${index}`}>{item}</ItemChip>) : <div style={{ color: "#6a87a3" }}>보유 아이템이 없습니다.</div>}
                </div>
              </ScrollPanel>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", placeItems: "center", minHeight: 540, overflow: "hidden" }}>
          {character?.mainImage ? (
            <img src={character.mainImage} alt={`${character.name}-full`} style={{ maxWidth: "100%", maxHeight: 820, width: "auto", height: "auto", objectFit: "contain", filter: "drop-shadow(0 18px 28px rgba(15,23,42,0.14))", pointerEvents: "none", userSelect: "none" }} />
          ) : <div style={{ color: "#7e94ae" }}>전신 이미지</div>}
        </div>

        <div style={{ padding: "6px 2px", color: "#4f7390", lineHeight: 1.95 }}>
          {renderProfileRichContent(character?.profile || "프로필이 없습니다.")}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
          {relations.length > 0 ? relations.map((relation, index) => <RelationCard key={index} relation={relation} />) : [0, 1, 2].map((index) => <div key={index} style={{ minHeight: 128, borderRadius: 22, background: "rgba(255,255,255,0.2)" }} />)}
        </div>
      </div>
    </div>
  );
}
