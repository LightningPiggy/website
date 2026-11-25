// social.ts
// Lightning Piggy's own profiles elsewhere. The footer links them and the
// Organization JSON-LD lists them as sameAs, so the two can't drift apart.
export const socialLinks = [
  { label: 'Nostr', href: 'https://primal.net/lightningpiggy', icon: 'nostr' },
  { label: 'X', href: 'https://x.com/lightningpiggy', icon: 'x' },
  { label: 'Telegram', href: 'https://t.me/LightningPiggy', icon: 'telegram' },
  { label: 'GitHub', href: 'https://github.com/LightningPiggy', icon: 'github' },
] as const;
