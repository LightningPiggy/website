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
// Requires a NIP-07 extension that implements nip44 (e.g. Alby). Throws
// 'no-extension' / 'no-nip44' otherwise so the UI can explain.

import { publish } from './nostrAuth';

export async function sendGiftWrappedDM(recipientHex: string, message: string): Promise<void> {
  const nostr = (window as any).nostr;
  if (!nostr || !nostr.getPublicKey || !nostr.signEvent) throw new Error('no-extension');
  if (!nostr.nip44 || typeof nostr.nip44.encrypt !== 'function') throw new Error('no-nip44');

  const [pure, nip44] = await Promise.all([import('nostr-tools/pure'), import('nostr-tools/nip44')]);
  const { generateSecretKey, finalizeEvent, getEventHash } = pure;

  const senderPubkey = await nostr.getPublicKey();
  const now = Math.floor(Date.now() / 1000);
  // NIP-59: randomise timestamps up to 2 days in the past to hide metadata.
  const past = () => now - Math.floor(Math.random() * 172800);

  // 1. Rumor — unsigned kind-14 message.
  const rumor: any = {
    kind: 14,
    pubkey: senderPubkey,
    created_at: now,
    tags: [['p', recipientHex]],
    content: message,
  };
  rumor.id = getEventHash(rumor);

  // 2. Seal — kind 13 signed by the sender; content = rumor encrypted to recipient.
  const sealContent = await nostr.nip44.encrypt(recipientHex, JSON.stringify(rumor));
  const seal = await nostr.signEvent({
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
