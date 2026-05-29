const DAILY_INVESTIGATION_ATTEMPTS_PER_DAY = 1;
const DAILY_GAMBLE_COUNT_PER_DAY = 3;

function getSeoulDateKey(date = new Date()) {
  const base = date instanceof Date ? date : new Date(date);
  const shifted = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function normalizeDailyUseLimits(character) {
  if (!character || typeof character !== "object") return character;
  const todayKey = getSeoulDateKey();
  const next = { ...character };

  if (String(next.dailyAttemptsResetDate || "") !== todayKey) {
    next.dailyAttemptsLeft = DAILY_INVESTIGATION_ATTEMPTS_PER_DAY;
    next.dailyAttemptsResetDate = todayKey;
  } else if (!Number.isFinite(Number(next.dailyAttemptsLeft))) {
    next.dailyAttemptsLeft = DAILY_INVESTIGATION_ATTEMPTS_PER_DAY;
  }

  if (String(next.gambleCountResetDate || "") !== todayKey) {
    next.gambleCountLeft = DAILY_GAMBLE_COUNT_PER_DAY;
    next.gambleCountResetDate = todayKey;
  } else if (!Number.isFinite(Number(next.gambleCountLeft))) {
    next.gambleCountLeft = DAILY_GAMBLE_COUNT_PER_DAY;
  }

  return next;
}

export function toLightCharacter(character) {
  if (!character) return null;
  const normalizedCharacter = normalizeDailyUseLimits(character);

  return {
    id: normalizedCharacter.id,
    ownerId: normalizedCharacter.ownerId,
    name: normalizedCharacter.name,
    approved: normalizedCharacter.approved,
    level: normalizedCharacter.level || 1,
    statPoints: normalizedCharacter.statPoints || 0,
    corrosion: normalizedCharacter.corrosion || 0,
    syncRate: Math.max(0, Math.min(100, Number(normalizedCharacter.syncRate ?? normalizedCharacter.synchronizationRate ?? 0))),
    coins: normalizedCharacter.coins || 0,
    exp: normalizedCharacter.exp || 0,
    stats: normalizedCharacter.stats || { atk: 0, hp: 0, def: 0, agi: 0 },
    currentHp: normalizedCharacter.currentHp,
    skills: Array.isArray(normalizedCharacter.skills) ? normalizedCharacter.skills : [],
    items: Array.isArray(normalizedCharacter.items) ? normalizedCharacter.items : [],
    image: normalizedCharacter.image || "",
    profileImage: normalizedCharacter.profileImage || normalizedCharacter.image || "",
    mainImage: normalizedCharacter.mainImage || "",
    cardImage: normalizedCharacter.cardImage || normalizedCharacter.mainImage || normalizedCharacter.profileImage || normalizedCharacter.image || "",
    investigationImage: normalizedCharacter.investigationImage || "",
    spriteImage: normalizedCharacter.spriteImage || normalizedCharacter.investigationImage || normalizedCharacter.mainImage || normalizedCharacter.profileImage || normalizedCharacter.image || "",
    age: normalizedCharacter.age || "",
    bodyInfo: normalizedCharacter.bodyInfo || "",
    rank: normalizedCharacter.rank || "대원",
    oneLine: normalizedCharacter.oneLine || "",
    mainImageFrame: normalizedCharacter.mainImageFrame || undefined,
    sdQuotes: Array.isArray(normalizedCharacter.sdQuotes) ? normalizedCharacter.sdQuotes : [],
    dailyAttemptsLeft: normalizedCharacter.dailyAttemptsLeft ?? DAILY_INVESTIGATION_ATTEMPTS_PER_DAY,
    dailyAttemptsResetDate: normalizedCharacter.dailyAttemptsResetDate || getSeoulDateKey(),
    gambleCountLeft: normalizedCharacter.gambleCountLeft ?? DAILY_GAMBLE_COUNT_PER_DAY,
    gambleCountResetDate: normalizedCharacter.gambleCountResetDate || getSeoulDateKey(),
    currentMap: normalizedCharacter.currentMap || "sector-01",
    x: typeof normalizedCharacter.x === "number" ? normalizedCharacter.x : undefined,
    y: typeof normalizedCharacter.y === "number" ? normalizedCharacter.y : undefined,
    updatedAt: normalizedCharacter.updatedAt || normalizedCharacter.assetVersion || 0,
    assetVersion: normalizedCharacter.assetVersion || normalizedCharacter.updatedAt || 0,
  };
}

export function saveActiveCharacter(character) {
  try {
    const light = toLightCharacter(character);
    if (light) {
      sessionStorage.setItem("plc-active-character", JSON.stringify(light));
      localStorage.setItem("character", JSON.stringify(light));
    }
    return light;
  } catch (e) {
    console.warn("storage error", e);
    return null;
  }
}

export function clearActiveCharacterStorage() {
  try {
    sessionStorage.removeItem("plc-active-character");
    localStorage.removeItem("character");
  } catch {}
}

export function readActiveCharacter() {
  try {
    const raw =
      sessionStorage.getItem("plc-active-character") ||
      localStorage.getItem("character");
    return raw ? normalizeDailyUseLimits(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
