export function toLightCharacter(character) {
  if (!character) return null;

  return {
    id: character.id,
    ownerId: character.ownerId,
    name: character.name,
    approved: character.approved,
    level: character.level || 1,
    statPoints: character.statPoints || 0,
    corrosion: character.corrosion || 0,
    coins: character.coins || 0,
    exp: character.exp || 0,
    stats: character.stats || { atk: 0, hp: 0, def: 0, agi: 0 },
    currentHp: character.currentHp,
    skills: Array.isArray(character.skills) ? character.skills : [],
    items: Array.isArray(character.items) ? character.items : [],
    image: character.image || "",
    profileImage: character.profileImage || character.image || "",
    mainImage: character.mainImage || "",
    cardImage: character.cardImage || character.mainImage || character.profileImage || character.image || "",
    investigationImage: character.investigationImage || "",
    spriteImage: character.spriteImage || character.investigationImage || character.mainImage || character.profileImage || character.image || "",
    age: character.age || "",
    bodyInfo: character.bodyInfo || "",
    rank: character.rank || "대원",
    oneLine: character.oneLine || "",
    mainImageFrame: character.mainImageFrame || undefined,
    sdQuotes: Array.isArray(character.sdQuotes) ? character.sdQuotes : [],
    dailyAttemptsLeft: character.dailyAttemptsLeft ?? 1,
    gambleCountLeft: character.gambleCountLeft ?? 3,
    currentMap: character.currentMap || "sector-01",
    x: typeof character.x === "number" ? character.x : undefined,
    y: typeof character.y === "number" ? character.y : undefined,
    updatedAt: character.updatedAt || character.assetVersion || 0,
    assetVersion: character.assetVersion || character.updatedAt || 0,
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
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
