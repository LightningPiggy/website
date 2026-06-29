// marketServer.ts
// Build-time (Node) relay fetch for prerendering the market. Uses the `ws`
// package since Node may have no global WebSocket. Mirrors the browser
// fetchFromRelay timeout/fail-safe behaviour, and is written so it can NEVER
// throw or hang the Astro build: every relay is wrapped in a timeout + try/catch
// and the overall call resolves with whatever events arrived (or []).

import WebSocket from 'ws';
import { RELAYS, type NostrEvent } from './market';

function fetchFromRelay(
  url: string,
  kinds: number[],
  authors: string[],
  timeoutMs: number,
): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    let ws: WebSocket | undefined;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws && ws.close();
      } catch {}
      resolve(events);
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch {
      finish();
      return;
    }
    const sub = Math.random().toString(36).slice(2, 10);
    ws.on('open', () => {
      try {
        ws!.send(JSON.stringify(['REQ', sub, { kinds, authors }]));
      } catch {
        finish();
      }
    });
    ws.on('message', (data: any) => {
      try {
        const m = JSON.parse(data.toString());
        if (m[0] === 'EVENT' && m[1] === sub) events.push(m[2]);
        if (m[0] === 'EOSE' && m[1] === sub) finish();
      } catch {}
    });
    ws.on('error', () => finish());
  });
}

// Fetch events of the given kinds for the given hex authors across all relays,
// merged. Returns [] on any failure (so the build degrades to client-only
// rendering rather than breaking).
export async function fetchMarketEvents(
  authors: string[],
  kinds: number[],
  timeoutMs = 6000,
): Promise<NostrEvent[]> {
  if (!authors.length) return [];
  try {
    const results = await Promise.all(
      RELAYS.map((r) => fetchFromRelay(r, kinds, authors, timeoutMs)),
    );
    return results.flat();
  } catch {
    return [];
  }
}
