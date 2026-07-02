// nostrChat.ts
// Client-only helpers for the site-wide "message the team" chat (NostrChat.astro).
//
// Sending reuses the gift-wrap construction from nostrOrder.ts (NIP-17 kind-14
// rumor → kind-13 seal → kind-1059 wrap). This module adds the READ side:
//   • fetch kind-1059 wraps `#p`-tagged to the signed-in user from the relays,
//   • decrypt wrap → seal → rumor (extension `window.nostr.nip44.decrypt`, or
//     locally via the nsec's conversation key),
//   • keep only kind-14 chat rumors exchanged with the project pubkey.
//
// It also publishes a SELF-ADDRESSED copy of every message the user sends
// (standard NIP-17 practice): the same rumor sealed and wrapped to the sender's
// own pubkey. That's what makes the user's side of the conversation appear in
// the `#p`=user query, so the thread survives reloads and other devices.
//
// Import this ONLY from client <script> blocks (it touches window.nostr /
// localStorage via nostrAuth at call time).

import { getSession, signEvent, nip44Encrypt, publish, type NostrSession } from './nostrAuth';
import { RELAYS, npubToHex, type NostrEvent } from './market';

// The Lightning Piggy project team's npub — the same identity as the
// "Danish Bacon" team shop in src/data/vendors.json. Chat messages sent from
// the envelope panel are gift-wrapped DMs to this key. Tests can override the
// recipient per-panel via the component's `data-recipient` attribute.
export const PROJECT_NPUB = 'npub15v9wrmt8dmfzzt9d5vk4fyww63nzsv0m50vcuw3wzct9728r0vnqdjts9p';

// NIP-59 randomises wrap timestamps up to 2 days into the past, so any `since`
// filter must reach back that far beyond the newest message actually seen.
export const WRAP_TS_SLACK = 172800;

export interface ChatMessage {
  // Rumor id. The recipient and self copies wrap a rumor with identical fields,
  // so getEventHash yields the SAME id for both — which is what lets
  // wrapsToThread dedupe the copies (and relay duplicates) into one message.
  id: string;
  wrapId: string; // kind-1059 wrap this rumor arrived in ('' = local echo, not yet fetched back)
  from: string; // rumor author (hex)
  text: string;
  ts: number; // rumor created_at (real send time)
  mine: boolean;
}

// Resolve a recipient given either an npub or a 64-char hex pubkey.
export function toHexPubkey(v: string): string {
  const s = (v || '').trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  return npubToHex(s);
}

// ---- Decryption (method-aware, mirrors nostrAuth.nip44Encrypt) ----
async function nip44Decrypt(session: NostrSession, peerPubkey: string, ciphertext: string): Promise<string> {
  if (session.method === 'extension') {
    const nostr = (window as any).nostr;
    if (!nostr || !nostr.nip44 || typeof nostr.nip44.decrypt !== 'function') throw new Error('no-nip44');
    return nostr.nip44.decrypt(peerPubkey, ciphertext);
  }
  const nip44 = await import('nostr-tools/nip44');
  const sk = hexToBytes(session.sk!);
  return nip44.decrypt(ciphertext, nip44.getConversationKey(sk, peerPubkey));
}

function hexToBytes(hex: string): Uint8Array {
  const a = new Uint8Array(hex.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return a;
}

// Unwrap one kind-1059 gift wrap addressed to the signed-in user:
// wrap.content (encrypted ephemeral→me) → seal (kind 13, signed by the real
// sender) → rumor (unsigned kind 14). Returns null for anything that fails to
// decrypt or isn't a chat rumor — relay-supplied data is never trusted.
export async function unwrapDM(wrap: NostrEvent, session: NostrSession): Promise<NostrEvent | null> {
  try {
    const sealJson = await nip44Decrypt(session, wrap.pubkey, wrap.content);
    const seal = JSON.parse(sealJson);
    if (!seal || seal.kind !== 13 || typeof seal.content !== 'string' || typeof seal.pubkey !== 'string') return null;
    const rumorJson = await nip44Decrypt(session, seal.pubkey, seal.content);
    const rumor = JSON.parse(rumorJson);
    // The seal signer must match the rumor author, or a sender could impersonate.
    if (!rumor || rumor.pubkey !== seal.pubkey) return null;
    if (typeof rumor.content !== 'string' || !Array.isArray(rumor.tags)) return null;
    return rumor as NostrEvent;
  } catch {
    return null;
  }
}

// ---- Relay fetch (browser WebSocket, CONNECTING-safe cleanup) ----
function fetchFromRelay(url: string, filter: any): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const evs: NostrEvent[] = [];
    let ws: WebSocket | undefined;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      try {
        // Abort immediately whatever state the socket is in — close() on a
        // CONNECTING socket cancels the attempt, so a relay that never finishes
        // connecting can't dangle for the rest of the session.
        if (ws) {
          ws.onopen = () => {
            try {
              ws!.close();
            } catch {}
          };
          ws.onmessage = null;
          ws.close();
        }
      } catch {}
      resolve(evs);
    };
    const t = window.setTimeout(finish, 6000);
    try {
      ws = new WebSocket(url);
    } catch {
      finish();
      return;
    }
    const sub = Math.random().toString(36).slice(2, 10);
    ws.onopen = () => ws!.send(JSON.stringify(['REQ', sub, filter]));
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m[0] === 'EVENT' && m[1] === sub) evs.push(m[2]);
        if (m[0] === 'EOSE' && m[1] === sub) finish();
      } catch {}
    };
    ws.onerror = () => finish();
  });
}

// Fetch gift wraps addressed to `pubkey`, de-duplicated across relays.
export async function fetchWraps(pubkey: string, since: number): Promise<NostrEvent[]> {
  const filter = { kinds: [1059], '#p': [pubkey], since, limit: 500 };
  const all = (await Promise.all(RELAYS.map((r) => fetchFromRelay(r, filter)))).flat();
  const seen = new Set<string>();
  return all.filter((e) => {
    if (!e || typeof e.id !== 'string' || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

// Turn wraps into the chat thread with `peerHex`, decrypting each wrap at most
// once per session (`cache`, keyed by wrap id — misses store null so failures
// aren't retried, which matters for extension users who confirm each decrypt).
export async function wrapsToThread(
  wraps: NostrEvent[],
  session: NostrSession,
  peerHex: string,
  cache: Map<string, NostrEvent | null>,
): Promise<ChatMessage[]> {
  const out: ChatMessage[] = [];
  for (const wrap of wraps) {
    let rumor = cache.get(wrap.id);
    if (rumor === undefined) {
      rumor = await unwrapDM(wrap, session);
      cache.set(wrap.id, rumor);
    }
    if (!rumor || rumor.kind !== 14) continue;
    const mine = rumor.pubkey === session.pubkey;
    // Relay-supplied rumor: individual tag entries may be anything, so guard
    // the shape before indexing.
    const taggedPeer = (rumor.tags || []).some((t) => Array.isArray(t) && t[0] === 'p' && t[1] === peerHex);
    // Keep only this conversation: messages I sent to the peer (self copy) or
    // messages the peer sent to me.
    if (!(mine ? taggedPeer : rumor.pubkey === peerHex)) continue;
    out.push({
      id: rumor.id || wrap.id,
      wrapId: wrap.id,
      from: rumor.pubkey,
      text: String(rumor.content || ''),
      ts: Number(rumor.created_at) || 0,
      mine,
    });
  }
  // Dedupe identical rumors seen via multiple wraps, oldest first (newest at bottom).
  const byId = new Map<string, ChatMessage>();
  for (const m of out) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

// Publish a self-addressed copy of a just-sent message (rumor kind 14 to
// `recipientHex`), sealed and wrapped to the SENDER's own key, so the sent
// side of the thread is fetchable later. Signed-in sessions only.
export async function sendSelfCopy(recipientHex: string, message: string): Promise<void> {
  const session = getSession();
  if (!session) return;
  const [pure, nip44] = await Promise.all([import('nostr-tools/pure'), import('nostr-tools/nip44')]);
  const { generateSecretKey, finalizeEvent, getEventHash } = pure;

  const now = Math.floor(Date.now() / 1000);
  const past = () => now - Math.floor(Math.random() * WRAP_TS_SLACK);

  const rumor: any = {
    kind: 14,
    pubkey: session.pubkey,
    created_at: now,
    tags: [['p', recipientHex]],
    content: message,
  };
  rumor.id = getEventHash(rumor);

  // Seal: signed by me, encrypted me→me (NIP-44 self conversation key).
  const seal = await signEvent({
    kind: 13,
    pubkey: session.pubkey,
    created_at: past(),
    tags: [],
    content: await nip44Encrypt(session.pubkey, JSON.stringify(rumor)),
  });

  // Wrap: fresh ephemeral key → me.
  const ephSk = generateSecretKey();
  const wrap = finalizeEvent(
    {
      kind: 1059,
      created_at: past(),
      tags: [['p', session.pubkey]],
      content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(ephSk, session.pubkey)),
    },
    ephSk,
  );
  await publish(wrap);
}
