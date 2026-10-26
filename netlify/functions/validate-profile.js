// Netlify serverless function: validates a Nostr npub or X/Twitter handle
// and resolves the profile avatar URL before a donation invoice is created.
//
// No environment variables required.

const WebSocket = require('ws');

const RELAYS = [
  'wss://relay.primal.net',
  'wss://nostr.oxtr.dev',
  'wss://nos.lol',
];

const RELAY_TIMEOUT = 5000; // 5 seconds per relay

// Inline bech32 decoder (from NostrProducts.astro pattern)
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Decode(str) {
  str = str.toLowerCase();
  const pos = str.lastIndexOf('1');
  if (pos < 1 || pos + 7 > str.length) return null;

  const dataStr = str.slice(pos + 1);
  const data = [];
  for (const c of dataStr) {
    const idx = BECH32_CHARSET.indexOf(c);
    if (idx === -1) return null;
    data.push(idx);
  }

  // Remove checksum (last 6 characters)
  const values = data.slice(0, -6);

  // Convert 5-bit values to 8-bit bytes
  let acc = 0;
  let bits = 0;
  const bytes = [];
  for (const v of values) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }

  return bytes;
}

function npubToHex(npub) {
  if (!npub || !npub.startsWith('npub1')) return null;
  const bytes = bech32Decode(npub);
  if (!bytes || bytes.length !== 32) return null;
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Query a single Nostr relay for kind:0 profile metadata
function queryRelay(relayUrl, hexPubkey) {
  return new Promise((resolve) => {
    let result = null;
    const ws = new WebSocket(relayUrl);
    const subscriptionId = 'validate-' + Date.now();

    const timeout = setTimeout(() => {
      ws.close();
      resolve(null);
    }, RELAY_TIMEOUT);

    ws.on('open', () => {
      ws.send(JSON.stringify([
        'REQ',
        subscriptionId,
        { kinds: [0], authors: [hexPubkey] }
      ]));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg[0] === 'EVENT' && msg[2]) {
          const event = msg[2];
          try {
            const profile = JSON.parse(event.content);
            if (!result || result.created_at < event.created_at) {
              result = { ...profile, created_at: event.created_at };
            }
          } catch (e) { /* invalid content JSON */ }
        }

        if (msg[0] === 'EOSE') {
          clearTimeout(timeout);
          ws.close();
          resolve(result);
        }
      } catch (e) { /* invalid message */ }
    });

    ws.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

// Resolve a Nostr npub to an avatar URL via relay queries
async function resolveNostrAvatar(npub) {
  const hex = npubToHex(npub);
  if (!hex) return null;

  for (const relay of RELAYS) {
    try {
      const profile = await queryRelay(relay, hex);
      if (profile && profile.picture) {
        // Wrap with Primal CDN for optimised delivery
        const encodedUrl = encodeURIComponent(profile.picture);
        return 'https://primal.b-cdn.net/media-cache?s=m&a=1&u=' + encodedUrl;
      }
    } catch (e) {
      // Try next relay
    }
  }

  return null;
}

// Validate an X/Twitter handle and return avatar URL
async function resolveXAvatar(handle) {
  const url = 'https://unavatar.io/twitter/' + encodeURIComponent(handle);
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (response.ok) {
      return url;
    }
  } catch (e) {
    // unavatar unreachable
  }
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const npub = (body.npub || '').trim();
  const xHandle = (body.xHandle || '').trim().replace(/^@/, '');

  // Basic format validation
  if (npub && !npub.match(/^npub1[a-z0-9]{58}$/)) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valid: false, error: 'Invalid npub format. It should start with npub1 and be 63 characters long.' })
    };
  }

  if (xHandle && !xHandle.match(/^[a-zA-Z0-9_]{1,15}$/)) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valid: false, error: 'Invalid X handle format. Use only letters, numbers, and underscores (max 15 characters).' })
    };
  }

  if (!npub && !xHandle) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valid: false, error: 'Please provide a Nostr npub or X handle.' })
    };
  }

  // Priority: npub over xHandle
  let avatarUrl = null;

  if (npub) {
    avatarUrl = await resolveNostrAvatar(npub);
    if (!avatarUrl) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valid: false, error: 'Could not find a Nostr profile for that npub. Please check and try again.' })
      };
    }
  } else if (xHandle) {
    avatarUrl = await resolveXAvatar(xHandle);
    if (!avatarUrl) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valid: false, error: 'Could not find an X/Twitter profile for that handle. Please check and try again.' })
      };
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valid: true, avatarUrl: avatarUrl })
  };
};
