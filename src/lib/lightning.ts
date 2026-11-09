// Lightning payments are paused: our LNbits server, which handles
// oink@lightningpiggy.com and BTCPay's Lightning payments, is switched off
// until a software update is out (since 8 November 2026). On-chain payments
// through BTCPay still work.
//
// When Lightning is back, set this to false: every "Lightning payments are
// paused" notice (components/ui/LightningPaused.astro) then disappears.
export const LIGHTNING_PAUSED = true;
