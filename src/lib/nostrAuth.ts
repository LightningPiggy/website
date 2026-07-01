// nostrAuth.ts
// Tiny browser-only Nostr session helper (NIP-07). Kept dependency-free to match
// the rest of the market code (the browser extension does the signing, so we
// never touch secp256k1). Import this ONLY from client <script> blocks — it
// touches window/localStorage and must not run in the Astro build.
//
// A "session" is just the logged-in pubkey plus a cached profile (name/picture)
// for display. Sign-in is via a NIP-07 extension (Alby, nos2x, …). Components
// listen for the `nostr:auth` window event to react to log in / log out.

import { RELAYS } from './market';

export interface NostrSession {
  pubkey: string; // hex
  name?: string;
  picture?: string;
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
  window.dispatchEvent(new CustomEvent('nostr:auth', { detail: s }));
}

export function logout() {
  setSession(null);
}

// Sign in with a NIP-07 extension, then enrich with the kind-0 profile.
export async function login(): Promise<NostrSession> {
  const nostr = (window as any).nostr;
  if (!nostr || typeof nostr.getPublicKey !== 'function') {
    throw new Error('no-extension');
  }
  const pubkey = await nostr.getPublicKey();
  let name: string | undefined;
  let picture: string | undefined;
  try {
    const profile = await fetchProfile(pubkey);
    name = profile?.display_name || profile?.name;
    picture = profile?.picture;
  } catch {}
  const session: NostrSession = { pubkey, name, picture };
  setSession(session);
  return session;
}

// Sign an event template with the current extension. Requires the extension to
// be present (the session in localStorage is only an identity cache).
export async function signEvent(unsigned: any): Promise<any> {
  const nostr = (window as any).nostr;
  if (!nostr || typeof nostr.signEvent !== 'function') {
    throw new Error('no-extension');
  }
  return nostr.signEvent(unsigned);
}

// Publish a signed event to the relays; resolves once one accepts (or after a
// short grace period). Shared by the reviews + comments forms.
export function publish(signed: any): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const overall = window.setTimeout(done, 4000);
    RELAYS.forEach((url) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        return;
      }
      ws.onopen = () => ws.send(JSON.stringify(['EVENT', signed]));
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m[0] === 'OK' && m[1] === signed.id) {
            try {
              ws.close();
            } catch {}
            clearTimeout(overall);
            done();
          }
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
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(newest);
    };
    const timer = window.setTimeout(finish, 4000);
    const onOneDone = () => {
      if (--pending <= 0) finish();
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
