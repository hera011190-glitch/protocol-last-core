export const HP_STAT_MAX = 40;
export const COMBAT_STAT_MAX = 25;
export const BASE_HP = 100;
export const HP_PER_STAT = 10;
export const HP_MAX = 500;
export const BASE_COMBAT_STAT = 10;
export const COMBAT_STAT_PER_POINT = 4;
export const COMBAT_TOTAL_MAX = 110;

export function clampNumber(value, min, max) {
  const next = Number(value || 0);
  if (!Number.isFinite(next)) return min;
  return Math.max(min, Math.min(max, next));
}

export function getHpStatValue(rawHp) {
  const value = Number(rawHp || 0);
  if (value >= BASE_HP) return clampNumber(Math.round((value - BASE_HP) / HP_PER_STAT), 0, HP_STAT_MAX);
  return clampNumber(value, 0, HP_STAT_MAX);
}

export function getMaxHpFromStat(rawHp) {
  const hpStat = getHpStatValue(rawHp);
  return Math.min(HP_MAX, BASE_HP + hpStat * HP_PER_STAT);
}

export function getCombatStatPoint(rawValue) {
  return clampNumber(rawValue, 0, COMBAT_STAT_MAX);
}

export function getCombatStatTotal(rawValue) {
  return Math.min(COMBAT_TOTAL_MAX, BASE_COMBAT_STAT + getCombatStatPoint(rawValue) * COMBAT_STAT_PER_POINT);
}

export function getCurrentHpDisplay(rawHp, fallbackCurrentHp) {
  const current = Number(fallbackCurrentHp);
  if (Number.isFinite(current) && current >= 0) return Math.min(getMaxHpFromStat(rawHp), Math.max(0, current));
  return getMaxHpFromStat(rawHp);
}
