/** A stable individual order for otherwise equivalent choices; no world knowledge or random actions. */
export function personalChoiceOrder(actorId: string, siteId: string) {
  let hash = 2166136261;
  for (const char of `${actorId}>${siteId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13; hash = Math.imul(hash, 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}
