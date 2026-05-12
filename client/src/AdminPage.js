import React, { useEffect, useMemo, useRef, useState } from "react";
import { ProfileCard, normalizeProfileCardFrame } from "./profileCardShared";
import { renderProfileRichParagraph } from "./profileRichText";
import ImageDropInput from "./ImageDropInput";
import AudioSourceInput from "./AudioSourceInput";
import { buildApiUrl } from "./api";

function normalizeUserIdText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function pickAdminUserRows(payload) {
  const normalizeRows = (rows) => rows.map((row) => (typeof row === "string" ? { id: row, type: "owner" } : row));
  if (Array.isArray(payload)) return normalizeRows(payload);
  if (Array.isArray(payload?.users)) return normalizeRows(payload.users);
  if (Array.isArray(payload?.accounts)) return normalizeRows(payload.accounts);
  if (Array.isArray(payload?.accountIds)) return normalizeRows(payload.accountIds);
  if (Array.isArray(payload?.rows)) return normalizeRows(payload.rows);
  if (Array.isArray(payload?.data)) return normalizeRows(payload.data);
  return [];
}

function getAdminAccountId(user) {
  if (!user || typeof user !== "object") return "";
  return normalizeUserIdText(
    user.id ??
    user.userId ??
    user.userID ??
    user.user_id ??
    user.accountId ??
    user.accountID ??
    user.account_id ??
    user.loginId ??
    user.loginID ??
    user.login_id ??
    user.username ??
    user.userName ??
    user.user_name ??
    user.uid ??
    user.memberId ??
    user.memberID ??
    user.member_id ??
    user.email ??
    ""
  );
}

function isSelectableAdminUserRow(user) {
  const id = getAdminAccountId(user);
  if (!id) return false;
  const lower = id.toLowerCase();
  if (["plc", "id", "name", "items", "item", "users", "accounts", "members", "data", "rows", "design", "theme", "node", "npc", "battle", "shop"].includes(lower)) return false;
  if (/^item-\d{8,}$/.test(lower)) return false;
  if (/^(custom|investigation|shop|item|node|map|design|theme|npc|battle|reward)[-_:.]/i.test(id)) return false;
  if (/(custom|investigation|shop|item|node|design|theme|npc|battle)/i.test(id) && !/@/.test(id)) return false;
  if (/(조사|커스텀|상점|아이템|노드|디자인|테마|전투|보상)/.test(id)) return false;
  if (/^\d+$/.test(id) && id.length >= 10) return false;
  if (/^E-\d+$/i.test(id)) return false;
  if (/^https?:\/\//i.test(id) || id.includes("/static/") || id.includes("data:image/")) return false;
  return true;
}

function MenuCard({ title, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: "left",
        padding: "22px",
        borderRadius: "24px",
        border: "1px solid rgba(98,176,220,0.18)",
        background: "rgba(255,255,255,0.92)",
        color: "#16324a",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        boxShadow: "0 20px 36px rgba(73,132,170,0.12)",
      }}
    >
      <div className="section-eyebrow">ADMIN</div>
      <div style={{ fontSize: "24px", fontWeight: 900, marginTop: "10px" }}>{title}</div>
    </button>
  );
}


function UserSelectModal({
  open,
  users,
  selectedUserId,
  search,
  onSearchChange,
  onSelect,
  onTypedSelect,
  onClose,
  onRefresh,
  loading = false,
  verifyingUser = null,
}) {
  const normalizedSearch = normalizeUserIdText(search).toLowerCase();
  const safeUsers = Array.isArray(users) ? users : [];
  const filteredUsers = safeUsers.filter((user) => {
    const id = normalizeUserIdText(user?.id);
    const type = String(user?.type || "");
    if (!normalizedSearch) return true;
    return id.toLowerCase().includes(normalizedSearch) || type.toLowerCase().includes(normalizedSearch);
  });
  const typedId = normalizeUserIdText(search);
  const typedKey = typedId.toLowerCase();
  const hasExactTypedUser = !!typedId && safeUsers.some((user) => normalizeUserIdText(user?.id).toLowerCase() === typedKey);
  const verificationMatchesTyped = !!typedId && normalizeUserIdText(verifyingUser?.id).toLowerCase() === typedKey;
  const verifiedExists = verificationMatchesTyped && verifyingUser?.status === "exists";
  const verifiedMissing = verificationMatchesTyped && verifyingUser?.status === "missing";
  const verifiedChecking = verificationMatchesTyped && verifyingUser?.status === "checking";
  const verifiedError = verificationMatchesTyped && verifyingUser?.status === "error";
  const showTypedSelect = !!typedId && !hasExactTypedUser && verifiedExists;

  const verificationLabel = (() => {
    if (!typedId) return "아이디를 입력하면 실제 가입 여부를 확인합니다.";
    if (hasExactTypedUser) return "목록에서 실제 가입된 아이디를 찾았습니다.";
    if (verifiedChecking) return "입력한 아이디가 실제 가입된 계정인지 확인 중입니다.";
    if (verifiedExists) return "입력한 아이디는 실제 가입된 계정입니다.";
    if (verifiedMissing) return "서버의 전체 회원가입 목록을 다시 확인했지만, 정확히 일치하는 계정을 찾지 못했습니다.";
    if (verifiedError) return "가입 여부 확인에 실패했습니다. 새로고침 후 다시 확인해주세요.";
    return "입력한 아이디가 실제 가입된 계정인지 확인합니다.";
  })();

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(8, 18, 32, 0.42)",
        backdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "min(720px, 96vw)",
          maxHeight: "82vh",
          overflow: "hidden",
          borderRadius: 28,
          background: "rgba(248, 252, 255, 0.98)",
          border: "1px solid rgba(98,176,220,0.24)",
          boxShadow: "0 28px 70px rgba(20, 62, 95, 0.28)",
          color: "#16324a",
          display: "grid",
          gridTemplateRows: "auto auto 1fr auto",
        }}
      >
        <div style={{ padding: "22px 24px 12px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <div className="section-eyebrow">USER SELECT</div>
            <h3 style={{ margin: "8px 0 0", fontSize: 24 }}>계정 선택</h3>
            <div style={{ marginTop: 6, color: "#5d7a95", fontSize: 13 }}>
              가입된 계정 {safeUsers.length}개 중 {filteredUsers.length}개 표시{loading ? " · 불러오는 중" : ""}
            </div>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>닫기</button>
        </div>

        <div style={{ padding: "0 24px 14px", display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
            <input
              value={search}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="유저 아이디 검색"
              autoFocus
              style={{
                ...inputStyle,
                marginTop: 0,
                fontSize: 15,
                background: "rgba(255,255,255,0.98)",
              }}
            />
            <button type="button" className="ghost-button" onClick={() => onRefresh?.()} disabled={loading || verifiedChecking}>
              {loading || verifiedChecking ? "확인 중" : "새로고침"}
            </button>
          </div>
          <div
            style={{
              minHeight: 18,
              fontSize: 12,
              color: hasExactTypedUser || verifiedExists ? "#237052" : verifiedMissing || verifiedError ? "#b45309" : "#5d7a95",
              fontWeight: hasExactTypedUser || verifiedExists ? 800 : 700,
            }}
          >
            {verificationLabel}
          </div>
        </div>

        <div style={{ padding: "0 24px 20px", overflow: "auto" }}>
          {loading && safeUsers.length === 0 ? (
            <div style={{ padding: 18, borderRadius: 18, background: "rgba(240,248,255,0.9)", color: "#5d7a95", textAlign: "center" }}>
              계정 목록을 다시 불러오고 있습니다.
            </div>
          ) : filteredUsers.length === 0 && !showTypedSelect ? (
            <div style={{ padding: 18, borderRadius: 18, background: "rgba(240,248,255,0.9)", color: "#5d7a95", textAlign: "center" }}>
              검색 결과가 없습니다. 정확한 아이디를 입력하면 실제 가입 여부를 따로 확인합니다.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {filteredUsers.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
                  {filteredUsers.map((user) => {
                    const id = String(user?.id || "");
                    const type = String(user?.type || "");
                    const active = String(selectedUserId || "") === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onSelect?.(id)}
                        style={{
                          textAlign: "left",
                          padding: "14px 15px",
                          borderRadius: 18,
                          border: active ? "1px solid rgba(61, 154, 220, 0.75)" : "1px solid rgba(98,176,220,0.18)",
                          background: active ? "linear-gradient(135deg, rgba(126,220,255,0.32), rgba(255,255,255,0.98))" : "rgba(255,255,255,0.92)",
                          color: "#16324a",
                          cursor: "pointer",
                          boxShadow: active ? "0 12px 26px rgba(73,132,170,0.22)" : "0 10px 22px rgba(73,132,170,0.1)",
                        }}
                      >
                        <div style={{ fontWeight: 900, wordBreak: "break-all" }}>{id || "아이디 없음"}</div>
                        <div style={{ marginTop: 4, fontSize: 12, color: "#6d86a0" }}>{type || "user"}</div>
                      </button>
                    );
                  })}
                </div>
              )}
              {showTypedSelect && (
                <button
                  type="button"
                  onClick={() => onTypedSelect?.(typedId)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "14px 16px",
                    borderRadius: 18,
                    border: "1px solid rgba(35,112,82,0.38)",
                    background: "rgba(232, 255, 246, 0.96)",
                    color: "#16324a",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 900 }}>확인된 아이디로 선택</div>
                  <div style={{ marginTop: 4, color: "#237052", wordBreak: "break-all" }}>{typedId}</div>
                </button>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: "14px 24px 22px", borderTop: "1px solid rgba(98,176,220,0.14)", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ color: "#5d7a95", fontSize: 13 }}>
            현재 선택: <b style={{ color: "#16324a" }}>{selectedUserId || "없음"}</b>
          </div>
          <button type="button" className="home-primary-button" onClick={onClose}>선택 완료</button>
        </div>
      </div>
    </div>
  );
}

const PROFILE_FONT_OPTIONS = [
  { label: "기본 폰트", value: `"Pretendard", "Noto Sans KR", sans-serif` },
  { label: "맑은 고딕", value: `"Malgun Gothic", sans-serif` },
  { label: "나눔고딕", value: `"Nanum Gothic", sans-serif` },
  { label: "나눔명조", value: `"Nanum Myeongjo", serif` },
  { label: "바탕", value: `"Batang", serif` },
  { label: "궁서", value: `"Gungsuh", serif` },
];

const adminApi = (path) => buildApiUrl(path);

function normalizeSavedCharacterPayload(character) {
  if (!character || typeof character !== "object") return character;
  const version = Number(character.assetVersion || character.updatedAt || Date.now());
  return {
    ...character,
    assetVersion: version,
    updatedAt: version,
    image: character.image || character.profileImage || "",
    profileImage: character.profileImage || character.image || "",
    mainImage: character.mainImage || character.cardImage || character.image || character.profileImage || "",
    cardImage: character.cardImage || character.mainImage || character.image || character.profileImage || "",
    investigationImage: character.investigationImage || character.spriteImage || character.mainImage || character.image || "",
    spriteImage: character.spriteImage || character.investigationImage || character.mainImage || character.image || "",
  };
}

function mergeUsersById(currentUsers, nextUsers) {
  const merged = [];
  const indexById = new Map();

  [...(Array.isArray(currentUsers) ? currentUsers : []), ...(Array.isArray(nextUsers) ? nextUsers : [])].forEach((user) => {
    if (!isSelectableAdminUserRow(user)) return;
    const id = getAdminAccountId(user);
    const key = id.toLowerCase();
    const normalized = { ...user, id, type: user.type || user.role || "owner" };

    if (indexById.has(key)) {
      const index = indexById.get(key);
      merged[index] = { ...merged[index], ...normalized, id: merged[index].id || id };
    } else {
      indexById.set(key, merged.length);
      merged.push(normalized);
    }
  });

  return merged;
}

const inputStyle = {
  width: "100%",
  marginTop: 6,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(98,176,220,0.18)",
  background: "rgba(255,255,255,0.98)",
  color: "#16324a",
  boxSizing: "border-box",
};

const panelStyle = {
  padding: 18,
  borderRadius: 24,
  background: "rgba(255,255,255,0.92)",
  border: "1px solid rgba(98,176,220,0.18)",
  boxShadow: "0 20px 36px rgba(73,132,170,0.12)",
  display: "grid",
  gap: 10,
};

function PreviewCharacterCard({ name, rank, image, oneLine, frame, onFrameChange }) {
  const dragRef = useRef(null);
  const safeFrame = normalizeProfileCardFrame(frame);

  const clampFrame = (next) => ({
    x: Math.max(-1200, Math.min(1200, Number(next.x ?? safeFrame.x))),
    y: Math.max(-1200, Math.min(1200, Number(next.y ?? safeFrame.y))),
    scale: Math.max(0.45, Math.min(11.5, Number(next.scale ?? safeFrame.scale))),
  });

  const handlePointerDown = (e) => {
    if (!onFrameChange || !image) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      frameX: safeFrame.x,
      frameY: safeFrame.y,
      scale: safeFrame.scale,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current || !onFrameChange) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    onFrameChange(clampFrame({
      x: dragRef.current.frameX + dx,
      y: dragRef.current.frameY + dy,
      scale: dragRef.current.scale,
    }));
  };

  const stopDrag = (e) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      style={{ width: 160, maxWidth: "100%", touchAction: "none", cursor: onFrameChange && image ? "grab" : "default", userSelect: "none" }}
    >
      <ProfileCard
        character={{ name, rank, oneLine, mainImage: image, mainImageFrame: safeFrame }}
        theme={{ line: "rgba(98,176,220,0.18)", shadow: "0 18px 38px rgba(73,132,170,0.16)" }}
        width="100%"
      />
    </div>
  );
}

function frameFromSource(source) {
  return {
    x: Number(source?.mainImageFrame?.x ?? source?.frameX ?? 50),
    y: Number(source?.mainImageFrame?.y ?? source?.frameY ?? 28),
    scale: Number(source?.mainImageFrame?.scale ?? source?.frameScale ?? 1.12),
  };
}

export default function AdminPage({
  goBack,
  goInvestigations,
  goInvestigationBuilder,
  goDesignEditor,
  goShopManager,
  goRelations,
  goMapManager,
}) {
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [characters, setCharacters] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [userSelectOpen, setUserSelectOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userVerify, setUserVerify] = useState({ id: "", status: "idle", user: null });
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [selectedCharacterDetail, setSelectedCharacterDetail] = useState(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    charName: "",
    charProfile: "",
    charImage: "",
    charMainImage: "",
    charInvestigationImage: "",
    charAge: "",
    charBodyInfo: "",
    charRank: "대원",
    charOneLine: "",
    charProfileBgm: "",
    frameX: 50,
    frameY: 28,
    frameScale: 1.12,
  });
  const createProfileTextareaRef = useRef(null);
  const editProfileTextareaRef = useRef(null);
  const [siteBgm, setSiteBgm] = useState("");
  const [siteBgmVolume, setSiteBgmVolume] = useState(1);
  const [edit, setEdit] = useState({
    name: "",
    profile: "",
    image: "",
    mainImage: "",
    investigationImage: "",
    coins: "",
    exp: "",
    level: "",
    statPoints: "",
    corrosion: "",
    atk: "",
    hp: "",
    currentHp: "",
    def: "",
    agi: "",
    items: [],
    itemInput: "",
    skills: [],
    skillInput: "",
    age: "",
    bodyInfo: "",
    rank: "대원",
    oneLine: "",
    profileBgm: "",
    profileBgmVolume: 1,
    dailyAttemptsLeft: "1",
    gambleCountLeft: "3",
    frameX: 50,
    frameY: 28,
    frameScale: 1.12,
  });


  const wrapTextareaSelection = (textarea, value, setter, openTag, closeTag = openTag) => {
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const raw = value || "";
    const selected = raw.slice(start, end) || "텍스트";
    const replacement = `${openTag}${selected}${closeTag}`;
    setter(`${raw.slice(0, start)}${replacement}${raw.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = start + openTag.length;
      textarea.selectionEnd = start + openTag.length + selected.length;
    });
  };

  const applyTextareaFontSelection = (textarea, value, setter, fontFamily) => {
    if (!fontFamily) return;
    wrapTextareaSelection(textarea, value, setter, `[font=${fontFamily}]`, "[/font]");
  };

  const loadSiteBgm = async () => {
    try {
      const res = await fetch(adminApi(`/designConfig?t=${Date.now()}`), { cache: "no-store" });
      const data = await res.json();
      setSiteBgm(String(data?.siteContent?.bgm?.site || data?.siteContent?.bgm?.home || ""));
      setSiteBgmVolume(Math.max(0, Math.min(1, Number(data?.siteContent?.bgm?.siteVolume ?? data?.siteContent?.bgm?.volume ?? 1) || 1)));
    } catch {
      setSiteBgm("");
    }
  };

  useEffect(() => () => {
    ["admin-site-preview", "admin-create-profile-preview", "admin-edit-profile-preview"].forEach((scope) => {
      window.dispatchEvent(new CustomEvent("plc-audio-clear", { detail: { scope } }));
    });
  }, []);

  const saveSiteBgm = async () => {
    try {
      const currentRes = await fetch(adminApi(`/designConfig?t=${Date.now()}`), { cache: "no-store" });
      const current = await currentRes.json();
      const next = {
        ...(current || {}),
        siteContent: {
          ...((current && current.siteContent) || {}),
          bgm: {
            ...(((current && current.siteContent) || {}).bgm || {}),
            site: siteBgm || "",
            siteVolume: Math.max(0, Math.min(1, Number(siteBgmVolume) || 1)),
          },
        },
      };
      const saveRes = await fetch(adminApi("/designConfig"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const saved = await saveRes.json();
      if (!saved?.success) {
        setMessage(saved?.message || "홈페이지 BGM 저장 실패");
        return;
      }
      try {
        localStorage.setItem("plc-design-cache", JSON.stringify(saved.designConfig));
      } catch {}
      window.dispatchEvent(new CustomEvent("plc-design-updated", { detail: { design: saved.designConfig } }));
      setMessage("홈페이지 BGM 저장 완료");
    } catch {
      setMessage("홈페이지 BGM 저장 실패");
    }
  };

  const loadUsers = async () => {
    try {
      setUsersLoading(true);
      const stamp = Date.now();
      const endpoints = [
        `/admin/accountIds?deep=1&t=${stamp}`,
        `/admin/users?deep=1&t=${stamp}`,
      ];
      let mergedRows = [];

      for (const endpoint of endpoints) {
        try {
          const userRes = await fetch(adminApi(endpoint), {
            cache: "no-store",
            headers: { "Cache-Control": "no-cache" },
          });
          const userData = await userRes.json();
          const userRows = pickAdminUserRows(userData);
          if (Array.isArray(userRows) && userRows.length > 0) {
            mergedRows = mergeUsersById(mergedRows, userRows);
          }
        } catch (error) {
          console.error("admin users endpoint failed", endpoint, error);
        }
      }

      setUsers((prev) => {
        if (mergedRows.length === 0 && prev.length > 0) return mergeUsersById([], prev);
        return mergeUsersById([], mergedRows);
      });
      return mergedRows;
    } catch (error) {
      console.error("admin users load failed", error);
    } finally {
      setUsersLoading(false);
    }
    return [];
  };

  const checkUserExists = async (userId) => {
    const keyword = normalizeUserIdText(userId);
    if (!keyword) {
      setUserVerify({ id: "", status: "idle", user: null });
      return null;
    }
    const localFound = mergeUsersById([], users).find((user) => normalizeUserIdText(user?.id).toLowerCase() === keyword.toLowerCase());
    if (localFound) {
      setUserVerify({ id: keyword, status: "exists", user: localFound });
      return localFound;
    }
    setUserVerify({ id: keyword, status: "checking", user: null });
    try {
      const stamp = Date.now();
      const res = await fetch(adminApi(`/admin/users/check?id=${encodeURIComponent(keyword)}&deep=1&t=${stamp}`), {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const data = await res.json();
      let foundUser = data?.exists && data?.user ? data.user : null;

      if (!foundUser) {
        const directRes = await fetch(adminApi(`/admin/accountIds?q=${encodeURIComponent(keyword)}&deep=1&t=${Date.now()}`), {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        const directData = await directRes.json();
        const directRows = pickAdminUserRows(directData);
        if (Array.isArray(directRows) && directRows.length > 0) {
          setUsers((prev) => mergeUsersById(prev, directRows));
          foundUser = directRows.find((user) => normalizeUserIdText(user?.id).toLowerCase() === keyword.toLowerCase()) || null;
        }
      }

      if (!foundUser) {
        const rebuildRes = await fetch(adminApi(`/admin/users/rebuild?q=${encodeURIComponent(keyword)}&deep=1&t=${Date.now()}`), {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        const rebuildData = await rebuildRes.json();
        const rebuildRows = pickAdminUserRows(rebuildData);
        if (Array.isArray(rebuildRows) && rebuildRows.length > 0) {
          setUsers((prev) => mergeUsersById(prev, rebuildRows));
          foundUser = rebuildRows.find((user) => normalizeUserIdText(user?.id).toLowerCase() === keyword.toLowerCase()) || null;
        }
      }

      if (foundUser) {
        setUsers((prev) => mergeUsersById(prev, [foundUser]));
        setUserVerify({ id: keyword, status: "exists", user: foundUser });
        return foundUser;
      }
      setUserVerify({ id: keyword, status: "missing", user: null });
      return null;
    } catch (error) {
      console.error("admin user verify failed", error);
      setUserVerify({ id: keyword, status: "error", user: null });
      return null;
    }
  };

  const loadAll = async () => {
    await loadUsers();

    const charRes = await fetch(adminApi(`/characters-lite?t=${Date.now()}`), { cache: "no-store" });
    const charData = await charRes.json();
    if (Array.isArray(charData)) {
      setCharacters((prev) => {
        if (charData.length === 0 && prev.length > 0) {
          setMessage("서버에서 빈 캐릭터 목록이 내려와 기존 화면 데이터를 보호했습니다. 새로고침 전 서버 저장소를 확인해주세요.");
          return prev;
        }
        return charData;
      });
    }
  };

  const loadCharacterDetail = async (characterId) => {
    if (!characterId) return null;
    try {
      const res = await fetch(adminApi(`/character/${characterId}?t=${Date.now()}`), { cache: "no-store" });
      const data = await res.json();
      return data?.character || null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    loadAll().catch(() => {});
    loadSiteBgm().catch(() => {});
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(""), 1800);
    return () => clearTimeout(timer);
  }, [message]);

  const selectedUser = useMemo(
    () => users.find((user) => normalizeUserIdText(user?.id).toLowerCase() === normalizeUserIdText(selectedUserId).toLowerCase()),
    [users, selectedUserId]
  );
  const selectAdminUser = (userId) => {
    const nextId = normalizeUserIdText(userId);
    if (!nextId) return;
    setSelectedUserId(nextId);
    setSelectedCharacterId("");
    setSelectedCharacterDetail(null);
    setUserSelectOpen(false);
  };

  const selectVerifiedTypedUser = async (userId) => {
    const foundUser = await checkUserExists(userId);
    if (!foundUser) {
      setMessage("실제 가입된 아이디인지 확인되지 않아 선택하지 않았습니다.");
      return;
    }
    selectAdminUser(foundUser.id || userId);
  };

  const openUserSelect = () => {
    setUserSelectOpen(true);
    loadUsers().catch(() => {});
    if (normalizeUserIdText(userSearch)) checkUserExists(userSearch).catch(() => {});
  };

  useEffect(() => {
    if (!userSelectOpen) return undefined;
    const timer = setTimeout(() => {
      loadUsers().catch(() => {});
      if (normalizeUserIdText(userSearch)) checkUserExists(userSearch).catch(() => {});
      else setUserVerify({ id: "", status: "idle", user: null });
    }, 250);
    return () => clearTimeout(timer);
  }, [userSelectOpen, userSearch]);

  const ownerCharacters = useMemo(
    () => characters.filter((c) => normalizeUserIdText(c.ownerId).toLowerCase() === normalizeUserIdText(selectedUserId).toLowerCase()),
    [characters, selectedUserId]
  );
  const selectedCharacterLite = ownerCharacters.find((c) => String(c.id) === String(selectedCharacterId));
  const selectedCharacter = selectedCharacterDetail && String(selectedCharacterDetail.id) === String(selectedCharacterId) ? selectedCharacterDetail : null;

  useEffect(() => {
    let cancelled = false;
    if (!selectedCharacterId) {
      setSelectedCharacterDetail(null);
      return undefined;
    }
    loadCharacterDetail(selectedCharacterId).then((detail) => {
      if (cancelled) return;
      setSelectedCharacterDetail(detail);
    }).catch(() => {
      if (cancelled) return;
      setSelectedCharacterDetail(null);
    });
    return () => { cancelled = true; };
  }, [selectedCharacterId]);

  useEffect(() => {
    if (!selectedCharacter) return;
    const frame = normalizeProfileCardFrame(frameFromSource(selectedCharacter));
    setEdit({
      name: selectedCharacter.name || "",
      profile: selectedCharacter.profile || "",
      image: selectedCharacter.image || "",
      mainImage: selectedCharacter.mainImage || "",
      investigationImage: selectedCharacter.investigationImage || "",
      coins: String(selectedCharacter.coins ?? 0),
      exp: String(selectedCharacter.exp ?? 0),
      level: String(selectedCharacter.level ?? 1),
      statPoints: String(selectedCharacter.statPoints ?? 0),
      corrosion: String(selectedCharacter.corrosion ?? 0),
      atk: String(selectedCharacter.stats?.atk ?? 0),
      hp: String(selectedCharacter.stats?.hp ?? 0),
      currentHp: String(selectedCharacter.currentHp ?? (100 + Math.max(0, Number(selectedCharacter.stats?.hp || 0)) * 10)),
      def: String(selectedCharacter.stats?.def ?? 0),
      agi: String(selectedCharacter.stats?.agi ?? 0),
      items: Array.isArray(selectedCharacter.items) ? selectedCharacter.items : [],
      itemInput: "",
      skills: Array.isArray(selectedCharacter.skills) ? selectedCharacter.skills : [],
      skillInput: "",
      age: selectedCharacter.age || "",
      bodyInfo: selectedCharacter.bodyInfo || "",
      rank: selectedCharacter.rank || "대원",
      oneLine: selectedCharacter.oneLine || "",
      profileBgm: selectedCharacter.profileBgm || "",
      profileBgmVolume: Math.max(0, Math.min(1, Number(selectedCharacter.profileBgmVolume ?? 1) || 1)),
      dailyAttemptsLeft: String(selectedCharacter.dailyAttemptsLeft ?? 1),
      gambleCountLeft: String(selectedCharacter.gambleCountLeft ?? 3),
      frameX: frame.x,
      frameY: frame.y,
      frameScale: frame.scale,
    });
  }, [selectedCharacterId, selectedCharacter]);

  const readAsDataUrl = (file, key) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setForm((prev) => ({ ...prev, [key]: reader.result }));
    reader.readAsDataURL(file);
  };

  const createCharacterForUser = async () => {
    if (!selectedUserId) return setMessage("먼저 계정을 선택해주세요.");
    if (!form.charName.trim()) return setMessage("캐릭터 이름을 입력해주세요.");
    const res = await fetch(adminApi("/createCharacter"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerId: selectedUserId,
        name: form.charName.trim(),
        image: form.charImage,
        mainImage: form.charMainImage,
        investigationImage: form.charInvestigationImage,
        profile: form.charProfile,
        age: form.charAge,
        bodyInfo: form.charBodyInfo,
        rank: form.charRank,
        oneLine: form.charOneLine,
        profileBgm: form.charProfileBgm,
        profileBgmVolume: Math.max(0, Math.min(1, Number(form.charProfileBgmVolume ?? 1) || 1)),
        mainImageFrame: { x: Number(form.frameX || 50), y: Number(form.frameY || 28), scale: Number(form.frameScale || 1.12) },
      }),
    });
    const data = await res.json();
    if (!data.success) return setMessage(data.message || "캐릭터 생성 실패");
    setMessage("캐릭터 생성 완료.");
    if (data.character) window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { character: data.character } }));
    setForm({ charName: "", charProfile: "", charImage: "", charMainImage: "", charInvestigationImage: "", charAge: "", charBodyInfo: "", charRank: "대원", charOneLine: "", charProfileBgm: "", frameX: 50, frameY: 28, frameScale: 1.18 });
    loadAll();
  };

  const saveSelectedCharacter = async () => {
    if (!selectedCharacter) return setMessage("캐릭터를 선택해주세요.");
    let latestDetail = null;
    try {
      latestDetail = await loadCharacterDetail(selectedCharacter.id);
    } catch {}
    if (!latestDetail) {
      return setMessage("서버의 최신 캐릭터 데이터를 불러오지 못해서 저장을 중단했습니다. 데이터 보호를 위해 새로고침 후 다시 시도해주세요.");
    }
    const preservedProfile = String(edit.profile || "").trim()
      ? edit.profile
      : (latestDetail?.profile ?? selectedCharacter?.profile ?? "");

    const res = await fetch(adminApi("/updateCharacter"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        charId: selectedCharacter.id,
        name: edit.name,
        image: edit.image || latestDetail.image || "",
        mainImage: edit.mainImage || latestDetail.mainImage || "",
        investigationImage: edit.investigationImage || latestDetail.investigationImage || "",
        profile: preservedProfile,
        level: Number(edit.level || 1),
        statPoints: Number(edit.statPoints || 0),
        corrosion: Number(edit.corrosion || 0),
        coins: Number(edit.coins || 0),
        exp: Number(edit.exp || 0),
        stats: { atk: Number(edit.atk || 0), hp: Number(edit.hp || 0), def: Number(edit.def || 0), agi: Number(edit.agi || 0) },
        currentHp: Number(edit.currentHp || 0),
        items: Array.isArray(edit.items) ? edit.items : (Array.isArray(latestDetail.items) ? latestDetail.items : []),
        replaceItems: true,
        skills: Array.isArray(edit.skills) ? edit.skills : (Array.isArray(latestDetail.skills) ? latestDetail.skills : []),
        age: edit.age,
        bodyInfo: edit.bodyInfo,
        rank: edit.rank,
        oneLine: edit.oneLine,
        profileBgm: edit.profileBgm || latestDetail.profileBgm || "",
        profileBgmVolume: Math.max(0, Math.min(1, Number(edit.profileBgmVolume ?? 1) || 1)),
        dailyAttemptsLeft: Number(edit.dailyAttemptsLeft || 1),
        gambleCountLeft: Number(edit.gambleCountLeft || 3),
        mainImageFrame: { x: Number(edit.frameX || 50), y: Number(edit.frameY || 28), scale: Number(edit.frameScale || 1.12) },
      }),
    });
    const data = await res.json();
    if (!data.success) return setMessage(data.message || "캐릭터 수정 실패");
    const savedCharacter = normalizeSavedCharacterPayload(data.character || latestDetail || selectedCharacter);
    setSelectedCharacterDetail(savedCharacter);
    setCharacters((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.map((item) => String(item.id) === String(savedCharacter?.id) ? { ...item, ...savedCharacter } : item);
    });
    setEdit((prev) => ({
      ...prev,
      profile: savedCharacter?.profile ?? preservedProfile,
      image: savedCharacter?.image || prev.image,
      mainImage: savedCharacter?.mainImage || prev.mainImage,
      investigationImage: savedCharacter?.investigationImage || prev.investigationImage,
      frameX: Number(savedCharacter?.mainImageFrame?.x ?? prev.frameX ?? 50),
      frameY: Number(savedCharacter?.mainImageFrame?.y ?? prev.frameY ?? 28),
      frameScale: Number(savedCharacter?.mainImageFrame?.scale ?? prev.frameScale ?? 1.12),
    }));
    try {
      localStorage.removeItem("plc-cache-characters");
      sessionStorage.removeItem("plc-warm-characters");
      sessionStorage.removeItem("plc-cache-characters");
      sessionStorage.removeItem("plc-cache-characters__meta");
    } catch {}
    setMessage("캐릭터 저장 완료");
    window.dispatchEvent(new CustomEvent("plc-character-updated", { detail: { character: savedCharacter } }));
    loadAll();
  };

  const addAdminItemToSelectedCharacter = () => {
    const value = String(edit.itemInput || "").trim();
    if (!value) return setMessage("추가할 아이템 이름을 입력해주세요.");
    setEdit((prev) => ({
      ...prev,
      items: [...(Array.isArray(prev.items) ? prev.items : []), value],
      itemInput: "",
    }));
  };

  const removeAdminItemFromSelectedCharacter = (index) => {
    setEdit((prev) => ({
      ...prev,
      items: (Array.isArray(prev.items) ? prev.items : []).filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const getSkillDisplayName = (skill) => {
    if (typeof skill === "string") return skill;
    if (!skill || typeof skill !== "object") return "이름 없는 스킬";
    return skill.name || skill.label || skill.key || "이름 없는 스킬";
  };

  const addAdminSkillToSelectedCharacter = () => {
    const value = String(edit.skillInput || "").trim();
    if (!value) return setMessage("추가할 스킬 이름을 입력해주세요.");
    setEdit((prev) => ({
      ...prev,
      skills: [...(Array.isArray(prev.skills) ? prev.skills : []), { key: value, name: value }],
      skillInput: "",
    }));
  };

  const removeAdminSkillFromSelectedCharacter = (index) => {
    setEdit((prev) => ({
      ...prev,
      skills: (Array.isArray(prev.skills) ? prev.skills : []).filter((_, skillIndex) => skillIndex !== index),
    }));
  };

  const deleteSelectedCharacter = async () => {
    if (!selectedCharacter) return setMessage("캐릭터를 선택해주세요.");
    const ok = window.confirm(`${selectedCharacter.name} 캐릭터를 삭제하겠습니까?`);
    if (!ok) return;
    const res = await fetch(adminApi(`/admin/characters/${selectedCharacter.id}`), { method: "DELETE" });
    const data = await res.json();
    if (!data.success) return setMessage(data.message || "캐릭터 삭제 실패");
    setSelectedCharacterId("");
    setMessage("캐릭터 삭제 완료");
    await loadAll();
  };

  const createFrame = { x: Number(form.frameX || 50), y: Number(form.frameY || 28), scale: Number(form.frameScale || 1.12) };
  const editFrame = { x: Number(edit.frameX || 50), y: Number(edit.frameY || 28), scale: Number(edit.frameScale || 1.12) };

  return (
    <div style={{ padding: 26, color: "#16324a", background: "linear-gradient(180deg, #f7fbff, #eef7ff)", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 18 }}>
        <div>
          <div className="section-eyebrow">ADMIN CONTROL</div>
          <h2 style={{ marginTop: 10, marginBottom: 0 }}>운영 페이지</h2>
        </div>
        <button type="button" className="ghost-button" onClick={goBack}>뒤로가기</button>
      </div>

      <UserSelectModal
        open={userSelectOpen}
        users={users}
        selectedUserId={selectedUserId}
        search={userSearch}
        onSearchChange={setUserSearch}
        onSelect={selectAdminUser}
        onTypedSelect={selectVerifiedTypedUser}
        onClose={() => setUserSelectOpen(false)}
        onRefresh={() => { loadUsers().catch(() => {}); if (normalizeUserIdText(userSearch)) checkUserExists(userSearch).catch(() => {}); }}
        loading={usersLoading}
        verifyingUser={userVerify}
      />

      <div style={{ ...panelStyle, marginBottom: 18 }}>
        <div className="section-eyebrow">SITE BGM</div>
        <AudioSourceInput label="홈페이지 / 공용 BGM" value={siteBgm || ""} onChange={setSiteBgm} volume={siteBgmVolume} onVolumeChange={setSiteBgmVolume} previewScope="admin-site-preview" previewPlacement="global" helperText="프로필과 조사에 별도 BGM이 없으면 해당 음악이 재생됩니다." />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="home-primary-button" onClick={saveSiteBgm}>홈페이지 BGM 저장</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 18, marginBottom: 22 }}>
        <MenuCard title="조사 관리" onClick={goInvestigations} />
        <MenuCard title="조사 제작기" onClick={goInvestigationBuilder} />
        <MenuCard title="상점 관리" onClick={goShopManager} />
        <MenuCard title="관계 승인" onClick={goRelations} />
        <MenuCard title="디자인 관리" onClick={goDesignEditor} />
        <MenuCard title="맵 관리" onClick={goMapManager} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div style={panelStyle}>
          <div className="section-eyebrow">CHARACTER CREATE</div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 800 }}>계정 선택</div>
            <button
              type="button"
              onClick={openUserSelect}
              style={{
                ...inputStyle,
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span>{selectedUserId ? `${selectedUserId}${selectedUser?.type ? ` (${selectedUser.type})` : ""}` : "계정을 선택해주세요"}</span>
              <b style={{ color: "#3d9adc" }}>계정 선택</b>
            </button>
            <div style={{ fontSize: 12, color: "#5d7a95" }}>가입된 계정 {users.length}개가 운영 계정 선택창에 표시됩니다.</div>
          </div>
          <label>캐릭터 이름<input value={form.charName} onChange={(e) => setForm({ ...form, charName: e.target.value })} style={inputStyle} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>나이<input value={form.charAge} onChange={(e) => setForm({ ...form, charAge: e.target.value })} style={inputStyle} /></label>
            <label>계급<select value={form.charRank} onChange={(e) => setForm({ ...form, charRank: e.target.value })} style={inputStyle}><option>분대장</option><option>선임대원</option><option>대원</option></select></label>
          </div>
          <label>키 / 몸무게<input value={form.charBodyInfo} onChange={(e) => setForm({ ...form, charBodyInfo: e.target.value })} style={inputStyle} /></label>
          <label>한마디<input value={form.charOneLine} onChange={(e) => setForm({ ...form, charOneLine: e.target.value })} style={inputStyle} /></label>
          <ImageDropInput label="프로필 이미지" value={form.charImage} onChange={(value) => setForm((prev) => ({ ...prev, charImage: value }))} previewHeight={150} compact />
          <ImageDropInput label="전신 이미지" value={form.charMainImage} onChange={(value) => setForm((prev) => ({ ...prev, charMainImage: value }))} previewHeight={180} previewFit="contain" compact />
          <ImageDropInput label="SD 이미지" value={form.charInvestigationImage} onChange={(value) => setForm((prev) => ({ ...prev, charInvestigationImage: value }))} previewHeight={160} previewFit="contain" compact />
          <AudioSourceInput label="프로필 BGM" value={form.charProfileBgm || ""} onChange={(value) => setForm((prev) => ({ ...prev, charProfileBgm: value }))} volume={form.charProfileBgmVolume ?? 1} onVolumeChange={(value) => setForm((prev) => ({ ...prev, charProfileBgmVolume: value }))} previewScope="admin-create-profile-preview" previewPlacement="profile" helperText="캐릭터 프로필 화면 재생 음악" />
          <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 800, color: "#16324a" }}>프로필</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(createProfileTextareaRef.current, form.charProfile, (next) => setForm({ ...form, charProfile: next }), "[b]", "[/b]")}>선택 굵게</button>
                <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(createProfileTextareaRef.current, form.charProfile, (next) => setForm({ ...form, charProfile: next }), "[i]", "[/i]")}>선택 기울기</button>
                <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(createProfileTextareaRef.current, form.charProfile, (next) => setForm({ ...form, charProfile: next }), "[size=24]", "[/size]")}>선택 크게</button>
                <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(createProfileTextareaRef.current, form.charProfile, (next) => setForm({ ...form, charProfile: next }), "[center]", "[/center]")}>가운데 정렬</button>
                <select defaultValue="" onChange={(e) => { applyTextareaFontSelection(createProfileTextareaRef.current, form.charProfile, (next) => setForm({ ...form, charProfile: next }), e.target.value); e.target.value = ""; }} style={{ ...inputStyle, width: 170, padding: "10px 12px" }}>
                  <option value="">선택 글씨체</option>
                  {PROFILE_FONT_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
                </select>
              </div>
            </div>
            <textarea ref={createProfileTextareaRef} value={form.charProfile} onChange={(e) => setForm({ ...form, charProfile: e.target.value })} style={{ ...inputStyle, minHeight: 120 }} />
            <div style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(240,248,255,0.92)", border: "1px solid rgba(98,176,220,0.16)", lineHeight: 1.85 }}>
              {renderProfileRichParagraph(form.charProfile || "미리보기")}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
            <div style={{ fontWeight: 800 }}>카드 전신 이미지 표시 위치</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <label>좌우<input type="range" min="-1200" max="1200" step="1" value={form.frameX} onChange={(e) => setForm({ ...form, frameX: Number(e.target.value) })} style={{ width: "100%" }} /><div style={{ fontSize: 12, color: "#5d7a95" }}>{Number(form.frameX).toFixed(0)}</div></label>
              <label>상하<input type="range" min="-1200" max="1200" step="1" value={form.frameY} onChange={(e) => setForm({ ...form, frameY: Number(e.target.value) })} style={{ width: "100%" }} /><div style={{ fontSize: 12, color: "#5d7a95" }}>{Number(form.frameY).toFixed(0)}</div></label>
              <label>확대<input type="range" min="0.4" max="11.5" step="0.01" value={form.frameScale} onChange={(e) => setForm({ ...form, frameScale: Number(e.target.value) })} style={{ width: "100%" }} /><div style={{ fontSize: 12, color: "#5d7a95" }}>{Number(form.frameScale).toFixed(2)}</div></label>
            </div>
            <PreviewCharacterCard name={form.charName} rank={form.charRank} image={form.charMainImage || ""} oneLine={form.charOneLine} frame={createFrame} onFrameChange={(next) => setForm((prev) => ({ ...prev, frameX: next.x, frameY: next.y, frameScale: next.scale }))} />
          </div>

          <button type="button" className="home-primary-button" onClick={createCharacterForUser}>캐릭터 생성</button>
        </div>

        <div style={panelStyle}>
          <div className="section-eyebrow">CHARACTER EDIT</div>
          <label>캐릭터 선택<select value={selectedCharacterId} onChange={(e) => setSelectedCharacterId(e.target.value)} style={inputStyle}><option value="">선택</option>{ownerCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>

          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ padding: 14, borderRadius: 18, background: "rgba(244,250,255,0.9)", display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>기본 프로필 수정</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                <label>이름<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} style={inputStyle} /></label>
                <label>계급<select value={edit.rank} onChange={(e) => setEdit({ ...edit, rank: e.target.value })} style={inputStyle}><option>분대장</option><option>선임대원</option><option>대원</option></select></label>
                <label>나이<input value={edit.age} onChange={(e) => setEdit({ ...edit, age: e.target.value })} style={inputStyle} /></label>
                <label>키 / 몸무게<input value={edit.bodyInfo} onChange={(e) => setEdit({ ...edit, bodyInfo: e.target.value })} style={inputStyle} /></label>
                <label style={{ gridColumn: "1 / -1" }}>한마디<input value={edit.oneLine} onChange={(e) => setEdit({ ...edit, oneLine: e.target.value })} style={inputStyle} /></label>
                <div style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, color: "#16324a" }}>프로필</span>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(editProfileTextareaRef.current, edit.profile, (next) => setEdit({ ...edit, profile: next }), "[b]", "[/b]")}>선택 굵게</button>
                      <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(editProfileTextareaRef.current, edit.profile, (next) => setEdit({ ...edit, profile: next }), "[i]", "[/i]")}>선택 기울기</button>
                      <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(editProfileTextareaRef.current, edit.profile, (next) => setEdit({ ...edit, profile: next }), "[size=24]", "[/size]")}>선택 크게</button>
                      <button type="button" className="ghost-button" onClick={() => wrapTextareaSelection(editProfileTextareaRef.current, edit.profile, (next) => setEdit({ ...edit, profile: next }), "[center]", "[/center]")}>가운데 정렬</button>
                      <select defaultValue="" onChange={(e) => { applyTextareaFontSelection(editProfileTextareaRef.current, edit.profile, (next) => setEdit({ ...edit, profile: next }), e.target.value); e.target.value = ""; }} style={{ ...inputStyle, width: 170, padding: "10px 12px" }}>
                        <option value="">선택 글씨체</option>
                        {PROFILE_FONT_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <textarea ref={editProfileTextareaRef} value={edit.profile} onChange={(e) => setEdit({ ...edit, profile: e.target.value })} style={{ ...inputStyle, minHeight: 120 }} />
                  <div style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(240,248,255,0.92)", border: "1px solid rgba(98,176,220,0.16)", lineHeight: 1.85 }}>
                    {renderProfileRichParagraph(edit.profile || "미리보기")}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ padding: 14, borderRadius: 18, background: "rgba(244,250,255,0.9)", display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>이미지 수정</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <ImageDropInput label="프로필 이미지" value={edit.image} onChange={(value) => setEdit((prev) => ({ ...prev, image: value }))} previewHeight={140} compact />
                <ImageDropInput label="SD 이미지" value={edit.investigationImage} onChange={(value) => setEdit((prev) => ({ ...prev, investigationImage: value }))} previewHeight={140} previewFit="contain" compact />
                <div style={{ gridColumn: "1 / -1", display: "grid", gap: 12 }}>
                  <ImageDropInput label="전신 이미지" value={edit.mainImage} onChange={(value) => setEdit((prev) => ({ ...prev, mainImage: value }))} previewHeight={180} previewFit="contain" compact />
                  <AudioSourceInput label="프로필 BGM" value={edit.profileBgm || ""} onChange={(value) => setEdit((prev) => ({ ...prev, profileBgm: value }))} volume={edit.profileBgmVolume ?? 1} onVolumeChange={(value) => setEdit((prev) => ({ ...prev, profileBgmVolume: value }))} previewScope="admin-edit-profile-preview" previewPlacement="profile" helperText="캐릭터 프로필 화면 재생 음악" />
                </div>
              </div>
            </div>

            <div style={{ padding: 14, borderRadius: 18, background: "rgba(244,250,255,0.9)", display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>수치 수정</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                <label>레벨<input value={edit.level} onChange={(e) => setEdit({ ...edit, level: e.target.value })} style={inputStyle} /></label>
                <label>코인<input value={edit.coins} onChange={(e) => setEdit({ ...edit, coins: e.target.value })} style={inputStyle} /></label>
                <label>경험치<input value={edit.exp} onChange={(e) => setEdit({ ...edit, exp: e.target.value })} style={inputStyle} /></label>
                <label>침식률<input value={edit.corrosion} onChange={(e) => setEdit({ ...edit, corrosion: e.target.value })} style={inputStyle} /></label>
                <label>스탯 포인트<input value={edit.statPoints} onChange={(e) => setEdit({ ...edit, statPoints: e.target.value })} style={inputStyle} /></label>
                <label>일일조사 횟수<input value={edit.dailyAttemptsLeft} onChange={(e) => setEdit({ ...edit, dailyAttemptsLeft: e.target.value })} style={inputStyle} /></label>
                <label>도박 횟수<input value={edit.gambleCountLeft} onChange={(e) => setEdit({ ...edit, gambleCountLeft: e.target.value })} style={inputStyle} /></label>
                <label>ATK<input value={edit.atk} onChange={(e) => setEdit({ ...edit, atk: e.target.value })} style={inputStyle} /></label>
                <label>HP 스탯<input value={edit.hp} onChange={(e) => setEdit({ ...edit, hp: e.target.value })} style={inputStyle} /></label>
                <label>현재 HP<input value={edit.currentHp} onChange={(e) => setEdit({ ...edit, currentHp: e.target.value })} style={inputStyle} /></label>
                <label>DEF<input value={edit.def} onChange={(e) => setEdit({ ...edit, def: e.target.value })} style={inputStyle} /></label>
                <label>DEX<input value={edit.agi} onChange={(e) => setEdit({ ...edit, agi: e.target.value })} style={inputStyle} /></label>
              </div>
            </div>

            <div style={{ padding: 14, borderRadius: 18, background: "rgba(244,250,255,0.9)", display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>보유 아이템 수정</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  value={edit.itemInput || ""}
                  onChange={(e) => setEdit({ ...edit, itemInput: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAdminItemToSelectedCharacter(); } }}
                  placeholder="추가할 아이템 이름"
                  style={{ ...inputStyle, flex: "1 1 220px" }}
                />
                <button type="button" className="home-primary-button" onClick={addAdminItemToSelectedCharacter}>아이템 추가</button>
              </div>
              <div style={{ display: "grid", gap: 8, maxHeight: 180, overflowY: "auto", paddingRight: 4 }}>
                {(Array.isArray(edit.items) && edit.items.length > 0) ? edit.items.map((item, index) => (
                  <div key={`${item}-${index}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 12, background: "rgba(255,255,255,0.86)", border: "1px solid rgba(98,176,220,0.16)" }}>
                    <span style={{ fontWeight: 800, color: "#16324a" }}>{typeof item === "string" ? item : (item?.name || item?.key || "이름 없는 아이템")}</span>
                    <button type="button" className="ghost-button" onClick={() => removeAdminItemFromSelectedCharacter(index)}>삭제</button>
                  </div>
                )) : (
                  <div style={{ padding: "11px 12px", borderRadius: 12, background: "rgba(255,255,255,0.72)", color: "#5d7a95", fontWeight: 700 }}>보유 아이템이 없습니다.</div>
                )}
              </div>
              <div style={{ fontSize: 12, color: "#5d7a95", lineHeight: 1.6 }}>아이템을 추가하거나 삭제한 뒤 아래 저장 버튼을 눌러야 반영됩니다.</div>
            </div>

            <div style={{ padding: 14, borderRadius: 18, background: "rgba(244,250,255,0.9)", display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>보유 스킬 수정</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  value={edit.skillInput || ""}
                  onChange={(e) => setEdit({ ...edit, skillInput: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAdminSkillToSelectedCharacter(); } }}
                  placeholder="추가할 스킬 이름"
                  style={{ ...inputStyle, flex: "1 1 220px" }}
                />
                <button type="button" className="home-primary-button" onClick={addAdminSkillToSelectedCharacter}>스킬 추가</button>
              </div>
              <div style={{ display: "grid", gap: 8, maxHeight: 180, overflowY: "auto", paddingRight: 4 }}>
                {(Array.isArray(edit.skills) && edit.skills.length > 0) ? edit.skills.map((skill, index) => (
                  <div key={`${getSkillDisplayName(skill)}-${index}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 12, background: "rgba(255,255,255,0.86)", border: "1px solid rgba(98,176,220,0.16)" }}>
                    <span style={{ fontWeight: 800, color: "#16324a" }}>{getSkillDisplayName(skill)}</span>
                    <button type="button" className="ghost-button" onClick={() => removeAdminSkillFromSelectedCharacter(index)}>삭제</button>
                  </div>
                )) : (
                  <div style={{ padding: "11px 12px", borderRadius: 12, background: "rgba(255,255,255,0.72)", color: "#5d7a95", fontWeight: 700 }}>보유 스킬이 없습니다.</div>
                )}
              </div>
              <div style={{ fontSize: 12, color: "#5d7a95", lineHeight: 1.6 }}>스킬을 추가하거나 삭제한 뒤 아래 저장 버튼을 눌러야 반영됩니다.</div>
            </div>
          </div>

          {selectedCharacter ? (
            <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
              <div style={{ fontWeight: 800 }}>카드 전신 이미지 표시 위치</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <label>좌우<input type="range" min="-1200" max="1200" step="1" value={edit.frameX} onChange={(e) => setEdit({ ...edit, frameX: Number(e.target.value) })} style={{ width: "100%" }} /><div style={{ fontSize: 12, color: "#5d7a95" }}>{Number(edit.frameX).toFixed(0)}</div></label>
                <label>상하<input type="range" min="-1200" max="1200" step="1" value={edit.frameY} onChange={(e) => setEdit({ ...edit, frameY: Number(e.target.value) })} style={{ width: "100%" }} /><div style={{ fontSize: 12, color: "#5d7a95" }}>{Number(edit.frameY).toFixed(0)}</div></label>
                <label>확대<input type="range" min="0.4" max="11.5" step="0.01" value={edit.frameScale} onChange={(e) => setEdit({ ...edit, frameScale: Number(e.target.value) })} style={{ width: "100%" }} /><div style={{ fontSize: 12, color: "#5d7a95" }}>{Number(edit.frameScale).toFixed(2)}</div></label>
              </div>
              <PreviewCharacterCard name={edit.name || selectedCharacter?.name || selectedCharacterLite?.name} rank={edit.rank || selectedCharacter?.rank || selectedCharacterLite?.rank} image={edit.mainImage || selectedCharacter?.mainImage || selectedCharacter?.cardImage || selectedCharacterLite?.mainImage || selectedCharacterLite?.cardImage || selectedCharacterLite?.image || ""} oneLine={edit.oneLine || selectedCharacter?.oneLine || selectedCharacterLite?.oneLine} frame={editFrame} onFrameChange={(next) => setEdit((prev) => ({ ...prev, frameX: next.x, frameY: next.y, frameScale: next.scale }))} />
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="home-primary-button" onClick={saveSelectedCharacter}>저장</button>
            <button type="button" className="ghost-button" onClick={deleteSelectedCharacter} disabled={!selectedCharacter}>캐릭터 삭제</button>
          </div>
        </div>
      </div>
      {message ? <div style={{ position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 9999, padding: "12px 18px", borderRadius: 999, background: "rgba(15,23,42,0.92)", color: "white", boxShadow: "0 12px 30px rgba(0,0,0,0.28)" }}>{message}</div> : null}
    </div>
  );
}
