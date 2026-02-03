#!/usr/bin/env node

/**
 * Fetch Nostr profile pictures from relays
 *
 * Usage: node scripts/fetch-nostr-avatars.js
 *
 * This script:
 * 1. Converts npub addresses to hex pubkeys
 * 2. Queries Nostr relays for kind:0 (profile metadata) events
 * 3. Extracts and displays avatar URLs
 */

import WebSocket from 'ws';
import { bech32 } from 'bech32';

// Nostr relays to query
const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

// npub/nprofile addresses to look up
const NPUBS = [
  // Core Team
  { name: 'BlackCoffee', npub: 'npub1dqepr0g4t3ahvnjtnxazvws4rkqjpxl854n29wcew8wph0fmw90qlsmmgt' },
  { name: 'Jake', npub: 'npub1a8us7vr738n7cvdxh0gdtnt5qzrk4qe3qklhmsrs45llq2k48agqjkrvn3' },
  { name: 'Richard', npub: 'npub1dwekunm9w9agazkwcq88ymxmj0j3qgxcu4mwfqnjqvyusa9cuxrs0wsqel' },

  // Contributors
  { name: '₿arekev', npub: 'npub1s3wrhlcdjjmtp7n4m0y36dnqyljfzsr4xah36gelx6d870un5jvsnqtfhs' },
  { name: 'Ben Weeks', npub: 'npub1jutptdc2m8kgjmudtws095qk2tcale0eemvp4j2xnjnl4nh6669slrf04x' },
  { name: 'Bitko Yinowsky', npub: 'nprofile1qqstdp3mrrh5ttnvjjvx6psufgwjf5l8c6hxw7y5ej4r4sy2p8s4vmqzu55tu' },
  { name: 'Isaac Weeks', npub: 'npub17dfg3tynlv39m0e9z8a0t558e7plet96xg9g4uu6q84caykq8jtqwdy09f' },
  { name: 'Orange Surf btc', npub: 'npub18h0w55nsp839ezxnggf00jd2xc6yl0ht62mf5p8wwllu8s80wdcs83ws8m' },
  { name: 'Zobroj', npub: 'npub1dlhf5h6mgzs3lc7n3e8zenrzaj4kukm05ujwf0gzdgkvy5g6s52stupj4a' },
];

/**
 * Convert npub or nprofile (bech32) to hex pubkey
 * nprofile contains TLV-encoded data where the pubkey is the first 32 bytes after type 0x00
 */
function npubToHex(bech32Str) {
  try {
    const decoded = bech32.decode(bech32Str, 90);
    const bytes = bech32.fromWords(decoded.words);

    // If it's an npub, the bytes are directly the pubkey
    if (decoded.prefix === 'npub') {
      return Buffer.from(bytes).toString('hex');
    }

    // If it's an nprofile, parse TLV to extract pubkey
    if (decoded.prefix === 'nprofile') {
      // TLV format: type (1 byte) + length (1 byte) + value
      // Type 0x00 = pubkey (32 bytes)
      let i = 0;
      while (i < bytes.length) {
        const type = bytes[i];
        const length = bytes[i + 1];
        if (type === 0x00 && length === 32) {
          return Buffer.from(bytes.slice(i + 2, i + 2 + 32)).toString('hex');
        }
        i += 2 + length;
      }
    }

    console.error(`Unknown bech32 prefix: ${decoded.prefix}`);
    return null;
  } catch (err) {
    console.error(`Failed to decode: ${bech32Str}`, err.message);
    return null;
  }
}

/**
 * Query a relay for profile metadata
 */
function queryRelay(relayUrl, hexPubkeys) {
  return new Promise((resolve) => {
    const results = new Map();
    const ws = new WebSocket(relayUrl);
    const subscriptionId = 'avatar-fetch-' + Date.now();

    const timeout = setTimeout(() => {
      ws.close();
      resolve(results);
    }, 10000); // 10 second timeout

    ws.on('open', () => {
      // Send REQ for kind:0 (metadata) events
      const req = JSON.stringify([
        'REQ',
        subscriptionId,
        {
          kinds: [0],
          authors: hexPubkeys
        }
      ]);
      ws.send(req);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg[0] === 'EVENT' && msg[2]) {
          const event = msg[2];
          const pubkey = event.pubkey;

          // Parse the content (JSON string with profile data)
          try {
            const profile = JSON.parse(event.content);

            // Only keep if newer than what we have
            if (!results.has(pubkey) || results.get(pubkey).created_at < event.created_at) {
              results.set(pubkey, {
                ...profile,
                created_at: event.created_at
              });
            }
          } catch (e) {
            // Invalid JSON in content
          }
        }

        if (msg[0] === 'EOSE') {
          // End of stored events
          clearTimeout(timeout);
          ws.close();
          resolve(results);
        }
      } catch (e) {
        // Invalid message
      }
    });

    ws.on('error', (err) => {
      console.error(`Relay ${relayUrl} error:`, err.message);
      clearTimeout(timeout);
      resolve(results);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      resolve(results);
    });
  });
}

/**
 * Main function
 */
async function main() {
  console.log('Fetching Nostr profile avatars...\n');

  // Convert npubs to hex
  const lookups = NPUBS.map(({ name, npub }) => ({
    name,
    npub,
    hex: npubToHex(npub)
  })).filter(l => l.hex);

  const hexPubkeys = lookups.map(l => l.hex);

  // Query each relay and merge results
  const allResults = new Map();

  for (const relay of RELAYS) {
    console.log(`Querying ${relay}...`);
    try {
      const results = await queryRelay(relay, hexPubkeys);

      // Merge results, keeping the newest
      for (const [pubkey, profile] of results) {
        if (!allResults.has(pubkey) || allResults.get(pubkey).created_at < profile.created_at) {
          allResults.set(pubkey, profile);
        }
      }
    } catch (err) {
      console.error(`Failed to query ${relay}:`, err.message);
    }
  }

  console.log('\n--- Results ---\n');

  // Output results
  for (const { name, npub, hex } of lookups) {
    const profile = allResults.get(hex);

    if (profile) {
      console.log(`${name}:`);
      console.log(`  npub: ${npub}`);
      console.log(`  hex:  ${hex}`);
      console.log(`  name: ${profile.name || profile.display_name || 'N/A'}`);
      console.log(`  avatar: ${profile.picture || 'N/A'}`);

      // Generate the primal CDN URL for easy copy-paste
      if (profile.picture) {
        const encodedUrl = encodeURIComponent(profile.picture);
        console.log(`  primal CDN: https://primal.b-cdn.net/media-cache?s=m&a=1&u=${encodedUrl}`);
      }
      console.log('');
    } else {
      console.log(`${name}: No profile found`);
      console.log(`  npub: ${npub}`);
      console.log(`  hex:  ${hex}`);
      console.log('');
    }
  }

  // Output as JavaScript object for easy copy-paste into credits.astro
  console.log('\n--- Copy-paste format for credits.astro ---\n');

  for (const { name, npub, hex } of lookups) {
    const profile = allResults.get(hex);
    if (profile?.picture) {
      const encodedUrl = encodeURIComponent(profile.picture);
      console.log(`{ name: '${name}', avatar: 'https://primal.b-cdn.net/media-cache?s=m&a=1&u=${encodedUrl}' },`);
    }
  }
}

main().catch(console.error);
