// Lightning payments were paused from 8 to 21 November 2026, while our
// LNbits server (oink@lightningpiggy.com and BTCPay's Lightning payments)
// waited for a software update. They work again.
//
// If Lightning ever has to be paused again, set this to true: every
// "Lightning payments are paused" notice (components/ui/LightningPaused.astro)
// then shows on the pages that take Lightning payments.
export const LIGHTNING_PAUSED = false;
