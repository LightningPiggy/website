// Shape checks for Nostr events that come from relays.
//
// A relay can send anything in an EVENT message, so every field the site uses
// is checked before use:
// - the id and pubkey must be 64-character hex, because they end up in links
//   and HTML attributes;
// - the content must be a string, and the tags arrays of strings, because
//   page code calls string methods on them;
// - created_at must not be more than 3 hours in the future, because a
//   future-dated event would beat the genuine one wherever the newest wins.
//   The margin allows for visitors whose clocks are off (relays themselves
//   refuse events more than about 15 minutes ahead).
//
// This doesn't prove who wrote an event. That needs a signature check, which
// is a separate step.

export interface RelayEvent {
  id: string;
  pubkey: string;
  sig: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const MAX_FUTURE_SECONDS = 3 * 60 * 60;

export function isHexKey(s: unknown): s is string {
  return typeof s === 'string' && HEX64.test(s);
}

export function isWellFormedEvent(ev: unknown, now = Math.floor(Date.now() / 1000)): ev is RelayEvent {
  if (!ev || typeof ev !== 'object') return false;
  const e = ev as Record<string, unknown>;
  return (
    isHexKey(e.id) &&
    isHexKey(e.pubkey) &&
    typeof e.sig === 'string' &&
    HEX128.test(e.sig) &&
    Number.isInteger(e.kind) &&
    (e.kind as number) >= 0 &&
    (e.kind as number) <= 65535 &&
    Number.isInteger(e.created_at) &&
    (e.created_at as number) >= 0 &&
    (e.created_at as number) <= now + MAX_FUTURE_SECONDS &&
    typeof e.content === 'string' &&
    Array.isArray(e.tags) &&
    e.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))
  );
}
