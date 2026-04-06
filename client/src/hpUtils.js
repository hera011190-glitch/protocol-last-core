export function getHpStatValue(rawHp) {
  const value = Number(rawHp || 0);
  if (value >= 100) return Math.max(0, Math.round((value - 100) / 10));
  return Math.max(0, value);
}

export function getMaxHpFromStat(rawHp) {
  const value = Number(rawHp || 0);
  if (value >= 100) return Math.max(100, value);
  return 100 + Math.max(0, value) * 10;
}

export function getCurrentHpDisplay(rawHp, fallbackCurrentHp) {
  const current = Number(fallbackCurrentHp);
  if (Number.isFinite(current) && current > 0) return current;
  return getMaxHpFromStat(rawHp);
}
