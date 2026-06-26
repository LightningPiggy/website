---
title: FAQs
slug: faqs
pubDate: 2023-04-27
---

### Where are the bitcoin stored?

Unlike a traditional piggy bank, they're not "inside the piggy." They live in the wallet you connect to. If someone ran off with your Lightning Piggy and you'd connected a watch-only wallet, the most they could do is see your balance, recent transactions, and the address used to receive bitcoin. Your funds stay safe in the wallet you control.

### Does Lightning Piggy custody funds?

Absolutely not, and we don't want to. Lightning Piggy is an open-source project run by volunteers. The device simply connects to a wallet of your choice. As bitcoiners, we live by "not your keys, not your coins," so we recommend connecting it with your own self-custodial wallet wherever possible. We can recommend [LNbits](https://lnbits.com/) or [Alby Hub](https://albyhub.com/) since both support multiple family accounts and are easy to use.

That said, we understand the tradeoffs with pocket-money sized amounts, especially when it comes to ease and speed. Connecting to a custodial wallet can be a reasonable choice if the balance is small, or if you set up an auto-sweep to cold storage. Some custodial wallets have this feature baked in, such as in the case of [CoinOS](https://coinos.io).

### Why prioritise Lightning payments over the main chain?

When choosing between Bitcoin's main chain (Layer 1) and the Lightning Network (Layer 2), we started with Lightning for its near-instant settlement, ultra-low fees that don't swing with memepool congestion, and the ease of attaching a message to each payment.

Lightning Piggy is built for small, routine transactions: pocket money, and rewards for homework or chores. But MicroPythonOS p1 now supports connecting to both a hot wallet (Lightning) and a cold wallet (on-chain). Switch between spending and savings at the touch of a button.

We released this update in honour of [Fart Face 2000 (FF2K)](http://njump.me/nprofile1qqsyg6gs8yx8ynaycnms6j0r7kwz4p0wagexa0je3sl32xlate5mqaqrn7mpy), who created BitPiggys back in 2019: an Opendime strapped to a physical piggy bank. The cold wallet is perfect for long-term savings.

### Why "Lightning Piggy", and not "Bitcoin Piggy"?

Bitcoin Piggy would also be a great name for the project. However, Lightning Piggy fits better for two reasons:

1. The piggy is designed for displaying small amounts, such as for pocket money and homework/housework task payments, meaning its design is lightning network native and therefore part of his pedigree.
2. Lightning Piggy has his life to thank for escaping the fiat money system when the truck he was travelling in got struck by *lightning* and crashed on the way to the abattoir. It's a harrowing story where he was chased into a forest, only evading capture by diving down a bottomless rabbit hole. During his time down the hole he meets lots of interesting characters who showed him the way to freedom.

### Does Lightning Piggy support Tor?

The device itself doesn't run over Tor but it could theoretically, since Tor seems to have been ported to the ESP32. However, we believe it wouldn't be trivial to implement and performant to run.
