// nostrOrder.ts
// Send a NIP-17 gift-wrapped (NIP-59) private DM to a recipient — used to
// deliver a buyer's order + shipping address to a vendor privately, mirroring
// the robotechy checkout's wrapped-note flow (kind 14 readable message).
//
// A gift wrap has three layers:
//   1. rumor  — unsigned kind-14 chat message (the actual content)
//   2. seal   — kind 13, the rumor NIP-44-encrypted sender→recipient, signed by
//               the SENDER. We do this via the NIP-07 extension (which holds the
//               user's key) — window.nostr.nip44.encrypt + signEvent.
//   3. wrap   — kind 1059, the seal NIP-44-encrypted from a fresh EPHEMERAL key
//               to the recipient, signed by that ephemeral key. We generate the
//               ephemeral key locally with nostr-tools (the extension can't sign
//               with a random key), so nostr-tools is imported dynamically here —
//               it only loads when a buyer actually checks out.
//
// Works signed-in OR as a guest:
//   • signed in  — the seal is signed + encrypted via nostrAuth (extension or
//     nsec), so the vendor sees the buyer's real npub and can reply over Nostr.
//   • guest      — a throwaway ephemeral key is generated just for this order, so
//     no account is needed ("no account needed" copy). The order is one-way; the
//     vendor replies via the email in the order.
// The outer gift wrap always uses a fresh ephemeral key regardless.

import { publish, signEvent, nip44Encrypt, getSession } from './nostrAuth';

// One-time guest key: create ONE per order and pass it to every send for that
// order, so the vendor sees the kind-14 note and the kind-16 order from the
// same (throwaway) sender and can correlate them.
export async function makeGuestKey(): Promise<Uint8Array> {
  const { generateSecretKey } = await import('nostr-tools/pure');
  return generateSecretKey();
}

// Send a gift-wrapped kind-14 chat message (human-readable).
export function sendGiftWrappedDM(recipientHex: string, message: string, guestSk?: Uint8Array): Promise<void> {
  return sendGiftWrapped(recipientHex, 14, [['p', recipientHex]], message, guestSk);
}

// Send a gift-wrapped structured event (e.g. Gamma kind-16 order, kind-17
// receipt). Tags are the rumor's tags; a ['p', recipient] is expected in them.
export function sendGiftWrappedEvent(
  recipientHex: string,
  kind: number,
  tags: string[][],
  content: string,
  guestSk?: Uint8Array,
): Promise<void> {
  return sendGiftWrapped(recipientHex, kind, tags, content, guestSk);
}

async function sendGiftWrapped(
  recipientHex: string,
  rumorKind: number,
  rumorTags: string[][],
  message: string,
  guestSk?: Uint8Array,
): Promise<void> {
  const session = getSession();

  const [pure, nip44] = await Promise.all([import('nostr-tools/pure'), import('nostr-tools/nip44')]);
  const { generateSecretKey, getPublicKey, finalizeEvent, getEventHash } = pure;

  const now = Math.floor(Date.now() / 1000);
  // NIP-59: randomise timestamps up to 2 days in the past to hide metadata.
  const past = () => now - Math.floor(Math.random() * 172800);

  // Sender identity + how to seal: the signed-in account, or a guest key.
  let senderPubkey: string;
  let sealEncrypt: (pt: string) => Promise<string> | string;
  let sealSign: (tmpl: any) => Promise<any> | any;
  if (session) {
    senderPubkey = session.pubkey;
    sealEncrypt = (pt) => nip44Encrypt(recipientHex, pt);
    sealSign = (tmpl) => signEvent(tmpl);
  } else {
    const gk = guestSk || generateSecretKey();
    senderPubkey = getPublicKey(gk);
    sealEncrypt = (pt) => nip44.encrypt(pt, nip44.getConversationKey(gk, recipientHex));
    sealSign = (tmpl) => finalizeEvent(tmpl, gk);
  }

  // 1. Rumor — unsigned inner event (kind 14 chat, or structured kind 16/17).
  const rumor: any = {
    kind: rumorKind,
    pubkey: senderPubkey,
    created_at: now,
    tags: rumorTags,
    content: message,
  };
  rumor.id = getEventHash(rumor);

  // 2. Seal — kind 13 signed by the sender; content = rumor encrypted to recipient.
  const sealContent = await sealEncrypt(JSON.stringify(rumor));
  const seal = await sealSign({
    kind: 13,
    pubkey: senderPubkey,
    created_at: past(),
    tags: [],
    content: sealContent,
  });

  // 3. Gift wrap — kind 1059 signed by a fresh ephemeral key; content = seal
  //    encrypted ephemeral→recipient.
  const ephSk = generateSecretKey();
  const convKey = nip44.getConversationKey(ephSk, recipientHex);
  const wrap = finalizeEvent(
    {
      kind: 1059,
      created_at: past(),
      tags: [['p', recipientHex]],
      content: nip44.encrypt(JSON.stringify(seal), convKey),
    },
    ephSk,
  );

  await publish(wrap);
}
