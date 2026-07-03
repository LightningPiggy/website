// nostrAuth.ts
// Browser-only Nostr session helper. Supports two login methods (mirroring the
// robotechy login dialog's core options):
//   • 'extension' — NIP-07 signer (Alby, nos2x). The extension holds the key and
//                   does the signing; nothing secret is stored here.
//   • 'nsec'      — a secret key pasted/uploaded by the user. Signing happens
//                   locally with nostr-tools (imported on demand). The key is
//                   kept in this browser's localStorage — see the warning shown
//                   in the login dialog.
//
// signEvent() and nip44Encrypt() branch on the method, so callers (reviews,
// comments, the gift-wrapped order flow) work the same regardless of how the
// user signed in. Components open the login dialog by dispatching the
// `nostr:open-login` window event, and react to `nostr:auth` for state changes.
//
// Import this ONLY from client <script> blocks.

import { RELAYS } from './market';

export type LoginMethod = 'extension' | 'nsec';

export interface NostrSession {
  pubkey: string; // hex
  method: LoginMethod;
  name?: string;
  picture?: string;
  sk?: string; // hex secret key — only present for method 'nsec' (this browser)
}

const KEY = 'lp_nostr_session';

export function getSession(): NostrSession | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

function setSession(s: NostrSession | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
  // Don't leak the secret key to listeners.
  const detail = s ? { pubkey: s.pubkey, method: s.method, name: s.name, picture: s.picture } : null;
  window.dispatchEvent(new CustomEvent('nostr:auth', { detail }));
}

export function logout() {
  setSession(null);
}

export function openLogin() {
  window.dispatchEvent(new CustomEvent('nostr:open-login'));
}

function hexToBytes(hex: string): Uint8Array {
  const a = new Uint8Array(hex.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return a;
}
function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

// ---- Login ----
export async function loginExtension(): Promise<NostrSession> {
  const nostr = (window as any).nostr;
  if (!nostr || typeof nostr.getPublicKey !== 'function') throw new Error('no-extension');
  const pubkey = await nostr.getPublicKey();
  return finish({ pubkey, method: 'extension' });
}

export async function loginNsec(nsec: string): Promise<NostrSession> {
  const [{ decode }, { getPublicKey }] = await Promise.all([
    import('nostr-tools/nip19'),
    import('nostr-tools/pure'),
  ]);
  const dec = decode(nsec.trim());
  if (dec.type !== 'nsec') throw new Error('bad-nsec');
  const sk = dec.data as Uint8Array;
  const pubkey = getPublicKey(sk);
  return finish({ pubkey, method: 'nsec', sk: bytesToHex(sk) });
}

// Kept for backwards-compatibility (older callers used login() === extension).
export const login = loginExtension;

async function finish(base: NostrSession): Promise<NostrSession> {
  let name: string | undefined;
  let picture: string | undefined;
  try {
    const profile = await fetchProfile(base.pubkey);
    name = profile?.display_name || profile?.name;
    picture = profile?.picture;
  } catch {}
  const session: NostrSession = { ...base, name, picture };
  setSession(session);
  return session;
}

// ---- Signing / encryption (method-aware) ----
export async function signEvent(unsigned: any): Promise<any> {
  const s = getSession();
  if (!s) throw new Error('not-signed-in');
  if (s.method === 'extension') {
    const nostr = (window as any).nostr;
    if (!nostr || typeof nostr.signEvent !== 'function') throw new Error('no-extension');
    return nostr.signEvent(unsigned);
  }
  // nsec
  const { finalizeEvent } = await import('nostr-tools/pure');
  const { pubkey, ...template } = unsigned;
  return finalizeEvent(template, hexToBytes(s.sk!));
}

export async function nip44Encrypt(recipientHex: string, plaintext: string): Promise<string> {
  const s = getSession();
  if (!s) throw new Error('not-signed-in');
  if (s.method === 'extension') {
    const nostr = (window as any).nostr;
    if (!nostr || !nostr.nip44 || typeof nostr.nip44.encrypt !== 'function') throw new Error('no-nip44');
    return nostr.nip44.encrypt(recipientHex, plaintext);
  }
  const nip44 = await import('nostr-tools/nip44');
  const convKey = nip44.getConversationKey(hexToBytes(s.sk!), recipientHex);
  return nip44.encrypt(plaintext, convKey);
}

// ---- Publish ----
// Publish a signed event to the relays; resolves once one accepts (or after a
// short grace period). Shared by the reviews + comments + order flows.
// All sockets are cleaned up when the publish settles: open ones are closed
// (close() flushes the already-queued EVENT first), and still-connecting ones
// send-then-close on open, so the event still propagates best-effort to slower
// relays without leaking connections.
export function publish(signed: any, relays: string[] = RELAYS): Promise<void> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(['EVENT', signed]);
    const sockets: WebSocket[] = [];
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      for (const ws of sockets) {
        try {
          if (ws.readyState === WebSocket.OPEN) ws.close();
          else if (ws.readyState === WebSocket.CONNECTING) {
            // Let it finish connecting, deliver the event, then close.
            ws.onopen = () => {
              try {
                ws.send(payload);
              } catch {}
              try {
                ws.close();
              } catch {}
            };
            ws.onmessage = null;
          }
        } catch {}
      }
      resolve();
    };
    const overall = window.setTimeout(done, 4000);
    relays.forEach((url) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        return;
      }
      sockets.push(ws);
      ws.onopen = () => ws.send(payload);
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m[0] === 'OK' && m[1] === signed.id) done();
        } catch {}
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {}
      };
    });
  });
}

// Best-effort fetch of a kind-0 profile (newest across relays).
function fetchProfile(hex: string): Promise<any | null> {
  return new Promise((resolve) => {
    let newest: any = null;
    let newestAt = -1;
    let pending = RELAYS.length;
    let settled = false;
    const finishFetch = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(newest);
    };
    const timer = window.setTimeout(finishFetch, 4000);
    const onOneDone = () => {
      if (--pending <= 0) finishFetch();
    };
    RELAYS.forEach((url) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        onOneDone();
        return;
      }
      const sub = Math.random().toString(36).slice(2, 10);
      ws.onopen = () => ws.send(JSON.stringify(['REQ', sub, { kinds: [0], authors: [hex], limit: 1 }]));
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m[0] === 'EVENT' && m[1] === sub) {
            const ev = m[2];
            if (ev.created_at > newestAt) {
              newestAt = ev.created_at;
              try {
                newest = JSON.parse(ev.content);
              } catch {}
            }
          }
          if (m[0] === 'EOSE' && m[1] === sub) {
            try {
              ws.close();
            } catch {}
            onOneDone();
          }
        } catch {}
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {}
        onOneDone();
      };
    });
  });
}

// Short display handle for a hex pubkey when no profile name is known.
export function shortId(hex: string): string {
  return hex ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : 'anon';
}
