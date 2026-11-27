const VRC_USER_ID = /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_PLAYER_ID = /^local_[a-f0-9]{16}$/;

export function normalizePlayerId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  if (VRC_USER_ID.test(id)) return id.toLowerCase();
  if (LOCAL_PLAYER_ID.test(id)) return id.toLowerCase();
  return '';
}

export function normalizePlayerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    const id = normalizePlayerId(item);
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length >= 32) break;
  }
  return ids;
}

export function isVrchatUserId(value: unknown): boolean {
  return typeof value === 'string' && VRC_USER_ID.test(value.trim());
}

export function playerInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}
